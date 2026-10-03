import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { prosemirrorToYXmlFragment } from "y-prosemirror";
import { Node as PMNode } from "prosemirror-model";
import {
  YJS_XML_FRAGMENT,
  CollabContentError,
  buildSeedUpdate as serverSeedUpdate,
  blockIdTypesOf,
  buildInsertUpdate,
  buildReplaceUpdate,
  normalizeLegacyJsonNode,
  schemaFromSpec,
  stateToDocJson,
  type DocJson,
} from "./collabContent";
import { stripBlockIds } from "./docJson";

const schema = schemaFromSpec();

const text = (t: string, marks?: DocJson["marks"]): DocJson => ({ type: "text", text: t, ...(marks ? { marks } : {}) });
const para = (t: string, id?: string): DocJson => ({
  type: "paragraph",
  ...(id ? { attrs: { id } } : {}),
  content: t ? [text(t)] : [],
});

// 실제 페이지와 유사한 본문(헤딩·리스트·콜아웃·토글·표·DB 블록·멘션·마크).
function realisticDoc(): DocJson {
  return {
    type: "doc",
    content: [
      { type: "heading", attrs: { id: "h1", level: 1 }, content: [text("제목")] },
      para("블록 A 본문", "pA"),
      {
        type: "bulletList",
        attrs: { id: "ul" },
        content: [
          { type: "listItem", content: [para("항목 1")] },
          { type: "listItem", content: [{ type: "paragraph", content: [text("굵게", [{ type: "bold" }])] }] },
        ],
      },
      para("블록 C 원본", "pC"),
      { type: "callout", attrs: { id: "co", preset: "idea", emoji: "💡" }, content: [para("콜아웃")] },
      {
        type: "toggle",
        attrs: { id: "tg", open: true },
        content: [
          { type: "toggleHeader", content: [text("토글 제목")] },
          { type: "toggleContent", content: [para("토글 내용")] },
        ],
      },
      {
        type: "table",
        attrs: { id: "tb" },
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableHeader", content: [para("H1")] },
              { type: "tableHeader", content: [para("H2")] },
            ],
          },
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [para("c1")] },
              { type: "tableCell", content: [para("c2")] },
            ],
          },
        ],
      },
      { type: "databaseBlock", attrs: { id: "db", databaseId: "db-1", layout: "inline", view: "table" } },
      {
        type: "paragraph",
        attrs: { id: "pm" },
        content: [
          text("담당 "),
          { type: "mention", attrs: { id: "m-1", label: "홍길동", mentionKind: "member" } },
          text(" 링크", [{ type: "link", attrs: { href: "https://example.com" } }]),
        ],
      },
    ],
  };
}

// 클라 src/lib/collab/yjsDoc.ts buildSeedUpdate 와 동일한 방식의 시드.
function buildSeedUpdate(json: DocJson): Uint8Array {
  const seedDoc = new Y.Doc();
  seedDoc.clientID = 0x5eed;
  const frag = seedDoc.get(YJS_XML_FRAGMENT, Y.XmlFragment) as Y.XmlFragment;
  prosemirrorToYXmlFragment(PMNode.fromJSON(schema, normalizeLegacyJsonNode(json)), frag);
  return Y.encodeStateAsUpdate(seedDoc);
}

function docFrom(...updates: Uint8Array[]): Y.Doc {
  const doc = new Y.Doc();
  for (const u of updates) Y.applyUpdate(doc, u);
  return doc;
}

// 정규형(기본값 채움) + 스키마 check 통과 확인.
function canonical(json: DocJson): unknown {
  const node = PMNode.fromJSON(schema, json);
  node.check();
  return node.toJSON();
}

// 서버가 새 블록에 생성한 id 를 무시하고 비교(블록 id 타입만, 인라인 mention.id 등은 유지).
const blockIdTypes = blockIdTypesOf(schema);
function canonicalNoIds(json: DocJson): unknown {
  return stripBlockIds(canonical(json) as DocJson, blockIdTypes);
}

const EMPTY = new Uint8Array([0, 0]);

function withBlock(doc: DocJson, index: number, block: DocJson): DocJson {
  const content = [...(doc.content ?? [])];
  content[index] = block;
  return { ...doc, content };
}

describe("collabContent", () => {
  it("블록 id 타입은 인라인(pageLink·mention 등)을 제외한다", () => {
    expect(blockIdTypes.has("paragraph")).toBe(true);
    expect(blockIdTypes.has("tableCell")).toBe(true);
    expect(blockIdTypes.has("pageLink")).toBe(false);
    expect(blockIdTypes.has("mention")).toBe(false);
  });

  it("스냅샷 스키마로 실제 본문을 파싱·검증할 수 있다", () => {
    expect(() => canonical(realisticDoc())).not.toThrow();
  });

  it("중간 블록 하나만 교체한다(나머지 블록 아이템 보존)", () => {
    const seed = buildSeedUpdate(realisticDoc());
    const client = docFrom(seed);
    const before = client.getXmlFragment(YJS_XML_FRAGMENT).toArray();
    const expected = withBlock(realisticDoc(), 3, para("블록 C 서버 수정", "pC"));

    const update = buildReplaceUpdate(seed, schema, expected);
    expect(update).not.toBeNull();
    Y.applyUpdate(client, update!);

    const result = stateToDocJson(Y.encodeStateAsUpdate(client));
    expect(canonical(result)).toEqual(canonical(expected));
    const after = client.getXmlFragment(YJS_XML_FRAGMENT).toArray();
    // 교체 대상(3) 외 블록은 동일 Y 아이템(객체 동일성) 유지.
    after.forEach((item, i) => {
      if (i !== 3) expect(item).toBe(before[i]);
    });
  });

  it("변경이 없으면 null", () => {
    const seed = buildSeedUpdate(realisticDoc());
    expect(buildReplaceUpdate(seed, schema, realisticDoc())).toBeNull();
  });

  it("동시 편집: 클라 블록 A 텍스트 입력 + 서버 블록 C 교체(stale) 가 양방향 병합에서 모두 보존", () => {
    const seed = buildSeedUpdate(realisticDoc());
    const client = docFrom(seed);
    const before = Y.encodeStateVector(client);
    const blockA = client.getXmlFragment(YJS_XML_FRAGMENT).get(1) as Y.XmlElement;
    (blockA.get(0) as Y.XmlText).insert(0, "클라 ");
    const clientUpdate = Y.encodeStateAsUpdate(client, before);

    const serverUpdate = buildReplaceUpdate(seed, schema, withBlock(realisticDoc(), 3, para("서버 C", "pC")))!;
    const expected = withBlock(withBlock(realisticDoc(), 1, para("클라 블록 A 본문", "pA")), 3, para("서버 C", "pC"));

    const order1 = docFrom(seed, clientUpdate, serverUpdate);
    const order2 = docFrom(seed, serverUpdate, clientUpdate);
    for (const doc of [order1, order2]) {
      expect(canonical(stateToDocJson(Y.encodeStateAsUpdate(doc)))).toEqual(canonical(expected));
    }
  });

  it("끝에 추가 / 인덱스 삽입", () => {
    const seed = buildSeedUpdate(realisticDoc());
    const base = realisticDoc().content!;
    const endUpdate = buildInsertUpdate(seed, schema, [para("끝 문단")], "end");
    const atUpdate = buildInsertUpdate(seed, schema, [para("앞 1"), para("앞 2")], { index: 1 });

    const endResult = stateToDocJson(Y.encodeStateAsUpdate(docFrom(seed, endUpdate)));
    expect(canonicalNoIds(endResult)).toEqual(canonicalNoIds({ type: "doc", content: [...base, para("끝 문단")] }));
    // 서버가 삽입한 블록은 id 를 받는다(클라 UniqueID 는 원격 트랜잭션에 id 를 채우지 않음).
    expect(typeof endResult.content?.at(-1)?.attrs?.id).toBe("string");

    const atResult = stateToDocJson(Y.encodeStateAsUpdate(docFrom(seed, atUpdate)));
    expect(canonicalNoIds(atResult)).toEqual(
      canonicalNoIds({ type: "doc", content: [base[0], para("앞 1"), para("앞 2"), ...base.slice(1)] }),
    );
  });

  it("범위 밖 인덱스·빈 블록은 CollabContentError", () => {
    const seed = buildSeedUpdate(realisticDoc());
    expect(() => buildInsertUpdate(seed, schema, [para("x")], { index: 99 })).toThrow(CollabContentError);
    expect(() => buildInsertUpdate(seed, schema, [], "end")).toThrow(CollabContentError);
  });

  it("알 수 없는 노드 타입·스키마 위반은 INVALID_DOC 로 throw", () => {
    const seed = buildSeedUpdate(realisticDoc());
    const unknown = { type: "doc", content: [{ type: "notARealNode" }] };
    expect(() => buildReplaceUpdate(seed, schema, unknown)).toThrow(CollabContentError);
    // table 직속에 paragraph(content 위반)
    const badContent = { type: "doc", content: [{ type: "table", content: [para("x")] }] };
    try {
      buildReplaceUpdate(seed, schema, badContent);
      expect.unreachable();
    } catch (e) {
      expect((e as CollabContentError).code).toBe("INVALID_DOC");
    }
    expect(() => buildInsertUpdate(seed, schema, [{ type: "bogus" }], "end")).toThrow(CollabContentError);
  });

  it("빈 룸 + allowEmptyRoom 이면 전체 본문이 들어간다", () => {
    expect(stateToDocJson(EMPTY).content ?? []).toEqual([]);
    const update = buildReplaceUpdate(EMPTY, schema, realisticDoc(), { allowEmptyRoom: true })!;
    const result = stateToDocJson(Y.encodeStateAsUpdate(docFrom(EMPTY, update)));
    expect(canonicalNoIds(result)).toEqual(canonicalNoIds(realisticDoc()));
  });

  it("빈 룸에 시드 없이 쓰면 EMPTY_ROOM_NO_SEED", () => {
    for (const run of [
      () => buildReplaceUpdate(EMPTY, schema, realisticDoc()),
      () => buildInsertUpdate(EMPTY, schema, [para("x")], "end"),
    ]) {
      try {
        run();
        expect.unreachable();
      } catch (e) {
        expect((e as CollabContentError).code).toBe("EMPTY_ROOM_NO_SEED");
      }
    }
  });

  it("빈 룸 + seedDocJson: 클라와 byte 동일 시드 위에 편집, 이후 클라 시드 재적용해도 중복 없음", () => {
    const seedJson = realisticDoc();
    // 서버 시드 바이트 == 클라 방식 시드 바이트
    expect(serverSeedUpdate(schema, seedJson)).toEqual(buildSeedUpdate(seedJson));

    const update = buildInsertUpdate(EMPTY, schema, [para("AI 추가")], "end", { seedDocJson: seedJson });
    const expected = { type: "doc", content: [...seedJson.content!, para("AI 추가")] };
    expect(canonicalNoIds(stateToDocJson(update))).toEqual(canonicalNoIds(expected));

    // 서버 쓰기 이전에 시드한 클라 / 이후에 시드를 재적용하는 클라 모두 수렴·중복 없음.
    const clientSeed = buildSeedUpdate(seedJson);
    for (const doc of [docFrom(clientSeed, update), docFrom(update, clientSeed), docFrom(update, clientSeed, clientSeed)]) {
      expect(canonicalNoIds(stateToDocJson(Y.encodeStateAsUpdate(doc)))).toEqual(canonicalNoIds(expected));
    }
  });

  it("seedDocJson 은 룸이 비어있지 않으면 무시된다", () => {
    const seed = buildSeedUpdate(realisticDoc());
    const update = buildInsertUpdate(seed, schema, [para("x")], "end", { seedDocJson: { type: "doc", content: [para("다른 본문")] } });
    const result = stateToDocJson(Y.encodeStateAsUpdate(docFrom(seed, update)));
    expect(result.content).toHaveLength(realisticDoc().content!.length + 1);
  });

  it("id 만 뺀 동일 문서로 replace 하면 null", () => {
    const withIds = realisticDoc();
    const seed = buildSeedUpdate(withIds);
    const idless = stripBlockIds(withIds, blockIdTypes);
    expect(JSON.stringify(idless)).not.toContain('"pA"');
    expect(JSON.stringify(idless)).toContain('"m-1"'); // 인라인 mention.id 는 유지
    expect(buildReplaceUpdate(seed, schema, idless)).toBeNull();
  });

  it("떨어진 여러 곳 수정(id 없는 입력)에도 바뀌지 않은 블록의 Y 아이템·id 유지", () => {
    const original = realisticDoc();
    const seed = buildSeedUpdate(original);
    const client = docFrom(seed);
    const before = client.getXmlFragment(YJS_XML_FRAGMENT).toArray();
    // 1(블록 A) 수정, 4(콜아웃) 삭제, 6(표) 앞에 새 문단 삽입, 8(멘션 문단) 수정 — 모두 id 없는 입력.
    const blocks = stripBlockIds(original, blockIdTypes).content!;
    const next: DocJson = {
      type: "doc",
      content: [
        blocks[0],
        para("A 수정"),
        blocks[2],
        blocks[3],
        blocks[5],
        para("새 문단"),
        blocks[6],
        blocks[7],
        { ...blocks[8], content: [text("멘션 문단 교체")] },
      ],
    };
    const update = buildReplaceUpdate(seed, schema, next)!;
    Y.applyUpdate(client, update);
    const after = client.getXmlFragment(YJS_XML_FRAGMENT).toArray();
    const keptPairs: Array<[number, number]> = [[0, 0], [2, 2], [3, 3], [5, 4], [6, 6], [7, 7]];
    for (const [oldI, newI] of keptPairs) expect(after[newI]).toBe(before[oldI]);
    const result = stateToDocJson(Y.encodeStateAsUpdate(client));
    expect(result.content?.[0]?.attrs?.id).toBe("h1");
    expect(result.content?.[3]?.attrs?.id).toBe("pC");
    expect(result.content?.[6]?.attrs?.id).toBe("tb");
    expect(canonicalNoIds(result)).toEqual(canonicalNoIds(next));
  });

  it("legacy paragraph(columns)+column 은 columnLayout 으로 보정된다", () => {
    const legacy: DocJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { columns: 2 },
          content: [
            { type: "column", content: [para("L")] },
            { type: "column", content: [para("R")] },
          ],
        },
      ],
    };
    const result = stateToDocJson(buildReplaceUpdate(EMPTY, schema, legacy, { allowEmptyRoom: true })!);
    expect(result.content?.[0]?.type).toBe("columnLayout");
  });

  it("서버 편집은 시드 sentinel clientID 를 쓰지 않는다", () => {
    const update = buildInsertUpdate(EMPTY, schema, [para("x")], "end", { allowEmptyRoom: true });
    const clients = [...Y.decodeStateVector(Y.encodeStateVectorFromUpdate(update)).keys()];
    expect(clients).toHaveLength(1);
    expect(clients[0]).not.toBe(0x5eed);
  });
});
