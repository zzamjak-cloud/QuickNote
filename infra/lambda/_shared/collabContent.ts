// 서버 측 협업 본문(Y.Doc) 편집 유틸 — 바이트 지향 API.
// 협업 ON 페이지는 Y.Doc(fragment "prosemirror")이 권위라 Pages.doc 직접 기록은 클라가 덮어쓴다.
// 따라서 서버 편집은 반드시 Yjs update 로 만들어 룸 로그에 append 해야 한다.
// ⚠ Y.Doc 객체는 모듈 경계를 넘기지 않는다(바이트만 입출력) — yjs 사본 혼용 사고 방지.
import { randomInt } from "node:crypto";
import * as Y from "yjs";
import { yDocToProsemirrorJSON, updateYFragment, prosemirrorToYXmlFragment } from "y-prosemirror";
import { Node as PMNode, Schema, type NodeSpec, type MarkSpec, type AttributeSpec } from "prosemirror-model";
import type {
  AttrSpecJson,
  EditorSchemaSpec,
} from "../../../src/lib/docModel/editorSchemaSpec";
import editorSchemaSpecJson from "../../../src/lib/docModel/editorSchemaSpec.json";
import { diffBlockKeys } from "./blockDiff";
import { type DocJson, fillMissingBlockIds, normalizeLegacyJsonNode, stripBlockIds } from "./docJson";

export { type DocJson, normalizeLegacyJsonNode } from "./docJson";

/** 클라 src/lib/collab/yjsDoc.ts 와 동일한 fragment 키. */
export const YJS_XML_FRAGMENT = "prosemirror";
/** 클라 결정적 시드 전용 clientID(yjsDoc.ts SEED_CLIENT_ID) — 서버 편집 자체에는 쓰지 않는다. */
export const SEED_CLIENT_ID = 0x5eed;
const SERVER_EDIT_ORIGIN = "qn-server-edit";

export type CollabContentErrorCode = "INVALID_DOC" | "INVALID_INDEX" | "EMPTY_ROOM_NO_SEED";

/** 입력 검증 실패(스키마 위반·범위 밖 인덱스·시드 없는 빈 룸). 호출측이 4xx 로 매핑할 수 있게 code 를 싣는다. */
export class CollabContentError extends Error {
  readonly code: CollabContentErrorCode;
  constructor(code: CollabContentErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CollabContentError";
    this.code = code;
  }
}

/**
 * 빈 룸(fragment length 0) 처리 옵션.
 * - seedDocJson: 서버 Pages.doc 본문. 빈 룸이면 클라 buildSeedUpdate 와 byte 동일한 결정적 시드를
 *   먼저 적용하고 그 위에 편집한다(반환 update 에 시드 포함). 시드 없이 AI 블록만 넣으면 나중에
 *   접속한 클라가 seedCollabDocIfEmpty 에서 "콘텐츠 있음"으로 보고 시드를 건너뛰어 기존 본문이 유실된다.
 * - allowEmptyRoom: 진짜 신규 빈 페이지처럼 시드할 본문이 없음을 호출자가 명시할 때만 true.
 */
export type ServerEditOptions = {
  seedDocJson?: DocJson;
  allowEmptyRoom?: boolean;
};

/** 커밋된 에디터 스키마 스냅샷(빌드 시 번들에 포함). */
export const editorSchemaSpec = editorSchemaSpecJson as unknown as EditorSchemaSpec;

const schemaCache = new WeakMap<EditorSchemaSpec, Schema>();
// Schema → id 를 관리하는 블록 타입(UniqueID 대상 중 비인라인).
const blockIdTypesBySchema = new WeakMap<Schema, ReadonlySet<string>>();

function toAttrSpecs(attrs: Record<string, AttrSpecJson> | undefined): Record<string, AttributeSpec> | undefined {
  if (!attrs) return undefined;
  const out: Record<string, AttributeSpec> = {};
  for (const [name, attr] of Object.entries(attrs)) {
    out[name] = attr.hasDefault ? { default: attr.default } : {};
  }
  return out;
}

/** 스냅샷 → prosemirror Schema(노드·마크 순서 보존, 캐시). toDOM/parseDOM 은 없다(서버 불필요). */
export function schemaFromSpec(spec: EditorSchemaSpec = editorSchemaSpec): Schema {
  const cached = schemaCache.get(spec);
  if (cached) return cached;
  const nodes: Record<string, NodeSpec> = {};
  for (const { name, attrs, ...rest } of spec.nodes) {
    nodes[name] = { ...rest, attrs: toAttrSpecs(attrs) };
  }
  const marks: Record<string, MarkSpec> = {};
  for (const { name, attrs, ...rest } of spec.marks) {
    marks[name] = { ...rest, attrs: toAttrSpecs(attrs) };
  }
  const schema = new Schema({ nodes, marks, topNode: spec.topNode });
  const blockIdTypes = (spec.uniqueIdTypes ?? []).filter((name) => {
    const type = schema.nodes[name];
    return type !== undefined && !type.isInline && type.spec.attrs !== undefined && "id" in type.spec.attrs;
  });
  blockIdTypesBySchema.set(schema, new Set(blockIdTypes));
  schemaCache.set(spec, schema);
  return schema;
}

/** 스키마에서 서버가 id 를 무시·생성하는 블록 타입 집합(schemaFromSpec 으로 만든 스키마만). */
export function blockIdTypesOf(schema: Schema): ReadonlySet<string> {
  return blockIdTypesBySchema.get(schema) ?? new Set();
}

// ── 내부 헬퍼 ──

function randomServerClientId(): number {
  let clientID = randomInt(1, 0xffffffff);
  while (clientID === SEED_CLIENT_ID) clientID = randomInt(1, 0xffffffff);
  return clientID;
}

function parseChecked(schema: Schema, json: DocJson): PMNode {
  try {
    const node = PMNode.fromJSON(schema, json);
    node.check();
    return node;
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new CollabContentError("INVALID_DOC", `invalid document: ${reason}`, { cause });
  }
}

/**
 * 클라 buildSeedUpdate(src/lib/collab/yjsDoc.ts)와 byte 동일한 결정적 시드 update.
 * 고정 clientID + normalizeLegacy → PMNode.fromJSON → prosemirrorToYXmlFragment 순서까지 동일해야
 * 같은 (clientID, clock) 에 같은 내용이 생겨 클라 시드와 멱등 병합된다.
 */
export function buildSeedUpdate(schema: Schema, json: DocJson): Uint8Array {
  let node: PMNode;
  try {
    node = PMNode.fromJSON(schema, normalizeLegacyJsonNode(json));
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new CollabContentError("INVALID_DOC", `invalid seed document: ${reason}`, { cause });
  }
  const seedDoc = new Y.Doc();
  seedDoc.clientID = SEED_CLIENT_ID; // 콘텐츠 채우기 전에 고정
  const frag = seedDoc.get(YJS_XML_FRAGMENT, Y.XmlFragment) as Y.XmlFragment;
  prosemirrorToYXmlFragment(node, frag);
  return Y.encodeStateAsUpdate(seedDoc);
}

type PreparedRoom = { doc: Y.Doc; fragment: Y.XmlFragment; before: Uint8Array };

// 룸 상태 로드 + (빈 룸이면) 결정적 시드 적용. before 는 시드 적용 전 state vector 라
// 최종 update 에 시드가 포함된다.
function prepareRoom(state: Uint8Array, schema: Schema, options: ServerEditOptions): PreparedRoom {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  // 랜덤 clientID(시드 sentinel 회피) — 서버 편집이 다른 시드/클라 아이템 ID 와 겹치지 않게 한다.
  doc.clientID = randomServerClientId();
  const before = Y.encodeStateVector(doc);
  const fragment = doc.getXmlFragment(YJS_XML_FRAGMENT);
  if (fragment.length === 0) {
    if (options.seedDocJson) {
      Y.applyUpdate(doc, buildSeedUpdate(schema, options.seedDocJson));
    } else if (!options.allowEmptyRoom) {
      throw new CollabContentError(
        "EMPTY_ROOM_NO_SEED",
        "room is empty: pass seedDocJson (server Pages.doc) or allowEmptyRoom for a truly new page",
      );
    }
  }
  return { doc, fragment, before };
}

// PM 블록들을 fragment[index..] 에 삽입. 빈 요소를 먼저 통합한 뒤 y-prosemirror updateYFragment 로
// 채운다(클라 ySyncPlugin 과 동일 표현). 미통합 요소에 바로 쓰면 Yjs "Invalid access" 경고가 난다.
function insertBlocks(doc: Y.Doc, fragment: Y.XmlFragment, index: number, nodes: PMNode[]): void {
  const elements = nodes.map((node) => new Y.XmlElement(node.type.name));
  fragment.insert(index, elements);
  const meta = { mapping: new Map(), isOMark: new Map() };
  elements.forEach((el, i) => updateYFragment(doc, el, nodes[i], meta));
}

// 새로 삽입되는 블록에 id 를 채운다(docJson.fillMissingBlockIds 주석 참고).
function withBlockIds(schema: Schema, node: PMNode): PMNode {
  const json = fillMissingBlockIds(node.toJSON() as DocJson, blockIdTypesOf(schema));
  return PMNode.fromJSON(schema, json);
}

// 블록 비교 키: 스키마 기본값을 채운 PM JSON 에서 블록 id 를 제거한 문자열.
// docToQfm 등 id 없는 재작성 입력도 기존 블록과 같다고 판정해 Y 아이템·id·댓글 앵커를 보존한다.
// 스키마 위반(레거시) 블록은 원본 JSON 으로 비교한다.
function blockKey(schema: Schema, block: DocJson): string {
  const idTypes = blockIdTypesOf(schema);
  try {
    return JSON.stringify(stripBlockIds(PMNode.fromJSON(schema, block).toJSON() as DocJson, idTypes));
  } catch {
    return JSON.stringify(stripBlockIds(block, idTypes));
  }
}

// ── 공개 API ──

/** 룸 상태 바이트 → ProseMirror JSON. 빈 룸이면 content 가 빈 doc. */
export function stateToDocJson(state: Uint8Array): DocJson {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return yDocToProsemirrorJSON(doc, YJS_XML_FRAGMENT) as DocJson;
}

/**
 * 현재 상태 대비 newDocJson 으로 바꾸는 최소 update.
 * 최상위 블록을 id 무시 키로 diff(prefix/suffix + 중간 LCS)해 실제로 바뀐 블록만 delete+insert 한다.
 * 유지 블록의 Y 아이템은 그대로라 그 블록의 동시 사용자 편집·id 가 보존된다. 변경 없으면 null.
 */
export function buildReplaceUpdate(
  state: Uint8Array,
  schema: Schema,
  newDocJson: DocJson,
  options: ServerEditOptions = {},
): Uint8Array | null {
  const nextDoc = parseChecked(schema, normalizeLegacyJsonNode(newDocJson));
  const { doc, fragment, before } = prepareRoom(state, schema, options);
  const oldBlocks = (yDocToProsemirrorJSON(doc, YJS_XML_FRAGMENT) as DocJson).content ?? [];
  const oldKeys = oldBlocks.map((b) => blockKey(schema, normalizeLegacyJsonNode(b)));
  const newNodes: PMNode[] = [];
  nextDoc.forEach((child) => newNodes.push(child));
  const newKeys = newNodes.map((n) => blockKey(schema, n.toJSON() as DocJson));

  const matches = diffBlockKeys(oldKeys, newKeys);
  if (matches.length === oldKeys.length && matches.length === newKeys.length) return null;

  doc.transact(() => {
    // 유지 쌍 사이 구간마다: 지울 old 블록 삭제 → 새 블록 삽입. pos 는 현재 fragment 기준 위치.
    let pos = 0;
    let oldCursor = 0;
    let newCursor = 0;
    for (const [oldIndex, newIndex] of [...matches, [oldKeys.length, newKeys.length] as const]) {
      const deleteCount = oldIndex - oldCursor;
      if (deleteCount > 0) fragment.delete(pos, deleteCount);
      const inserts = newNodes.slice(newCursor, newIndex).map((n) => withBlockIds(schema, n));
      if (inserts.length > 0) insertBlocks(doc, fragment, pos, inserts);
      pos += inserts.length + 1; // +1: 유지 블록(마지막 sentinel 에서는 의미 없음)
      oldCursor = oldIndex + 1;
      newCursor = newIndex + 1;
    }
  }, SERVER_EDIT_ORIGIN);
  return Y.encodeStateAsUpdate(doc, before);
}

/** 최상위 블록 삽입 update. at="end" 면 끝에 추가, {index} 면 해당 위치(0..length)에 삽입. */
export function buildInsertUpdate(
  state: Uint8Array,
  schema: Schema,
  blocksJson: DocJson[],
  at: { index: number } | "end",
  options: ServerEditOptions = {},
): Uint8Array {
  if (blocksJson.length === 0) {
    throw new CollabContentError("INVALID_DOC", "blocks must not be empty");
  }
  const wrapper = parseChecked(schema, {
    type: schema.topNodeType.name,
    content: blocksJson.map(normalizeLegacyJsonNode),
  });
  const nodes: PMNode[] = [];
  wrapper.forEach((child) => nodes.push(withBlockIds(schema, child)));
  const { doc, fragment, before } = prepareRoom(state, schema, options);
  const length = fragment.length;
  const index = at === "end" ? length : at.index;
  if (!Number.isInteger(index) || index < 0 || index > length) {
    throw new CollabContentError("INVALID_INDEX", `index ${index} out of range 0..${length}`);
  }
  doc.transact(() => insertBlocks(doc, fragment, index, nodes), SERVER_EDIT_ORIGIN);
  return Y.encodeStateAsUpdate(doc, before);
}
