import { useAuthStore } from "../../store/authStore";
import { useMemberStore } from "../../store/memberStore";

export function MyProfileSection() {
  const authState = useAuthStore((s) => s.state);
  const me = useMemberStore((s) => s.me);

  const email =
    me?.email ??
    (authState.status === "authenticated" ? authState.user.email : "");
  const name =
    me?.name ??
    (authState.status === "authenticated" ? authState.user.name ?? "" : "");
  const role = me?.workspaceRole ?? "member";

  return (
    <div className="space-y-2 text-xs text-zinc-700 dark:text-zinc-200">
      <h3 className="text-sm font-semibold">내 프로필</h3>
      <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-900">
        <p><span className="text-zinc-500">이름:</span> {name || "-"}</p>
        <p><span className="text-zinc-500">이메일:</span> {email || "-"}</p>
        <p><span className="text-zinc-500">권한:</span> {role}</p>
      </div>
    </div>
  );
}
