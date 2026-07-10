// 8인 동시 편집 시뮬레이션 — 서버 영속(yjsStore)의 동시성 회귀 테스트.
// 2026-07-10 사고: compactPage 가 머지 후 로그를 재조회해 전부 삭제, 그 사이 다른 Lambda 가
// append 한 update 를 머지 없이 삭제(영구 유실) + 동시 compaction 스냅샷 last-writer-wins.
// 이 테스트는 in-memory DynamoDB 로 실제 모듈 로직을 8클라 폭주 상황으로 구동해
// "모든 클라이언트의 편집이 최종 머지 상태에 남아있는지"를 검증한다.
import { describe, it, expect, beforeAll, vi } from "vitest";
import * as Y from "yjs";

// ===== in-memory DynamoDB =====
type Item = Record<string, unknown>;
const ydocTable = new Map<string, Item>();
const updatesTable = new Map<string, Item>(); // key: `${pageId}#${seq}`

// 호출 인터리빙을 넓히기 위한 소지연(모듈 로직의 read-modify-write 창을 벌린다).
const jitter = () => new Promise((r) => setTimeout(r, Math.floor(Math.random() * 3)));

function queryItems(pageId: string): Item[] {
  return [...updatesTable.entries()]
    .filter(([k]) => k.startsWith(`${pageId}#`))
    .map(([, v]) => v)
    .sort((a, b) => String(a.seq).localeCompare(String(b.seq)));
}

const PAGE_SIZE = 7; // 페이지네이션 경로도 항상 타도록 작은 페이지 크기

async function fakeSend(cmd: { constructor: { name: string }; input: Item }): Promise<Item> {
  await jitter();
  const name = cmd.constructor.name;
  const input = cmd.input as Item;
  const table = input.TableName as string;

  if (name === "GetCommand") {
    const key = (input.Key as Item).pageId as string;
    return { Item: ydocTable.get(key) };
  }
  if (name === "PutCommand") {
    const item = input.Item as Item;
    if (table === "ydoc") {
      const existing = ydocTable.get(item.pageId as string);
      const cond = input.ConditionExpression as string | undefined;
      if (cond === "attribute_not_exists(version)") {
        if (existing && existing.version !== undefined) {
          throw Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });
        }
      } else if (cond === "version = :v") {
        const v = (input.ExpressionAttributeValues as Item)[":v"];
        if (!existing || existing.version !== v) {
          throw Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });
        }
      }
      ydocTable.set(item.pageId as string, item);
      return {};
    }
    updatesTable.set(`${item.pageId}#${item.seq}`, item);
    return {};
  }
  if (name === "QueryCommand") {
    const pageId = (input.ExpressionAttributeValues as Item)[":p"] as string;
    const all = queryItems(pageId);
    if (input.Select === "COUNT") return { Count: all.length };
    const startIdx = input.ExclusiveStartKey
      ? all.findIndex((it) => it.seq === (input.ExclusiveStartKey as Item).seq) + 1
      : 0;
    const slice = all.slice(startIdx, startIdx + PAGE_SIZE);
    const last = startIdx + PAGE_SIZE < all.length ? slice[slice.length - 1] : undefined;
    return {
      Items: slice,
      ...(last ? { LastEvaluatedKey: { pageId, seq: last.seq } } : {}),
    };
  }
  if (name === "BatchWriteCommand") {
    const reqs = (input.RequestItems as Record<string, Array<{ DeleteRequest: { Key: Item } }>>)[
      "updates"
    ];
    for (const r of reqs) {
      updatesTable.delete(`${r.DeleteRequest.Key.pageId}#${r.DeleteRequest.Key.seq}`);
    }
    return {};
  }
  throw new Error(`unhandled command: ${name}`);
}

vi.mock("@aws-sdk/lib-dynamodb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/lib-dynamodb")>();
  return {
    ...actual,
    DynamoDBDocumentClient: { from: () => ({ send: fakeSend }) },
  };
});

let store: typeof import("../yjsStore");

beforeAll(async () => {
  process.env.YDOC_TABLE = "ydoc";
  process.env.YDOC_UPDATES_TABLE = "updates";
  store = await import("../yjsStore");
});

describe("yjsStore 8인 동시 편집(압축 폭주) 시뮬레이션", () => {
  it("compaction 이 반복돼도 8명 전원의 편집이 최종 머지 상태에 남는다", async () => {
    const pageId = "v99:page-8users";
    const CLIENTS = 8;
    const EDITS_PER_CLIENT = 80; // 총 640 append — COMPACT_THRESHOLD(50) 를 여러 번 넘긴다

    // 각 클라이언트는 자기 Y.Doc 에 자기 키의 텍스트를 누적하고, 발생한 update 를
    // 실제 모듈의 appendPageUpdate 로 서버에 영속한다(fan-out 은 이 테스트 관심사 아님).
    const runClient = async (idx: number) => {
      const doc = new Y.Doc();
      const pending: Uint8Array[] = [];
      doc.on("update", (u: Uint8Array) => pending.push(u));
      for (let i = 0; i < EDITS_PER_CLIENT; i += 1) {
        const text = doc.getText(`client-${idx}`);
        text.insert(text.length, `${idx}`);
        const u = pending.shift();
        if (u) await store.appendPageUpdate(pageId, u);
        if (i % 7 === idx % 7) await jitter(); // 클라별 상이한 타이밍
      }
    };

    await Promise.all(Array.from({ length: CLIENTS }, (_, i) => runClient(i)));

    const merged = await store.loadPageState(pageId);
    const finalDoc = new Y.Doc();
    Y.applyUpdate(finalDoc, merged);
    for (let i = 0; i < CLIENTS; i += 1) {
      const text = finalDoc.getText(`client-${i}`).toString();
      // 유실 없음: 각 클라이언트가 넣은 글자 수가 정확히 보존돼야 한다.
      expect(text).toBe(`${i}`.repeat(EDITS_PER_CLIENT));
    }
  }, 60_000);

  it("동시 compaction 경합에서도 스냅샷이 로그를 잃지 않는다(version 조건부 Put)", async () => {
    const pageId = "v99:page-compact-race";
    const doc = new Y.Doc();
    const updates: Uint8Array[] = [];
    doc.on("update", (u: Uint8Array) => updates.push(u));
    for (let i = 0; i < 120; i += 1) doc.getText("t").insert(i, "a");

    // 55개를 먼저 append(임계 초과 상태) 한 뒤, 나머지 65개를 8-way 동시 append —
    // 각 append 가 COUNT 임계에서 compactPage 를 중첩 실행한다.
    for (const u of updates.slice(0, 55)) await store.appendPageUpdate(pageId, u);
    await Promise.all(
      Array.from({ length: 8 }, (_, w) =>
        (async () => {
          for (let i = 55 + w; i < 120; i += 8) {
            await store.appendPageUpdate(pageId, updates[i]);
          }
        })(),
      ),
    );

    const merged = await store.loadPageState(pageId);
    const finalDoc = new Y.Doc();
    Y.applyUpdate(finalDoc, merged);
    expect(finalDoc.getText("t").toString()).toBe("a".repeat(120));
  }, 60_000);
});
