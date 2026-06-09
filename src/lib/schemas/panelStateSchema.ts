import { z } from "zod";
import type { DatabasePanelState } from "../../types/database";
import { emptyPanelState } from "../../types/database";

const filterOperatorSchema = z.enum([
  "equals",
  "notEquals",
  "contains",
  "isEmpty",
  "isNotEmpty",
  "gt",
  "lt",
]);

const filterRuleSchema = z.object({
  id: z.string(),
  columnId: z.string(),
  operator: filterOperatorSchema,
  value: z.string().optional(),
});

const sortRuleSchema = z.object({
  columnId: z.string(),
  dir: z.enum(["asc", "desc"]),
});

const viewSpecificSchema = z.object({
  visibleColumnIds: z.array(z.string()).optional(),
  hiddenColumnIds: z.array(z.string()).optional(),
});

const viewKindEnum = z.enum(["table", "kanban", "timeline", "gallery", "list"]);

const filterPresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().optional(),
  filterRules: z.array(filterRuleSchema),
  sortRules: z.array(sortRuleSchema),
});

/** attrs 에 부분 저장 가능 — 알려진 키만 통과·알 수 없는 키는 제거(CWE-1321 완화) */
const databasePanelStatePartialSchema = z
  .object({
    searchQuery: z.string().optional(),
    filterRules: z.array(filterRuleSchema).optional(),
    sortColumnId: z.string().nullable().optional(),
    sortDir: z.enum(["asc", "desc"]).optional(),
    sortRules: z.array(sortRuleSchema).optional(),
    kanbanGroupColumnId: z.string().nullable().optional(),
    groupByColumnId: z.string().nullable().optional(),
    galleryCoverColumnId: z.string().nullable().optional(),
    timelineDateColumnId: z.string().nullable().optional(),
    viewConfigs: z.record(viewKindEnum, viewSpecificSchema).optional(),
    hiddenViewKinds: z.array(viewKindEnum).optional(),
    itemLimit: z.number().int().positive().optional(),
    pageTreeEnabled: z.boolean().optional(),
    galleryColumns: z.number().int().min(1).max(10).optional(),
    filterPresets: z.array(filterPresetSchema).optional(),
    activePresetId: z.string().nullable().optional(),
    schedulerFeatureMilestoneIds: z.array(z.string()).nullable().optional(),
    schedulerMemberOrder: z.array(z.string()).optional(),
    schedulerMemberOrderUpdatedAt: z.number().finite().nonnegative().optional(),
  });

export function parseDatabasePanelStateJson(raw: string): DatabasePanelState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
    // 이중 인코딩 방어: AWSJSON 필드가 이미 stringify 된 값을 다시 stringify 해 저장/전송된 경우
    // (구독 onDatabaseChanged 페이로드에서 흔함) 객체가 나올 때까지 한 겹씩 더 벗긴다(상한 5회).
    // columns/presets 의 parseSerializedArray 와 동일한 방어 — 이게 없어서 구독 수신 시
    // panelState 가 통째로 빈 값으로 붕괴돼 구성원 순서·표시설정 실시간 동기화가 누락됐다.
    for (let depth = 0; depth < 5 && typeof parsed === "string"; depth += 1) {
      parsed = JSON.parse(parsed);
    }
  } catch {
    return emptyPanelState();
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return emptyPanelState();
  }
  const base = emptyPanelState();
  const r = databasePanelStatePartialSchema.safeParse(parsed);
  if (!r.success) return base;
  return { ...base, ...r.data };
}
