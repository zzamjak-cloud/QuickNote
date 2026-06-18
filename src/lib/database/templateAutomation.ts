import type {
  CellValue,
  ColumnDef,
  DatabasePanelState,
  DatabaseTemplate,
  DatabaseTemplateAutomationConfig,
  TemplateAutomationWeekday,
} from "../../types/database";

export const TEMPLATE_AUTOMATION_MIN_ATTEMPTS = 1;
export const TEMPLATE_AUTOMATION_DEFAULT_ATTEMPTS = 3;
export const TEMPLATE_AUTOMATION_MAX_ATTEMPTS = 5;
export const TEMPLATE_AUTOMATION_DEFAULT_TIMEZONE = "Asia/Seoul";

export const TEMPLATE_AUTOMATION_WEEKDAY_LABELS: Record<TemplateAutomationWeekday, string> = {
  0: "일",
  1: "월",
  2: "화",
  3: "수",
  4: "목",
  5: "금",
  6: "토",
};

const EVENTBRIDGE_WEEKDAY_NAMES: Record<TemplateAutomationWeekday, string> = {
  0: "SUN",
  1: "MON",
  2: "TUE",
  3: "WED",
  4: "THU",
  5: "FRI",
  6: "SAT",
};

const TEMPLATE_MARKER_CELL_ID = "_qn_isTemplate";
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isWeekday(value: unknown): value is TemplateAutomationWeekday {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 6;
}

function normalizeWeekdays(raw: unknown): TemplateAutomationWeekday[] {
  if (!Array.isArray(raw)) return [];
  const deduped: TemplateAutomationWeekday[] = [];
  for (const value of raw) {
    const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
    if (!isWeekday(parsed)) continue;
    if (!deduped.includes(parsed)) deduped.push(parsed);
  }
  return deduped.sort((a, b) => a - b);
}

function normalizeAttempts(value: unknown): number {
  const raw = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(raw)) return TEMPLATE_AUTOMATION_DEFAULT_ATTEMPTS;
  return Math.max(
    TEMPLATE_AUTOMATION_MIN_ATTEMPTS,
    Math.min(TEMPLATE_AUTOMATION_MAX_ATTEMPTS, Math.floor(raw)),
  );
}

export function normalizeTemplateAutomationConfig(
  raw: unknown,
  fallbackId: string,
): DatabaseTemplateAutomationConfig | undefined {
  if (!isPlainObject(raw)) return undefined;
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : fallbackId;
  const weekdays = normalizeWeekdays(raw.weekdays);
  const time = typeof raw.time === "string" && TIME_PATTERN.test(raw.time) ? raw.time : "";
  if (!id || weekdays.length === 0 || !time) return undefined;

  const timezone =
    typeof raw.timezone === "string" && raw.timezone.trim()
      ? raw.timezone.trim()
      : TEMPLATE_AUTOMATION_DEFAULT_TIMEZONE;
  const titlePrefix = typeof raw.titlePrefix === "string" ? raw.titlePrefix.trim() : undefined;
  const dateColumnId =
    typeof raw.dateColumnId === "string" && raw.dateColumnId.trim()
      ? raw.dateColumnId.trim()
      : raw.dateColumnId === null
        ? null
        : undefined;
  const endDate =
    typeof raw.endDate === "string" && DATE_PATTERN.test(raw.endDate)
      ? raw.endDate
      : raw.endDate === null
        ? null
        : undefined;
  const updatedAt = typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) ? raw.updatedAt : undefined;

  return {
    id,
    enabled: raw.enabled !== false,
    weekdays,
    time,
    timezone,
    ...(titlePrefix ? { titlePrefix } : {}),
    ...(dateColumnId !== undefined ? { dateColumnId } : {}),
    maxAttempts: normalizeAttempts(raw.maxAttempts),
    ...(endDate !== undefined ? { endDate } : {}),
    updatedAt,
  };
}

export function buildTemplateAutomationScheduleExpression(
  automation: Pick<DatabaseTemplateAutomationConfig, "time" | "weekdays">,
): string {
  const match = TIME_PATTERN.exec(automation.time);
  if (!match) throw new Error("Invalid template automation time");
  const [, hour, minute] = match;
  const weekdays = automation.weekdays
    .filter((weekday): weekday is TemplateAutomationWeekday => isWeekday(weekday))
    .sort((a, b) => a - b)
    .map((weekday) => EVENTBRIDGE_WEEKDAY_NAMES[weekday]);
  if (weekdays.length === 0) throw new Error("Template automation requires at least one weekday");
  return `cron(${Number(minute)} ${Number(hour)} ? * ${weekdays.join(",")} *)`;
}

export function resolveTemplateAutomationDateColumnId(
  columns: ColumnDef[],
  panelState?: Pick<DatabasePanelState, "timelineDateColumnId">,
  automation?: Pick<DatabaseTemplateAutomationConfig, "dateColumnId">,
): string | null {
  const dateColumns = columns.filter((column) => column.type === "date");
  if (dateColumns.length === 0) return null;
  if (automation?.dateColumnId && dateColumns.some((column) => column.id === automation.dateColumnId)) {
    return automation.dateColumnId;
  }
  const timelineDateColumnId = panelState?.timelineDateColumnId;
  if (timelineDateColumnId && dateColumns.some((column) => column.id === timelineDateColumnId)) {
    return timelineDateColumnId;
  }
  return dateColumns[0]?.id ?? null;
}

function formatDatePartsInTimeZone(value: Date | string, timezone: string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid scheduledAt");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return {
    ymd: `${year}-${month}-${day}`,
    short: `${year.slice(-2)}/${month}/${day}`,
  };
}

export function buildTemplateAutomationGeneratedRow({
  template,
  columns,
  panelState,
  automation,
  scheduledAt,
}: {
  template: Pick<DatabaseTemplate, "title" | "cells">;
  columns: ColumnDef[];
  panelState?: Pick<DatabasePanelState, "timelineDateColumnId">;
  automation: Pick<DatabaseTemplateAutomationConfig, "dateColumnId" | "timezone" | "titlePrefix">;
  scheduledAt: Date | string;
}): { title: string; cells: Record<string, CellValue>; dateColumnId: string | null } {
  const dateParts = formatDatePartsInTimeZone(scheduledAt, automation.timezone);
  const cells: Record<string, CellValue> = {};
  for (const [columnId, value] of Object.entries(template.cells ?? {})) {
    if (columnId === TEMPLATE_MARKER_CELL_ID) continue;
    cells[columnId] = value as CellValue;
  }

  const dateColumnId = resolveTemplateAutomationDateColumnId(columns, panelState, automation);
  if (dateColumnId) {
    cells[dateColumnId] = { start: dateParts.ymd };
  }

  const prefix = automation.titlePrefix?.trim() || (template.title ?? "").trim() || "Untitled";
  return {
    title: `${prefix} ${dateParts.short}`,
    cells,
    dateColumnId,
  };
}
