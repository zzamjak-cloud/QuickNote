import { LogOut } from "lucide-react";
import { useAuthStore } from "../../store/authStore";
import { MenuBase, type MenuItem } from "../../lib/ui-primitives";

export function UserMenu() {
  const state = useAuthStore((s) => s.state);
  const signOut = useAuthStore((s) => s.signOut);

  if (state.status !== "authenticated") return null;
  const { user } = state;

  const initial =
    user.name?.[0]?.toUpperCase() ?? user.email[0]?.toUpperCase() ?? "?";

  const items: MenuItem[] = [
    {
      id: "sign-out",
      label: (
        <>
          <LogOut size={14} />
          로그아웃
        </>
      ),
      onSelect: () => void signOut(),
    },
  ];

  return (
    <MenuBase
      width={224}
      items={items}
      header={
        <div className="px-3 py-2">
          <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {user.name ?? user.email}
          </div>
          {user.name && (
            <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {user.email}
            </div>
          )}
        </div>
      }
      trigger={({ buttonRef, toggle }) => (
        <button
          ref={buttonRef}
          type="button"
          onClick={() => toggle(224)}
          className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-zinc-200 text-xs font-medium text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600"
          aria-label="사용자 메뉴"
          title={user.email}
        >
          {user.picture ? (
            <img src={user.picture} alt="" className="h-full w-full object-cover" />
          ) : (
            initial
          )}
        </button>
      )}
    />
  );
}
