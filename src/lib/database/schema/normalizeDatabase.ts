import type {
  CellValue,
  ColumnDef,
  ColumnType,
  DatabaseBundle,
  DatabasePanelState,
  DatabaseRowPreset,
  DatabaseTemplate,
  ProgressSourceConfig,
  SearchFilterRule,
  SelectOption,
  TimelineDateCardConfig,
} from "../../../types/database";
import { parseDatabasePanelStateJson } from "../../schemas/panelStateSchema";

type ColumnConfig = NonNullable<ColumnDef["config"]>;
type MutableColumnConfig = ColumnConfig & Record<string, unknown>;

const PAGE_LINK_CONFIG_KEYS = [
  "pageLinkScopeDatabaseId",
  "pageLinkMirrorColumnId",
  "pageLinkAutoReverse",
  "pageLinkReverseColumnName",
  "pageLinkAutoFill",
] as const;

const ITEM_FETCH_CONFIG_KEYS = [
  "itemFetchSourceDatabaseId",
  "itemFetchMatchColumnId",
] as const;

export const DATABASE_COLUMN_TYPES = new Set<ColumnType>([
  "title",
  "text",
  "json",
  "number",
  "select",
  "multiSelect",
  "status",
  "date",
  "person",
  "file",
  "checkbox",
  "url",
  "phone",
  "email",
  "dbLink",
  "pageLink",
  "progress",
  "itemFetch",
]);

const SEARCH_FILTER_KINDS = new Set<SearchFilterRule["kind"]>([
  "database",
  "milestone",
  "feature",
  "organization",
  "team",
  "project",
]);

const PRESET_SCOPES = new Set<DatabaseRowPreset["scope"]>([
  "workspace",
  "organization",
  "team",
  "project",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneJsonCompatible(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    return value
      .map(cloneJsonCompatible)
      .filter((item): item is NonNullable<unknown> => item !== undefined);
  }
  if (!isPlainObject(value)) return undefined;

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const cloned = cloneJsonCompatible(item);
    if (cloned !== undefined) result[key] = cloned;
  }
  return result;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeSelectOption(value: unknown): SelectOption | null {
  if (!isPlainObject(value) || typeof value.id !== "string" || typeof value.label !== "string") {
    return null;
  }
  return {
    id: value.id,
    label: value.label,
    ...(typeof value.color === "string" ? { color: value.color } : {}),
    ...(typeof value.divider === "boolean" ? { divider: value.divider } : {}),
  };
}

function normalizeSelectOptions(value: unknown): SelectOption[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map(normalizeSelectOption).filter((option): option is SelectOption => option != null);
}

function normalizeSearchFilter(value: unknown): SearchFilterRule | null {
  if (
    !isPlainObject(value) ||
    typeof value.id !== "string" ||
    typeof value.kind !== "string" ||
    !SEARCH_FILTER_KINDS.has(value.kind as SearchFilterRule["kind"])
  ) {
    return null;
  }
  return {
    id: value.id,
    kind: value.kind as SearchFilterRule["kind"],
    ...(typeof value.value === "string" ? { value: value.value } : {}),
  };
}

function normalizeSearchFilters(value: unknown): SearchFilterRule[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .map(normalizeSearchFilter)
    .filter((filter): filter is SearchFilterRule => filter != null);
}

function normalizeProgressSource(value: unknown): ProgressSourceConfig | undefined {
  if (
    !isPlainObject(value) ||
    typeof value.databaseId !== "string" ||
    typeof value.columnId !== "string"
  ) {
    return undefined;
  }

  const source: ProgressSourceConfig = {
    databaseId: value.databaseId,
    columnId: value.columnId,
    ...(typeof value.completedValue === "string" ? { completedValue: value.completedValue } : {}),
  };

  if (isPlainObject(value.scope)) {
    if (value.scope.mode === "allRows") {
      source.scope = { mode: "allRows" };
    } else if (
      value.scope.mode === "linkedPagesFromColumn" &&
      typeof value.scope.pageLinkColumnId === "string"
    ) {
      source.scope = {
        mode: "linkedPagesFromColumn",
        pageLinkColumnId: value.scope.pageLinkColumnId,
      };
    }
  }

  return source;
}

function normalizeColumnConfig(value: unknown): ColumnConfig | undefined {
  if (!isPlainObject(value)) return undefined;

  const cloned = cloneJsonCompatible(value);
  const config: MutableColumnConfig = isPlainObject(cloned)
    ? ({ ...cloned } as MutableColumnConfig)
    : {};

  delete config.options;
  const options = normalizeSelectOptions(value.options);
  if (options) config.options = options;

  delete config.dateShowEnd;
  if (typeof value.dateShowEnd === "boolean") config.dateShowEnd = value.dateShowEnd;

  delete config.timelineCard;
  if (isPlainObject(value.timelineCard)) {
    const timelineCard: TimelineDateCardConfig = {};
    if (typeof value.timelineCard.enabled === "boolean") {
      timelineCard.enabled = value.timelineCard.enabled;
    }
    if (
      value.timelineCard.titleMode === "pageTitle" ||
      value.timelineCard.titleMode === "custom"
    ) {
      timelineCard.titleMode = value.timelineCard.titleMode;
    }
    if (typeof value.timelineCard.title === "string") {
      timelineCard.title = value.timelineCard.title;
    }
    if (
      typeof value.timelineCard.color === "string" &&
      /^#[0-9a-fA-F]{6}$/.test(value.timelineCard.color)
    ) {
      timelineCard.color = value.timelineCard.color;
    }
    if (Object.keys(timelineCard).length > 0) {
      config.timelineCard = timelineCard;
    }
  }

  delete config.wrapText;
  if (typeof value.wrapText === "boolean") config.wrapText = value.wrapText;

  delete config.textAlign;
  if (value.textAlign === "left" || value.textAlign === "center" || value.textAlign === "right") {
    config.textAlign = value.textAlign;
  }

  delete config.sourceFromDb;
  if (
    isPlainObject(value.sourceFromDb) &&
    typeof value.sourceFromDb.databaseId === "string" &&
    typeof value.sourceFromDb.columnId === "string"
  ) {
    config.sourceFromDb = {
      databaseId: value.sourceFromDb.databaseId,
      columnId: value.sourceFromDb.columnId,
      ...(typeof value.sourceFromDb.automation === "boolean"
        ? { automation: value.sourceFromDb.automation }
        : {}),
      ...(typeof value.sourceFromDb.viaPageLinkColumnId === "string"
        ? { viaPageLinkColumnId: value.sourceFromDb.viaPageLinkColumnId }
        : {}),
    };
  }

  delete config.progressSource;
  const progressSource = normalizeProgressSource(value.progressSource);
  if (progressSource) config.progressSource = progressSource;

  for (const key of [
    "pageLinkScopeDatabaseId",
    "pageLinkMirrorColumnId",
    "pageLinkReverseColumnName",
    "itemFetchSourceDatabaseId",
    "itemFetchMatchColumnId",
  ] as const) {
    delete config[key];
    if (typeof value[key] === "string") config[key] = value[key];
  }

  delete config.pageLinkAutoReverse;
  if (typeof value.pageLinkAutoReverse === "boolean") {
    config.pageLinkAutoReverse = value.pageLinkAutoReverse;
  }

  delete config.searchFilters;
  const searchFilters = normalizeSearchFilters(value.searchFilters);
  if (searchFilters) config.searchFilters = searchFilters;

  delete config.pageLinkAutoFill;
  if (Array.isArray(value.pageLinkAutoFill)) {
    const autoFill = value.pageLinkAutoFill.filter(
      (item): item is { targetColumnId: string; sourceColumnId: string } =>
        isPlainObject(item) &&
        typeof item.targetColumnId === "string" &&
        typeof item.sourceColumnId === "string",
    );
    config.pageLinkAutoFill = autoFill;
  }

  delete config.linkedScope;
  if (
    value.linkedScope === "organization" ||
    value.linkedScope === "team" ||
    value.linkedScope === "project"
  ) {
    config.linkedScope = value.linkedScope;
  }

  return Object.keys(config).length > 0 ? config : undefined;
}

function normalizeColumnConfigForType(
  config: ColumnConfig | undefined,
  type: ColumnType,
): ColumnConfig | undefined {
  if (!config) return undefined;
  const next: MutableColumnConfig = { ...config };

  if (type !== "pageLink") {
    for (const key of PAGE_LINK_CONFIG_KEYS) delete next[key];
  }
  if (type !== "itemFetch") {
    for (const key of ITEM_FETCH_CONFIG_KEYS) delete next[key];
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

export function normalizeColumnDef(value: unknown): ColumnDef | null {
  if (
    !isPlainObject(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.type !== "string" ||
    !DATABASE_COLUMN_TYPES.has(value.type as ColumnType)
  ) {
    return null;
  }

  const column: ColumnDef = {
    id: value.id,
    name: value.name,
    type: value.type as ColumnType,
  };
  if (typeof value.icon === "string") column.icon = value.icon;
  if (typeof value.width === "number" && Number.isFinite(value.width)) {
    column.width = value.width;
  }
  const config = normalizeColumnConfigForType(
    normalizeColumnConfig(value.config),
    column.type,
  );
  if (config) column.config = config;
  return column;
}

function normalizeColumns(value: unknown): ColumnDef[] | null {
  if (!Array.isArray(value)) return null;
  const columns = value.map(normalizeColumnDef);
  if (columns.some((column) => column == null)) return null;
  return columns as ColumnDef[];
}

function normalizeColumnDefaults(value: unknown): Record<string, CellValue> {
  if (!isPlainObject(value)) return {};

  const defaults: Record<string, CellValue> = {};
  for (const [columnId, cellValue] of Object.entries(value)) {
    const cloned = cloneJsonCompatible(cellValue);
    if (cloned !== undefined) defaults[columnId] = cloned as CellValue;
  }
  return defaults;
}

function normalizeSchedulerDefaults(
  value: unknown,
): DatabaseRowPreset["schedulerDefaults"] | undefined {
  if (!isPlainObject(value)) return undefined;

  const defaults: NonNullable<DatabaseRowPreset["schedulerDefaults"]> = {};
  if (typeof value.durationDays === "number" && Number.isFinite(value.durationDays)) {
    defaults.durationDays = value.durationDays;
  }
  if (typeof value.color === "string") defaults.color = value.color;
  if (typeof value.titlePrefix === "string") defaults.titlePrefix = value.titlePrefix;
  if (Array.isArray(value.assigneeIds)) {
    defaults.assigneeIds = normalizeStringArray(value.assigneeIds);
  }

  return Object.keys(defaults).length > 0 ? defaults : undefined;
}

export function normalizeDatabaseRowPreset(
  value: unknown,
  now = Date.now(),
): DatabaseRowPreset | null {
  if (
    !isPlainObject(value) ||
    typeof value.id !== "string" ||
    typeof value.databaseId !== "string" ||
    typeof value.name !== "string"
  ) {
    return null;
  }

  const scope = typeof value.scope === "string" ? value.scope : "workspace";
  if (!PRESET_SCOPES.has(scope as DatabaseRowPreset["scope"])) return null;

  const createdAt = Number(value.createdAt);
  const updatedAt = Number(value.updatedAt);
  const schedulerDefaults = normalizeSchedulerDefaults(value.schedulerDefaults);

  return {
    id: value.id,
    databaseId: value.databaseId,
    name: value.name,
    ...(typeof value.description === "string" ? { description: value.description } : {}),
    scope: scope as DatabaseRowPreset["scope"],
    ...(typeof value.scopeId === "string" ? { scopeId: value.scopeId } : {}),
    columnDefaults: normalizeColumnDefaults(value.columnDefaults),
    requiredColumnIds: normalizeStringArray(value.requiredColumnIds),
    visibleColumnIds: normalizeStringArray(value.visibleColumnIds),
    hiddenColumnIds: normalizeStringArray(value.hiddenColumnIds),
    ...(schedulerDefaults ? { schedulerDefaults } : {}),
    createdAt: Number.isFinite(createdAt) ? createdAt : now,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : now,
  };
}

function normalizePresets(value: unknown, now = Date.now()): DatabaseRowPreset[] | null {
  if (!Array.isArray(value)) return null;
  const presets = value.map((preset) => normalizeDatabaseRowPreset(preset, now));
  if (presets.some((preset) => preset == null)) return null;
  return presets as DatabaseRowPreset[];
}

export function normalizeDatabaseBundle(value: unknown, now = Date.now()): DatabaseBundle | null {
  if (!isPlainObject(value) || !isPlainObject(value.meta)) return null;

  const createdAt = Number(value.meta.createdAt);
  const updatedAt = Number(value.meta.updatedAt);
  if (
    typeof value.meta.id !== "string" ||
    typeof value.meta.title !== "string" ||
    !Number.isFinite(createdAt) ||
    !Number.isFinite(updatedAt) ||
    !Array.isArray(value.rowPageOrder)
  ) {
    return null;
  }

  const columns = normalizeColumns(value.columns);
  if (!columns) return null;

  const presets = normalizePresets(Array.isArray(value.presets) ? value.presets : [], now);
  if (!presets) return null;

  return {
    meta: {
      id: value.meta.id,
      ...(typeof value.meta.workspaceId === "string" ? { workspaceId: value.meta.workspaceId } : {}),
      title: value.meta.title,
      createdAt,
      updatedAt,
    },
    columns,
    presets,
    ...(value.panelState == null
      ? {}
      : { panelState: parseDatabasePanelStateJson(JSON.stringify(value.panelState)) }),
    rowPageOrder: normalizeStringArray(value.rowPageOrder),
  };
}

export function serializeColumns(columns: ColumnDef[]): string {
  const normalized = normalizeColumns(columns);
  if (!normalized) throw new Error("Invalid database columns");
  return JSON.stringify(normalized);
}

export function serializePresets(presets: DatabaseRowPreset[] | undefined): string {
  const normalized = normalizePresets(presets ?? []);
  if (!normalized) throw new Error("Invalid database presets");
  return JSON.stringify(normalized);
}

export function serializePanelState(panelState: DatabasePanelState | undefined): string {
  return JSON.stringify(
    parseDatabasePanelStateJson(JSON.stringify(panelState ?? {})),
  );
}

/** DB 템플릿 배열 직렬화 — AWSJSON 필드용. */
export function serializeTemplates(templates: DatabaseTemplate[] | undefined): string {
  return JSON.stringify(Array.isArray(templates) ? templates : []);
}

/** 원격 templates(AWSJSON) → DatabaseTemplate[] 파싱. 실패 시 null. */
export function tryParseSerializedTemplates(value: unknown): DatabaseTemplate[] | null {
  if (value == null) return null;
  const arr = parseSerializedArray(value);
  if (!arr) return null;
  const out: DatabaseTemplate[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const t = raw as Record<string, unknown>;
    if (typeof t.id !== "string" || typeof t.title !== "string") continue;
    out.push(t as unknown as DatabaseTemplate);
  }
  return out;
}

function parseSerializedArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  try {
    let parsed = JSON.parse(value) as unknown;
    // 레거시/이중 인코딩 방어: AWSJSON 필드에 이미 stringify 된 값이 다시 stringify 되어
    // 저장된 경우(JSON 문자열을 또 감싼 형태) 한 번 더 파싱해 배열을 복구한다.
    // (이중 인코딩된 columns/presets 가 통째로 폐기돼 DB 가 사라지는 회귀 방지)
    if (typeof parsed === "string") {
      parsed = JSON.parse(parsed) as unknown;
    }
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function tryParseSerializedColumns(value: unknown): ColumnDef[] | null {
  return normalizeColumns(parseSerializedArray(value));
}

export function tryParseSerializedPresets(value: unknown): DatabaseRowPreset[] | null {
  if (value == null) return [];
  return normalizePresets(parseSerializedArray(value));
}

export function tryParseSerializedPanelState(value: unknown): DatabasePanelState | null {
  if (value == null) return null;
  if (typeof value === "string") return parseDatabasePanelStateJson(value);
  if (typeof value === "object" && !Array.isArray(value)) {
    return parseDatabasePanelStateJson(JSON.stringify(value));
  }
  return null;
}

export function parseSerializedColumns(value: unknown): ColumnDef[] {
  return tryParseSerializedColumns(value) ?? [];
}

export function parseSerializedPresets(value: unknown): DatabaseRowPreset[] {
  return tryParseSerializedPresets(value) ?? [];
}
