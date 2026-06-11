// PM JSON ↔ Y.Doc 변환 래퍼. 본문은 단일 XML fragment 키 "prosemirror" 로 표현한다.
// - jsonToYDoc: Pages.doc(JSON) → 권위적 Y.Doc 시드(최초 진입 시 사용).
// - yDocToJson: Y.Doc → Pages.doc(JSON) materialize(디바운스 저장 시 사용).
import * as Y from "yjs";
import {
  prosemirrorJSONToYDoc,
  yDocToProsemirrorJSON,
  prosemirrorToYXmlFragment,
} from "y-prosemirror";
import { Node as PMNode, type Schema } from "@tiptap/pm/model";
import type { JSONContent } from "@tiptap/react";

/** y-prosemirror 가 ySyncPlugin 과 공유하는 기본 XML fragment 키. */
export const YJS_XML_FRAGMENT = "prosemirror";

/**
 * 결정적 시드용 고정 clientID.
 * 여러 클라이언트가 같은 콘텐츠를 동시에 시드해도 아이템 ID가 동일해져 Yjs 가 멱등 병합한다(중복 삽입 방지).
 * 실 편집은 각 Y.Doc 의 랜덤 clientID 를 쓰므로 이 sentinel 과 충돌하지 않는다.
 */
export const SEED_CLIENT_ID = 0x5eed;

/** ProseMirror JSON 으로부터 Y.Doc 을 생성한다(시드). */
export function jsonToYDoc(schema: Schema, json: JSONContent): Y.Doc {
  return prosemirrorJSONToYDoc(schema, json, YJS_XML_FRAGMENT);
}

/** Y.Doc 을 ProseMirror JSON 으로 직렬화한다(materialize). */
export function yDocToJson(ydoc: Y.Doc): JSONContent {
  return yDocToProsemirrorJSON(ydoc, YJS_XML_FRAGMENT) as JSONContent;
}

/**
 * ProseMirror JSON → 결정적 Yjs 시드 update(바이트).
 * 고정 clientID(SEED_CLIENT_ID) + 결정적 변환이라 같은 입력은 항상 byte 동일한 update 를 만든다.
 */
export function buildSeedUpdate(schema: Schema, json: JSONContent): Uint8Array {
  const seedDoc = new Y.Doc();
  seedDoc.clientID = SEED_CLIENT_ID; // 콘텐츠 채우기 전에 고정
  const frag = seedDoc.get(YJS_XML_FRAGMENT, Y.XmlFragment) as Y.XmlFragment;
  prosemirrorToYXmlFragment(PMNode.fromJSON(schema, json), frag);
  return Y.encodeStateAsUpdate(seedDoc);
}

/**
 * 협업 Y.Doc 이 비어 있으면 기존 JSON 콘텐츠로 1회 시드한다.
 * 서버 sync 완료(=서버에 콘텐츠 없음 확인) 후 호출해야 안전하다. 결정적 update 라 동시 시드도 중복이 없다.
 * @returns 시드했으면 true, 이미 콘텐츠가 있어 건너뛰면 false.
 */
export function seedCollabDocIfEmpty(doc: Y.Doc, schema: Schema, json: JSONContent): boolean {
  if (doc.getXmlFragment(YJS_XML_FRAGMENT).length > 0) return false; // 이미 콘텐츠 있음(피어/서버 시드됨)
  Y.applyUpdate(doc, buildSeedUpdate(schema, json));
  return true;
}
