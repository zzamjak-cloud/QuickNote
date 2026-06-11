import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  jsonToYDoc,
  yDocToJson,
  YJS_XML_FRAGMENT,
  buildSeedUpdate,
  seedCollabDocIfEmpty,
  isCollabDocBodyEmpty,
} from "../yjsDoc";

// 라운드트립 검증용 최소 schema (StarterKit 기반).
// @tiptap/core 가 getDefaultSchema 를 export 하지 않으므로 Editor 인스턴스에서 schema 를 추출한다.
function schema() {
  const e = new Editor({ extensions: [StarterKit] });
  const s = e.schema;
  e.destroy();
  return s;
}

describe("yjsDoc", () => {
  it("fragment 키 상수", () => {
    expect(YJS_XML_FRAGMENT).toBe("prosemirror");
  });

  it("JSON → Y.Doc → JSON 라운드트립이 의미 동치", () => {
    const json = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "안녕 협업" }] },
        { type: "paragraph", content: [{ type: "text", text: "둘째 줄" }] },
      ],
    };
    const ydoc = jsonToYDoc(schema(), json);
    const back = yDocToJson(ydoc);
    expect(back.type).toBe("doc");
    const text = JSON.stringify(back);
    expect(text).toContain("안녕 협업");
    expect(text).toContain("둘째 줄");
  });

  it("빈 doc 변환도 예외 없이 동작", () => {
    const ydoc = jsonToYDoc(schema(), { type: "doc", content: [{ type: "paragraph" }] });
    expect(yDocToJson(ydoc).type).toBe("doc");
  });

  const seedJson = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "시드 본문" }] }],
  };

  it("buildSeedUpdate 는 같은 입력에 byte 동일한 결정적 update 를 만든다", () => {
    const s = schema();
    const a = buildSeedUpdate(s, seedJson);
    const b = buildSeedUpdate(s, seedJson);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("동시 시드(같은 콘텐츠)는 중복 없이 한 벌로 수렴한다", () => {
    const s = schema();
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    // 두 클라이언트가 각자 빈 상태를 보고 시드
    expect(seedCollabDocIfEmpty(docA, s, seedJson)).toBe(true);
    expect(seedCollabDocIfEmpty(docB, s, seedJson)).toBe(true);
    // 교차 머지
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const a = yDocToJson(docA);
    // 문단 1개만 — 중복 삽입 없음
    expect(a.content?.length).toBe(1);
    expect(JSON.stringify(a)).toBe(JSON.stringify(yDocToJson(docB)));
    expect(JSON.stringify(a)).toContain("시드 본문");
  });

  it("isCollabDocBodyEmpty: 미시드 Y.Doc 은 true, 시드 후 false (빈 본문 materialize 가드)", () => {
    const s = schema();
    const doc = new Y.Doc();
    expect(isCollabDocBodyEmpty(doc)).toBe(true); // 미시드 → 빈 → materialize 생략돼야 함
    seedCollabDocIfEmpty(doc, s, seedJson);
    expect(isCollabDocBodyEmpty(doc)).toBe(false); // 시드 후 → 본문 있음 → materialize 허용
  });

  it("isCollabDocBodyEmpty: 의도적으로 비운 페이지(빈 문단)는 false 로 보존된다", () => {
    const s = schema();
    const doc = jsonToYDoc(s, { type: "doc", content: [{ type: "paragraph" }] });
    // 빈 문단은 fragment length≥1 → false → 의도적 비우기 저장 허용(미시드와 구분)
    expect(isCollabDocBodyEmpty(doc)).toBe(false);
  });

  it("이미 콘텐츠가 있으면 재시드하지 않는다", () => {
    const s = schema();
    const doc = new Y.Doc();
    expect(seedCollabDocIfEmpty(doc, s, seedJson)).toBe(true);
    const reseeded = seedCollabDocIfEmpty(doc, s, {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "다른 내용" }] }],
    });
    expect(reseeded).toBe(false);
    expect(JSON.stringify(yDocToJson(doc))).toContain("시드 본문");
  });
});
