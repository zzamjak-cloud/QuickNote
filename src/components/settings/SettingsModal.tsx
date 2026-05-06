import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { useAuthStore } from "../../store/authStore";
import { useMemberStore } from "../../store/memberStore";
import { MyProfileSection } from "./MyProfileSection";
import { AdminMembersTab } from "./AdminMembersTab";
import { AdminTeamsTab } from "./AdminTeamsTab";
import { AdminWorkspacesTab } from "./AdminWorkspacesTab";

type Props = {
  open: boolean;
  onClose: () => void;
};

type TabId = "profile" | "members" | "teams" | "workspaces";

export function SettingsModal({ open, onClose }: Props) {
  const signOut = useAuthStore((s) => s.signOut);
  const role = useMemberStore((s) => s.me?.workspaceRole ?? "member");
  const isAdmin = role === "owner" || role === "manager";
  const [tab, setTab] = useState<TabId>("profile");

  const tabs = useMemo(() => {
    const base: Array<{ id: TabId; label: string }> = [{ id: "profile", label: "내 프로필" }];
    if (isAdmin) {
      base.push(
        { id: "members", label: "구성원" },
        { id: "teams", label: "팀" },
        { id: "workspaces", label: "워크스페이스" },
      );
    }
    return base;
  }, [isAdmin]);

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
        className="flex h-[min(86vh,820px)] w-full max-w-6xl overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-950"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <aside className="w-56 shrink-0 border-r border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
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
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={[
                  "w-full rounded px-2 py-1.5 text-left text-xs",
                  tab === t.id
                    ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
                ].join(" ")}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </aside>

        <section className="flex-1 overflow-y-auto p-6">
          {tab === "profile" && <MyProfileSection />}
          {tab === "members" && isAdmin && <AdminMembersTab />}
          {tab === "teams" && isAdmin && <AdminTeamsTab />}
          {tab === "workspaces" && isAdmin && <AdminWorkspacesTab />}

          {tab === "profile" ? (
            <div className="mt-6 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => void signOut()}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-900"
              >
                로그아웃
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

