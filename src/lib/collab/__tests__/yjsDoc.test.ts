import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { jsonToYDoc, yDocToJson, YJS_XML_FRAGMENT } from "../yjsDoc";

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
});
