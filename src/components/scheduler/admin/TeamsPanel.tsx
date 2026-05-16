// 설정 모달 — 팀 활성/비활성 패널.
import { Eye, EyeOff } from "lucide-react";
import { useTeamStore } from "../../../store/teamStore";
import { useSchedulerFiltersStore } from "../../../store/schedulerFiltersStore";

export function TeamsPanel() {
  const teams = useTeamStore((s) => s.teams);
  const disabledTeamIds = useSchedulerFiltersStore((s) => s.disabledTeamIds);
  const toggleTeam = useSchedulerFiltersStore((s) => s.toggleTeam);

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
          <div
            key={team.teamId}
            className="flex items-center justify-between px-3 py-2.5 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800"
          >
            <span
              className={`text-sm font-medium ${
                isDisabled
                  ? "text-zinc-400 dark:text-zinc-500 line-through"
                  : "text-zinc-900 dark:text-zinc-100"
              }`}
            >
              {team.name}
            </span>
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
        );
      })}
    </div>
  );
}
