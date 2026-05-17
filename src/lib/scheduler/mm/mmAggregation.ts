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
}): string {
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
