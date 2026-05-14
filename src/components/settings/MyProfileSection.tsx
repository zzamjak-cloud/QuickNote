import { useRef, useState } from "react";
import { useAuthStore } from "../../store/authStore";
import { useMemberStore } from "../../store/memberStore";
import { resizeAvatar } from "../../lib/images/resizeAvatar";
import { updateMemberApi } from "../../lib/sync/memberApi";

export function MyProfileSection() {
  const authState = useAuthStore((s) => s.state);
  const me = useMemberStore((s) => s.me);
  const upsertMember = useMemberStore((s) => s.upsertMember);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const email =
    me?.email ??
    (authState.status === "authenticated" ? authState.user.email : "");
  const name =
    me?.name ??
    (authState.status === "authenticated" ? authState.user.name ?? "" : "");
  const role = me?.workspaceRole ?? "member";
  const avatar = me?.avatarUrl ?? me?.thumbnailUrl ?? "";

  const handleAvatarFile = async (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/") || !me) return;
    setSaving(true);
    setError(null);
    try {
      const { avatar256, thumbnail64 } = await resizeAvatar(file);
      const updated = await updateMemberApi(me.memberId, {
        avatarUrl: avatar256,
        thumbnailUrl: thumbnail64,
      });
      upsertMember({ ...me, ...updated });
    } catch (err) {
      setError(err instanceof Error ? err.message : "사진 변경에 실패했습니다.");
    } finally {
      setSaving(false);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-3 text-xs text-zinc-700 dark:text-zinc-200">
      <h3 className="text-sm font-semibold">내 프로필</h3>
      <div className="w-full rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex flex-col items-center gap-1.5 border-b border-zinc-100 px-4 pb-3 pt-4 dark:border-zinc-800">
          <div className="relative">
            <div className="flex h-32 w-32 items-center justify-center overflow-hidden rounded-2xl border-2 border-zinc-200 bg-zinc-100 text-4xl dark:border-zinc-700 dark:bg-zinc-800">
              {avatar ? (
                <img src={avatar} className="h-full w-full object-cover" alt="" />
              ) : (
                "👤"
              )}
            </div>
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              disabled={!me || saving}
              className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-700 text-[10px] text-white hover:bg-zinc-500 disabled:opacity-50"
              title="사진 변경"
            >
              ✎
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void handleAvatarFile(e.target.files?.[0])}
            />
          </div>
          <div className="text-sm font-semibold">{name || "-"}</div>
          <div className="flex flex-wrap justify-center gap-1">
            {role !== "member" ? (
              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                {role === "owner" ? "Owner" : "Manager"}
              </span>
            ) : null}
            {me?.employmentStatus && me.employmentStatus !== "재직중" ? (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                {me.employmentStatus}
              </span>
            ) : null}
            {me?.department ? (
              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                {me.department}
              </span>
            ) : null}
            {me?.jobTitle ? (
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[9px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {me.jobTitle}
              </span>
            ) : null}
            {me?.jobRole ? (
              <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-[9px] text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300">
                {me.jobRole}
              </span>
            ) : null}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 p-4">
          <label className="block">
            <span className="mb-0.5 block text-[9px] font-medium text-zinc-500">이름</span>
            <input value={name || "-"} disabled className="w-full rounded border border-zinc-100 bg-zinc-50 px-2 py-1 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950" />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[9px] font-medium text-zinc-500">이메일</span>
            <input value={email || "-"} disabled className="w-full rounded border border-zinc-100 bg-zinc-50 px-2 py-1 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950" />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[9px] font-medium text-zinc-500">사번</span>
            <input value={me?.employeeNumber || "-"} disabled className="w-full rounded border border-zinc-100 bg-zinc-50 px-2 py-1 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950" />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[9px] font-medium text-zinc-500">재직 상태</span>
            <input value={me?.employmentStatus || "재직중"} disabled className="w-full rounded border border-zinc-100 bg-zinc-50 px-2 py-1 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950" />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[9px] font-medium text-zinc-500">소속(실)</span>
            <input value={me?.department || "-"} disabled className="w-full rounded border border-zinc-100 bg-zinc-50 px-2 py-1 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950" />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[9px] font-medium text-zinc-500">소속(팀)</span>
            <input value={me?.team || "-"} disabled className="w-full rounded border border-zinc-100 bg-zinc-50 px-2 py-1 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950" />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[9px] font-medium text-zinc-500">직책</span>
            <input value={me?.jobTitle || "-"} disabled className="w-full rounded border border-zinc-100 bg-zinc-50 px-2 py-1 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950" />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[9px] font-medium text-zinc-500">직무</span>
            <input value={me?.jobRole || "-"} disabled className="w-full rounded border border-zinc-100 bg-zinc-50 px-2 py-1 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950" />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[9px] font-medium text-zinc-500">직무 카테고리</span>
            <input value={me?.jobCategory || "-"} disabled className="w-full rounded border border-zinc-100 bg-zinc-50 px-2 py-1 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950" />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[9px] font-medium text-zinc-500">상세직무</span>
            <input value={me?.jobDetail || "-"} disabled className="w-full rounded border border-zinc-100 bg-zinc-50 px-2 py-1 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950" />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[9px] font-medium text-zinc-500">입사일</span>
            <input value={me?.joinedAt || "-"} disabled className="w-full rounded border border-zinc-100 bg-zinc-50 px-2 py-1 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950" />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[9px] font-medium text-zinc-500">권한</span>
            <input value={role} disabled className="w-full rounded border border-zinc-100 bg-zinc-50 px-2 py-1 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950" />
          </label>
          {error ? <p className="col-span-2 text-[11px] text-red-500">{error}</p> : null}
          {saving ? <p className="col-span-2 text-[11px] text-zinc-400">사진 저장 중...</p> : null}
        </div>
      </div>
    </div>
  );
}
