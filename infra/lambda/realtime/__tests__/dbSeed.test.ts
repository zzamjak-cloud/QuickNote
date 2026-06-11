import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Y from "yjs";

const sendMock = vi.fn();
vi.mock("@aws-sdk/lib-dynamodb", async (orig) => {
  const actual = await orig<typeof import("@aws-sdk/lib-dynamodb")>();
  return {
    ...actual,
    DynamoDBDocumentClient: { from: () => ({ send: (...a: unknown[]) => sendMock(...a) }) },
  };
});

beforeEach(() => {
  sendMock.mockReset();
  process.env.DATABASE_TABLE = "DB";
  process.env.PAGE_TABLE = "PG";
});

function decodeRows(update: Uint8Array) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  const root = doc.getMap("db");
  const rows = root.get("rows") as Y.Map<Y.Map<unknown>>;
  const out: Record<string, Record<string, unknown>> = {};
  for (const [pid, row] of rows.entries()) {
    const inner: Record<string, unknown> = {};
    for (const [cid, v] of (row as Y.Map<unknown>).entries()) inner[cid] = v;
    out[pid] = inner;
  }
  return out;
}

describe("buildDbSeedUpdate rows 시드", () => {
  it("rowPageOrder 의 각 행 dbCells 를 rows 로 시드한다(빈 셀 행도 inner map 시드)", async () => {
    const { buildDbSeedUpdate } = await import("../dbSeed");
    sendMock.mockImplementation((cmd: { input: { TableName: string; Key: { id?: string } } }) => {
      const t = cmd.input.TableName;
      if (t === "DB") {
        return Promise.resolve({ Item: {
          id: "db1", columns: "[]", presets: "[]", panelState: "{}",
          rowPageOrder: JSON.stringify(["pg1", "pg2", "pg3"]),
        }});
      }
      const id = cmd.input.Key.id;
      if (id === "pg1") return Promise.resolve({ Item: { id: "pg1", dbCells: JSON.stringify({ c1: "a" }) } });
      if (id === "pg2") return Promise.resolve({ Item: { id: "pg2", dbCells: JSON.stringify({ c1: "b" }) } });
      if (id === "pg3") return Promise.resolve({ Item: { id: "pg3", dbCells: null } }); // 빈 셀 행
      return Promise.resolve({ Item: undefined });
    });

    const update = await buildDbSeedUpdate("db1");
    expect(update).not.toBeNull();
    expect(decodeRows(update!)).toEqual({ pg1: { c1: "a" }, pg2: { c1: "b" }, pg3: {} });
  });

  it("Database 항목이 없으면 null 을 반환한다", async () => {
    const { buildDbSeedUpdate } = await import("../dbSeed");
    sendMock.mockResolvedValue({ Item: undefined });
    expect(await buildDbSeedUpdate("nope")).toBeNull();
  });
});
