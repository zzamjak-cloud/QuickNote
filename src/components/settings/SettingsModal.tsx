import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Building, Building2, Download, Folder, User, Users, UsersRound, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import pkg from "../../../package.json";
import { useAuthStore } from "../../store/authStore";
import { useMemberStore } from "../../store/memberStore";
import { useSettingsStore } from "../../store/settingsStore";
import { MyProfileSection } from "./MyProfileSection";
import { AdminMembersTab } from "./AdminMembersTab";
import { AdminWorkspacesTab } from "./AdminWorkspacesTab";
import { ProjectsPanel } from "../scheduler/admin/ProjectsPanel";
import { listTeamsApi } from "../../lib/sync/teamApi";
import { listOrganizationsApi } from "../../lib/sync/organizationApi";
import { useTeamStore } from "../../store/teamStore";
import { useOrganizationStore } from "../../store/organizationStore";
import { useSchedulerProjectsStore } from "../../store/schedulerProjectsStore";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../lib/scheduler/scope";

const AdminTeamsTab = lazy(() =>
  import("./AdminTeamsTab").then((m) => ({ default: m.AdminTeamsTab })),
);
const AdminOrganizationsTab = lazy(() =>
  import("./AdminOrganizationsTab").then((m) => ({ default: m.AdminOrganizationsTab })),
);
const NotionImportTab = lazy(() =>
  import("./NotionImportTab").then((m) => ({ default: m.NotionImportTab })),
);

type Props = {
  open: boolean;
  onClose: () => void;
};

type TabId = "profile" | "notionImport" | "members" | "projects" | "teams" | "organizations" | "workspaces";

type TabDef = { id: TabId; label: string; title: string; icon: LucideIcon };

export function SettingsModal({ open, onClose }: Props) {
  const signOut = useAuthStore((s) => s.signOut);
  const role = useMemberStore((s) => s.me?.workspaceRole ?? "member");
  const darkMode = useSettingsStore((s) => s.darkMode);
  const toggleDarkMode = useSettingsStore((s) => s.toggleDarkMode);
  const setTeams = useTeamStore((s) => s.setTeams);
  const setOrganizations = useOrganizationStore((s) => s.setOrganizations);
  const fetchProjects = useSchedulerProjectsStore((s) => s.fetchProjects);
  const isAdmin = role === "developer" || role === "owner" || role === "leader" || role === "manager";
  const [tab, setTab] = useState<TabId>("profile");

  const tabs = useMemo(() => {
    const base: TabDef[] = [
      { id: "profile", label: "내 프로필", title: "내 프로필", icon: User },
      { id: "notionImport", label: "Notion 가져오기", title: "Notion 가져오기", icon: Download },
    ];
    if (isAdmin) {
      base.push(
        { id: "members", label: "구성원", title: "구성원 관리", icon: Users },
        { id: "projects", label: "프로젝트", title: "프로젝트 관리", icon: Folder },
        { id: "teams", label: "팀", title: "팀 관리", icon: UsersRound },
        { id: "organizations", label: "조직", title: "조직 관리", icon: Building2 },
        { id: "workspaces", label: "워크스페이스", title: "워크스페이스 관리", icon: Building },
      );
    }
    return base;
  }, [isAdmin]);

  useEffect(() => {
    if (!open || !isAdmin) return;
    let cancelled = false;
    let inFlight = false;

    const refreshAdminMetadata = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const [teams, organizations] = await Promise.all([
          listTeamsApi(),
          listOrganizationsApi(),
          fetchProjects(LC_SCHEDULER_WORKSPACE_ID),
        ]);
        if (cancelled) return;
        setTeams(teams, LC_SCHEDULER_WORKSPACE_ID);
        setOrganizations(organizations, LC_SCHEDULER_WORKSPACE_ID);
      } catch (error) {
        console.error("[SettingsModal] 조직/팀/프로젝트 동기화 실패", error);
      } finally {
        inFlight = false;
      }
    };

    const handleFocus = () => {
      void refreshAdminMetadata();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      void refreshAdminMetadata();
    };

    void refreshAdminMetadata();
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fetchProjects, isAdmin, open, setOrganizations, setTeams]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center bg-black/45 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        className="relative flex h-[min(86vh,820px)] w-full max-w-6xl overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-950"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 id="settings-modal-title" className="text-sm font-semibold">설정</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800"
              aria-label="설정 닫기"
            >
              <X size={14} />
            </button>
          </div>
          <nav className="space-y-1">
            {tabs.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={[
                    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm",
                    tab === t.id
                      ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100"
                      : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
                  ].join(" ")}
                >
                  <Icon size={15} className="shrink-0" />
                  {t.label}
                </button>
              );
            })}
          </nav>
          <div className="mt-auto space-y-1 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <button
              type="button"
              onClick={toggleDarkMode}
              className="flex w-full items-center justify-between rounded-md px-2 py-2 text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
              aria-pressed={darkMode}
            >
              <span>{darkMode ? "다크" : "라이트"}</span>
              <span
                className={[
                  "relative h-5 w-10 rounded-full transition",
                  darkMode ? "bg-zinc-700" : "bg-zinc-300",
                ].join(" ")}
              >
                <span
                  className={[
                    "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition",
                    darkMode ? "left-5" : "left-0.5",
                  ].join(" ")}
                />
              </span>
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
              className="w-full rounded-md px-2 py-2 text-left text-xs text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              로그아웃
            </button>
          </div>
        </aside>

        <section className="flex flex-1 flex-col overflow-hidden">
          {(() => {
            const cur = tabs.find((t) => t.id === tab);
            if (!cur) return null;
            const Icon = cur.icon;
            return (
              <div className="flex h-14 shrink-0 items-center gap-3 border-b border-zinc-100 px-6 dark:border-zinc-800">
                <Icon size={22} className="shrink-0 text-zinc-500 dark:text-zinc-400" />
                <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">{cur.title}</h2>
              </div>
            );
          })()}
          <div className="flex-1 overflow-y-auto p-6">
            <Suspense fallback={null}>
              {tab === "profile" && <MyProfileSection />}
              {tab === "notionImport" && <NotionImportTab />}
              {tab === "members" && isAdmin && <AdminMembersTab />}
              {tab === "projects" && isAdmin && <ProjectsPanel />}
              {tab === "teams" && isAdmin && <AdminTeamsTab />}
              {tab === "organizations" && isAdmin && <AdminOrganizationsTab />}
              {tab === "workspaces" && isAdmin && <AdminWorkspacesTab />}
            </Suspense>
          </div>
        </section>

        <p
          className="pointer-events-none absolute bottom-3 right-4 text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500"
          aria-label={`앱 버전 ${pkg.version}`}
        >
          v{pkg.version}
        </p>
      </div>
    </div>
  );
}
