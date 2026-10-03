// DB 컬럼 정의 입력 → 클라 ColumnDef. 클라 생성 규칙과 같다:
// 컬럼 id·옵션 id 는 UUID(newId), 옵션 색은 SELECT_COLOR_PRESETS 를 순서대로 순환(ColumnOptionsEditor),
// title 컬럼은 DB 생성 시 자동으로 하나 만든다(seedColumns 의 "이름").
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { SELECT_COLOR_PRESETS } from "../../../src/components/database/selectColorPresets";
import type { ColumnDef, ColumnType, SelectOption } from "../../../src/types/database";
import { ToolError } from "./context";

/** MCP 로 만들고 값을 쓸 수 있는 컬럼 타입(셀 입력 변환 cellInput.ts 와 같은 집합, title 제외). */
export const WRITABLE_COLUMN_TYPES = [
  "text", "number", "select", "multiSelect", "status", "date", "checkbox", "url", "email", "phone", "person", "pageLink",
] as const satisfies readonly ColumnType[];
export const OPTION_COLUMN_TYPES = new Set<string>(["select", "multiSelect", "status"]);
export const DEFAULT_TITLE_COLUMN_NAME = "이름";
const MAX_OPTIONS = 100;

const optionLabel = z.string().trim().min(1).max(100);

export const columnSpecInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    type: z.enum(WRITABLE_COLUMN_TYPES),
    options: z.array(optionLabel).max(MAX_OPTIONS).optional()
      .describe("select/multiSelect/status only: option labels (omitted → app defaults: status 시작전/진행중/완료/보류, select 옵션 1/2)"),
  })
  .strict();
export type ColumnSpec = z.infer<typeof columnSpecInput>;

export function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** 기존 옵션 뒤에 이어 붙일 새 옵션(라벨 중복 거부). 색은 구분선 제외 개수 기준으로 순환. */
export function buildOptions(labels: string[], existing: SelectOption[] = []): SelectOption[] {
  const taken = existing.filter((o) => !o.divider).map((o) => o.label);
  const out: SelectOption[] = [];
  for (const label of labels) {
    if ([...taken, ...out.map((o) => o.label)].some((t) => sameName(t, label))) {
      throw new ToolError(`Option "${label}" already exists`);
    }
    const n = taken.length + out.length;
    out.push({ id: randomUUID(), label, color: SELECT_COLOR_PRESETS[n % SELECT_COLOR_PRESETS.length] });
  }
  if (taken.length + out.length > MAX_OPTIONS) throw new ToolError(`At most ${MAX_OPTIONS} options per column`);
  return out;
}

// 옵션을 주지 않았을 때 앱 defaultColumnForType(src/store/databaseStore.ts) 과 같은 기본 옵션.
const DEFAULT_STATUS_OPTIONS = [
  { label: "시작전", color: "#94a3b8" },
  { label: "진행중", color: "#3b82f6" },
  { label: "완료", color: "#10b981" },
  { label: "보류", color: "#f59e0b" },
];
const DEFAULT_SELECT_LABELS = ["옵션 1", "옵션 2"];

function defaultOptions(type: string): SelectOption[] {
  if (type === "status") return DEFAULT_STATUS_OPTIONS.map((o) => ({ id: randomUUID(), ...o }));
  return DEFAULT_SELECT_LABELS.map((label) => ({ id: randomUUID(), label }));
}

export function buildColumn(spec: ColumnSpec): ColumnDef {
  if (spec.options && !OPTION_COLUMN_TYPES.has(spec.type)) {
    throw new ToolError(`Column "${spec.name}": options are only allowed for select, multiSelect and status`);
  }
  const column: ColumnDef = { id: randomUUID(), name: spec.name, type: spec.type };
  if (OPTION_COLUMN_TYPES.has(spec.type)) {
    column.config = { options: spec.options ? buildOptions(spec.options) : defaultOptions(spec.type) };
  }
  if (spec.type === "date") column.config = { dateShowEnd: true };
  return column;
}

export function titleColumn(name = DEFAULT_TITLE_COLUMN_NAME): ColumnDef {
  return { id: randomUUID(), name, type: "title" };
}

/** 이름 중복 검사(대소문자 무시) — 이름으로 속성을 지정하는 MCP 입력이 모호해지지 않게 한다. */
export function assertUniqueColumnNames(columns: Pick<ColumnDef, "name">[]): void {
  const seen: string[] = [];
  for (const c of columns) {
    if (seen.some((s) => sameName(s, c.name))) throw new ToolError(`Column name "${c.name}" is used more than once`);
    seen.push(c.name);
  }
}
