// DB 뷰 툴 — 뷰 조회·뷰 설정 변경·필터 프리셋 탭 저장/삭제. 위치·쓰기 경로는 viewState.ts.
// 입력은 사람 값(컬럼 이름·옵션 라벨·이메일)이고 query_database 와 같은 변환으로 클라 FilterRule/SortRule 을 만든다.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  COLUMN_TYPE_META,
  buildViewColumnConfig,
  resolveViewColumnOrderState,
  type ColumnDef,
  type DatabasePanelState,
  type FilterPreset,
  type FilterRule,
  type SortRule,
  type ViewKind,
} from "../../../../../src/types/database";
import { resolveColumn } from "../../cellInput";
import { ToolError, type McpContext } from "../../context";
import { currentColumns } from "../../dbStructureWriter";
import { parseColumns, type ColumnLite } from "../../properties";
import { filterInput, toFilterRules } from "../queryDatabase";
import { isTrashed, loadDatabaseAnyState } from "../history/shared";
import { idInput } from "./shared";
import { VIEW_KINDS, applyViewWrite, readViewTargets, resolveWriteTarget, type ViewTarget, type ViewWrite } from "./viewState";

type Item = Record<string, unknown>;
type Columns = { defs: ColumnDef[]; lite: ColumnLite[] };

const columnKey = z.string().trim().min(1).max(200);
const sortInput = z.object({ column: columnKey, direction: z.enum(["asc", "desc"]).default("asc") }).strict();
const pageIdInput = idInput.optional()
  .describe("Page that shows the database (inline view). Omit for the full-page database view (or database-level settings when it has no home page)");

async function loadColumns(ctx: McpContext, db: Item): Promise<Columns> {
  const defs = await currentColumns(ctx, db);
  return { defs, lite: parseColumns(JSON.stringify(defs)) };
}

async function loadDatabase(ctx: McpContext, databaseId: string, access: "read" | "write"): Promise<Item> {
  const db = await loadDatabaseAnyState(ctx, databaseId, access);
  if (isTrashed(db)) throw new ToolError("This database is in the trash.");
  return db;
}

// ── 조회 ──

function nameOf(cols: Columns, id: string | null | undefined): string | null {
  if (!id) return null;
  return cols.defs.find((c) => c.id === id)?.name ?? id;
}

function describeRule(cols: Columns, rule: FilterRule) {
  const col = cols.defs.find((c) => c.id === rule.columnId);
  const labels = new Map((col?.config?.options ?? []).map((o) => [o.id, o.label]));
  const label = (v: string) => labels.get(v) ?? v;
  const value = Array.isArray(rule.value) ? rule.value.map(label) : rule.value === undefined ? undefined : label(rule.value);
  return { column: nameOf(cols, rule.columnId), operator: rule.operator, ...(value === undefined ? {} : { value }) };
}

function describeSorts(cols: Columns, sorts: SortRule[]) {
  return sorts.map((s) => ({ column: nameOf(cols, s.columnId), direction: s.dir }));
}

function describeColumns(cols: Columns, panel: DatabasePanelState) {
  const out: Record<string, { order: (string | null)[]; hidden: (string | null)[] }> = {};
  for (const [kind, cfg] of Object.entries(panel.viewConfigs ?? {})) {
    const state = resolveViewColumnOrderState(cols.defs, kind as ViewKind, cfg);
    out[kind] = { order: state.orderedColumnIds.map((id) => nameOf(cols, id)), hidden: state.hiddenColumnIds.map((id) => nameOf(cols, id)) };
  }
  return out;
}

export function describeTarget(cols: Columns, t: ViewTarget) {
  const p = t.panel;
  return {
    target: t.kind === "block" ? { pageId: t.pageId, pageTitle: t.pageTitle, layout: t.layout } : "database",
    ...(t.view ? { view: t.view } : {}),
    hiddenViews: p.hiddenViewKinds ?? [],
    search: p.searchQuery || null,
    filters: (p.filterRules ?? []).map((r) => describeRule(cols, r)),
    sorts: describeSorts(cols, p.sortRules ?? []),
    groupBy: nameOf(cols, p.groupByColumnId),
    kanbanGroupBy: nameOf(cols, p.kanbanGroupColumnId),
    timelineDateColumn: nameOf(cols, p.timelineDateColumnId),
    galleryCoverColumn: nameOf(cols, p.galleryCoverColumnId),
    galleryColumns: p.galleryColumns ?? null,
    itemLimit: p.itemLimit ?? null,
    pageTreeEnabled: p.pageTreeEnabled ?? false,
    hideTitle: p.hideTitle ?? false,
    headerColor: p.headerColor ?? null,
    columns: describeColumns(cols, p),
    filterPresets: (p.filterPresets ?? []).map((fp) => ({
      id: fp.id, name: fp.name, ...(fp.icon ? { icon: fp.icon } : {}),
      filters: fp.filterRules.map((r) => describeRule(cols, r)), sorts: describeSorts(cols, fp.sortRules),
    })),
    activePresetId: p.activePresetId ?? null,
  };
}

export const listDatabaseViewsInputShape = {
  databaseId: idInput,
  pageId: idInput.optional().describe("Also include the inline view of this database on this page"),
};
const listDatabaseViewsInput = z.object(listDatabaseViewsInputShape);

export async function listDatabaseViewsTool(ctx: McpContext, raw: z.input<typeof listDatabaseViewsInput>) {
  const input = listDatabaseViewsInput.parse(raw);
  const db = await loadDatabase(ctx, input.databaseId, "read");
  const cols = await loadColumns(ctx, db);
  const targets = await readViewTargets(ctx, db, input.pageId);
  return {
    databaseId: String(db.id),
    title: String(db.title ?? ""),
    columns: cols.defs.map((c) => ({ name: c.name, type: c.type })),
    views: targets.blocks.map((t) => describeTarget(cols, t)),
    databaseLevel: describeTarget(cols, targets.database),
    note: "Each page view (inline block or full-page home) keeps its own view type, filters, sorts, grouping and column visibility. " +
      "Change them with update_database_view; filter tabs with save_database_filter_preset / delete_database_filter_preset.",
  };
}

// ── 변경 ──

function columnOfType(cols: Columns, key: string | null | undefined, allowed: (c: ColumnDef) => boolean, what: string): string | null | undefined {
  if (key === undefined) return undefined;
  if (key === null) return null;
  const id = resolveColumn(cols.lite, key).id;
  const def = cols.defs.find((c) => c.id === id) as ColumnDef;
  if (!allowed(def)) throw new ToolError(`Column "${def.name}" (${def.type}) cannot be used as ${what}`);
  return id;
}

function toSortRules(cols: Columns, sorts: z.infer<typeof sortInput>[]): SortRule[] {
  return sorts.map((s) => ({ columnId: resolveColumn(cols.lite, s.column).id, dir: s.direction }));
}

const columnsInput = z.object({
  view: z.enum(VIEW_KINDS),
  order: z.array(columnKey).max(200).optional().describe("Column order for this view (unlisted columns keep their relative order after these)"),
  hidden: z.array(columnKey).max(200).optional().describe("Columns hidden in this view (replaces the hidden set; the title column cannot be hidden)"),
}).strict();

function applyColumnConfigs(cols: Columns, panel: DatabasePanelState, specs: z.infer<typeof columnsInput>[]) {
  const next = { ...(panel.viewConfigs ?? {}) };
  for (const spec of specs) {
    const state = resolveViewColumnOrderState(cols.defs, spec.view, next[spec.view]);
    const order = spec.order ? spec.order.map((k) => resolveColumn(cols.lite, k).id) : state.orderedColumnIds;
    const hidden = spec.hidden ? spec.hidden.map((k) => resolveColumn(cols.lite, k).id) : state.hiddenColumnIds;
    next[spec.view] = buildViewColumnConfig(cols.defs, spec.view, order, hidden);
  }
  return next;
}

export const updateDatabaseViewInputShape = {
  databaseId: idInput,
  pageId: pageIdInput,
  view: z.enum(VIEW_KINDS).optional().describe("Displayed layout (page views only)"),
  filters: z.array(filterInput).max(20).optional().describe("Replaces the view's filters (AND). [] clears. Also deactivates the active filter tab"),
  sorts: z.array(sortInput).max(5).optional().describe("Replaces the view's sorts in priority order. [] clears"),
  search: z.string().max(200).optional(),
  groupBy: columnKey.nullable().optional().describe("Group table/list/gallery rows by this column (null = off)"),
  kanbanGroupBy: columnKey.nullable().optional().describe("Board columns: a status or select column"),
  timelineDateColumn: columnKey.nullable().optional().describe("Date column for the timeline"),
  galleryCoverColumn: columnKey.nullable().optional().describe("File or URL column for gallery card covers"),
  galleryColumns: z.number().int().min(1).max(10).optional(),
  itemLimit: z.number().int().min(1).max(1000).optional().describe("Rows shown before 'show more' (inline views)"),
  pageTreeEnabled: z.boolean().optional(),
  hideTitle: z.boolean().optional().describe("Hide the inline database header"),
  headerColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  hiddenViews: z.array(z.enum(VIEW_KINDS)).max(5).optional().describe("Layouts hidden from the view switcher (table is always available)"),
  columns: z.array(columnsInput).max(5).optional().describe("Per-layout column order / hidden columns"),
  activePreset: z.string().trim().min(1).max(200).nullable().optional().describe("Filter tab id or name to activate; null = none"),
};
const updateDatabaseViewInput = z.object(updateDatabaseViewInputShape);
type UpdateInput = z.infer<typeof updateDatabaseViewInput>;

function findPreset(panel: DatabasePanelState, key: string): FilterPreset {
  const presets = panel.filterPresets ?? [];
  const hit = presets.find((p) => p.id === key) ?? presets.find((p) => p.name.trim().toLowerCase() === key.trim().toLowerCase());
  if (!hit) throw new ToolError(`Unknown filter tab "${key}". Tabs: ${presets.map((p) => `${p.name} (${p.id})`).join(", ") || "none"}`);
  return hit;
}

async function buildPatch(ctx: McpContext, cols: Columns, panel: DatabasePanelState, input: UpdateInput, workspaceId: string) {
  const patch: Partial<DatabasePanelState> = {};
  const ruleId = () => randomUUID();
  if (input.filters) patch.filterRules = await toFilterRules(ctx, cols.lite, input.filters, workspaceId, ruleId);
  if (input.sorts) Object.assign(patch, { sortRules: toSortRules(cols, input.sorts), sortColumnId: null });
  if (input.search !== undefined) patch.searchQuery = input.search;
  const groupBy = columnOfType(cols, input.groupBy, (c) => COLUMN_TYPE_META[c.type]?.groupable === true, "a group");
  if (groupBy !== undefined) patch.groupByColumnId = groupBy;
  const kanban = columnOfType(cols, input.kanbanGroupBy, (c) => c.type === "status" || c.type === "select", "board columns");
  if (kanban !== undefined) patch.kanbanGroupColumnId = kanban;
  const timeline = columnOfType(cols, input.timelineDateColumn, (c) => c.type === "date", "the timeline date");
  if (timeline !== undefined) patch.timelineDateColumnId = timeline;
  const cover = columnOfType(cols, input.galleryCoverColumn, (c) => c.type === "file" || c.type === "url", "a gallery cover");
  if (cover !== undefined) patch.galleryCoverColumnId = cover;
  for (const key of ["galleryColumns", "itemLimit", "pageTreeEnabled", "hideTitle", "headerColor"] as const) {
    if (input[key] !== undefined) Object.assign(patch, { [key]: input[key] });
  }
  if (input.hiddenViews) patch.hiddenViewKinds = input.hiddenViews.filter((k) => k !== "table");
  if (input.columns) patch.viewConfigs = applyColumnConfigs(cols, panel, input.columns);
  if (input.activePreset !== undefined) patch.activePresetId = input.activePreset === null ? null : findPreset(panel, input.activePreset).id;
  else if (input.filters || input.sorts) patch.activePresetId = null;
  return patch;
}

function changeUnits(patch: Partial<DatabasePanelState>, view?: ViewKind): number {
  return Object.keys(patch).length + (view ? 1 : 0);
}

async function writeView(ctx: McpContext, db: Item, cols: Columns, pageId: string | undefined, plan: (t: ViewTarget) => Promise<ViewWrite>) {
  const write = await resolveWriteTarget(ctx, db, pageId);
  const change = await plan(write.target);
  if (change.view && write.kind === "database") {
    throw new ToolError("This database has no page view; the layout (view) can only be set on a page that shows it (pass pageId)");
  }
  if (changeUnits(change.patch, change.view) === 0) throw new ToolError("Nothing to update");
  const result = await applyViewWrite(ctx, db, write, change);
  return { databaseId: String(db.id), writtenTo: result.writtenTo, ...describeTarget(cols, result.target) };
}

export async function updateDatabaseViewTool(ctx: McpContext, raw: z.input<typeof updateDatabaseViewInput>) {
  const input = updateDatabaseViewInput.parse(raw);
  const db = await loadDatabase(ctx, input.databaseId, "write");
  const cols = await loadColumns(ctx, db);
  return writeView(ctx, db, cols, input.pageId, async (t) => ({
    view: input.view,
    patch: await buildPatch(ctx, cols, t.panel, input, String(db.workspaceId)),
  }));
}

// ── 필터 프리셋 탭 ──

export const saveFilterPresetInputShape = {
  databaseId: idInput,
  pageId: pageIdInput,
  presetId: z.string().trim().min(1).max(200).optional().describe("Existing tab id or name to update; omit to create a tab"),
  name: z.string().trim().min(1).max(100).optional().describe("Tab name (required when creating)"),
  icon: z.string().trim().min(1).max(200).optional().describe("Emoji icon"),
  filters: z.array(filterInput).max(20).optional(),
  sorts: z.array(sortInput).max(5).optional(),
  activate: z.boolean().optional().describe("Make this tab active (default true)"),
};
const saveFilterPresetInput = z.object(saveFilterPresetInputShape);

export async function saveFilterPresetTool(ctx: McpContext, raw: z.input<typeof saveFilterPresetInput>) {
  const input = saveFilterPresetInput.parse(raw);
  const db = await loadDatabase(ctx, input.databaseId, "write");
  const cols = await loadColumns(ctx, db);
  return writeView(ctx, db, cols, input.pageId, async (t) => {
    const presets = t.panel.filterPresets ?? [];
    const existing = input.presetId ? findPreset(t.panel, input.presetId) : null;
    if (!existing && !input.name) throw new ToolError("name is required to create a filter tab");
    const filterRules = input.filters
      ? await toFilterRules(ctx, cols.lite, input.filters, String(db.workspaceId), () => randomUUID())
      : existing?.filterRules ?? [];
    const preset: FilterPreset = {
      id: existing?.id ?? randomUUID(),
      name: input.name ?? (existing as FilterPreset).name,
      ...((input.icon ?? existing?.icon) ? { icon: input.icon ?? existing?.icon } : {}),
      filterRules,
      sortRules: input.sorts ? toSortRules(cols, input.sorts) : existing?.sortRules ?? [],
    };
    const filterPresets = existing ? presets.map((p) => (p.id === existing.id ? preset : p)) : [...presets, preset];
    const activate = input.activate ?? true;
    return { patch: { filterPresets, ...(activate ? { activePresetId: preset.id } : {}) } };
  });
}

export const deleteFilterPresetInputShape = {
  databaseId: idInput,
  pageId: pageIdInput,
  presetId: z.string().trim().min(1).max(200).describe("Tab id or name"),
};
const deleteFilterPresetInput = z.object(deleteFilterPresetInputShape);

export async function deleteFilterPresetTool(ctx: McpContext, raw: z.input<typeof deleteFilterPresetInput>) {
  const input = deleteFilterPresetInput.parse(raw);
  const db = await loadDatabase(ctx, input.databaseId, "write");
  const cols = await loadColumns(ctx, db);
  return writeView(ctx, db, cols, input.pageId, async (t) => {
    const hit = findPreset(t.panel, input.presetId);
    const filterPresets = (t.panel.filterPresets ?? []).filter((p) => p.id !== hit.id);
    return { patch: { filterPresets, ...(t.panel.activePresetId === hit.id ? { activePresetId: null } : {}) } };
  });
}
