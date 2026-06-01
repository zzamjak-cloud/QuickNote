import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Building, Building2, Download, Folder, HardDrive, User, Users, UsersRound, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import pkg from "../../../package.json";
import { useAuthStore } from "../../store/authStore";
import { useMemberStore } from "../../store/memberStore";
import { useSettingsStore } from "../../store/settingsStore";
import { MyProfileSection } from "./MyProfileSection";
import { AdminMembersTab } from "./AdminMembersTab";
import { AdminWorkspacesTab } from "./AdminWorkspacesTab";
import { AdminTeamsTab } from "./AdminTeamsTab";
import { AdminOrganizationsTab } from "./AdminOrganizationsTab";
import { ProjectsPanel } from "../scheduler/admin/ProjectsPanel";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../lib/scheduler/scope";
import { isWorkspaceMetaCacheFresh, refreshWorkspaceMeta } from "../../lib/sync/workspaceMetaCache";

// NotionImportTab 은 ~174KB 청크라 자주·전체 사용자가 쓰지 않으므로 lazy 유지.
// 클릭한 시점에만 다운로드된다.
const NotionImportTab = lazy(() =>
  import("./NotionImportTab").then((m) => ({ default: m.NotionImportTab })),
);

// AdminAssetsTab — 가상 스크롤 등 부수 의존이 있어 lazy.
const AdminAssetsTab = lazy(() =>
  import("./AdminAssetsTab").then((m) => ({ default: m.AdminAssetsTab })),
);

type Props = {
  open: boolean;
  onClose: () => void;
};

type TabId = "profile" | "notionImport" | "members" | "projects" | "teams" | "organizations" | "workspaces" | "assets";

type TabDef = { id: TabId; label: string; title: string; icon: LucideIcon };

export function SettingsModal({ open, onClose }: Props) {
  const signOut = useAuthStore((s) => s.signOut);
  const role = useMemberStore((s) => s.me?.workspaceRole ?? "member");
  const darkMode = useSettingsStore((s) => s.darkMode);
  const toggleDarkMode = useSettingsStore((s) => s.toggleDarkMode);
  const isAdmin = role === "developer" || role === "owner" || role === "leader" || role === "manager";
  const [tab, setTab] = useState<TabId>("profile");

  const tabs = useMemo(() => {
    const list: TabDef[] = [
      { id: "profile", label: "내 프로필", title: "내 프로필", icon: User },
    ];
    if (isAdmin) {
      list.push(
        { id: "members", label: "구성원", title: "구성원 관리", icon: Users },
        { id: "projects", label: "프로젝트", title: "프로젝트 관리", icon: Folder },
        { id: "teams", label: "팀", title: "팀 관리", icon: UsersRound },
        { id: "organizations", label: "조직", title: "조직 관리", icon: Building2 },
        { id: "workspaces", label: "워크스페이스", title: "워크스페이스 관리", icon: Building },
      );
    }
    // 자산 관리 — 본인의 모든 업로드 자산. 영구 삭제·페이지 본문 교체가 가능해
    // developer/owner 로 제한.
    if (role === "developer" || role === "owner") {
      list.push({ id: "assets", label: "자산", title: "자산 관리", icon: HardDrive });
    }
    // Notion 가져오기는 일회성·일부 사용자 전용 — 가장 하단 배치
    list.push({ id: "notionImport", label: "Notion 가져오기", title: "Notion 가져오기", icon: Download });
    return list;
  }, [isAdmin, role]);

  useEffect(() => {
    if (!open || !isAdmin) return;
    let cancelled = false;
    let inFlight = false;

    const refreshAdminMetadata = async (opts: { force?: boolean } = {}) => {
      if (cancelled || inFlight) return;
      if (!opts.force && isWorkspaceMetaCacheFresh(LC_SCHEDULER_WORKSPACE_ID)) return;
      inFlight = true;
      try {
        await refreshWorkspaceMeta(LC_SCHEDULER_WORKSPACE_ID, opts);
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
  }, [isAdmin, open]);

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
              {tab === "assets" && (role === "developer" || role === "owner") && (
                <AdminAssetsTab onClose={onClose} />
              )}
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
