// create_database — 앱 생성 흐름과 같다(src/store/databaseStore.ts createDatabase, slashMenu/dbCommands.ts):
// - inline: DB 생성 + 부모 페이지 본문 끝에 databaseBlock{layout:"inline", view:"table", panelState}.
// - fullPage: DB 생성 + 숨김 홈 페이지(fullPageDatabaseId 태그, 루트, 본문 = fullPage databaseBlock 하나)
//   + (부모 페이지가 있으면) 부모 본문 끝에 DB 버튼 블록. 홈 태그 누락은 사이드바 유령이 된다(wiki/pages/ghost-page-prevention.md).
// 앱은 빈 DB 에 "항목 1" 시드 행을 만들지만, MCP 는 행을 명시적으로 만들므로(create_pages) 시드 행은 만들지 않는다.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { emptyPanelState, type ColumnDef } from "../../../../src/types/database";
import type { DocJson } from "../../_shared/collabContent";
import { loadBodyBase, writePageBody } from "../collabWriter";
import { ToolError, type McpContext } from "../context";
import { columnSpecInput, assertUniqueColumnNames, buildColumn, titleColumn, DEFAULT_TITLE_COLUMN_NAME } from "../dbSchemaInput";
import { allocateDatabaseTitle, saveDatabase, workspaceDatabaseTitles } from "../dbStructureWriter";
import { requireCollabEpoch } from "../epochGuard";
import { nextSiblingOrder, workspaceMetas } from "../pageHelpers";
import { nowIso, saveNewPage } from "../pageWrite";
import { loadWritablePage, requireWritableWorkspace } from "../writeAccess";

const idString = z.string().trim().min(1).max(256);

export const createDatabaseInputShape = {
  parent: z.union([z.object({ pageId: idString }).strict(), z.object({ workspaceId: idString }).strict()])
    .describe("inline: the page that will contain the database block. fullPage: optional host page that gets a button to the database, or a workspace"),
  title: z.string().trim().max(200).describe("Database title (a (2), (3)… suffix is added if already used in the workspace)"),
  layout: z.enum(["inline", "fullPage"]).default("inline"),
  titleColumnName: z.string().trim().min(1).max(100).optional().describe(`Name of the automatic title column (default "${DEFAULT_TITLE_COLUMN_NAME}")`),
  columns: z.array(columnSpecInput).max(30).default([]).describe("Extra columns besides the automatic title column"),
};
const createDatabaseInput = z.object(createDatabaseInputShape);
export type CreateDatabaseInput = z.input<typeof createDatabaseInput>;

type Item = Record<string, unknown>;

function databaseBlock(databaseId: string, layout: "inline" | "fullPage"): DocJson {
  const attrs: Record<string, unknown> = { databaseId, layout, view: "table", panelState: JSON.stringify(emptyPanelState()) };
  // 인라인 새 DB 는 앱 DatabaseBlockView 처럼 readOnlyTitle:false(기존 DB 연결만 true).
  if (layout === "inline") attrs.readOnlyTitle = false;
  return { type: "databaseBlock", attrs };
}

async function resolveParent(ctx: McpContext, input: z.infer<typeof createDatabaseInput>) {
  if ("pageId" in input.parent) {
    const page = await loadWritablePage(ctx, input.parent.pageId);
    if (page.databaseId || page.fullPageDatabaseId) throw new ToolError("The parent page must be a regular page");
    return { workspaceId: String(page.workspaceId), page };
  }
  if (input.layout === "inline") throw new ToolError("An inline database needs parent.pageId (the page that shows it)");
  await requireWritableWorkspace(ctx, input.parent.workspaceId);
  return { workspaceId: input.parent.workspaceId, page: null };
}

function buildColumns(input: z.infer<typeof createDatabaseInput>): ColumnDef[] {
  const columns = [titleColumn(input.titleColumnName), ...input.columns.map(buildColumn)];
  assertUniqueColumnNames(columns);
  return columns;
}

async function createHomePage(ctx: McpContext, workspaceId: string, databaseId: string, title: string): Promise<string> {
  const metas = await workspaceMetas(ctx, workspaceId);
  const id = randomUUID();
  const now = nowIso();
  await saveNewPage(ctx, {
    id,
    workspaceId,
    createdByMemberId: ctx.caller.memberId,
    // 앱 ensureFullPagePageForDatabase 와 같이 DB 제목을 그대로 쓴다(홈 제목 = DB 제목 동기화 규약).
    title,
    fullPageDatabaseId: databaseId,
    parentId: null,
    order: String(nextSiblingOrder(metas, { parentId: null, databaseId: null })),
    doc: JSON.stringify({ type: "doc", content: [databaseBlock(databaseId, "fullPage")] }),
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

/** 부모 페이지 본문 끝에 블록 추가(협업 룸 경로). */
async function appendToParent(ctx: McpContext, page: Item, block: DocJson): Promise<boolean> {
  const base = await loadBodyBase(ctx, page);
  const result = await writePageBody(ctx, page, base, { kind: "insert", blocks: [block], at: "end" });
  return result.materialized;
}

export async function createDatabaseTool(ctx: McpContext, raw: CreateDatabaseInput) {
  const input = createDatabaseInput.parse(raw);
  const parent = await resolveParent(ctx, input);
  if (parent.page) await requireCollabEpoch(ctx); // 부모 본문(룸)에 블록을 쓴다
  const columns = buildColumns(input);
  const title = allocateDatabaseTitle(await workspaceDatabaseTitles(ctx, parent.workspaceId), input.title);
  const databaseId = randomUUID();
  const now = nowIso();
  await saveDatabase(ctx, { id: databaseId, workspaceId: parent.workspaceId }, {
    title,
    columns: JSON.stringify(columns),
    // 앱 신규 DB 와 같게 presets 는 "[]", panelState 는 보내지 않는다(기본 뷰 상태는 블록 attrs 에 있다).
    presets: "[]",
    createdAt: now,
  });

  let homePageId: string | null = null;
  if (input.layout === "fullPage") homePageId = await createHomePage(ctx, parent.workspaceId, databaseId, title);
  const block = input.layout === "inline"
    ? databaseBlock(databaseId, "inline")
    // 앱 DB 버튼(인라인 노드): 슬래시 명령처럼 문단 안에 버튼 + 공백. label 은 DB 제목을 따라 자동 동기화된다.
    : { type: "paragraph", content: [{ type: "buttonBlock", attrs: { label: `${title} DB`, href: "", databaseId } }, { type: "text", text: " " }] };
  const parentMaterialized = parent.page ? await appendToParent(ctx, parent.page, block) : null;

  return {
    databaseId,
    title,
    layout: input.layout,
    ...(homePageId ? { homePageId } : {}),
    ...(parent.page ? { parentPageId: String(parent.page.id) } : {}),
    ...(parentMaterialized === false ? { parentMaterialized: false } : {}),
    columns: columns.map((c) => ({ id: c.id, name: c.name, type: c.type })),
  };
}
