// PM JSON ↔ Y.Doc 변환 래퍼. 본문은 단일 XML fragment 키 "prosemirror" 로 표현한다.
// - jsonToYDoc: Pages.doc(JSON) → 권위적 Y.Doc 시드(최초 진입 시 사용).
// - yDocToJson: Y.Doc → Pages.doc(JSON) materialize(디바운스 저장 시 사용).
import * as Y from "yjs";
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from "y-prosemirror";
import type { Schema } from "@tiptap/pm/model";
import type { JSONContent } from "@tiptap/react";

/** y-prosemirror 가 ySyncPlugin 과 공유하는 기본 XML fragment 키. */
export const YJS_XML_FRAGMENT = "prosemirror";

/** ProseMirror JSON 으로부터 Y.Doc 을 생성한다(시드). */
export function jsonToYDoc(schema: Schema, json: JSONContent): Y.Doc {
  return prosemirrorJSONToYDoc(schema, json, YJS_XML_FRAGMENT);
}

/** Y.Doc 을 ProseMirror JSON 으로 직렬화한다(materialize). */
export function yDocToJson(ydoc: Y.Doc): JSONContent {
  return yDocToProsemirrorJSON(ydoc, YJS_XML_FRAGMENT) as JSONContent;
}
