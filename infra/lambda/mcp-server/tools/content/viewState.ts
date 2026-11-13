// DB 뷰 상태의 위치·읽기·쓰기.
// 앱에서 "뷰"는 페이지 본문의 databaseBlock 이다: attrs.view(표/보드/타임라인/갤러리/리스트) + attrs.panelState(JSON 문자열 —
// 필터·정렬·그룹·컬럼 표시·필터 프리셋 탭). 풀페이지 DB 는 홈 페이지(fullPageDatabaseId)의 fullPage 블록이 같은 역할을 한다.
// 홈이 없는 DB(직접 열기 화면)만 DB 레코드의 panelState(협업 DB 룸 권위)를 쓴다.
// 블록 쓰기는 update_page 와 같은 페이지 룸 경로(writePageBody), DB 수준 쓰기는 update_database 와 같은 DB 룸 경로
// (panelState = Y.Map 키 단위 병합, 클라 reconcileStructureIntoYDoc 과 같은 표현) + upsertDatabase·발행.
import * as Y from "yjs";
import type { DocJson } from "../../../_shared/collabContent";
import { jsonToY } from "../../../realtime/dbSeed";
import { parseDatabasePanelStateJson } from "../../../../../src/lib/schemas/panelStateSchema";
import type { DatabasePanelState, ViewKind } from "../../../../../src/types/database";
import { loadBodyBase, writePageBody } from "../../collabWriter";
import { ToolError, type McpContext } from "../../context";
import { editDbRoom, readDbRoomRoot } from "../../dbCollabWriter";
import { findDatabaseHomeId } from "../../dbPath";
import { saveDatabase } from "../../dbStructureWriter";
import { requireCollabEpoch } from "../../epochGuard";
import { loadPageBody } from "../../pageBody";
import { workspaceMetas } from "../../pageHelpers";
import { loadWritablePage } from "../../writeAccess";
import { loadPageAnyState } from "../history/shared";

type Item = Record<string, unknown>;
export const VIEW_KINDS = ["table", "kanban", "timeline", "gallery", "list"] as const;

export type ViewTarget = {
  kind: "block" | "database";
  pageId: string | null;
  pageTitle: string | null;
  layout: string | null;
  view: ViewKind | null;
  panel: DatabasePanelState;
};

function isViewKind(value: unknown): value is ViewKind {
  return typeof value === "string" && (VIEW_KINDS as readonly string[]).includes(value);
}

export function findDatabaseBlock(node: DocJson, databaseId: string): DocJson | null {
  if (node.type === "databaseBlock" && node.attrs?.databaseId === databaseId) return node;
  for (const child of node.content ?? []) {
    const hit = findDatabaseBlock(child, databaseId);
    if (hit) return hit;
  }
  return null;
}

function patchDatabaseBlocks(node: DocJson, databaseId: string, attrs: Item): DocJson {
  if (node.type === "databaseBlock" && node.attrs?.databaseId === databaseId) return { ...node, attrs: { ...node.attrs, ...attrs } };
  if (!node.content) return node;
  return { ...node, content: node.content.map((c) => patchDatabaseBlocks(c, databaseId, attrs)) };
}

function blockTarget(page: Item, block: DocJson): ViewTarget {
  const attrs = block.attrs ?? {};
  return {
    kind: "block",
    pageId: String(page.id),
    pageTitle: String(page.title ?? ""),
    layout: typeof attrs.layout === "string" ? attrs.layout : "inline",
    view: isViewKind(attrs.view) ? attrs.view : "table",
    panel: parseDatabasePanelStateJson(typeof attrs.panelState === "string" ? attrs.panelState : "{}"),
  };
}

/** DB 수준 panelState — 룸이 시드돼 있으면 룸(권위), 아니면 Databases 레코드. */
export async function databasePanel(ctx: McpContext, db: Item): Promise<DatabasePanelState> {
  const root = await readDbRoomRoot(ctx, String(db.id));
  const fromRoom = root && Array.isArray(root.columns) && root.columns.length > 0 ? root.panelState : undefined;
  const raw = fromRoom ?? db.panelState;
  return parseDatabasePanelStateJson(typeof raw === "string" ? raw : JSON.stringify(raw ?? {}));
}

function databaseTarget(panel: DatabasePanelState): ViewTarget {
  return { kind: "database", pageId: null, pageTitle: null, layout: null, view: null, panel };
}

async function homePageId(ctx: McpContext, db: Item): Promise<string | null> {
  return findDatabaseHomeId(ctx, db, await workspaceMetas(ctx, String(db.workspaceId)));
}

/** 읽기용 — 홈(풀페이지) 블록과 지정 페이지의 블록, DB 수준 설정. */
export async function readViewTargets(ctx: McpContext, db: Item, pageId?: string): Promise<{ database: ViewTarget; blocks: ViewTarget[] }> {
  const databaseId = String(db.id);
  const ids = [...new Set([await homePageId(ctx, db), pageId].filter((id): id is string => Boolean(id)))];
  const blocks: ViewTarget[] = [];
  for (const id of ids) {
    const page = await loadPageAnyState(ctx, id, "read");
    const body = await loadPageBody(ctx.collabRoomEpoch, page);
    const block = body.doc ? findDatabaseBlock(body.doc as DocJson, databaseId) : null;
    if (block) blocks.push(blockTarget(page, block));
    else if (id === pageId) throw new ToolError(`Page ${pageId} has no view of this database`);
  }
  return { database: databaseTarget(await databasePanel(ctx, db)), blocks };
}

export type WriteTarget =
  | { kind: "block"; target: ViewTarget; page: Item; base: Awaited<ReturnType<typeof loadBodyBase>> }
  | { kind: "database"; target: ViewTarget };

/** 쓰기 대상 — pageId 의 블록, 없으면 홈 블록, 홈도 없으면 DB 수준 설정. */
export async function resolveWriteTarget(ctx: McpContext, db: Item, pageId?: string): Promise<WriteTarget> {
  const id = pageId ?? await homePageId(ctx, db);
  if (!id) return { kind: "database", target: databaseTarget(await databasePanel(ctx, db)) };
  const page = await loadWritablePage(ctx, id);
  const base = await loadBodyBase(ctx, page);
  const block = findDatabaseBlock(base.doc, String(db.id));
  if (!block) throw new ToolError(`Page ${id} has no view of this database`);
  return { kind: "block", target: blockTarget(page, block), page, base };
}

/** DB 수준 panelState 의 바꾼 키만 룸 Y.Map 에 반영하고 Databases 에 저장·발행한다. */
async function writeDatabasePanel(ctx: McpContext, db: Item, current: DatabasePanelState, patch: Partial<DatabasePanelState>) {
  const next = { ...current, ...patch };
  const writtenTo = await editDbRoom(ctx, String(db.id), (root) => {
    let panel = root.get("panelState");
    if (!(panel instanceof Y.Map)) {
      panel = new Y.Map<unknown>();
      root.set("panelState", panel);
    }
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) (panel as Y.Map<unknown>).delete(k);
      else (panel as Y.Map<unknown>).set(k, jsonToY(v));
    }
  });
  await saveDatabase(ctx, db, { panelState: JSON.stringify(next) });
  return writtenTo;
}

export type ViewWrite = { view?: ViewKind; patch: Partial<DatabasePanelState> };

/**
 * 뷰 변경 적용. 블록은 attrs(view·panelState 전체 JSON — 앱 setPanelState 와 같은 형태)를 룸에 쓰고,
 * 컬럼 표시(viewConfigs)를 바꿨으면 앱 표시설정처럼 DB 수준 panelState 에도 미러링한다(피커뷰 속성 순서).
 */
export async function applyViewWrite(ctx: McpContext, db: Item, write: WriteTarget, change: ViewWrite): Promise<{ writtenTo: string; target: ViewTarget }> {
  await requireCollabEpoch(ctx);
  const panel = { ...write.target.panel, ...change.patch };
  if (write.kind === "database") {
    const writtenTo = await writeDatabasePanel(ctx, db, write.target.panel, change.patch);
    return { writtenTo: `database:${writtenTo}`, target: { ...write.target, panel } };
  }
  const view = change.view ?? write.target.view ?? "table";
  const nextDoc = patchDatabaseBlocks(write.base.doc, String(db.id), { view, panelState: JSON.stringify(panel) });
  const result = await writePageBody(ctx, write.page, write.base, { kind: "replace", doc: nextDoc });
  if (change.patch.viewConfigs) await writeDatabasePanel(ctx, db, await databasePanel(ctx, db), { viewConfigs: panel.viewConfigs });
  return { writtenTo: result.changed ? "page" : "unchanged", target: { ...write.target, view, panel } };
}
