import { AlertTriangle, ChevronLeft, ChevronRight, Lock, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../../lib/scheduler/scope";
import { buildWeeklyMmSuggestion, toMmScheduleSource } from "../../../lib/scheduler/mm/mmSuggestion";
import {
  getDefaultMmWeek,
  getMmWeekLabel,
  getWeekEndDate,
  parseDateKey,
  shiftMmWeek,
} from "../../../lib/scheduler/mm/weekUtils";
import { bpToPercent, percentToBp, validateMmBuckets } from "../../../lib/scheduler/mm/mmValidation";
import { canEditWeeklyMmInput, isMmAdmin } from "../../../lib/scheduler/mm/mmPermissions";
import type { MmBucket } from "../../../lib/scheduler/mm/mmTypes";
import { useMemberStore } from "../../../store/memberStore";
import { useSchedulerStore } from "../../../store/schedulerStore";
import { useSchedulerHolidaysStore } from "../../../store/schedulerHolidaysStore";
import { useSchedulerProjectsStore } from "../../../store/schedulerProjectsStore";
import { useOrganizationStore } from "../../../store/organizationStore";
import { useTeamStore } from "../../../store/teamStore";
import { useSchedulerMmStore } from "../../../store/schedulerMmStore";
import { useSchedulerViewStore } from "../../../store/schedulerViewStore";
import { useVisibleMembers } from "../hooks/useVisibleMembers";

function labelMap<T extends { id: string; name: string }>(items: T[]): Record<string, string> {
  return Object.fromEntries(items.map((item) => [item.id, item.name]));
}

function memberIdSet(members: Array<{ memberId: string }>): Set<string> {
  return new Set(members.map((member) => member.memberId));
}

function formatPercent(bp: number): string {
  return String(bpToPercent(bp));
}

function formatShortRange(weekStart: string): string {
  const start = parseDateKey(weekStart);
  const end = getWeekEndDate(weekStart);
  return `${start.getMonth() + 1}/${start.getDate()} ~ ${end.getMonth() + 1}/${end.getDate()}`;
}

export function WeeklyMmPanel() {
  const me = useMemberStore((s) => s.me);
  const schedules = useSchedulerStore((s) => s.schedules);
  const holidays = useSchedulerHolidaysStore((s) => s.holidays);
  const projects = useSchedulerProjectsStore((s) => s.projects);
  const organizations = useOrganizationStore((s) => s.organizations);
  const teams = useTeamStore((s) => s.teams);
  const entries = useSchedulerMmStore((s) => s.entries);
  const fetchEntries = useSchedulerMmStore((s) => s.fetchEntries);
  const upsertEntry = useSchedulerMmStore((s) => s.upsertEntry);
  const selectedMemberId = useSchedulerViewStore((s) => s.selectedMemberId);
  const selectedProjectId = useSchedulerViewStore((s) => s.selectedProjectId);
  const multiSelectedIds = useSchedulerViewStore((s) => s.multiSelectedIds);
  const setMmWeekStart = useSchedulerViewStore((s) => s.setMmWeekStart);
  const visibleMembers = useVisibleMembers();

  const [open, setOpen] = useState(false);
  const [weekStart, setWeekStart] = useState(() => getDefaultMmWeek());
  const [draftBuckets, setDraftBuckets] = useState<MmBucket[]>([]);
  const [draftSourceKey, setDraftSourceKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const admin = isMmAdmin(me);
  const selectedVisibleMember = selectedMemberId
    ? visibleMembers.find((member) => member.memberId === selectedMemberId) ?? null
    : null;
  const targetMember = selectedVisibleMember ?? null;
  const effectiveTargetMemberId = targetMember?.memberId ?? null;
  const organizationMemberIdsById = useMemo(
    () => new Map(organizations.map((org) => [org.organizationId, memberIdSet(org.members)])),
    [organizations],
  );
  const teamMemberIdsById = useMemo(
    () => new Map(teams.map((team) => [team.teamId, memberIdSet(team.members)])),
    [teams],
  );
  const projectMemberIdsById = useMemo(
    () => new Map(projects.map((project) => [project.id, new Set(project.memberIds)])),
    [projects],
  );

  const scopeIncludesMe = useMemo(() => {
    if (!me || !selectedProjectId) return false;
    if (selectedProjectId.startsWith("org:")) {
      const orgId = selectedProjectId.slice(4);
      return organizationMemberIdsById.get(orgId)?.has(me.memberId) ?? false;
    }
    if (selectedProjectId.startsWith("team:")) {
      const teamId = selectedProjectId.slice(5);
      return teamMemberIdsById.get(teamId)?.has(me.memberId) ?? false;
    }
    if (selectedProjectId.startsWith("proj:")) {
      const projectId = selectedProjectId.slice(5);
      return projectMemberIdsById.get(projectId)?.has(me.memberId) ?? false;
    }
    return false;
  }, [me, organizationMemberIdsById, projectMemberIdsById, selectedProjectId, teamMemberIdsById]);
  const shouldRenderButton = Boolean(
    me &&
    selectedMemberId &&
    selectedProjectId &&
    selectedVisibleMember &&
    multiSelectedIds.length === 0 &&
    ((admin && scopeIncludesMe) || selectedMemberId === me.memberId),
  );

  useEffect(() => {
    setMmWeekStart(open && shouldRenderButton ? weekStart : null);
    return () => setMmWeekStart(null);
  }, [open, setMmWeekStart, shouldRenderButton, weekStart]);

  useEffect(() => {
    if (!open || !effectiveTargetMemberId) return;
    void fetchEntries({
      workspaceId: LC_SCHEDULER_WORKSPACE_ID,
      fromWeekStart: weekStart,
      toWeekStart: weekStart,
      memberId: effectiveTargetMemberId,
    });
  }, [effectiveTargetMemberId, fetchEntries, open, weekStart]);

  const projectNames = useMemo(
    () => labelMap(projects.map((project) => ({ id: project.id, name: project.name }))),
    [projects],
  );
  const teamNames = useMemo(
    () => labelMap(teams.map((team) => ({ id: team.teamId, name: team.name }))),
    [teams],
  );
  const orgNames = useMemo(
    () => labelMap(organizations.map((org) => ({ id: org.organizationId, name: org.name }))),
    [organizations],
  );

  const existingEntry = useMemo(
    () => entries.find((entry) =>
      entry.workspaceId === LC_SCHEDULER_WORKSPACE_ID &&
      entry.memberId === effectiveTargetMemberId &&
      entry.weekStart === weekStart,
    ),
    [effectiveTargetMemberId, entries, weekStart],
  );

  const mmScheduleSources = useMemo(() => schedules.map(toMmScheduleSource), [schedules]);
  const suggestion = useMemo(
    () => effectiveTargetMemberId
      ? buildWeeklyMmSuggestion({
        memberId: effectiveTargetMemberId,
        weekStart,
        schedules: mmScheduleSources,
        holidays,
        labels: { projects: projectNames, teams: teamNames, organizations: orgNames },
      })
      : null,
    [effectiveTargetMemberId, holidays, mmScheduleSources, orgNames, projectNames, teamNames, weekStart],
  );

  useEffect(() => {
    const nextKey = existingEntry
      ? `entry:${existingEntry.id}:${existingEntry.updatedAt}`
      : suggestion
        ? `suggestion:${effectiveTargetMemberId}:${weekStart}:${suggestion.sourceSnapshot.scheduleIds.join("|")}:${suggestion.sourceSnapshot.holidayDates.join("|")}`
        : null;
    if (!nextKey || nextKey === draftSourceKey) return;
    if (existingEntry) {
      setDraftBuckets(existingEntry.buckets);
      setDraftSourceKey(nextKey);
      return;
    }
    if (suggestion) {
      setDraftBuckets(suggestion.buckets);
      setDraftSourceKey(nextKey);
    }
  }, [draftSourceKey, effectiveTargetMemberId, existingEntry, suggestion, weekStart]);

  const validation = validateMmBuckets(draftBuckets);
  const editable = Boolean(effectiveTargetMemberId && canEditWeeklyMmInput({
    viewer: me,
    targetMemberId: effectiveTargetMemberId,
    status: existingEntry?.status,
  }));
  const submitLabel = existingEntry ? "갱신" : "저장";
  const statusLabel = existingEntry && existingEntry.status !== "draft" ? "제출완료" : "누락";
  const statusTone = statusLabel === "제출완료" ? "text-emerald-600 bg-emerald-50" : "text-red-600 bg-red-50";

  const memberOrg = useMemo(
    () => effectiveTargetMemberId
      ? organizations.find((org) => organizationMemberIdsById.get(org.organizationId)?.has(effectiveTargetMemberId)) ?? null
      : null,
    [effectiveTargetMemberId, organizationMemberIdsById, organizations],
  );
  const memberTeam = useMemo(
    () => effectiveTargetMemberId
      ? teams.find((team) => teamMemberIdsById.get(team.teamId)?.has(effectiveTargetMemberId)) ?? null
      : null,
    [effectiveTargetMemberId, teamMemberIdsById, teams],
  );

  function updateBucketRatio(id: string, value: string) {
    const next = percentToBp(Number(value));
    setDraftBuckets((prev) => prev.map((bucket) => (
      bucket.id === id ? { ...bucket, ratioBp: next } : bucket
    )));
  }

  async function handleSave() {
    if (!effectiveTargetMemberId || !suggestion || !validation.ok || !editable) return;
    setSaving(true);
    setError(null);
    try {
      await upsertEntry({
        workspaceId: LC_SCHEDULER_WORKSPACE_ID,
        memberId: effectiveTargetMemberId,
        weekStart,
        weekEnd: suggestion.weekEnd,
        buckets: draftBuckets,
        sourceSnapshot: suggestion.sourceSnapshot,
        organizationId: memberOrg?.organizationId ?? null,
        teamId: memberTeam?.teamId ?? null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "MM 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  if (!me || !shouldRenderButton) return null;

  return (
    <>
      {open && (
        <section className="fixed bottom-16 right-5 z-[620] w-[420px] rounded-lg border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
          <div className="border-b border-zinc-200 px-4 py-3 text-center dark:border-zinc-700">
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setWeekStart((v) => shiftMmWeek(v, -1))}
                className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label="이전 주"
              >
                <ChevronLeft size={18} />
              </button>
              <div>
                <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  {getMmWeekLabel(weekStart)}
                </h3>
                <p className="mt-0.5 text-xs text-zinc-400">{formatShortRange(weekStart)}</p>
                <span className={`mt-2 inline-flex rounded px-2 py-0.5 text-xs ${statusTone}`}>
                  {statusLabel}
                </span>
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
          </div>

          <div className="max-h-[70vh] space-y-3 overflow-y-auto p-4">
            <div className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
              {targetMember?.name ?? "구성원"}
            </div>

            {!editable && (
              <div className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                <Lock size={14} />
                편집 권한이 없거나 잠금된 주차입니다.
              </div>
            )}

            <div className="space-y-2">
              {draftBuckets.map((bucket) => (
                <div
                  key={bucket.id}
                  className={`rounded border px-3 py-2 ${
                    bucket.kind === "other"
                      ? "border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/60"
                      : "border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {bucket.label}
                      </p>
                      <p className="text-xs text-zinc-400">
                        {bucket.kind === "other" ? "자동 계산" : bucket.kind}
                      </p>
                    </div>
                    {bucket.editable ? (
                      <label className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.5}
                          value={formatPercent(bucket.ratioBp)}
                          onChange={(event) => updateBucketRatio(bucket.id, event.target.value)}
                          disabled={!editable}
                          className="w-20 rounded border border-zinc-200 px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-zinc-100 disabled:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        />
                        <span className="text-sm text-zinc-500">%</span>
                      </label>
                    ) : (
                      <div className="flex items-center gap-1 text-sm text-zinc-500">
                        <Lock size={13} />
                        {formatPercent(bucket.ratioBp)}%
                      </div>
                    )}
                  </div>
                  {bucket.kind === "other" && bucket.reasons && bucket.reasons.length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-zinc-500">이유 보기</summary>
                      <div className="mt-1 space-y-1">
                        {bucket.reasons.map((reason) => (
                          <div key={`${reason.date}:${reason.type}:${reason.label}`} className="flex justify-between rounded bg-white px-2 py-1 text-xs text-zinc-500 dark:bg-zinc-900">
                            <span>{reason.date} · {reason.label}</span>
                            <span>{formatPercent(reason.ratioBp)}%</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              ))}
            </div>

            {!validation.ok && (
              <div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-900 dark:bg-red-950/30">
                <AlertTriangle size={14} />
                {validation.message}
              </div>
            )}
            {error && (
              <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-900 dark:bg-red-950/30">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!validation.ok || !editable || saving}
              className="flex w-full items-center justify-center gap-2 rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Save size={15} />
              {saving ? "저장 중" : submitLabel}
            </button>
          </div>
        </section>
      )}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="fixed bottom-5 right-5 z-[620] h-8 w-[108px] rounded-md border border-zinc-200 bg-white text-xs font-semibold text-zinc-700 shadow-lg hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        {open ? "주간 MM 접기" : "주간 MM 열기"}
      </button>
    </>
  );
}
