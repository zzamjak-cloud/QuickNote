import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import type { Member } from "../../store/memberStore";
import { useWorkspaceOptionsStore } from "../../store/workspaceOptionsStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import {
  updateMemberApi,
  promoteToManagerApi,
  demoteToMemberApi,
  setMemberRoleApi,
  removeMemberApi,
  restoreMemberApi,
} from "../../lib/sync/memberApi";
import { updateWorkspaceOptionsApi } from "../../lib/sync/workspaceApi";
import { resizeAvatar } from "../../lib/images/resizeAvatar";

type CreateProps = {
  mode: "create";
  open: boolean;
  onClose: () => void;
  onCreate: (input: { email: string; name: string; jobRole: string; workspaceRole: Member["workspaceRole"] }) => Promise<void>;
};

type EditProps = {
  mode: "edit";
  open: boolean;
  onClose: () => void;
  member: Member;
  onUpdated: (member: Member) => void;
  onRemoved: (memberId: string) => void;
  archived?: boolean; // 보관함 모드
  onRestored?: (member: Member) => void;
};

type Props = CreateProps | EditProps;

// 드롭다운 + 직접 추가 서브컴포넌트 (옵션별 삭제 버튼, 알파벳 정렬)
function DropdownWithAdd({
  label,
  value,
  options,
  onChange,
  onAdd,
  onRemove,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  onAdd: (v: string) => void | Promise<void>;
  onRemove: (v: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newValue, setNewValue] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const sorted = [...options].sort((a, b) => a.localeCompare(b, "ko"));

  const handleAdd = () => {
    const v = newValue.trim();
    if (!v) return;
    onAdd(v);
    onChange(v);
    setNewValue("");
    setAdding(false);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative">
      <div className="mb-0.5 text-[9px] font-medium text-zinc-500">{label}</div>
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); setAdding(false); }}
        className="flex w-full items-center justify-between rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-950"
      >
        <span className={value ? "" : "text-zinc-400"}>{value || "선택"}</span>
        <ChevronDown size={10} className="text-zinc-400" />
      </button>
      {open && (
        <div className="absolute z-30 mt-0.5 w-full rounded border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <div className="max-h-36 overflow-y-auto">
            <button
              type="button"
              onClick={() => { onChange(""); setOpen(false); }}
              className="w-full px-2 py-1 text-left text-xs text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              선택 안 함
            </button>
            {sorted.map((o) => (
              <div key={o} className="flex items-center hover:bg-zinc-50 dark:hover:bg-zinc-800">
                <button
                  type="button"
                  onClick={() => { onChange(o); setOpen(false); }}
                  className={`flex-1 px-2 py-1 text-left text-xs ${value === o ? "font-semibold" : ""}`}
                >
                  {o}
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void onRemove(o); }}
                  className="px-1.5 py-1 text-[10px] text-zinc-300 hover:text-red-500"
                  title="삭제"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div className="border-t border-zinc-100 dark:border-zinc-800">
            {adding ? (
              <div className="flex gap-1 p-1">
                <input
                  autoFocus
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                  placeholder="새 항목..."
                  className="flex-1 rounded border border-blue-400 px-1.5 py-0.5 text-xs outline-none dark:bg-zinc-950"
                />
                <button
                  type="button"
                  onClick={handleAdd}
                  className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-white dark:bg-zinc-100 dark:text-zinc-900"
                >
                  추가
                </button>
                <button
                  type="button"
                  onClick={() => setAdding(false)}
                  className="rounded border px-1.5 py-0.5 text-[10px]"
                >
                  취소
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="w-full px-2 py-1 text-left text-[10px] text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                + 직접 추가...
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function MemberModal(props: Props) {
  const jobFunctions = useWorkspaceOptionsStore((s) => s.jobFunctions);
  const jobTitles = useWorkspaceOptionsStore((s) => s.jobTitles);
  const addJobFunction = useWorkspaceOptionsStore((s) => s.addJobFunction);
  const removeJobFunction = useWorkspaceOptionsStore((s) => s.removeJobFunction);
  const addJobTitle = useWorkspaceOptionsStore((s) => s.addJobTitle);
  const removeJobTitle = useWorkspaceOptionsStore((s) => s.removeJobTitle);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);

  const initial = props.mode === "edit" ? props.member : null;

  const [email, setEmail] = useState(initial?.email ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [jobRole, setJobRole] = useState(initial?.jobRole ?? "");
  const [jobTitle, setJobTitle] = useState(initial?.jobTitle ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [workspaceRole, setWorkspaceRole] = useState<Member["workspaceRole"]>(
    initial?.workspaceRole ?? "member",
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 아바타 미리보기 (편집 모드 초기값은 기존 URL)
  const [avatarPreview, setAvatarPreview] = useState<string | undefined>(
    props.mode === "edit" ? props.member.avatarUrl ?? undefined : undefined,
  );
  const [thumbnailPreview, setThumbnailPreview] = useState<string | undefined>(
    props.mode === "edit" ? props.member.thumbnailUrl ?? undefined : undefined,
  );
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // 편집 모드에서 변경 여부 확인
  const dirty =
    props.mode === "create"
      ? true
      : name !== (initial?.name ?? "") ||
        jobRole !== (initial?.jobRole ?? "") ||
        jobTitle !== (initial?.jobTitle ?? "") ||
        phone !== (initial?.phone ?? "") ||
        workspaceRole !== (initial?.workspaceRole ?? "member");

  if (!props.open) return null;

  const isArchived = props.mode === "edit" && props.archived === true;

  // 아바타 파일 선택 시 리사이즈 처리
  const handleAvatarFile = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const { avatar256, thumbnail64 } = await resizeAvatar(file);
    setAvatarPreview(avatar256);
    setThumbnailPreview(thumbnail64);
  };

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      if (props.mode === "create") {
        if (!email.trim() || !name.trim()) {
          setError("이름과 이메일은 필수입니다.");
          setSubmitting(false);
          return;
        }
        await props.onCreate({ email: email.trim(), name: name.trim(), jobRole, workspaceRole });
        props.onClose();
      } else {
        // 1. 필드 업데이트
        let updated = await updateMemberApi(props.member.memberId, {
          name: name.trim(),
          jobRole: jobRole || null,
          jobTitle: jobTitle || null,
          phone: phone || null,
          avatarUrl: avatarPreview ?? null,
          thumbnailUrl: thumbnailPreview ?? null,
        });
        // 2. 역할 변경 (필요한 경우에만)
        const prevRole = initial?.workspaceRole;
        if (workspaceRole !== prevRole) {
          if (workspaceRole === "manager" && prevRole === "member") {
            updated = await promoteToManagerApi(props.member.memberId);
          } else if (workspaceRole === "member" && prevRole === "manager") {
            updated = await demoteToMemberApi(props.member.memberId);
          } else if (workspaceRole && workspaceRole !== "owner" && workspaceRole !== "developer") {
            updated = await setMemberRoleApi(props.member.memberId, workspaceRole);
          }
        }
        props.onUpdated({ ...props.member, ...updated });
        props.onClose();
      }
    } catch (e) {
      if (e instanceof Error) {
        setError(e.message);
      } else if (e && typeof e === "object" && "errors" in e) {
        const gqlErrors = (e as { errors: Array<{ message?: string }> }).errors;
        setError(gqlErrors[0]?.message ?? "오류가 발생했습니다.");
      } else {
        setError("오류가 발생했습니다.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = async () => {
    if (props.mode !== "edit") return;
    setSubmitting(true);
    try {
      await removeMemberApi(props.member.memberId);
      props.onRemoved(props.member.memberId);
      props.onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "제거에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRestore = async () => {
    if (props.mode !== "edit" || !props.onRestored) return;
    setSubmitting(true);
    try {
      const restored = await restoreMemberApi(props.member.memberId);
      props.onRestored(restored);
      props.onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "복원에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const isOwner = workspaceRole === "owner";

  return (
    <div
      className="fixed inset-0 z-[520] flex items-center justify-center bg-black/45 p-4"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* 상단 프로필 영역 */}
        <div className="flex flex-col items-center gap-1.5 border-b border-zinc-100 px-4 pb-3 pt-4 dark:border-zinc-800">
          <div className="relative">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-blue-200 bg-blue-100 text-2xl dark:border-blue-900 dark:bg-blue-950">
              {avatarPreview ? (
                <img
                  src={avatarPreview}
                  className="h-full w-full rounded-full object-cover"
                  alt=""
                />
              ) : (
                "👤"
              )}
            </div>
            {props.mode === "edit" && (
              <>
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-700 text-[10px] text-white hover:bg-zinc-500"
                  title="사진 변경"
                >
                  ✎
                </button>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleAvatarFile(f);
                  }}
                />
              </>
            )}
          </div>
          {props.mode === "edit" ? (
            <>
              <div className="text-sm font-semibold">{name || initial?.name}</div>
              <div className="flex gap-1">
                {workspaceRole === "developer" && (
                  <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[9px] text-purple-700 dark:bg-purple-900 dark:text-purple-300">Developer</span>
                )}
                {workspaceRole === "owner" && (
                  <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] text-blue-700 dark:bg-blue-900 dark:text-blue-300">Owner</span>
                )}
                {workspaceRole === "leader" && (
                  <span className="rounded bg-green-100 px-1.5 py-0.5 text-[9px] text-green-700 dark:bg-green-900 dark:text-green-300">Leader</span>
                )}
                {workspaceRole === "manager" && (
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[9px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">Manager</span>
                )}
                {jobTitle && (
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[9px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {jobTitle}
                  </span>
                )}
                {jobRole && (
                  <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-[9px] text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300">
                    {jobRole}
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className="text-sm font-semibold text-zinc-400">새 구성원</div>
          )}
        </div>

        {/* 폼 영역 */}
        <div className="p-4">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="mb-0.5 text-[9px] font-medium text-zinc-500">이름 *</div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="이름"
                className="w-full rounded border border-zinc-300 px-2 py-1 outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-950"
              />
            </div>
            <div>
              <div className="mb-0.5 text-[9px] font-medium text-zinc-500">이메일</div>
              {props.mode === "create" ? (
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="이메일"
                  className="w-full rounded border border-zinc-300 px-2 py-1 outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-950"
                />
              ) : (
                <input
                  value={initial?.email ?? ""}
                  disabled
                  className="w-full rounded border border-zinc-100 bg-zinc-50 px-2 py-1 text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900"
                />
              )}
            </div>
            <DropdownWithAdd
              label="직무"
              value={jobRole}
              options={jobFunctions}
              onChange={setJobRole}
              onAdd={async (v) => {
                addJobFunction(v);
                if (currentWorkspaceId) {
                  await updateWorkspaceOptionsApi(currentWorkspaceId, {
                    jobFunctions: useWorkspaceOptionsStore.getState().jobFunctions,
                  });
                }
              }}
              onRemove={async (v) => {
                removeJobFunction(v);
                if (currentWorkspaceId) {
                  await updateWorkspaceOptionsApi(currentWorkspaceId, {
                    jobFunctions: useWorkspaceOptionsStore.getState().jobFunctions,
                  });
                }
              }}
            />
            <DropdownWithAdd
              label="직책"
              value={jobTitle}
              options={jobTitles}
              onChange={setJobTitle}
              onAdd={async (v) => {
                addJobTitle(v);
                if (currentWorkspaceId) {
                  await updateWorkspaceOptionsApi(currentWorkspaceId, {
                    jobTitles: useWorkspaceOptionsStore.getState().jobTitles,
                  });
                }
              }}
              onRemove={async (v) => {
                removeJobTitle(v);
                if (currentWorkspaceId) {
                  await updateWorkspaceOptionsApi(currentWorkspaceId, {
                    jobTitles: useWorkspaceOptionsStore.getState().jobTitles,
                  });
                }
              }}
            />
            <div>
              <div className="mb-0.5 text-[9px] font-medium text-zinc-500">역할 (권한)</div>
              <select
                value={workspaceRole}
                onChange={(e) => setWorkspaceRole(e.target.value as Member["workspaceRole"])}
                disabled={isOwner || workspaceRole === "developer"}
                className="w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-600 dark:bg-zinc-950 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {workspaceRole === "developer" && <option value="developer">Developer</option>}
                {workspaceRole === "owner" ? (
                  <option value="owner">Owner</option>
                ) : (
                  <>
                    <option value="owner">Owner</option>
                    <option value="leader">Leader</option>
                    <option value="manager">Manager</option>
                    <option value="member">Member</option>
                  </>
                )}
              </select>
            </div>
            <div>
              <div className="mb-0.5 text-[9px] font-medium text-zinc-500">연락처</div>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="010-0000-0000"
                className="w-full rounded border border-zinc-300 px-2 py-1 outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-950"
              />
            </div>
          </div>

          {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

          <div className="mt-3 flex items-center justify-between">
            {isArchived ? (
              /* 보관함 모드: 구성원으로 이동 */
              <button
                type="button"
                onClick={() => void handleRestore()}
                disabled={submitting}
                className="rounded bg-blue-50 px-3 py-1 text-xs text-blue-600 hover:bg-blue-100 dark:bg-blue-950/30 dark:text-blue-400 disabled:opacity-60"
              >
                구성원으로 이동
              </button>
            ) : (
              /* 일반 편집 모드: 보관함으로 이동 */
              props.mode === "edit" && !isOwner ? (
                <button
                  type="button"
                  onClick={() => void handleRemove()}
                  disabled={submitting}
                  className="rounded bg-red-50 px-3 py-1 text-xs text-red-600 hover:bg-red-100 dark:bg-red-950/30 dark:text-red-400 disabled:opacity-60"
                >
                  보관함으로 이동
                </button>
              ) : (
                <span />
              )
            )}
            {!isArchived && (
              <div className="flex gap-2">
                <button type="button" onClick={props.onClose} className="rounded border px-3 py-1 text-xs">
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => void handleSubmit()}
                  disabled={submitting || (props.mode === "edit" && !dirty)}
                  className="rounded bg-zinc-900 px-3 py-1 text-xs text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  {submitting ? "처리 중..." : props.mode === "create" ? "추가" : "갱신"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
