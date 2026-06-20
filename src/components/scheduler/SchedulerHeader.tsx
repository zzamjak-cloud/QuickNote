// LC 스케줄러 헤더 — 뷰 모드 탭 + 조직/팀/프로젝트 선택 + 설정 버튼 + 닫기 버튼.
import { useState, useEffect, useMemo } from "react";
import { Calendar, X, Settings, CalendarCheck } from "lucide-react";
import { useSchedulerViewStore } from "../../store/schedulerViewStore";
import { useOrganizationStore } from "../../store/organizationStore";
import { useTeamStore } from "../../store/teamStore";
import { useSchedulerFiltersStore } from "../../store/schedulerFiltersStore";
import { useSchedulerProjectsStore } from "../../store/schedulerProjectsStore";
import { useMemberStore } from "../../store/memberStore";
import { SchedulerSettingsModal } from "./SchedulerSettingsModal";
import { ScopeSelectDropdown } from "./common/ScopeSelectDropdown";

// 관리자 패널 접근 권한 — MANAGER 이상만 허용
const ADMIN_ROLES = new Set(["developer", "owner", "leader", "manager"]);

type Props = {
  onClose: () => void;
};

export function SchedulerHeader({ onClose }: Props) {
  const viewMode = useSchedulerViewStore((s) => s.viewMode);
  const setViewMode = useSchedulerViewStore((s) => s.setViewMode);
  const entityMode = useSchedulerViewStore((s) => s.entityMode);
  const setEntityMode = useSchedulerViewStore((s) => s.setEntityMode);
  const selectedProjectId = useSchedulerViewStore((s) => s.selectedProjectId);
  const setSelectedProjectId = useSchedulerViewStore((s) => s.setSelectedProjectId);
  const selectMember = useSchedulerViewStore((s) => s.selectMember);
  const setMultiSelected = useSchedulerViewStore((s) => s.setMultiSelected);

  const organizations = useOrganizationStore((s) => s.organizations);
  const teams = useTeamStore((s) => s.teams);

  // 필터 스토어: 비활성 조직/팀 목록
  const disabledOrgIds = useSchedulerFiltersStore((s) => s.disabledOrgIds);
  const disabledTeamIds = useSchedulerFiltersStore((s) => s.disabledTeamIds);

  // 프로젝트 스토어: 숨김 제외 목록
  const projects = useSchedulerProjectsStore((s) => s.projects);

  // 현재 로그인 멤버 — 권한 체크용
  const me = useMemberStore((s) => s.me);
  // 스케줄러 워크스페이스 멤버 목록 — "내일정" 식별(이메일 조인)용
  const schedulerMembers = useMemberStore((s) => s.members);
  const canManage = !!me && ADMIN_ROLES.has(me.workspaceRole);

  // 설정 모달 표시 여부
  const [showSettings, setShowSettings] = useState(false);

  // 활성 조직/팀/프로젝트만 필터링
  const visibleOrgs = organizations.filter(
    (o) => !disabledOrgIds.includes(o.organizationId),
  );
  const visibleOrgNameSet = new Set(visibleOrgs.map((org) => (org.name ?? "").trim()).filter(Boolean));
  const visibleTeams = teams.filter(
    (t) => !disabledTeamIds.includes(t.teamId) && !visibleOrgNameSet.has((t.name ?? "").trim()),
  );
  const visibleProjects = projects.filter((p) => !p.isHidden);

  const hasSelectedInVisibleOptions = (() => {
    if (!selectedProjectId) return false;
    if (selectedProjectId.startsWith("org:")) {
      const orgId = selectedProjectId.slice(4);
      return visibleOrgs.some((org) => org.organizationId === orgId);
    }
    if (selectedProjectId.startsWith("team:")) {
      const teamId = selectedProjectId.slice(5);
      return visibleTeams.some((team) => team.teamId === teamId);
    }
    if (selectedProjectId.startsWith("proj:")) {
      const projectId = selectedProjectId.slice(5);
      return visibleProjects.some((project) => project.id === projectId);
    }
    return false;
  })();

  // 선택값이 없거나 현재 옵션에서 사라진 경우, 첫 조직 → 첫 팀 → 첫 프로젝트 순으로 자동 보정
  useEffect(() => {
    if (selectedProjectId && hasSelectedInVisibleOptions) return;

    if (selectedProjectId?.startsWith("team:")) {
      const teamId = selectedProjectId.slice(5);
      const selectedTeam = teams.find((team) => team.teamId === teamId);
      const sameNamedOrg = selectedTeam
        ? visibleOrgs.find((org) => (org.name ?? "").trim() === (selectedTeam.name ?? "").trim())
        : null;
      if (sameNamedOrg) {
        setSelectedProjectId(`org:${sameNamedOrg.organizationId}`);
        return;
      }
    }

    if (visibleOrgs.length > 0 && visibleOrgs[0]) {
      setSelectedProjectId(`org:${visibleOrgs[0].organizationId}`);
    } else if (visibleTeams.length > 0 && visibleTeams[0]) {
      setSelectedProjectId(`team:${visibleTeams[0].teamId}`);
    } else if (visibleProjects.length > 0 && visibleProjects[0]) {
      setSelectedProjectId(`proj:${visibleProjects[0].id}`);
    }
  }, [
    selectedProjectId,
    hasSelectedInVisibleOptions,
    teams,
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

  const scopeOrganizations = useMemo(
    () =>
      visibleOrgs.map((org) => ({
        id: org.organizationId,
        label: org.name,
        value: `org:${org.organizationId}`,
      })),
    [visibleOrgs],
  );
  const scopeTeams = useMemo(
    () =>
      visibleTeams.map((team) => ({
        id: team.teamId,
        label: team.name,
        value: `team:${team.teamId}`,
      })),
    [visibleTeams],
  );
  const scopeProjects = useMemo(
    () =>
      visibleProjects.map((project) => ({
        id: project.id,
        label: project.name,
        value: `proj:${project.id}`,
      })),
    [visibleProjects],
  );

  // 스케줄러는 별도 워크스페이스라 me.memberId 가 스케줄러 멤버 ID 와 다를 수 있다.
  // 안정적인 조인 키인 이메일로 스케줄러 멤버를 찾아 "나"의 memberId 를 확정.
  const myMemberId = useMemo(() => {
    if (!me) return null;
    const byId = schedulerMembers.find((m) => m.memberId === me.memberId);
    if (byId) return byId.memberId;
    const myEmail = me.email?.trim().toLowerCase();
    if (myEmail) {
      const byEmail = schedulerMembers.find(
        (m) => m.email?.trim().toLowerCase() === myEmail,
      );
      if (byEmail) return byEmail.memberId;
    }
    return null;
  }, [me, schedulerMembers]);

  // 내가 속한 스코프 — 조직 우선, 없으면 팀(가시 항목 우선)
  const myScopeKey = useMemo(() => {
    if (!myMemberId) return null;
    const orgHit =
      visibleOrgs.find((o) => o.members.some((m) => m.memberId === myMemberId)) ??
      organizations.find((o) => o.members.some((m) => m.memberId === myMemberId));
    if (orgHit) return `org:${orgHit.organizationId}`;
    const teamHit =
      visibleTeams.find((t) => t.members.some((m) => m.memberId === myMemberId)) ??
      teams.find((t) => t.members.some((m) => m.memberId === myMemberId));
    if (teamHit) return `team:${teamHit.teamId}`;
    return null;
  }, [myMemberId, visibleOrgs, organizations, visibleTeams, teams]);

  // "내일정" — 내 스코프로 즉시 전환 + 내 구성원 탭 활성화
  const handleMySchedule = () => {
    if (!myMemberId) return;
    if (myScopeKey) setSelectedProjectId(myScopeKey);
    setMultiSelected([]);
    selectMember(myMemberId);
  };

  return (
    <>
      <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-6 py-3 flex items-center justify-between flex-shrink-0">
        {/* 좌측: 아이콘 + 타이틀 + 데이터 모드 + 뷰 모드 탭 */}
        <div className="flex items-center gap-3 flex-wrap">
          <Calendar className="w-6 h-6 text-amber-500 shrink-0" />
          {/* 제목 영역 = 조직/팀/프로젝트 선택 드롭다운 (선택값이 곧 제목) */}
          <div className="flex items-center gap-1">
            <ScopeSelectDropdown
              value={selectedProjectId ?? ""}
              onChange={(value) => setSelectedProjectId(value || null)}
              organizations={scopeOrganizations}
              teams={scopeTeams}
              projects={scopeProjects}
              align="left"
              ariaLabel="조직, 팀 또는 프로젝트 선택"
              placeholder={headerTitle}
              buttonClassName="max-w-[320px] !border-transparent !bg-transparent !shadow-none !px-2 !text-xl !font-bold hover:!bg-zinc-100 dark:hover:!bg-zinc-800"
              menuClassName="w-[920px] max-w-[calc(100vw-24px)]"
              listMaxHeightClass="max-h-[560px]"
            />
            <span className="text-sm text-zinc-500">일정</span>
          </div>
          <div
            className="flex rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-100/40 dark:bg-zinc-800/40 p-0.5"
            role="tablist"
            aria-label="일정 데이터 모드"
          >
            {[
              ["milestone", "마일스톤"],
              ["feature", "피처"],
              ["task", "작업"],
            ].map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={entityMode === mode}
                onClick={() => setEntityMode(mode as typeof entityMode)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                  entityMode === mode
                    ? "bg-green-600 text-white shadow-sm"
                    : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                }`}
              >
                {label}
              </button>
            ))}
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
                  ? "bg-green-600 text-white shadow-sm"
                  : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              연간
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "month"}
              onClick={() => setViewMode("month")}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                viewMode === "month"
                  ? "bg-green-600 text-white shadow-sm"
                  : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              월간
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === "week"}
              onClick={() => setViewMode("week")}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                viewMode === "week"
                  ? "bg-green-600 text-white shadow-sm"
                  : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              주간
            </button>
          </div>
        </div>

        {/* 우측: 내일정 + 설정 버튼 + 닫기 */}
        <div className="flex items-center gap-2">
          {/* 내일정 — 내 조직 + 내 구성원 탭으로 즉시 이동 */}
          {myMemberId && (
            <button
              type="button"
              onClick={handleMySchedule}
              className="flex items-center gap-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2.5 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-200 shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-700/70 transition-colors"
              aria-label="내일정"
              title="내 조직의 내 일정으로 이동"
            >
              <CalendarCheck className="w-4 h-4" />
              내일정
            </button>
          )}

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
