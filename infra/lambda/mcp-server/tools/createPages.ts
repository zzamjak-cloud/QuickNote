// create_pages — 페이지·워크스페이스 루트·DB 행 생성. 신규 페이지는 협업 룸이 없으므로 Pages.doc 에 직접 쓰고
// (첫 진입 클라가 서버 본문으로 결정적 시드), DB 행 셀은 DB 룸이 시드돼 있으면 룸에도 기록한다.
// 모든 입력(본문 파싱·속성 변환)을 먼저 검증한 뒤 쓰기를 시작해 부분 생성을 줄인다.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { convertProperties } from "../cellInput";
import { pageIconInput } from "../iconInput";
import { parseNewPageContent } from "../contentEdit";
import { ToolError, type McpContext } from "../context";
import { writeDbRowCells } from "../dbCollabWriter";
import { requireCollabEpoch } from "../epochGuard";
import {
  allocateUniqueTitle,
  assertDatabasesUsable,
  nextSiblingOrder,
  prepareNewDoc,
  workspaceMetas,
} from "../pageHelpers";
import { nowIso, saveNewPage } from "../pageWrite";
import { loadWritableDatabase, loadWritablePage, requireWritableWorkspace } from "../writeAccess";

const idString = z.string().trim().min(1).max(256);

export const pageSpecInput = z
  .object({
    title: z.string().max(500).optional().describe("Page title (DB rows: may instead be given via the title column in properties)"),
    icon: pageIconInput.optional().describe('Emoji, "quicknote-lucide:<Name>:<hex>" or "quicknote-image://<imageId>"'),
    content: z.string().optional().describe("Body as QFM markdown (max 512KB)"),
    properties: z.record(z.string(), z.unknown()).optional()
      .describe("Database rows only: {columnNameOrId: value}. select/status: option label; multiSelect: labels[]; person: member id or email (or list); date: YYYY-MM-DD or {start,end}; checkbox: boolean; pageLink: page ids"),
  })
  .strict();

export const createPagesInputShape = {
  parent: z
    .union([
      z.object({ pageId: idString }).strict(),
      z.object({ databaseId: idString }).strict(),
      z.object({ workspaceId: idString }).strict(),
    ])
    .describe("Where to create: {pageId} child pages, {databaseId} database rows, {workspaceId} top-level pages"),
  pages: z.array(pageSpecInput).min(1).max(20).describe("1-20 pages to create, in order (appended after existing siblings)"),
};
const createPagesInput = z.object(createPagesInputShape);
export type CreatePagesInput = z.input<typeof createPagesInput>;

type Item = Record<string, unknown>;
type Target = { workspaceId: string; parentId: string | null; db: Item | null };
type Prepared = {
  title: string | undefined;
  icon?: string;
  /** 검증·id 부여·크기 검사를 마친 저장용 본문(쓰기 루프 전에 전부 준비). */
  doc: string;
  databaseIds: string[];
  cells: Record<string, unknown>;
};

async function resolveTarget(ctx: McpContext, parent: CreatePagesInput["parent"]): Promise<Target> {
  if ("pageId" in parent) {
    const page = await loadWritablePage(ctx, parent.pageId);
    return { workspaceId: String(page.workspaceId), parentId: String(page.id), db: null };
  }
  if ("databaseId" in parent) {
    const db = await loadWritableDatabase(ctx, parent.databaseId);
    return { workspaceId: String(db.workspaceId), parentId: null, db };
  }
  await requireWritableWorkspace(ctx, parent.workspaceId);
  return { workspaceId: parent.workspaceId, parentId: null, db: null };
}

async function prepare(ctx: McpContext, target: Target, spec: z.infer<typeof pageSpecInput>): Promise<Prepared> {
  const { doc, databaseIds } = parseNewPageContent(spec.content);
  if (spec.properties && !target.db) throw new ToolError("properties can only be set on database rows (parent.databaseId)");
  const converted = target.db && spec.properties ? await convertProperties(ctx, target.db, spec.properties) : { cells: {} };
  if (spec.title !== undefined && converted.title !== undefined && spec.title !== converted.title) {
    throw new ToolError("Give the row title either as title or as the title column, not both");
  }
  const cells = Object.fromEntries(Object.entries(converted.cells).filter(([, v]) => v !== undefined));
  return {
    title: spec.title ?? converted.title,
    icon: spec.icon,
    doc: JSON.stringify(prepareNewDoc(doc)),
    databaseIds,
    cells,
  };
}

export async function createPagesTool(ctx: McpContext, raw: CreatePagesInput) {
  const input = createPagesInput.parse(raw);
  const target = await resolveTarget(ctx, input.parent);
  // DB 행 셀은 DB 룸이 권위(epoch 가드). 신규 일반 페이지는 룸이 없어 Pages.doc 시드라 무관하다.
  if (target.db) await requireCollabEpoch(ctx);
  const prepared: Prepared[] = [];
  for (const spec of input.pages) prepared.push(await prepare(ctx, target, spec));
  await assertDatabasesUsable(ctx, prepared.flatMap((p) => p.databaseIds), target.workspaceId);

  const metas = await workspaceMetas(ctx, target.workspaceId);
  const databaseId = target.db ? String(target.db.id) : null;
  const firstOrder = nextSiblingOrder(metas, { parentId: target.parentId, databaseId });
  const reserved = new Set<string>();
  const created: { id: string; title: string; updatedAt: string; cellsWrittenTo?: "collab" | "pages" }[] = [];
  for (const [i, p] of prepared.entries()) {
    // DB 행은 클라도 제목 중복을 강제하지 않는다. 일반 페이지만 워크스페이스 단위로 회피한다.
    const title = databaseId ? (p.title ?? "").trim() : allocateUniqueTitle(metas, p.title, reserved);
    reserved.add(title);
    const now = nowIso();
    const id = randomUUID();
    const { page } = await saveNewPage(ctx, {
      id,
      workspaceId: target.workspaceId,
      createdByMemberId: ctx.caller.memberId,
      title,
      ...(p.icon ? { icon: p.icon } : {}),
      parentId: target.parentId,
      order: String(firstOrder + i),
      databaseId,
      doc: p.doc,
      dbCells: databaseId ? JSON.stringify(p.cells) : null,
      createdAt: now,
      updatedAt: now,
    });
    const cellsWrittenTo = databaseId ? await writeDbRowCells(ctx, databaseId, id, p.cells, { newRow: true }) : undefined;
    created.push({ id, title, updatedAt: String(page.updatedAt ?? now), ...(cellsWrittenTo ? { cellsWrittenTo } : {}) });
  }
  return { workspaceId: target.workspaceId, parentId: target.parentId, databaseId, pages: created };
}
