import { Download, Lock, RefreshCw, ShieldCheck, Unlock } from "lucide-react";
import { useEffect, useState } from "react";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../../lib/scheduler/scope";
import { aggregateMmEntries, buildMmCsvRows } from "../../../lib/scheduler/mm/mmAggregation";
import { getDefaultMmWeek, getMmWeekLabel, shiftMmWeek, weeksInMonth, weeksInYear } from "../../../lib/scheduler/mm/weekUtils";
import { bpToPercent, getMemberSubmissionStates } from "../../../lib/scheduler/mm/mmValidation";
import { useMemberStore } from "../../../store/memberStore";
import { useSchedulerMmStore } from "../../../store/schedulerMmStore";
import { useOrganizationStore } from "../../../store/organizationStore";
import { useTeamStore } from "../../../store/teamStore";
import { useSchedulerProjectsStore } from "../../../store/schedulerProjectsStore";
import type { MmEntry } from "../../../lib/scheduler/mm/mmTypes";

type RangeKind = "week" | "month" | "year";
type InnerTab = "member" | "leader";
type ScopeFilter = "all" | `organization:${string}` | `team:${string}` | `project:${string}`;

function mapById<T>(items: T[], getId: (item: T) => string, getName: (item: T) => string): Record<string, string> {
  return Object.fromEntries(items.map((item) => [getId(item), getName(item)]));
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function rangeWeeks(kind: RangeKind, weekStart: string, year: number, monthIndex: number): string[] {
  if (kind === "week") return [weekStart];
  if (kind === "month") return weeksInMonth(year, monthIndex);
  return weeksInYear(year);
}

function entryMatchesScope(entry: MmEntry, scope: ScopeFilter): boolean {
  if (scope === "all") return true;
  const [kind, id] = scope.split(":");
  return entry.buckets.some((bucket) => bucket.kind === kind && bucket.scopeId === id);
}

export function MmDashboardTab() {
  const members = useMemberStore((s) => s.members).filter((member) => member.status === "active");
  const me = useMemberStore((s) => s.me);
  const organizations = useOrganizationStore((s) => s.organizations);
  const teams = useTeamStore((s) => s.teams);
  const projects = useSchedulerProjectsStore((s) => s.projects);
  const entries = useSchedulerMmStore((s) => s.entries);
  const fetchEntries = useSchedulerMmStore((s) => s.fetchEntries);
  const reviewEntry = useSchedulerMmStore((s) => s.reviewEntry);
  const lockEntry = useSchedulerMmStore((s) => s.lockEntry);
  const unlockEntry = useSchedulerMmStore((s) => s.unlockEntry);

  const now = new Date();
  const [innerTab, setInnerTab] = useState<InnerTab>("member");
  const [rangeKind, setRangeKind] = useState<RangeKind>("week");
  const [weekStart, setWeekStart] = useState(() => getDefaultMmWeek());
  const [year, setYear] = useState(now.getFullYear());
  const [monthIndex, setMonthIndex] = useState(now.getMonth());
  const [scope, setScope] = useState<ScopeFilter>("all");

  const weeks = rangeWeeks(rangeKind, weekStart, year, monthIndex);
  const fromWeekStart = weeks[0] ?? weekStart;
  const toWeekStart = weeks[weeks.length - 1] ?? weekStart;

  useEffect(() => {
    void fetchEntries({
      workspaceId: LC_SCHEDULER_WORKSPACE_ID,
      fromWeekStart,
      toWeekStart,
    });
  }, [fetchEntries, fromWeekStart, toWeekStart]);

  const visibleEntries = entries
    .filter((entry) => entry.workspaceId === LC_SCHEDULER_WORKSPACE_ID)
    .filter((entry) => entry.weekStart >= fromWeekStart && entry.weekStart <= toWeekStart)
    .filter((entry) => entryMatchesScope(entry, scope));
  const weeklyStates = getMemberSubmissionStates(members, visibleEntries, weekStart);
  const aggregateRows = aggregateMmEntries(visibleEntries);

  const memberNameById = mapById(members, (m) => m.memberId, (m) => m.name);
  const orgNameById = mapById(organizations, (o) => o.organizationId, (o) => o.name);
  const teamNameById = mapById(teams, (t) => t.teamId, (t) => t.name);
  const projectNameById = mapById(projects, (p) => p.id, (p) => p.name);

  const submittedCount = rangeKind === "week"
    ? weeklyStates.filter((state) => state.label === "제출완료").length
    : new Set(visibleEntries.map((entry) => entry.memberId)).size;
  const missingCount = rangeKind === "week" ? weeklyStates.length - submittedCount : 0;

  function exportCsv() {
    const csv = buildMmCsvRows({
      entries: visibleEntries,
      memberNameById,
      organizationNameById: orgNameById,
      teamNameById,
      projectNameById,
    });
    downloadCsv(`lc-scheduler-mm-${rangeKind}-${fromWeekStart}-${toWeekStart}.csv`, csv);
  }

  const scopeOptions: Array<{ value: ScopeFilter; label: string }> = [
    { value: "all", label: "전체" },
    ...organizations.filter((org) => !org.removedAt).map((org) => ({ value: `organization:${org.organizationId}` as ScopeFilter, label: `조직 · ${org.name}` })),
    ...teams.filter((team) => !team.removedAt).map((team) => ({ value: `team:${team.teamId}` as ScopeFilter, label: `팀 · ${team.name}` })),
    ...projects.filter((project) => !project.isHidden).map((project) => ({ value: `project:${project.id}` as ScopeFilter, label: `프로젝트 · ${project.name}` })),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-md border border-zinc-200 bg-zinc-100/60 p-0.5 dark:border-zinc-700 dark:bg-zinc-800/50">
          {([
            ["member", "구성원 입력"],
            ["leader", "리더 검토"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setInnerTab(id)}
              className={`rounded px-3 py-1.5 text-xs font-medium ${
                innerTab === id
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void fetchEntries({ workspaceId: LC_SCHEDULER_WORKSPACE_ID, fromWeekStart, toWeekStart })}
            className="inline-flex items-center gap-1.5 rounded border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <RefreshCw size={13} />
            구성원 입력 정보 가져오기
          </button>
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 rounded bg-zinc-900 px-3 py-1.5 text-xs text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            <Download size={13} />
            CSV 내보내기
          </button>
        </div>
      </div>

      <div className="grid grid-cols-[140px_1fr_180px] gap-2">
        <select
          value={rangeKind}
          onChange={(event) => setRangeKind(event.target.value as RangeKind)}
          className="rounded border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="week">주간</option>
          <option value="month">월간</option>
          <option value="year">연간</option>
        </select>
        {rangeKind === "week" ? (
          <div className="flex items-center justify-center gap-2 rounded border border-zinc-200 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900">
            <button type="button" onClick={() => setWeekStart((v) => shiftMmWeek(v, -1))} className="rounded px-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">‹</button>
            <span className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{getMmWeekLabel(weekStart)}</span>
            <button type="button" onClick={() => setWeekStart((v) => shiftMmWeek(v, 1))} className="rounded px-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">›</button>
          </div>
        ) : rangeKind === "month" ? (
          <div className="grid grid-cols-2 gap-2">
            <input type="number" value={year} onChange={(event) => setYear(Number(event.target.value))} className="rounded border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
            <select value={monthIndex} onChange={(event) => setMonthIndex(Number(event.target.value))} className="rounded border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900">
              {Array.from({ length: 12 }, (_, idx) => <option key={idx} value={idx}>{idx + 1}월</option>)}
            </select>
          </div>
        ) : (
          <input type="number" value={year} onChange={(event) => setYear(Number(event.target.value))} className="rounded border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        )}
        <select
          value={scope}
          onChange={(event) => setScope(event.target.value as ScopeFilter)}
          className="rounded border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          {scopeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-xs text-zinc-400">제출</p>
          <p className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{submittedCount}</p>
        </div>
        <div className="rounded border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-xs text-zinc-400">누락</p>
          <p className="text-xl font-semibold text-red-600">{missingCount}</p>
        </div>
        <div className="rounded border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-xs text-zinc-400">MM 레코드</p>
          <p className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{visibleEntries.length}</p>
        </div>
      </div>

      {innerTab === "member" && rangeKind === "week" && (
        <div className="grid grid-cols-2 gap-2">
          {weeklyStates.map((state) => (
            <div
              key={state.memberId}
              className={`flex items-center justify-between rounded border px-3 py-2 ${
                state.tone === "danger"
                  ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"
              }`}
            >
              <span className="truncate text-sm font-medium">{memberNameById[state.memberId] ?? state.memberId}</span>
              <span className="text-xs">{state.label}</span>
            </div>
          ))}
        </div>
      )}

      {innerTab === "leader" && (
        <div className="space-y-2">
          {visibleEntries.length === 0 && (
            <div className="rounded border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-400 dark:border-zinc-700">
              조회된 MM 레코드가 없습니다.
            </div>
          )}
          {visibleEntries.map((entry) => (
            <div key={entry.id} className="rounded border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {memberNameById[entry.memberId] ?? entry.memberId}
                  </p>
                  <p className="text-xs text-zinc-400">{entry.weekStart} · {entry.status}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {entry.buckets.map((bucket) => (
                      <span key={bucket.id} className="rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                        {bucket.label} {bpToPercent(bucket.ratioBp)}%
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => void reviewEntry({ workspaceId: LC_SCHEDULER_WORKSPACE_ID, entryId: entry.id, buckets: entry.buckets })}
                    disabled={entry.status === "locked"}
                    className="rounded border border-zinc-200 p-1.5 text-zinc-500 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    title="검토 완료"
                  >
                    <ShieldCheck size={15} />
                  </button>
                  {entry.status === "locked" ? (
                    <button
                      type="button"
                      onClick={() => void unlockEntry(LC_SCHEDULER_WORKSPACE_ID, entry.id)}
                      className="rounded border border-zinc-200 p-1.5 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      title="잠금 해제"
                    >
                      <Unlock size={15} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void lockEntry(LC_SCHEDULER_WORKSPACE_ID, entry.id)}
                      className="rounded border border-zinc-200 p-1.5 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      title="잠금"
                    >
                      <Lock size={15} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {innerTab === "member" && rangeKind !== "week" && (
        <div className="space-y-2">
          {aggregateRows.map((row) => (
            <div key={row.key} className="flex items-center justify-between rounded border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{memberNameById[row.memberId] ?? row.memberId}</p>
                <p className="text-xs text-zinc-400">{row.label} · {row.entryCount}주</p>
              </div>
              <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{bpToPercent(row.ratioBp)}%</span>
            </div>
          ))}
        </div>
      )}

      {!me && <div className="text-xs text-zinc-400">로그인 구성원 정보를 확인 중입니다.</div>}
    </div>
  );
}
