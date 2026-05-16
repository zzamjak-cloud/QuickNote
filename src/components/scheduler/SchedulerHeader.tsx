// LC 스케줄러 헤더 — 뷰 모드 탭 + 조직/팀/프로젝트 선택 + 설정 버튼 + 닫기 버튼.
import { useState, useEffect } from "react";
import { Calendar, X, Settings } from "lucide-react";
import { useSchedulerViewStore } from "../../store/schedulerViewStore";
import { useOrganizationStore } from "../../store/organizationStore";
import { useTeamStore } from "../../store/teamStore";
import { useSchedulerFiltersStore } from "../../store/schedulerFiltersStore";
import { useSchedulerProjectsStore } from "../../store/schedulerProjectsStore";
import { useMemberStore } from "../../store/memberStore";
import { SchedulerSettingsModal } from "./SchedulerSettingsModal";

// 관리자 패널 접근 권한 — MANAGER 이상만 허용
const ADMIN_ROLES = new Set(["developer", "owner", "leader", "manager"]);

type Props = {
  onClose: () => void;
};

export function SchedulerHeader({ onClose }: Props) {
  const viewMode = useSchedulerViewStore((s) => s.viewMode);
  const setViewMode = useSchedulerViewStore((s) => s.setViewMode);
  const selectedProjectId = useSchedulerViewStore((s) => s.selectedProjectId);
  const setSelectedProjectId = useSchedulerViewStore((s) => s.setSelectedProjectId);

  const organizations = useOrganizationStore((s) => s.organizations);
  const teams = useTeamStore((s) => s.teams);

  // 필터 스토어: 비활성 조직/팀 목록
  const disabledOrgIds = useSchedulerFiltersStore((s) => s.disabledOrgIds);
  const disabledTeamIds = useSchedulerFiltersStore((s) => s.disabledTeamIds);

  // 프로젝트 스토어: 숨김 제외 목록
  const projects = useSchedulerProjectsStore((s) => s.projects);

  // 현재 로그인 멤버 — 권한 체크용
  const me = useMemberStore((s) => s.me);
  const canManage = !!me && ADMIN_ROLES.has(me.workspaceRole);

  // 설정 모달 표시 여부
  const [showSettings, setShowSettings] = useState(false);

  // 활성 조직/팀/프로젝트만 필터링
  const visibleOrgs = organizations.filter(
    (o) => !disabledOrgIds.includes(o.organizationId),
  );
  const visibleOrgNameSet = new Set(visibleOrgs.map((org) => org.name.trim()).filter(Boolean));
  const visibleTeams = teams.filter(
    (t) => !disabledTeamIds.includes(t.teamId) && !visibleOrgNameSet.has(t.name.trim()),
  );
  const visibleProjects = projects.filter((p) => !p.isHidden);

  // 선택값 없으면 첫 조직 → 첫 팀 → 첫 프로젝트 순으로 자동 선택
  useEffect(() => {
    if (selectedProjectId) return;
    if (visibleOrgs.length > 0 && visibleOrgs[0]) {
      setSelectedProjectId(`org:${visibleOrgs[0].organizationId}`);
    } else if (visibleTeams.length > 0 && visibleTeams[0]) {
      setSelectedProjectId(`team:${visibleTeams[0].teamId}`);
    } else if (visibleProjects.length > 0 && visibleProjects[0]) {
      setSelectedProjectId(`proj:${visibleProjects[0].id}`);
    }
  }, [
    selectedProjectId,
    visibleOrgs,
    visibleTeams,
    visibleProjects,
    setSelectedProjectId,
  ]);

  // 헤더 타이틀 계산
  const headerTitle = (() => {
    if (!selectedProjectId) return "LC 스케줄러";
    if (selectedProjectId.startsWith("org:")) {
      const id = selectedProjectId.slice(4);
      return organizations.find((o) => o.organizationId === id)?.name ?? "LC 스케줄러";
    }
    if (selectedProjectId.startsWith("team:")) {
      const id = selectedProjectId.slice(5);
      return teams.find((t) => t.teamId === id)?.name ?? "LC 스케줄러";
    }
    if (selectedProjectId.startsWith("proj:")) {
      const id = selectedProjectId.slice(5);
      return projects.find((p) => p.id === id)?.name ?? "LC 스케줄러";
    }
    return "LC 스케줄러";
  })();

  return (
    <>
      <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-6 py-3 flex items-center justify-between flex-shrink-0">
        {/* 좌측: 아이콘 + 타이틀 + 뷰 모드 탭 */}
        <div className="flex items-center gap-3 flex-wrap">
          <Calendar className="w-6 h-6 text-amber-500 shrink-0" />
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
              {headerTitle}
            </h1>
            <span className="text-sm text-zinc-500">일정</span>
          </div>
          {/* 뷰 모드 segmented control */}
          <div
            className="flex rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-100/40 dark:bg-zinc-800/40 p-0.5"
            role="tablist"
            aria-label="일정 보기 모드"
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "year"}
              onClick={() => setViewMode("year")}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                viewMode === "year"
                  ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              연간 보기
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "week"}
              onClick={() => setViewMode("week")}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                viewMode === "week"
                  ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              주간 보기
            </button>
          </div>
        </div>

        {/* 우측: 조직/팀/프로젝트 선택 + 설정 버튼 + 닫기 */}
        <div className="flex items-center gap-2">
          {/* 조직 / 팀 / 프로젝트 선택 드롭다운 */}
          <select
            value={selectedProjectId ?? ""}
            onChange={(e) => setSelectedProjectId(e.target.value || null)}
            className="px-2.5 py-1.5 text-xs border border-zinc-200 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700/60 focus:outline-none focus:ring-2 focus:ring-amber-400"
            aria-label="조직 또는 팀 선택"
          >
            {visibleOrgs.length > 0 && (
              <optgroup label="조직">
                {visibleOrgs.map((o) => (
                  <option key={o.organizationId} value={`org:${o.organizationId}`}>
                    {o.name}
                  </option>
                ))}
              </optgroup>
            )}
            {visibleTeams.length > 0 && (
              <optgroup label="팀">
                {visibleTeams.map((t) => (
                  <option key={t.teamId} value={`team:${t.teamId}`}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
            )}
            {visibleProjects.length > 0 && (
              <optgroup label="프로젝트">
                {visibleProjects.map((p) => (
                  <option key={p.id} value={`proj:${p.id}`}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>

          {/* 설정 버튼 — MANAGER 이상만 노출 */}
          {canManage && (
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              aria-label="스케줄러 설정"
              title="스케줄러 설정"
            >
              <Settings className="w-5 h-5" />
            </button>
          )}

          {/* 닫기 버튼 */}
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            aria-label="닫기"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* 설정 모달 — 권한 없는 경우 렌더 차단(방어) */}
      {showSettings && canManage && (
        <SchedulerSettingsModal onClose={() => setShowSettings(false)} />
      )}
    </>
  );
}
