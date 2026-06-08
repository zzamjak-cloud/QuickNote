import { createHash } from "node:crypto";

export type TemplateAutomationWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type TemplateAutomationConfig = {
  id: string;
  enabled: boolean;
  weekdays: TemplateAutomationWeekday[];
  time: string;
  timezone: string;
  titlePrefix?: string;
  dateColumnId?: string | null;
  maxAttempts?: number;
  endDate?: string | null;
  updatedAt?: number;
};

export type DatabaseTemplateSnapshot = {
  id: string;
  title: string;
  cells: Record<string, unknown>;
  pageId?: string;
  automation?: TemplateAutomationConfig;
};

export type DatabaseColumnSnapshot = {
  id: string;
  name: string;
  type: string;
};

export type DatabasePanelStateSnapshot = {
  timelineDateColumnId?: string | null;
};

export type TemplateAutomationTarget = {
  automation: TemplateAutomationConfig;
  template: DatabaseTemplateSnapshot;
};

export type GeneratedTemplatePage = {
  id: string;
  workspaceId: string;
  databaseId: string;
  title: string;
  doc: string;
  order: string;
  createdAt: string;
  updatedAt: string;
  createdByMemberId: string;
  dbCells: Record<string, unknown>;
  icon?: string;
  coverImage?: string;
};

export const TEMPLATE_AUTOMATION_DEFAULT_ATTEMPTS = 3;
export const TEMPLATE_AUTOMATION_MAX_ATTEMPTS = 5;
export const TEMPLATE_AUTOMATION_MAX_EVENT_AGE_SECONDS = 3600;

const TEMPLATE_MARKER_CELL_ID = "_qn_isTemplate";
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EVENTBRIDGE_WEEKDAY_NAMES: Record<TemplateAutomationWeekday, string> = {
  0: "SUN",
  1: "MON",
  2: "TUE",
  3: "WED",
  4: "THU",
  5: "FRI",
  6: "SAT",
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isWeekday(value: unknown): value is TemplateAutomationWeekday {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 6;
}

function parseJsonLike(raw: unknown): unknown {
  let parsed = raw;
  for (let depth = 0; depth < 2 && typeof parsed === "string"; depth += 1) {
    if (!parsed) return undefined;
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return undefined;
    }
  }
  return parsed;
}

function normalizeWeekdays(raw: unknown): TemplateAutomationWeekday[] {
  if (!Array.isArray(raw)) return [];
  const weekdays: TemplateAutomationWeekday[] = [];
  for (const value of raw) {
    const parsed = typeof value === "string" && value.trim() ? Number(value) : value;
    if (!isWeekday(parsed)) continue;
    if (!weekdays.includes(parsed)) weekdays.push(parsed);
  }
  return weekdays.sort((a, b) => a - b);
}

function normalizeAttempts(raw: unknown): number {
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) return TEMPLATE_AUTOMATION_DEFAULT_ATTEMPTS;
  return Math.max(1, Math.min(TEMPLATE_AUTOMATION_MAX_ATTEMPTS, Math.floor(value)));
}

export function normalizeTemplateAutomationConfig(
  raw: unknown,
  fallbackId: string,
): TemplateAutomationConfig | undefined {
  if (!isPlainObject(raw)) return undefined;
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : fallbackId;
  const weekdays = normalizeWeekdays(raw.weekdays);
  const time = typeof raw.time === "string" && TIME_PATTERN.test(raw.time) ? raw.time : "";
  if (!id || weekdays.length === 0 || !time) return undefined;
  const timezone = typeof raw.timezone === "string" && raw.timezone.trim()
    ? raw.timezone.trim()
    : "Asia/Seoul";
  const titlePrefix = typeof raw.titlePrefix === "string" && raw.titlePrefix.trim()
    ? raw.titlePrefix.trim()
    : undefined;
  const dateColumnId = typeof raw.dateColumnId === "string" && raw.dateColumnId.trim()
    ? raw.dateColumnId.trim()
    : raw.dateColumnId === null
      ? null
      : undefined;
  const endDate = typeof raw.endDate === "string" && DATE_PATTERN.test(raw.endDate)
    ? raw.endDate
    : raw.endDate === null
      ? null
      : undefined;
  const updatedAt = typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt)
    ? raw.updatedAt
    : undefined;
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
    ...(updatedAt !== undefined ? { updatedAt } : {}),
  };
}

export function parseTemplateSnapshots(raw: unknown): DatabaseTemplateSnapshot[] {
  const parsed = parseJsonLike(raw);
  if (!Array.isArray(parsed)) return [];
  const templates: DatabaseTemplateSnapshot[] = [];
  for (const item of parsed) {
    if (!isPlainObject(item)) continue;
    if (typeof item.id !== "string" || typeof item.title !== "string") continue;
    const cells = isPlainObject(item.cells) ? item.cells : {};
    const automation = normalizeTemplateAutomationConfig(item.automation, `${item.id}:weekly`);
    templates.push({
      id: item.id,
      title: item.title,
      cells,
      ...(typeof item.pageId === "string" ? { pageId: item.pageId } : {}),
      ...(automation ? { automation } : {}),
    });
  }
  return templates;
}

export function parseColumnSnapshots(raw: unknown): DatabaseColumnSnapshot[] {
  const parsed = parseJsonLike(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(isPlainObject)
    .filter((item) => typeof item.id === "string" && typeof item.type === "string")
    .map((item) => ({
      id: item.id as string,
      name: typeof item.name === "string" ? item.name : item.id as string,
      type: item.type as string,
    }));
}

export function parsePanelStateSnapshot(raw: unknown): DatabasePanelStateSnapshot | undefined {
  const parsed = parseJsonLike(raw);
  if (!isPlainObject(parsed)) return undefined;
  return {
    timelineDateColumnId:
      typeof parsed.timelineDateColumnId === "string" ? parsed.timelineDateColumnId : null,
  };
}

export function collectTemplateAutomationTargets(
  database: Record<string, unknown> | undefined | null,
): TemplateAutomationTarget[] {
  const templates = parseTemplateSnapshots(database?.templates);
  return templates
    .filter((template) => template.automation)
    .map((template) => ({ template, automation: template.automation! }));
}

export function buildTemplateAutomationScheduleExpression(
  automation: Pick<TemplateAutomationConfig, "time" | "weekdays">,
): string {
  const match = TIME_PATTERN.exec(automation.time);
  if (!match) throw new Error("Invalid automation time");
  const weekdays = automation.weekdays
    .filter((weekday): weekday is TemplateAutomationWeekday => isWeekday(weekday))
    .sort((a, b) => a - b)
    .map((weekday) => EVENTBRIDGE_WEEKDAY_NAMES[weekday]);
  if (weekdays.length === 0) throw new Error("Automation weekday is required");
  return `cron(${Number(match[2])} ${Number(match[1])} ? * ${weekdays.join(",")} *)`;
}

export function buildTemplateAutomationScheduleName(args: {
  databaseId: string;
  templateId: string;
  automationId: string;
}): string {
  const hash = createHash("sha256")
    .update(`${args.databaseId}|${args.templateId}|${args.automationId}`)
    .digest("hex")
    .slice(0, 48);
  return `qn-ta-${hash}`;
}

export function buildTemplateAutomationRunId(args: {
  automationId: string;
  scheduledTime: string;
}): string {
  return createHash("sha256")
    .update(`${args.automationId}|${args.scheduledTime}`)
    .digest("hex");
}

export function buildTemplateAutomationPageId(args: {
  automationId: string;
  scheduledTime: string;
}): string {
  return `ta_${buildTemplateAutomationRunId(args).slice(0, 40)}`;
}

export function resolveTemplateAutomationDateColumnId(
  columns: DatabaseColumnSnapshot[],
  panelState: DatabasePanelStateSnapshot | undefined,
  automation: Pick<TemplateAutomationConfig, "dateColumnId">,
): string | null {
  const dateColumns = columns.filter((column) => column.type === "date");
  if (dateColumns.length === 0) return null;
  if (automation.dateColumnId && dateColumns.some((column) => column.id === automation.dateColumnId)) {
    return automation.dateColumnId;
  }
  const timelineDateColumnId = panelState?.timelineDateColumnId;
  if (timelineDateColumnId && dateColumns.some((column) => column.id === timelineDateColumnId)) {
    return timelineDateColumnId;
  }
  return dateColumns[0]?.id ?? null;
}

function formatDatePartsInTimeZone(value: string, timezone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid scheduled time");
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

export function buildGeneratedTemplatePage(args: {
  database: Record<string, unknown>;
  template: DatabaseTemplateSnapshot;
  templatePage?: Record<string, unknown> | null;
  scheduledTime: string;
  pageId: string;
  nowIso: string;
}): GeneratedTemplatePage {
  const automation = args.template.automation;
  if (!automation) throw new Error("Template automation is missing");
  const columns = parseColumnSnapshots(args.database.columns);
  const panelState = parsePanelStateSnapshot(args.database.panelState);
  const sourceCells = isPlainObject(args.templatePage?.dbCells)
    ? args.templatePage.dbCells
    : args.template.cells;
  const dbCells: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(sourceCells ?? {})) {
    if (key !== TEMPLATE_MARKER_CELL_ID) dbCells[key] = value;
  }
  const dateParts = formatDatePartsInTimeZone(args.scheduledTime, automation.timezone);
  const dateColumnId = resolveTemplateAutomationDateColumnId(columns, panelState, automation);
  if (dateColumnId) {
    dbCells[dateColumnId] = { start: dateParts.ymd };
  }
  const templateTitle =
    typeof args.templatePage?.title === "string" && args.templatePage.title.trim()
      ? args.templatePage.title
      : args.template.title;
  const titlePrefix = automation.titlePrefix?.trim() || templateTitle.trim() || "Untitled";
  const createdByMemberId =
    typeof args.database.createdByMemberId === "string" && args.database.createdByMemberId
      ? args.database.createdByMemberId
      : "system";
  const page: GeneratedTemplatePage = {
    id: args.pageId,
    workspaceId: String(args.database.workspaceId ?? ""),
    databaseId: String(args.database.id ?? ""),
    title: `${titlePrefix} ${dateParts.short}`,
    doc: typeof args.templatePage?.doc === "string" ? args.templatePage.doc : "{}",
    order: String(Date.parse(args.nowIso)),
    createdAt: args.nowIso,
    updatedAt: args.nowIso,
    createdByMemberId,
    dbCells,
  };
  if (typeof args.templatePage?.icon === "string") page.icon = args.templatePage.icon;
  if (typeof args.templatePage?.coverImage === "string") page.coverImage = args.templatePage.coverImage;
  return page;
}
