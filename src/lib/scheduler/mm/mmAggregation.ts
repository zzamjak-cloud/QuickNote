import type { MmBucket, MmEntry, MmScopeKind } from "./mmTypes";
import { toCsvMmValue } from "./mmValidation";

export type MmAggregateRow = {
  key: string;
  memberId: string;
  kind: MmScopeKind;
  scopeId?: string | null;
  label: string;
  ratioBp: number;
  entryCount: number;
};

export type MmAggregateMemberGroup = {
  entryCount: number;
  rows: MmAggregateRow[];
};

export type MmCsvRangeKind = "week" | "month" | "year";
export type MmCsvScopeFilter = "all" | `organization:${string}` | `team:${string}` | `project:${string}`;

export function aggregateMmEntries(entries: MmEntry[]): MmAggregateRow[] {
  const rows = new Map<string, MmAggregateRow>();
  for (const entry of entries) {
    for (const bucket of entry.buckets) {
      const key = `${entry.memberId}:${bucket.kind}:${bucket.scopeId ?? bucket.id}`;
      const prev = rows.get(key);
      if (prev) {
        rows.set(key, {
          ...prev,
          ratioBp: prev.ratioBp + bucket.ratioBp,
          entryCount: prev.entryCount + 1,
        });
        continue;
      }
      rows.set(key, {
        key,
        memberId: entry.memberId,
        kind: bucket.kind,
        scopeId: bucket.scopeId,
        label: bucket.label,
        ratioBp: bucket.ratioBp,
        entryCount: 1,
      });
    }
  }
  return Array.from(rows.values()).sort((a, b) =>
    a.memberId.localeCompare(b.memberId) || a.label.localeCompare(b.label, "ko"),
  );
}

export function filterMmEntriesByRange(
  entries: MmEntry[],
  workspaceId: string,
  fromWeekStart: string,
  toWeekStart: string,
): MmEntry[] {
  return entries
    .filter((entry) => entry.workspaceId === workspaceId)
    .filter((entry) => entry.weekStart >= fromWeekStart && entry.weekStart <= toWeekStart);
}

export function mmEntryMatchesScope(entry: MmEntry, scope: MmCsvScopeFilter): boolean {
  if (scope === "all") return true;
  const [kind, id] = scope.split(":");
  if (kind === "organization" && entry.organizationId === id) return true;
  if (kind === "team" && entry.teamId === id) return true;
  return entry.buckets.some((bucket) => bucket.kind === kind && bucket.scopeId === id);
}

export function filterMmEntriesByScope(entries: MmEntry[], scope: MmCsvScopeFilter): MmEntry[] {
  if (scope === "all") return entries;
  return entries.filter((entry) => mmEntryMatchesScope(entry, scope));
}

export function aggregateMmEntriesByMemberAverage(entries: MmEntry[]): Map<string, MmAggregateMemberGroup> {
  const aggregateRows = aggregateMmEntries(entries);
  const rowsByMember = new Map<string, MmAggregateMemberGroup>();
  const entryCountByMember = new Map<string, number>();
  for (const entry of entries) {
    entryCountByMember.set(
      entry.memberId,
      (entryCountByMember.get(entry.memberId) ?? 0) + 1,
    );
  }
  for (const row of aggregateRows) {
    const entryCount = Math.max(1, entryCountByMember.get(row.memberId) ?? row.entryCount);
    const nextRow = {
      ...row,
      ratioBp: Math.round(row.ratioBp / entryCount),
    };
    const prev = rowsByMember.get(row.memberId);
    if (prev) {
      prev.rows.push(nextRow);
    } else {
      rowsByMember.set(row.memberId, { entryCount, rows: [nextRow] });
    }
  }
  return rowsByMember;
}

function escapeCsv(value: unknown): string {
  const text = String(value ?? "");
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replaceAll("\"", "\"\"")}"`;
}

export function buildMmCsvRows(args: {
  entries: MmEntry[];
  memberNameById: Record<string, string>;
  organizationNameById?: Record<string, string>;
  teamNameById?: Record<string, string>;
  projectNameById?: Record<string, string>;
  rangeKind?: MmCsvRangeKind;
  periodLabel?: string;
  scope?: MmCsvScopeFilter;
}): string {
  if (args.rangeKind || args.periodLabel || args.scope) {
    return buildSummaryMmCsvRows({
      ...args,
      rangeKind: args.rangeKind ?? "week",
      periodLabel: args.periodLabel ?? "",
      scope: args.scope ?? "all",
    });
  }

  const header = [
    "기간",
    "주차",
    "구성원",
    "조직",
    "팀",
    "프로젝트",
    "분류",
    "MM값",
    "상태",
    "제출일",
    "검토자",
    "검토일",
    "비고",
  ];
  const lines = [header.map(escapeCsv).join(",")];
  for (const entry of args.entries) {
    for (const bucket of entry.buckets) {
      const scope = resolveScopeColumns(bucket, args);
      lines.push([
        `${entry.weekStart}~${entry.weekEnd}`,
        entry.weekStart,
        args.memberNameById[entry.memberId] ?? entry.memberId,
        scope.organization,
        scope.team,
        scope.project,
        bucket.kind === "other" ? "기타" : bucket.label,
        toCsvMmValue(bucket.ratioBp),
        entry.status,
        entry.submittedAt,
        entry.reviewedByMemberId ?? "",
        entry.reviewedAt ?? "",
        entry.note ?? "",
      ].map(escapeCsv).join(","));
    }
  }
  return lines.join("\n");
}

function buildSummaryMmCsvRows(args: {
  entries: MmEntry[];
  memberNameById: Record<string, string>;
  organizationNameById?: Record<string, string>;
  teamNameById?: Record<string, string>;
  projectNameById?: Record<string, string>;
  rangeKind: MmCsvRangeKind;
  periodLabel: string;
  scope: MmCsvScopeFilter;
}): string {
  const firstColumn = args.rangeKind === "month" ? "월" : args.rangeKind === "year" ? "연" : "주";
  const lines = [[firstColumn, "구성원", "조직MM", "팀MM", "프로젝트MM", "기타MM"].map(escapeCsv).join(",")];
  const memberIds = resolveExportMemberIds(args.entries, args.scope);
  for (const memberId of memberIds) {
    const memberEntries = args.entries.filter((entry) => entry.memberId === memberId);
    const entryCount = memberEntries.length;
    if (entryCount === 0) continue;
    const buckets = summarizeMemberBuckets(memberEntries, entryCount, args);
    lines.push([
      args.periodLabel,
      args.memberNameById[memberId] ?? memberId,
      formatSummaryCell(buckets.organization),
      formatSummaryCell(buckets.team),
      formatSummaryCell(buckets.project),
      formatSummaryCell(buckets.other, true),
    ].map(escapeCsv).join(","));
  }
  return lines.join("\n");
}

function resolveExportMemberIds(entries: MmEntry[], scope: MmCsvScopeFilter): string[] {
  const memberIds = new Set<string>();
  for (const entry of entries) {
    if (mmEntryMatchesScope(entry, scope)) {
      memberIds.add(entry.memberId);
    }
  }
  return Array.from(memberIds).sort((a, b) => a.localeCompare(b));
}

function shouldIncludeBucketForExport(entry: MmEntry, bucket: MmBucket, scope: MmCsvScopeFilter): boolean {
  if (scope === "all") return true;
  const [kind, id] = scope.split(":");
  if (kind === "project") return bucket.kind === "project" && bucket.scopeId === id;
  if (kind === "team") return entry.teamId === id || (bucket.kind === "team" && bucket.scopeId === id);
  if (kind === "organization") return entry.organizationId === id || (bucket.kind === "organization" && bucket.scopeId === id);
  return true;
}

function summarizeMemberBuckets(
  entries: MmEntry[],
  entryCount: number,
  args: {
    scope: MmCsvScopeFilter;
    organizationNameById?: Record<string, string>;
    teamNameById?: Record<string, string>;
    projectNameById?: Record<string, string>;
  },
): Record<MmScopeKind, Array<{ label: string; ratioBp: number }>> {
  const grouped = new Map<string, { kind: MmScopeKind; label: string; ratioBp: number }>();
  for (const entry of entries) {
    for (const bucket of entry.buckets) {
      if (!shouldIncludeBucketForExport(entry, bucket, args.scope)) continue;
      const label = resolveBucketLabel(bucket, args);
      const key = `${bucket.kind}:${bucket.scopeId ?? bucket.id}:${label}`;
      const prev = grouped.get(key);
      if (prev) {
        prev.ratioBp += bucket.ratioBp;
      } else {
        grouped.set(key, { kind: bucket.kind, label, ratioBp: bucket.ratioBp });
      }
    }
  }

  const result: Record<MmScopeKind, Array<{ label: string; ratioBp: number }>> = {
    organization: [],
    team: [],
    project: [],
    other: [],
  };
  for (const item of grouped.values()) {
    result[item.kind].push({
      label: item.label,
      ratioBp: Math.round(item.ratioBp / entryCount),
    });
  }
  for (const values of Object.values(result)) {
    values.sort((a, b) => a.label.localeCompare(b.label, "ko"));
  }
  return result;
}

function resolveBucketLabel(
  bucket: MmBucket,
  args: {
    organizationNameById?: Record<string, string>;
    teamNameById?: Record<string, string>;
    projectNameById?: Record<string, string>;
  },
): string {
  if (bucket.kind === "organization" && bucket.scopeId) {
    return args.organizationNameById?.[bucket.scopeId] ?? bucket.label;
  }
  if (bucket.kind === "team" && bucket.scopeId) {
    return args.teamNameById?.[bucket.scopeId] ?? bucket.label;
  }
  if (bucket.kind === "project" && bucket.scopeId) {
    return args.projectNameById?.[bucket.scopeId] ?? bucket.label;
  }
  return bucket.kind === "other" ? "기타" : bucket.label;
}

function formatSummaryCell(values: Array<{ label: string; ratioBp: number }>, omitLabel = false): string {
  return values
    .filter((value) => value.ratioBp > 0)
    .map((value) => omitLabel ? toCsvMmValue(value.ratioBp) : `${value.label} ${toCsvMmValue(value.ratioBp)}`)
    .join("; ");
}

function resolveScopeColumns(
  bucket: MmBucket,
  args: {
    organizationNameById?: Record<string, string>;
    teamNameById?: Record<string, string>;
    projectNameById?: Record<string, string>;
  },
): { organization: string; team: string; project: string } {
  if (bucket.kind === "organization") {
    return { organization: bucket.scopeId ? args.organizationNameById?.[bucket.scopeId] ?? bucket.label : bucket.label, team: "", project: "" };
  }
  if (bucket.kind === "team") {
    return { organization: "", team: bucket.scopeId ? args.teamNameById?.[bucket.scopeId] ?? bucket.label : bucket.label, project: "" };
  }
  if (bucket.kind === "project") {
    return { organization: "", team: "", project: bucket.scopeId ? args.projectNameById?.[bucket.scopeId] ?? bucket.label : bucket.label };
  }
  return { organization: "", team: "", project: "" };
}
