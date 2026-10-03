// update_database — 제목·컬럼 추가/수정/삭제. 앱 columnActions 와 같은 의미:
// - title 컬럼은 삭제·타입 변경 불가(이름만 변경).
// - 타입 변경은 앱처럼 값 변환 없이 허용(config·옵션 유지). 쓸 수 있는 타입 집합 안에서만.
// - 컬럼 삭제 전에는 DB 버전 히스토리 체크포인트를 남긴다(복원 가능).
// 제목 변경은 앱 setDatabaseTitle 처럼 풀페이지 홈 페이지 제목을 먼저 맞춘다.
import { z } from "zod";
import type { ColumnDef } from "../../../../src/types/database";
import { resolveColumn } from "../cellInput";
import { ToolError, type McpContext } from "../context";
import { findDatabaseHomeId } from "../dbPath";
import {
  OPTION_COLUMN_TYPES, WRITABLE_COLUMN_TYPES, assertUniqueColumnNames, buildColumn, buildOptions, columnSpecInput, sameName,
} from "../dbSchemaInput";
import {
  currentColumns, recordDatabaseCheckpoint, saveDatabase, workspaceDatabaseTitles, writeColumns, type ColumnPlan,
} from "../dbStructureWriter";
import { requireCollabEpoch } from "../epochGuard";
import { normalizeTitle, workspaceMetas } from "../pageHelpers";
import { patchPage } from "../pageWrite";
import { parseColumns } from "../properties";
import { loadWritableDatabase } from "../writeAccess";

const name = z.string().trim().min(1).max(100);

const columnUpdateInput = z
  .object({
    column: z.string().trim().min(1).max(200).describe("Column name or id"),
    name: name.optional(),
    type: z.enum(WRITABLE_COLUMN_TYPES).optional().describe("Change type (values are not converted, like the app)"),
    addOptions: z.array(name).max(100).optional(),
    renameOptions: z.array(z.object({ from: name, to: name }).strict()).max(100).optional(),
  })
  .strict();

export const updateDatabaseInputShape = {
  databaseId: z.string().trim().min(1).max(256),
  title: z.string().trim().min(1).max(200).optional(),
  addColumns: z.array(columnSpecInput).max(20).optional(),
  updateColumns: z.array(columnUpdateInput).max(20).optional(),
  removeColumns: z.array(z.string().trim().min(1).max(200)).max(20).optional()
    .describe("Column names or ids. A version-history checkpoint is saved first; the title column cannot be removed"),
};
const updateDatabaseInput = z.object(updateDatabaseInputShape);
export type UpdateDatabaseInput = z.input<typeof updateDatabaseInput>;
type Input = z.infer<typeof updateDatabaseInput>;
type Item = Record<string, unknown>;

const PROTECTED_DB_PREFIXES = ["lc-scheduler-db:", "lc-milestone-db:", "lc-feature-db:"];

/** 변경 단위 수(일일 쓰기 상한 차감용). */
export function databaseChangeUnits(input: UpdateDatabaseInput): number {
  const n = (input.title ? 1 : 0) + (input.addColumns?.length ?? 0) + (input.updateColumns?.length ?? 0) + (input.removeColumns?.length ?? 0);
  return Math.max(1, n);
}

function updateColumn(col: ColumnDef, u: z.infer<typeof columnUpdateInput>): ColumnDef {
  if (col.type === "title" && (u.type || u.addOptions || u.renameOptions)) {
    throw new ToolError(`"${col.name}" is the title column; only its name can change`);
  }
  const type = u.type ?? col.type;
  const next: ColumnDef = { ...col, name: u.name ?? col.name, type };
  if (!u.addOptions && !u.renameOptions) return next;
  if (!OPTION_COLUMN_TYPES.has(type)) throw new ToolError(`Column "${col.name}": options need a select, multiSelect or status column`);
  let options = [...(col.config?.options ?? [])];
  for (const r of u.renameOptions ?? []) {
    const hit = options.find((o) => !o.divider && sameName(o.label, r.from));
    if (!hit) throw new ToolError(`Column "${col.name}": unknown option "${r.from}". Valid options: ${options.map((o) => o.label).join(", ")}`);
    if (options.some((o) => o !== hit && sameName(o.label, r.to))) throw new ToolError(`Option "${r.to}" already exists`);
    options = options.map((o) => (o === hit ? { ...o, label: r.to } : o));
  }
  options = [...options, ...buildOptions(u.addOptions ?? [], options)];
  return { ...next, config: { ...(col.config ?? {}), options } };
}

export function planColumns(current: ColumnDef[], input: Input): ColumnPlan {
  const lite = parseColumns(JSON.stringify(current));
  const removedIds = (input.removeColumns ?? []).map((key) => {
    const col = resolveColumn(lite, key);
    if (col.type === "title") throw new ToolError(`"${col.name}" is the title column and cannot be removed`);
    return col.id;
  });
  const updated = (input.updateColumns ?? []).map((u) => {
    const id = resolveColumn(lite, u.column).id;
    if (removedIds.includes(id)) throw new ToolError(`Column "${u.column}" is both updated and removed`);
    return updateColumn(current.find((c) => c.id === id) as ColumnDef, u);
  });
  if (new Set(updated.map((c) => c.id)).size !== updated.length) throw new ToolError("A column is updated more than once");
  const added = (input.addColumns ?? []).map(buildColumn);
  const plan = { added, updated, removedIds };
  const byId = new Map(updated.map((c) => [c.id, c]));
  assertUniqueColumnNames([...current.filter((c) => !removedIds.includes(c.id)).map((c) => byId.get(c.id) ?? c), ...added]);
  return plan;
}

/** 앱 setDatabaseTitle: DB 제목 중복 거부 → 홈 페이지 제목(페이지 제목 중복 거부)을 먼저 맞춘 뒤 DB 제목. */
export async function renameDatabase(ctx: McpContext, db: Item, title: string): Promise<string | null> {
  const workspaceId = String(db.workspaceId);
  const wanted = normalizeTitle(title);
  const taken = await workspaceDatabaseTitles(ctx, workspaceId, String(db.id));
  if (taken.some((t) => normalizeTitle(t) === wanted)) throw new ToolError(`A database titled "${wanted}" already exists in this workspace`);
  const metas = await workspaceMetas(ctx, workspaceId);
  const homeId = await findDatabaseHomeId(ctx, db, metas);
  if (homeId) {
    if (metas.some((m) => m.id !== homeId && normalizeTitle(m.title) === wanted)) {
      throw new ToolError(`A page titled "${wanted}" already exists in this workspace`);
    }
    await patchPage(ctx, homeId, { title: wanted });
  }
  return homeId;
}

export async function updateDatabaseTool(ctx: McpContext, raw: UpdateDatabaseInput) {
  const input = updateDatabaseInput.parse(raw);
  if (!input.title && !input.addColumns?.length && !input.updateColumns?.length && !input.removeColumns?.length) {
    throw new ToolError("Nothing to update: pass title, addColumns, updateColumns or removeColumns");
  }
  if (PROTECTED_DB_PREFIXES.some((p) => input.databaseId.startsWith(p))) throw new ToolError("This database is managed by the scheduler and cannot be changed via MCP");
  const db = await loadWritableDatabase(ctx, input.databaseId);
  const current = await currentColumns(ctx, db);
  const plan = planColumns(current, input);
  const columnsChanged = plan.added.length + plan.updated.length + plan.removedIds.length > 0;
  // 컬럼은 DB 룸이 권위(epoch 가드). 제목은 룸 밖(Databases·홈 페이지 메타)이라 대상이 아니다.
  if (columnsChanged) await requireCollabEpoch(ctx);
  const homePageId = input.title ? await renameDatabase(ctx, db, input.title) : null;
  const extra = input.title ? { title: normalizeTitle(input.title) } : {};
  if (plan.removedIds.length > 0) await recordDatabaseCheckpoint(ctx, db, current);
  const result = columnsChanged ? await writeColumns(ctx, db, current, plan, extra) : null;
  const saved = result?.saved ?? await saveDatabase(ctx, db, extra);
  return {
    databaseId: String(db.id),
    title: String(saved.title ?? ""),
    updatedAt: String(saved.updatedAt ?? ""),
    ...(homePageId ? { homePageId } : {}),
    ...(result ? { structureWrittenTo: result.writtenTo, historyCheckpoint: plan.removedIds.length > 0 } : {}),
    columns: (result?.columns ?? current).map((c) => ({ id: c.id, name: c.name, type: c.type })),
    ...(plan.added.length ? { addedColumnIds: plan.added.map((c) => c.id) } : {}),
  };
}
