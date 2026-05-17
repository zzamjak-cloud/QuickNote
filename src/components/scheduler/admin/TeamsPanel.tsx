// 설정 모달 — 팀 활성/비활성 패널.
import { useState } from "react";
import { Check, Eye, EyeOff, Pencil, X } from "lucide-react";
import { useTeamStore } from "../../../store/teamStore";
import { useSchedulerFiltersStore } from "../../../store/schedulerFiltersStore";
import { updateTeamApi } from "../../../lib/sync/teamApi";
import { inferLeaderMemberIds } from "../../../lib/scheduler/mm/leaderDefaults";
import { LeaderMemberPicker } from "../mm/LeaderMemberPicker";

export function TeamsPanel() {
  const teams = useTeamStore((s) => s.teams);
  const upsertTeam = useTeamStore((s) => s.upsertTeam);
  const disabledTeamIds = useSchedulerFiltersStore((s) => s.disabledTeamIds);
  const toggleTeam = useSchedulerFiltersStore((s) => s.toggleTeam);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [leaderDraft, setLeaderDraft] = useState<string[]>([]);

  async function saveLeaders(teamId: string) {
    const updated = await updateTeamApi(teamId, undefined, leaderDraft);
    upsertTeam(updated);
    setEditingId(null);
  }

  if (teams.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-zinc-400">
        등록된 팀이 없습니다.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
        비활성화한 팀은 헤더 드롭다운에 표시되지 않습니다.
      </p>
      {teams.map((team) => {
        const isDisabled = disabledTeamIds.includes(team.teamId);
        return (
          <div key={team.teamId} className="rounded-md border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800">
            <div className="flex items-center justify-between px-3 py-2.5">
              <div className="min-w-0">
                <span
                  className={`block truncate text-sm font-medium ${
                    isDisabled
                      ? "text-zinc-400 dark:text-zinc-500 line-through"
                      : "text-zinc-900 dark:text-zinc-100"
                  }`}
                >
                  {team.name}
                </span>
                <span className="text-xs text-zinc-400">
                  팀장 {(team.leaderMemberIds ?? []).length}명
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(editingId === team.teamId ? null : team.teamId);
                    setLeaderDraft((team.leaderMemberIds?.length ? team.leaderMemberIds : inferLeaderMemberIds("team", team.members)) ?? []);
                  }}
                  title="팀장 편집"
                  className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                >
                  <Pencil size={15} className="text-zinc-500" />
                </button>
                <button
                  type="button"
                  onClick={() => toggleTeam(team.teamId)}
                  title={isDisabled ? "활성화" : "비활성화"}
                  className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                >
                  {isDisabled ? (
                    <EyeOff size={16} className="text-zinc-400" />
                  ) : (
                    <Eye size={16} className="text-amber-500" />
                  )}
                </button>
              </div>
            </div>
            {editingId === team.teamId && (
              <div className="space-y-3 border-t border-zinc-200 p-3 dark:border-zinc-700">
                <LeaderMemberPicker
                  label="팀장"
                  members={team.members}
                  value={leaderDraft}
                  recommendedIds={inferLeaderMemberIds("team", team.members)}
                  onChange={setLeaderDraft}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void saveLeaders(team.teamId)}
                    className="inline-flex items-center gap-1 rounded bg-amber-500 px-3 py-1.5 text-xs text-white hover:bg-amber-600"
                  >
                    <Check size={12} />
                    저장
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="inline-flex items-center gap-1 rounded border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-700"
                  >
                    <X size={12} />
                    취소
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
