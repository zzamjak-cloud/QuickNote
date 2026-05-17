import { parseSchedulerTaskMeta } from "../taskMeta";
import { LC_SCHEDULER_COLUMN_IDS } from "../database";
import { parseScheduleInstanceId } from "../taskAdapter";
import { usePageStore } from "../../../store/pageStore";
import type { Schedule } from "../../../store/schedulerStore";
import type { SchedulerHoliday } from "../../../store/schedulerHolidaysStore";
import type { MmBucket, MmScopeKind } from "./mmTypes";
import { MM_RATIO_TOTAL_BP, MM_WORKDAY_RATIO_BP } from "./mmTypes";
import { eachWorkdayInWeek, getWeekEndKey, toDateKey } from "./weekUtils";

export type MmScheduleSource = {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  assigneeId?: string | null;
  kind?: "schedule" | "leave";
  projectId?: string | null;
  teamId?: string | null;
  organizationId?: string | null;
};

export type MmLabelMaps = {
  projects?: Record<string, string>;
  teams?: Record<string, string>;
  organizations?: Record<string, string>;
};

export type WeeklyMmSuggestion = {
  weekStart: string;
  weekEnd: string;
  buckets: MmBucket[];
  sourceSnapshot: {
    generatedAt: string;
    scheduleIds: string[];
    holidayDates: string[];
  };
};

function dayRange(date: Date): { start: number; end: number } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start: start.getTime(), end: end.getTime() };
}

function overlapsDay(schedule: MmScheduleSource, date: Date): boolean {
  const start = Date.parse(schedule.startAt);
  const end = Date.parse(schedule.endAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  const range = dayRange(date);
  return start <= range.end && end >= range.start;
}

function bucketInfo(
  schedule: MmScheduleSource,
  labels: MmLabelMaps,
): { id: string; kind: MmScopeKind; scopeId: string; label: string } | null {
  if (schedule.projectId) {
    return {
      id: `project:${schedule.projectId}`,
      kind: "project",
      scopeId: schedule.projectId,
      label: labels.projects?.[schedule.projectId] ?? schedule.title,
    };
  }
  if (schedule.teamId) {
    return {
      id: `team:${schedule.teamId}`,
      kind: "team",
      scopeId: schedule.teamId,
      label: labels.teams?.[schedule.teamId] ?? schedule.title,
    };
  }
  if (schedule.organizationId) {
    return {
      id: `organization:${schedule.organizationId}`,
      kind: "organization",
      scopeId: schedule.organizationId,
      label: labels.organizations?.[schedule.organizationId] ?? schedule.title,
    };
  }
  return null;
}

function addBucketRatio(
  map: Map<string, MmBucket>,
  bucket: Omit<MmBucket, "ratioBp">,
  ratioBp: number,
): void {
  const prev = map.get(bucket.id);
  if (prev) {
    map.set(bucket.id, { ...prev, ratioBp: prev.ratioBp + ratioBp });
    return;
  }
  map.set(bucket.id, { ...bucket, ratioBp });
}

function addOther(
  map: Map<string, MmBucket>,
  date: string,
  type: "holiday" | "leave" | "empty" | "unclassified",
  label: string,
  ratioBp = MM_WORKDAY_RATIO_BP,
): void {
  const prev = map.get("other");
  const reason = { date, type, label, ratioBp };
  if (prev) {
    map.set("other", {
      ...prev,
      ratioBp: prev.ratioBp + ratioBp,
      reasons: [...(prev.reasons ?? []), reason],
    });
    return;
  }
  map.set("other", {
    id: "other",
    kind: "other",
    scopeId: null,
    label: "기타",
    ratioBp,
    editable: false,
    reasons: [reason],
  });
}

function rebalanceToTotal(buckets: MmBucket[]): MmBucket[] {
  const total = buckets.reduce((sum, bucket) => sum + bucket.ratioBp, 0);
  if (total === MM_RATIO_TOTAL_BP || buckets.length === 0) return buckets;
  const target = buckets[buckets.length - 1];
  if (!target) return buckets;
  return buckets.map((bucket) =>
    bucket.id === target.id
      ? { ...bucket, ratioBp: Math.max(0, bucket.ratioBp + (MM_RATIO_TOTAL_BP - total)) }
      : bucket,
  );
}

export function buildWeeklyMmSuggestion(args: {
  memberId: string;
  weekStart: string;
  schedules: MmScheduleSource[];
  holidays?: Array<Pick<SchedulerHoliday, "date" | "title">>;
  labels?: MmLabelMaps;
}): WeeklyMmSuggestion {
  const labels = args.labels ?? {};
  const buckets = new Map<string, MmBucket>();
  const holidaysByDate = new Map((args.holidays ?? []).map((holiday) => [holiday.date, holiday.title]));
  const memberSchedules = args.schedules.filter((schedule) => schedule.assigneeId === args.memberId);

  for (const date of eachWorkdayInWeek(args.weekStart)) {
    const dateKey = toDateKey(date);
    const holidayTitle = holidaysByDate.get(dateKey);
    if (holidayTitle) {
      addOther(buckets, dateKey, "holiday", holidayTitle);
      continue;
    }

    const daySchedules = memberSchedules.filter((schedule) => overlapsDay(schedule, date));
    if (!daySchedules.length) {
      addOther(buckets, dateKey, "empty", "일정 없음");
      continue;
    }
    const leave = daySchedules.find((schedule) => schedule.kind === "leave");
    if (leave) {
      addOther(buckets, dateKey, "leave", leave.title || "연차");
      continue;
    }

    const unique = new Map<string, ReturnType<typeof bucketInfo>>();
    for (const schedule of daySchedules) {
      const info = bucketInfo(schedule, labels);
      if (info) unique.set(info.id, info);
    }

    if (!unique.size) {
      addOther(buckets, dateKey, "unclassified", daySchedules[0]?.title ?? "미분류 일정");
      continue;
    }

    const infos = Array.from(unique.values()).filter(Boolean);
    const base = Math.floor(MM_WORKDAY_RATIO_BP / infos.length);
    let remainder = MM_WORKDAY_RATIO_BP - base * infos.length;
    for (const info of infos) {
      if (!info) continue;
      const ratioBp = base + (remainder > 0 ? 1 : 0);
      remainder -= 1;
      addBucketRatio(
        buckets,
        {
          id: info.id,
          kind: info.kind,
          scopeId: info.scopeId,
          label: info.label,
          editable: true,
        },
        ratioBp,
      );
    }
  }

  const orderedKinds: MmScopeKind[] = ["organization", "team", "project", "other"];
  const ordered = Array.from(buckets.values()).sort((a, b) => {
    const kindDiff = orderedKinds.indexOf(a.kind) - orderedKinds.indexOf(b.kind);
    return kindDiff || a.label.localeCompare(b.label, "ko");
  });

  return {
    weekStart: args.weekStart,
    weekEnd: getWeekEndKey(args.weekStart),
    buckets: rebalanceToTotal(ordered),
    sourceSnapshot: {
      generatedAt: new Date().toISOString(),
      scheduleIds: memberSchedules.map((schedule) => schedule.id),
      holidayDates: Array.from(holidaysByDate.keys()),
    },
  };
}

function cellString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function toMmScheduleSource(schedule: Schedule): MmScheduleSource {
  const parsed = parseScheduleInstanceId(schedule.id);
  const page = parsed ? usePageStore.getState().pages[parsed.pageId] : null;
  const cells = page?.dbCells ?? {};
  const meta = parseSchedulerTaskMeta(cells[LC_SCHEDULER_COLUMN_IDS.meta]);
  return {
    id: schedule.id,
    title: schedule.title,
    startAt: schedule.startAt,
    endAt: schedule.endAt,
    assigneeId: schedule.assigneeId,
    kind: meta.kind,
    projectId: schedule.projectId ?? cellString(cells[LC_SCHEDULER_COLUMN_IDS.project]),
    teamId: cellString(cells[LC_SCHEDULER_COLUMN_IDS.team]),
    organizationId: cellString(cells[LC_SCHEDULER_COLUMN_IDS.organization]),
  };
}
