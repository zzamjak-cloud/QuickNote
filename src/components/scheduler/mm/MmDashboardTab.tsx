import { ChevronLeft, ChevronRight, Download, Lock, RefreshCw, ShieldCheck, Unlock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../../lib/scheduler/scope";
import { aggregateMmEntries, buildMmCsvRows, type MmAggregateRow } from "../../../lib/scheduler/mm/mmAggregation";
import {
  getDefaultMmWeek,
  getMmWeekLabel,
  getWeekEndDate,
  parseDateKey,
  shiftMmWeek,
  weeksInMonth,
  weeksInYear,
} from "../../../lib/scheduler/mm/weekUtils";
import { bpToPercent, getMemberSubmissionStates } from "../../../lib/scheduler/mm/mmValidation";
import { isMmAdmin } from "../../../lib/scheduler/mm/mmPermissions";
import { useMemberStore, type Member } from "../../../store/memberStore";
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
  if (kind === "organization" && entry.organizationId === id) return true;
  if (kind === "team" && entry.teamId === id) return true;
  return entry.buckets.some((bucket) => bucket.kind === kind && bucket.scopeId === id);
}

function memberIdsOf(items: Array<{ memberId: string }>): string[] {
  return items.map((item) => item.memberId);
}

function pickMembersByIds(members: Member[], ids: string[]): Member[] {
  const byId = new Map(members.map((member) => [member.memberId, member]));
  return ids.map((id) => byId.get(id)).filter((member): member is Member => Boolean(member));
}

function formatReviewDate(value?: string | null): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatShortRange(weekStart: string): string {
  const start = parseDateKey(weekStart);
  const end = getWeekEndDate(weekStart);
  return `${start.getMonth() + 1}/${start.getDate()} ~ ${end.getMonth() + 1}/${end.getDate()}`;
}

function entryStatusLabel(entry: MmEntry): string {
  if (entry.status === "locked") return "잠금";
  if (entry.status === "reviewed") return "검토완료";
  return "제출완료";
}

function MmEntryLineCard({
  entry,
  memberName,
  showLeaderActions,
  onReview,
  onLock,
  onUnlock,
}: {
  entry: MmEntry;
  memberName: string;
  showLeaderActions: boolean;
  onReview?: () => void;
  onLock?: () => void;
  onUnlock?: () => void;
}) {
  const reviewed = entry.status === "reviewed" || entry.status === "locked";
  return (
    <div
      className={`rounded px-4 py-3 ${
        reviewed
          ? "bg-emerald-600 text-white"
          : "bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-xl font-semibold">{memberName}</span>
          <div className="flex flex-wrap gap-1">
            {entry.buckets.map((bucket) => (
              <span
                key={bucket.id}
                className={`rounded px-2 py-1 text-xs ${
                  reviewed
                    ? "bg-white/20 text-white"
                    : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                }`}
              >
                {bucket.label} {bpToPercent(bucket.ratioBp)}%
              </span>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {entry.reviewedAt && (
            <span className={`hidden text-xs md:inline ${reviewed ? "text-white/80" : "text-zinc-400"}`}>
              {formatReviewDate(entry.reviewedAt)}
            </span>
          )}
          {!showLeaderActions && (
            <span className={`rounded px-2 py-1 text-xs ${reviewed ? "bg-white/20 text-white" : "bg-emerald-50 text-emerald-700"}`}>
              {entryStatusLabel(entry)}
            </span>
          )}
          {showLeaderActions && (
            <>
              <button
                type="button"
                onClick={onReview}
                disabled={entry.status === "locked"}
                className={`rounded border p-1.5 hover:bg-black/5 disabled:opacity-40 ${
                  reviewed
                    ? "border-white/40 text-white hover:bg-white/10"
                    : "border-zinc-200 text-zinc-500 dark:border-zinc-700 dark:hover:bg-zinc-800"
                }`}
                title="검토 완료"
              >
                <ShieldCheck size={15} />
              </button>
              {entry.status === "locked" ? (
                <button
                  type="button"
                  onClick={onUnlock}
                  className="rounded border border-white/40 p-1.5 text-white hover:bg-white/10"
                  title="잠금 해제"
                >
                  <Unlock size={15} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onLock}
                  className={`rounded border p-1.5 ${
                    entry.status === "reviewed"
                      ? "border-white/40 text-white hover:bg-white/10"
                      : "border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  }`}
                  title="잠금"
                >
                  <Lock size={15} />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MissingMmLineCard({ memberName }: { memberName: string }) {
  return (
    <div className="rounded bg-red-50 px-4 py-3 text-red-700 dark:bg-red-950/30 dark:text-red-300">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xl font-semibold">{memberName}</span>
        <span className="rounded bg-red-100 px-2 py-1 text-xs text-red-700 dark:bg-red-900/40 dark:text-red-200">
          누락
        </span>
      </div>
    </div>
  );
}

function MmAggregateMemberCard({
  memberName,
  entryCount,
  rows,
}: {
  memberName: string;
  entryCount: number;
  rows: MmAggregateRow[];
}) {
  return (
    <div className="rounded bg-white px-4 py-3 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-xl font-semibold">{memberName}</span>
          <div className="flex flex-wrap gap-1">
            {rows.map((row) => (
              <span
                key={row.key}
                className="rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
              >
                {row.label} {bpToPercent(row.ratioBp)}%
              </span>
            ))}
          </div>
        </div>
        <span className="rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">
          {entryCount}주
        </span>
      </div>
    </div>
  );
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
  const [didApplyDefaultScope, setDidApplyDefaultScope] = useState(false);

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

  useEffect(() => {
    if (didApplyDefaultScope || !me || !isMmAdmin(me) || scope !== "all") return;
    const org = organizations.find((item) =>
      !item.removedAt && item.members.some((member) => member.memberId === me.memberId),
    );
    if (org) {
      setScope(`organization:${org.organizationId}`);
      setDidApplyDefaultScope(true);
      return;
    }
    const team = teams.find((item) =>
      !item.removedAt && item.members.some((member) => member.memberId === me.memberId),
    );
    if (team) {
      setScope(`team:${team.teamId}`);
      setDidApplyDefaultScope(true);
      return;
    }
    const project = projects.find((item) =>
      !item.isHidden && item.memberIds.includes(me.memberId),
    );
    if (project) {
      setScope(`project:${project.id}`);
      setDidApplyDefaultScope(true);
    }
  }, [didApplyDefaultScope, me, organizations, projects, scope, teams]);

  const scopeMembers = useMemo(() => {
    if (scope === "all") return members;
    const [kind, id] = scope.split(":");
    if (kind === "organization") {
      const org = organizations.find((item) => item.organizationId === id);
      return org ? pickMembersByIds(members, memberIdsOf(org.members)) : [];
    }
    if (kind === "team") {
      const team = teams.find((item) => item.teamId === id);
      return team ? pickMembersByIds(members, memberIdsOf(team.members)) : [];
    }
    if (kind === "project") {
      const project = projects.find((item) => item.id === id);
      return project ? pickMembersByIds(members, project.memberIds) : [];
    }
    return members;
  }, [members, organizations, projects, scope, teams]);

  const rangeEntries = entries
    .filter((entry) => entry.workspaceId === LC_SCHEDULER_WORKSPACE_ID)
    .filter((entry) => entry.weekStart >= fromWeekStart && entry.weekStart <= toWeekStart);
  const visibleEntries = rangeEntries
    .filter((entry) => entryMatchesScope(entry, scope));
  const weeklyStates = getMemberSubmissionStates(scopeMembers, visibleEntries, weekStart);
  const aggregateRows = aggregateMmEntries(visibleEntries);
  const aggregateRowsByMember = new Map<string, { entryCount: number; rows: MmAggregateRow[] }>();
  const aggregateEntryCountByMember = new Map<string, number>();
  for (const entry of visibleEntries) {
    aggregateEntryCountByMember.set(
      entry.memberId,
      (aggregateEntryCountByMember.get(entry.memberId) ?? 0) + 1,
    );
  }
  for (const row of aggregateRows) {
    const entryCount = Math.max(1, aggregateEntryCountByMember.get(row.memberId) ?? row.entryCount);
    const nextRow = {
      ...row,
      ratioBp: Math.round(row.ratioBp / entryCount),
    };
    const prev = aggregateRowsByMember.get(row.memberId);
    if (prev) {
      prev.rows.push(nextRow);
    } else {
      aggregateRowsByMember.set(row.memberId, { entryCount, rows: [nextRow] });
    }
  }

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
      entries: rangeEntries,
      memberNameById,
      organizationNameById: orgNameById,
      teamNameById,
      projectNameById,
      rangeKind,
      periodLabel: rangeKind === "month"
        ? `${year}-${String(monthIndex + 1).padStart(2, "0")}`
        : rangeKind === "year"
          ? String(year)
          : weekStart,
      scope,
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
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md bg-white/70 p-0.5 dark:bg-zinc-900/60">
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
          <select
            value={rangeKind}
            onChange={(event) => setRangeKind(event.target.value as RangeKind)}
            className="rounded border-0 bg-white px-2 py-1.5 text-sm text-zinc-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-zinc-900 dark:text-zinc-200"
          >
            <option value="week">주간</option>
            <option value="month">월간</option>
            <option value="year">연간</option>
          </select>
          <select
            value={scope}
            onChange={(event) => setScope(event.target.value as ScopeFilter)}
            className="rounded border-0 bg-white px-2 py-1.5 text-sm text-zinc-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 dark:bg-zinc-900 dark:text-zinc-200"
          >
            {scopeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          {rangeKind === "month" ? (
            <div className="flex items-center gap-2">
              <input type="number" value={year} onChange={(event) => setYear(Number(event.target.value))} className="w-24 rounded border-0 bg-white px-2 py-1.5 text-sm shadow-sm dark:bg-zinc-900" />
              <select value={monthIndex} onChange={(event) => setMonthIndex(Number(event.target.value))} className="rounded border-0 bg-white px-2 py-1.5 text-sm shadow-sm dark:bg-zinc-900">
                {Array.from({ length: 12 }, (_, idx) => <option key={idx} value={idx}>{idx + 1}월</option>)}
              </select>
            </div>
          ) : rangeKind === "year" ? (
            <input type="number" value={year} onChange={(event) => setYear(Number(event.target.value))} className="w-24 rounded border-0 bg-white px-2 py-1.5 text-sm shadow-sm dark:bg-zinc-900" />
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void fetchEntries({ workspaceId: LC_SCHEDULER_WORKSPACE_ID, fromWeekStart, toWeekStart })}
            className="inline-flex items-center gap-1.5 rounded bg-white px-3 py-1.5 text-xs text-zinc-600 shadow-sm hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <RefreshCw size={13} />
            구성원 MM 가져오기
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

      {rangeKind === "week" && (
        <div className="flex items-center justify-center gap-2 py-1">
          <button
            type="button"
            onClick={() => setWeekStart((v) => shiftMmWeek(v, -1))}
            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="이전 주"
          >
            <ChevronLeft size={18} />
          </button>
          <div className="text-center">
            <h3 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
              {getMmWeekLabel(weekStart)}
            </h3>
            <p className="mt-0.5 text-xs text-zinc-400">{formatShortRange(weekStart)}</p>
          </div>
          <button
            type="button"
            onClick={() => setWeekStart((v) => shiftMmWeek(v, 1))}
            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="다음 주"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      )}

      <div className="grid grid-cols-3 divide-x divide-zinc-200 bg-white dark:divide-zinc-700 dark:bg-zinc-900">
        <div className="px-4 py-3 text-center">
          <p className="text-xs text-zinc-400">제출</p>
          <p className="text-3xl font-semibold text-zinc-900 dark:text-zinc-100">{submittedCount}</p>
        </div>
        <div className="px-4 py-3 text-center">
          <p className="text-xs text-zinc-400">누락</p>
          <p className="text-3xl font-semibold text-red-600">{missingCount}</p>
        </div>
        <div className="px-4 py-3 text-center">
          <p className="text-xs text-zinc-400">MM 레코드</p>
          <p className="text-3xl font-semibold text-zinc-900 dark:text-zinc-100">{visibleEntries.length}</p>
        </div>
      </div>

      {innerTab === "member" && rangeKind === "week" && (
        <div className="space-y-2">
          {weeklyStates.map((state) => (
            state.entry ? (
              <MmEntryLineCard
                key={state.memberId}
                entry={state.entry}
                memberName={memberNameById[state.memberId] ?? state.memberId}
                showLeaderActions={false}
              />
            ) : (
              <MissingMmLineCard
                key={state.memberId}
                memberName={memberNameById[state.memberId] ?? state.memberId}
              />
            )
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
            <MmEntryLineCard
              key={entry.id}
              entry={entry}
              memberName={memberNameById[entry.memberId] ?? entry.memberId}
              showLeaderActions
              onReview={() => void reviewEntry({ workspaceId: LC_SCHEDULER_WORKSPACE_ID, entryId: entry.id, buckets: entry.buckets })}
              onLock={() => void lockEntry(LC_SCHEDULER_WORKSPACE_ID, entry.id)}
              onUnlock={() => void unlockEntry(LC_SCHEDULER_WORKSPACE_ID, entry.id)}
            />
          ))}
        </div>
      )}

      {innerTab === "member" && rangeKind !== "week" && (
        <div className="space-y-2">
          {Array.from(aggregateRowsByMember.entries()).map(([memberId, aggregate]) => (
            <MmAggregateMemberCard
              key={memberId}
              memberName={memberNameById[memberId] ?? memberId}
              entryCount={aggregate.entryCount}
              rows={aggregate.rows}
            />
          ))}
        </div>
      )}

      {!me && <div className="text-xs text-zinc-400">로그인 구성원 정보를 확인 중입니다.</div>}
    </div>
  );
}
