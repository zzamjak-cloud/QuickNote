// 페이지 본문 쓰기(Yjs 경로) — 협업 ON 환경은 Y 룸이 본문 권위라 Pages.doc 직접 기록은 열린 클라가 덮어쓴다.
// 순서: 룸 상태 로드 → Y update 생성 → 크기 가드 → (replace 면 히스토리 체크포인트) → 룸 로그 append →
// 룸 연결 브로드캐스트 → 병합 상태를 Pages.doc 으로 materialize(upsertPage) + publishPageChanged.
import * as Y from "yjs";
import {
  CollabContentError,
  buildInsertUpdate,
  buildReplaceUpdate,
  normalizeLegacyJsonNode,
  schemaFromSpec,
  stateToDocJson,
  type DocJson,
  type ServerEditOptions,
} from "../_shared/collabContent";
import { appendPageUpdate, loadPageState } from "../realtime/yjsStore";
import { hasMeaningfulPageDocContent } from "../v5-resolvers/handlers/pageDatabase";
import { ToolError, type McpContext } from "./context";
import { pageRoomKey } from "./pageBody";
import { CONCURRENT_MODIFICATION, patchPage, recordBodyCheckpoint, type PagePatch, type SavedPage } from "./pageWrite";
import { parseDocJson } from "./text";
import { broadcastRoomUpdate, type BroadcastResult } from "./wsBroadcast";

/** Pages.doc 상한 — 클라 upsertPage payload 가드(MAX_UPSERT_PAGE_PAYLOAD_BYTES 350KB)와 맞춘다. */
export const MAX_PAGE_DOC_BYTES = 350 * 1024;

type Item = Record<string, unknown>;

/**
 * 편집 기준 본문.
 * - room: 룸에 본문이 있음(권위).
 * - seed: 룸이 비었고 Pages.doc 에 본문 → 결정적 시드(seedDocJson) 위에 편집.
 * - empty: 룸·Pages.doc 모두 비었음(신규/placeholder) → allowEmptyRoom.
 * - repair: 룸이 빈 문단뿐(오염)인데 Pages.doc 에 본문 → Pages.doc 기준 전체 교체로 룸을 복구.
 *   (클라도 placeholder 룸은 서버 본문으로 교체한다 — 여기에 삽입만 하면 기존 본문이 가려진다.)
 */
export type BodyBase = {
  room: string;
  state: Uint8Array;
  doc: DocJson;
  source: "room" | "seed" | "empty" | "repair";
  options: ServerEditOptions;
};

export type BodyEdit =
  | { kind: "replace"; doc: DocJson }
  | { kind: "insert"; blocks: DocJson[]; at: { index: number } | "end" };

export type BodyWriteResult = {
  changed: boolean;
  doc: DocJson;
  saved: SavedPage | null;
  broadcast: BroadcastResult | null;
  /** 교체 전 버전 히스토리 체크포인트를 남겼는지. */
  checkpointed: boolean;
  /** Pages.doc materialize(+publish) 성공 여부. 룸 반영 뒤 실패해도 쓰기 자체는 성공이다. */
  materialized: boolean;
};

function emptyDoc(): DocJson {
  return { type: "doc", content: [] };
}

export async function loadBodyBase(ctx: McpContext, page: Item): Promise<BodyBase> {
  const room = pageRoomKey(ctx.collabRoomEpoch, String(page.id));
  const state = await loadPageState(room);
  const roomDoc = stateToDocJson(state);
  const stored = parseDocJson(page.doc) as DocJson | null;
  const storedMeaningful = hasMeaningfulPageDocContent(stored);
  if ((roomDoc.content ?? []).length > 0) {
    if (hasMeaningfulPageDocContent(roomDoc) || !storedMeaningful || !stored) {
      return { room, state, doc: roomDoc, source: "room", options: {} };
    }
    return { room, state, doc: normalizeLegacyJsonNode(stored), source: "repair", options: {} };
  }
  if (stored && storedMeaningful) {
    return { room, state, doc: normalizeLegacyJsonNode(stored), source: "seed", options: { seedDocJson: stored } };
  }
  return { room, state, doc: emptyDoc(), source: "empty", options: { allowEmptyRoom: true } };
}

function spliceBlocks(doc: DocJson, blocks: DocJson[], at: { index: number } | "end"): DocJson {
  const content = doc.content ?? [];
  const index = at === "end" ? content.length : at.index;
  return { ...doc, content: [...content.slice(0, index), ...blocks, ...content.slice(index)] };
}

function buildUpdate(base: BodyBase, edit: BodyEdit): Uint8Array | null {
  const schema = schemaFromSpec();
  // repair 는 룸이 오염 상태라 삽입 위치가 Pages.doc 기준과 맞지 않는다 → 전체 교체로 변환.
  const effective: BodyEdit =
    base.source === "repair" && edit.kind === "insert"
      ? { kind: "replace", doc: spliceBlocks(base.doc, edit.blocks, edit.at) }
      : edit;
  try {
    return effective.kind === "replace"
      ? buildReplaceUpdate(base.state, schema, effective.doc, base.options)
      : buildInsertUpdate(base.state, schema, effective.blocks, effective.at, base.options);
  } catch (err) {
    if (err instanceof CollabContentError) throw new ToolError(`Invalid content: ${err.message}`);
    throw err;
  }
}

function resolvePatch(patch: PagePatch | undefined, latest: Item): Item {
  if (!patch) return {};
  return typeof patch === "function" ? patch(latest) : patch;
}

export function docByteLength(doc: unknown): number {
  return Buffer.byteLength(JSON.stringify(doc), "utf8");
}

/**
 * 본문 편집을 룸에 반영하고 Pages.doc 을 materialize 한다. patch(제목·아이콘·셀 등)는 같은 upsert 에 싣는다.
 * 변경이 없으면 룸은 건드리지 않고, patch 가 있을 때만 메타를 저장한다.
 */
export async function writePageBody(
  ctx: McpContext,
  page: Item,
  base: BodyBase,
  edit: BodyEdit,
  opts: { checkpoint?: boolean; patch?: PagePatch } = {},
): Promise<BodyWriteResult> {
  const patch = opts.patch;
  const pageId = String(page.id);
  const update = buildUpdate(base, edit);
  if (!update) {
    const saved = patch ? await patchPage(ctx, pageId, patch) : null;
    return { changed: false, doc: base.doc, saved, broadcast: null, checkpointed: false, materialized: saved !== null };
  }
  const nextDoc = stateToDocJson(Y.mergeUpdates([base.state, update]));
  // 서버 placeholder 가드(preserveExistingDocForPlaceholderInput)·클라 placeholder 복구가 옛 본문을 되살려
  // 룸과 Pages.doc 이 어긋나므로, 본문 전체 비우기는 받지 않는다.
  if (!hasMeaningfulPageDocContent(nextDoc) && hasMeaningfulPageDocContent(base.doc)) {
    throw new ToolError("Clearing the whole page body is not supported; keep some content or use trash_page");
  }
  const bytes = docByteLength(nextDoc);
  if (bytes > MAX_PAGE_DOC_BYTES) {
    throw new ToolError(`Resulting page body is ${bytes} bytes (max ${MAX_PAGE_DOC_BYTES}). Split the content into child pages.`);
  }
  const checkpointed = Boolean(opts.checkpoint) && hasMeaningfulPageDocContent(base.doc);
  if (checkpointed) await recordBodyCheckpoint(ctx, page, base.doc);
  await appendPageUpdate(base.room, update);
  const broadcast = await broadcastRoomUpdate(base.room, update);
  const saved = await materializeAfterRoomWrite(ctx, pageId, JSON.stringify(nextDoc), patch);
  return { changed: true, doc: nextDoc, saved, broadcast, checkpointed, materialized: saved !== null };
}

/**
 * 룸 반영 뒤 Pages.doc materialize. 여기서 실패해도 오류로 돌려주면 안 된다 — 본문은 이미 룸(권위)에 확정됐고,
 * AI 가 "재시도" 로 append·insert 를 다시 보내면 내용이 중복된다. 열린 클라의 주기 업서트(8초)가 updatedAt 을
 * 자주 바꿔 조건부 저장 충돌은 흔하며, 그 클라가 룸 상태를 다시 materialize 한다. 실패 시 publish 도 생략된다.
 */
async function materializeAfterRoomWrite(ctx: McpContext, pageId: string, doc: string, patch: PagePatch | undefined) {
  try {
    return await patchPage(ctx, pageId, (latest) => ({ ...resolvePatch(patch, latest), doc }));
  } catch (err) {
    const conflict = err instanceof ToolError && err.message === CONCURRENT_MODIFICATION;
    const log = conflict ? console.warn : console.error;
    log("mcp materialize 생략(룸 반영 완료)", { pageId, conflict }, conflict ? "" : err);
    return null;
  }
}
