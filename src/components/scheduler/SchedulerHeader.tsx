// LC 스케줄러 헤더 — 뷰 모드 탭 + 조직/팀/프로젝트 선택 + 설정 버튼 + 닫기 버튼.
import { useState, useEffect, useRef } from "react";
import { Calendar, X, Settings, ChevronDown, Check } from "lucide-react";
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
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false);
  const scopeMenuRef = useRef<HTMLDivElement>(null);
  const scopeListRefs = useRef<Record<string, HTMLDivElement | null>>({
    org: null,
    team: null,
    project: null,
  });
  const [scopeScrollHintByColumn, setScopeScrollHintByColumn] = useState<Record<string, boolean>>({
    org: false,
    team: false,
    project: false,
  });

  // 활성 조직/팀/프로젝트만 필터링
  const visibleOrgs = organizations.filter(
    (o) => !disabledOrgIds.includes(o.organizationId),
  );
  const visibleOrgNameSet = new Set(visibleOrgs.map((org) => org.name.trim()).filter(Boolean));
  const visibleTeams = teams.filter(
    (t) => !disabledTeamIds.includes(t.teamId) && !visibleOrgNameSet.has(t.name.trim()),
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
        ? visibleOrgs.find((org) => org.name.trim() === selectedTeam.name.trim())
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

  useEffect(() => {
    if (!scopeMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (scopeMenuRef.current?.contains(event.target as Node)) return;
      setScopeMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setScopeMenuOpen(false);
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [scopeMenuOpen]);

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

  const scopeColumns = [
    {
      key: "org",
      title: "조직",
      items: visibleOrgs.map((org) => ({
        id: org.organizationId,
        label: org.name,
        value: `org:${org.organizationId}`,
      })),
    },
    {
      key: "team",
      title: "팀",
      items: visibleTeams.map((team) => ({
        id: team.teamId,
        label: team.name,
        value: `team:${team.teamId}`,
      })),
    },
    {
      key: "project",
      title: "프로젝트",
      items: visibleProjects.map((project) => ({
        id: project.id,
        label: project.name,
        value: `proj:${project.id}`,
      })),
    },
  ];

  const handleSelectScope = (value: string) => {
    setSelectedProjectId(value || null);
    setScopeMenuOpen(false);
  };

  const updateScopeListHint = (columnKey: string) => {
    const list = scopeListRefs.current[columnKey];
    if (!list) return;
    const hasOverflow = list.scrollHeight > list.clientHeight + 2;
    const canScrollDown = list.scrollTop + list.clientHeight < list.scrollHeight - 2;
    const showHint = hasOverflow && canScrollDown;
    setScopeScrollHintByColumn((prev) =>
      prev[columnKey] === showHint ? prev : { ...prev, [columnKey]: showHint },
    );
  };

  useEffect(() => {
    if (!scopeMenuOpen) {
      setScopeScrollHintByColumn({ org: false, team: false, project: false });
      return;
    }
    const raf = window.requestAnimationFrame(() => {
      updateScopeListHint("org");
      updateScopeListHint("team");
      updateScopeListHint("project");
    });
    const onResize = () => {
      updateScopeListHint("org");
      updateScopeListHint("team");
      updateScopeListHint("project");
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [scopeMenuOpen, visibleOrgs.length, visibleTeams.length, visibleProjects.length]);

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

        {/* 우측: 조직/팀/프로젝트 선택 + 설정 버튼 + 닫기 */}
        <div className="flex items-center gap-2">
          {/* 조직 / 팀 / 프로젝트 선택 드롭다운 */}
          <div ref={scopeMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setScopeMenuOpen((open) => !open)}
              className="flex min-h-[32px] max-w-[260px] items-center gap-2 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm shadow-sm transition-colors hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-amber-400 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700/70"
              aria-haspopup="menu"
              aria-expanded={scopeMenuOpen}
              aria-label="조직, 팀 또는 프로젝트 선택"
            >
              <span className="min-w-0 truncate text-zinc-800 dark:text-zinc-100">{headerTitle}</span>
              <ChevronDown
                size={14}
                className={`shrink-0 text-zinc-500 transition-transform ${scopeMenuOpen ? "rotate-180" : ""}`}
              />
            </button>

            {scopeMenuOpen && (
              <div
                className="absolute right-0 top-full z-[720] mt-2 grid w-[680px] max-w-[calc(100vw-32px)] grid-cols-3 gap-0 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
                role="menu"
                aria-label="스케줄러 범위 선택"
              >
                {scopeColumns.map((column) => (
                  <div
                    key={column.key}
                    className="min-w-0 border-r border-zinc-100 p-2 last:border-r-0 dark:border-zinc-800"
                  >
                    <div className="mb-1.5 px-2 font-semibold text-zinc-500 dark:text-zinc-400">
                      {column.title}
                    </div>
                    <div className="relative">
                      <div
                        ref={(node) => {
                          scopeListRefs.current[column.key] = node;
                        }}
                        onScroll={() => updateScopeListHint(column.key)}
                        className="max-h-[420px] space-y-1 overflow-y-auto pb-6 pr-1"
                      >
                        {column.items.length === 0 ? (
                          <div className="px-2 py-2 text-zinc-400 dark:text-zinc-500">
                            없음
                          </div>
                        ) : (
                          column.items.map((item) => {
                            const selected = selectedProjectId === item.value;
                            return (
                              <button
                                key={item.id}
                                type="button"
                                role="menuitemradio"
                                aria-checked={selected}
                                onClick={() => handleSelectScope(item.value)}
                                className={`flex w-full min-w-0 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                                  selected
                                    ? "bg-blue-600 font-semibold text-white"
                                    : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                                }`}
                              >
                                <span className="truncate">{item.label}</span>
                                {selected ? <Check size={13} strokeWidth={2.6} className="shrink-0" /> : null}
                              </button>
                            );
                          })
                        )}
                      </div>
                      {scopeScrollHintByColumn[column.key] ? (
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-7 items-end justify-center bg-gradient-to-t from-white via-white/95 to-transparent pb-0.5 text-zinc-400 dark:from-zinc-900 dark:via-zinc-900/95 dark:text-zinc-500">
                          <ChevronDown size={15} />
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

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
