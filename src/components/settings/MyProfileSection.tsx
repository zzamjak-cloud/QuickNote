import { useRef, useState } from "react";
import { useAuthStore } from "../../store/authStore";
import { useMemberStore } from "../../store/memberStore";
import { resizeAvatar } from "../../lib/images/resizeAvatar";
import { updateMemberApi } from "../../lib/sync/memberApi";

function ProfileField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-[2rem] items-center gap-3 border-b border-zinc-100 py-3 dark:border-zinc-800">
      <span className="w-24 shrink-0 text-sm text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-100">{value}</span>
    </div>
  );
}

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
    <div className="space-y-4 text-sm text-zinc-700 dark:text-zinc-200">
      {/* 아바타 영역 */}
      <div className="flex items-center gap-4 pb-4">
        <div className="relative shrink-0">
          <div className="flex h-32 w-32 items-center justify-center overflow-hidden rounded-2xl border-2 border-zinc-200 bg-zinc-100 text-5xl dark:border-zinc-700 dark:bg-zinc-800">
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
        <div>
          <div className="text-base font-semibold">{name || "-"}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {role !== "member" ? (
              <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                {{ owner: "Owner", developer: "Developer", leader: "Leader", manager: "Manager", member: "Member" }[role] ?? role}
              </span>
            ) : null}
            {me?.employmentStatus && me.employmentStatus !== "재직중" ? (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                {me.employmentStatus}
              </span>
            ) : null}
            {me?.department ? (
              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                {me.department}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* 3단 컬럼 필드 목록 */}
      <div className="grid grid-cols-1 gap-x-8 md:grid-cols-3">
        <ProfileField label="이름" value={name || "-"} />
        <ProfileField label="이메일" value={email || "-"} />
        <ProfileField label="권한" value={role} />
        <ProfileField label="사번" value={me?.employeeNumber || "-"} />
        <ProfileField label="재직 상태" value={me?.employmentStatus || "재직중"} />
        <ProfileField label="입사일" value={me?.joinedAt || "-"} />
        <ProfileField label="소속(실)" value={me?.department || "-"} />
        <ProfileField label="소속(팀)" value={me?.team || "-"} />
        <ProfileField label="직책" value={me?.jobTitle || "-"} />
        <ProfileField label="직무" value={me?.jobRole || "-"} />
        <ProfileField label="직무 카테고리" value={me?.jobCategory || "-"} />
        <ProfileField label="상세직무" value={me?.jobDetail || "-"} />
      </div>

      {error ? <p className="text-sm text-red-500">{error}</p> : null}
      {saving ? <p className="text-sm text-zinc-400">사진 저장 중...</p> : null}
    </div>
  );
}
