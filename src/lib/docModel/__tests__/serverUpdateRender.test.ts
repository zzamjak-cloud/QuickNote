// 서버(스냅샷 스키마)로 만든 Yjs update 가 실제 에디터 스키마에서 렌더 가능한지 교차 검증.
// infra/lambda/_shared/collabContent.ts 와 동일 경로(updateYFragment 로 블록 삽입)를 root 의존성으로 재현한다.
import * as Y from "yjs";
import {
  updateYFragment,
  yDocToProsemirrorJSON,
  prosemirrorJSONToYDoc,
  prosemirrorToYXmlFragment,
} from "y-prosemirror";
import { getSchema } from "@tiptap/core";
import { Node as PMNode, Schema, type AttributeSpec } from "@tiptap/pm/model";
import { buildEditorExtensions } from "../../../components/editor/useEditorExtensions";
import { buildSeedUpdate, seedCollabDocIfEmpty, yDocToJson } from "../../collab/yjsDoc";
import type { AttrSpecJson, EditorSchemaSpec } from "../editorSchemaSpec";
import specJson from "../editorSchemaSpec.json";

const realSchema = getSchema(
  buildEditorExtensions({
    lowlightApi: null,
    isFullPageDatabase: false,
    effectivePageId: null,
    myMemberId: undefined,
    collabDoc: null,
    collabAwareness: null,
  }),
);

function toAttrs(attrs?: Record<string, AttrSpecJson>): Record<string, AttributeSpec> | undefined {
  if (!attrs) return undefined;
  return Object.fromEntries(
    Object.entries(attrs).map(([k, a]) => [k, a.hasDefault ? { default: a.default } : {}]),
  );
}

// 서버 schemaFromSpec 과 동일 규칙으로 스냅샷 → Schema.
const spec = specJson as unknown as EditorSchemaSpec;
const specSchema = new Schema({
  topNode: spec.topNode,
  nodes: Object.fromEntries(spec.nodes.map(({ name, attrs, ...rest }) => [name, { ...rest, attrs: toAttrs(attrs) }])),
  marks: Object.fromEntries(spec.marks.map(({ name, attrs, ...rest }) => [name, { ...rest, attrs: toAttrs(attrs) }])),
});

const seedJson = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "제목" }] },
    { type: "paragraph", content: [{ type: "text", text: "본문" }] },
  ],
};

const serverBlocks = [
  {
    type: "callout",
    attrs: { preset: "idea" },
    content: [{ type: "paragraph", content: [{ type: "text", text: "서버", marks: [{ type: "bold" }] }] }],
  },
  {
    type: "toggle",
    content: [
      { type: "toggleHeader", content: [{ type: "text", text: "T" }] },
      { type: "toggleContent", content: [{ type: "paragraph" }] },
    ],
  },
  { type: "databaseBlock", attrs: { databaseId: "db-1" } },
  {
    type: "paragraph",
    content: [{ type: "mention", attrs: { id: "m", label: "홍길동" } }, { type: "dateInline", attrs: { value: "2026-01-01" } }],
  },
];

describe("서버 update → 에디터 렌더 교차 검증", () => {
  it("스냅샷 스키마로 만든 블록 삽입 update 가 실제 스키마 check 를 통과한다", () => {
    // 클라 시드(실제 스키마) → 서버가 스냅샷 스키마로 블록 삽입 update 생성.
    const clientDoc = prosemirrorJSONToYDoc(realSchema, seedJson, "prosemirror");
    const serverDoc = new Y.Doc();
    Y.applyUpdate(serverDoc, Y.encodeStateAsUpdate(clientDoc));
    const before = Y.encodeStateVector(serverDoc);
    const fragment = serverDoc.getXmlFragment("prosemirror");
    const nodes = serverBlocks.map((b) => PMNode.fromJSON(specSchema, b));
    serverDoc.transact(() => {
      const elements = nodes.map((n) => new Y.XmlElement(n.type.name));
      fragment.insert(1, elements);
      const meta = { mapping: new Map(), isOMark: new Map() };
      elements.forEach((el, i) => updateYFragment(serverDoc, el, nodes[i], meta));
    });
    Y.applyUpdate(clientDoc, Y.encodeStateAsUpdate(serverDoc, before));

    const json = yDocToProsemirrorJSON(clientDoc, "prosemirror");
    const rendered = PMNode.fromJSON(realSchema, json);
    expect(() => rendered.check()).not.toThrow();
    expect(rendered.childCount).toBe(2 + serverBlocks.length);
    expect(rendered.child(1).type.name).toBe("callout");
  });

  it("서버 시드(스냅샷 스키마) 바이트 == 클라 buildSeedUpdate(실제 스키마), 서버 쓰기 후 클라 재시드 중복 없음", () => {
    const pageDoc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { id: "h", level: 1 }, content: [{ type: "text", text: "제목" }] },
        ...serverBlocks,
      ],
    };
    // infra collabContent.buildSeedUpdate 와 동일 절차(고정 clientID → fromJSON → prosemirrorToYXmlFragment).
    const serverSeedDoc = new Y.Doc();
    serverSeedDoc.clientID = 0x5eed;
    prosemirrorToYXmlFragment(PMNode.fromJSON(specSchema, pageDoc), serverSeedDoc.getXmlFragment("prosemirror"));
    const serverSeed = Y.encodeStateAsUpdate(serverSeedDoc);
    expect(serverSeed).toEqual(buildSeedUpdate(realSchema, pageDoc));

    // 서버: 빈 룸 → 시드 + AI 블록 1개 삽입.
    const serverDoc = new Y.Doc();
    Y.applyUpdate(serverDoc, serverSeed);
    const extra = PMNode.fromJSON(specSchema, { type: "paragraph", content: [{ type: "text", text: "AI" }] });
    serverDoc.transact(() => {
      const fragment = serverDoc.getXmlFragment("prosemirror");
      const el = new Y.XmlElement(extra.type.name);
      fragment.insert(fragment.length, [el]);
      updateYFragment(serverDoc, el, extra, { mapping: new Map(), isOMark: new Map() });
    });
    const serverUpdate = Y.encodeStateAsUpdate(serverDoc);

    // 이미 로컬 시드한 클라 + 서버 update, 그리고 서버 update 후 시드 재시도 — 모두 중복 없음.
    const seededClient = new Y.Doc();
    Y.applyUpdate(seededClient, buildSeedUpdate(realSchema, pageDoc));
    Y.applyUpdate(seededClient, serverUpdate);
    const lateClient = new Y.Doc();
    Y.applyUpdate(lateClient, serverUpdate);
    expect(seedCollabDocIfEmpty(lateClient, realSchema, pageDoc)).toBe(false);
    Y.applyUpdate(lateClient, buildSeedUpdate(realSchema, pageDoc));
    for (const doc of [seededClient, lateClient]) {
      const rendered = PMNode.fromJSON(realSchema, yDocToJson(doc));
      expect(() => rendered.check()).not.toThrow();
      expect(rendered.childCount).toBe(pageDoc.content.length + 1);
    }
  });
});
