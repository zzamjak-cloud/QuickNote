import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import {
  jsonToYDoc,
  yDocToJson,
  YJS_XML_FRAGMENT,
  buildSeedUpdate,
  seedCollabDocIfEmpty,
  isCollabDocBodyEmpty,
  isPlaceholderBodyJson,
  sanitizeCollabDocAttrsForRender,
  isCollabDocRenderableForEditor,
  replaceCollabDocContent,
  hasRenderableCollabContent,
} from "../yjsDoc";
import { BlockBackground } from "../../tiptapExtensions/blockBackground";
import { Column, ColumnLayout } from "../../tiptapExtensions/columns";

// 라운드트립 검증용 최소 schema (StarterKit 기반).
// @tiptap/core 가 getDefaultSchema 를 export 하지 않으므로 Editor 인스턴스에서 schema 를 추출한다.
function schema() {
  const e = new Editor({ extensions: [StarterKit] });
  const s = e.schema;
  e.destroy();
  return s;
}

function schemaWithBlockAttrs() {
  const e = new Editor({ extensions: [StarterKit, BlockBackground] });
  const s = e.schema;
  e.destroy();
  return s;
}

function schemaWithColumns() {
  const e = new Editor({
    extensions: [StarterKit, TaskList, TaskItem.configure({ nested: true }), ColumnLayout, Column],
  });
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

  it("렌더링에 위험한 객체 attrs 는 primitive attrs 만 남기고 정화한다", () => {
    const s = schemaWithBlockAttrs();
    const doc = jsonToYDoc(s, {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: {
            backgroundColor: { nested: ["bad"] },
            blockTextColor: "red",
          },
          content: [{ type: "text", text: "본문" }],
        },
      ],
    });
    expect(sanitizeCollabDocAttrsForRender(doc, s)).toBe(true);
    const attrs = yDocToJson(doc).content?.[0]?.attrs ?? {};
    expect(typeof attrs.backgroundColor).not.toBe("object");
    expect(attrs.blockTextColor).toBe("red");
  });

  it("Y.Doc 본문을 지정 JSON 으로 교체한다", () => {
    const s = schema();
    const doc = jsonToYDoc(s, seedJson);
    replaceCollabDocContent(doc, s, {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "교체 본문" }] }],
    });
    expect(isCollabDocRenderableForEditor(doc, s)).toBe(true);
    expect(hasRenderableCollabContent(doc, s)).toBe(true);
    expect(JSON.stringify(yDocToJson(doc))).toContain("교체 본문");
    expect(JSON.stringify(yDocToJson(doc))).not.toContain("시드 본문");
  });

  it("legacy paragraph 컬럼 레이아웃은 현재 columnLayout 으로 시드한다", () => {
    const s = schemaWithColumns();
    const doc = new Y.Doc();
    seedCollabDocIfEmpty(doc, s, {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { columns: 2, preset: "empty" },
          content: [
            {
              type: "column",
              content: [{ type: "paragraph", content: [{ type: "text", text: "왼쪽" }] }],
            },
            {
              type: "column",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "오른쪽" }] },
                {
                  type: "taskList",
                  content: [
                    {
                      type: "taskItem",
                      attrs: { checked: false },
                      content: [
                        { type: "paragraph", content: [{ type: "text", text: "체크" }] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    const back = yDocToJson(doc);
    expect(back.content?.[0]?.type).toBe("columnLayout");
    expect(JSON.stringify(back)).toContain("왼쪽");
    expect(JSON.stringify(back)).toContain("오른쪽");
    expect(JSON.stringify(back)).toContain("체크");
    expect(hasRenderableCollabContent(doc, s)).toBe(true);
  });

  it("빈 문단 placeholder 는 렌더 가능하지만 사용 가능한 본문으로 보지 않는다", () => {
    const s = schema();
    const doc = jsonToYDoc(s, { type: "doc", content: [{ type: "paragraph" }] });
    expect(isCollabDocRenderableForEditor(doc, s)).toBe(true);
    expect(hasRenderableCollabContent(doc, s)).toBe(false);
  });

  it("isPlaceholderBodyJson: 블록 없음·빈 문단만은 placeholder, 텍스트·비문단 블록은 아님", () => {
    expect(isPlaceholderBodyJson(null)).toBe(true);
    expect(isPlaceholderBodyJson({ type: "doc" })).toBe(true);
    expect(isPlaceholderBodyJson({ type: "doc", content: [] })).toBe(true);
    // 과거 오염 룸의 실제 형태 — 빈 문단 N개
    expect(
      isPlaceholderBodyJson({
        type: "doc",
        content: [{ type: "paragraph" }, { type: "paragraph" }, { type: "paragraph" }],
      }),
    ).toBe(true);
    expect(
      isPlaceholderBodyJson({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "내용" }] }],
      }),
    ).toBe(false);
    expect(
      isPlaceholderBodyJson({ type: "doc", content: [{ type: "heading" }] }),
    ).toBe(false);
  });
});
