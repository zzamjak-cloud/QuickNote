import { useState } from "react";
import type { Member } from "../../store/memberStore";
import { useWorkspaceOptionsStore } from "../../store/workspaceOptionsStore";
import {
  updateMemberApi,
  promoteToManagerApi,
  demoteToMemberApi,
  removeMemberApi,
} from "../../lib/sync/memberApi";

type CreateProps = {
  mode: "create";
  open: boolean;
  onClose: () => void;
  onCreate: (input: { email: string; name: string; jobRole: string }) => Promise<void>;
};

type EditProps = {
  mode: "edit";
  open: boolean;
  onClose: () => void;
  member: Member;
  onUpdated: (member: Member) => void;
  onRemoved: (memberId: string) => void;
};

type Props = CreateProps | EditProps;

// 드롭다운 + 직접 추가 서브컴포넌트
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
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newValue, setNewValue] = useState("");

  const handleAdd = () => {
    const v = newValue.trim();
    if (!v) return;
    onAdd(v);
    onChange(v);
    setNewValue("");
    setAdding(false);
  };

  return (
    <div>
      <div className="mb-0.5 text-[9px] font-medium text-zinc-500">{label}</div>
      <select
        value={value}
        onChange={(e) => {
          if (e.target.value === "__add__") setAdding(true);
          else onChange(e.target.value);
        }}
        className="w-full rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-950"
      >
        <option value="">선택</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        <option disabled>────────</option>
        <option value="__add__">+ 직접 추가...</option>
      </select>
      {adding && (
        <div className="mt-1 flex gap-1">
          <input
            autoFocus
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder="새 항목 입력..."
            className="flex-1 rounded border border-blue-400 px-2 py-1 text-xs outline-none"
          />
          <button
            type="button"
            onClick={handleAdd}
            className="rounded bg-zinc-900 px-2 py-1 text-xs text-white"
          >
            추가
          </button>
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="rounded border px-2 py-1 text-xs"
          >
            취소
          </button>
        </div>
      )}
      {value && options.includes(value) && (
        <button
          type="button"
          onClick={() => onRemove(value)}
          className="mt-0.5 text-[9px] text-red-400 hover:text-red-600"
        >
          "{value}" 항목 삭제
        </button>
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
        await props.onCreate({ email: email.trim(), name: name.trim(), jobRole });
        props.onClose();
      } else {
        // 1. 필드 업데이트
        let updated = await updateMemberApi(props.member.memberId, {
          name: name.trim(),
          jobRole: jobRole || null,
          jobTitle: jobTitle || null,
          phone: phone || null,
        });
        // 2. 역할 변경 (필요한 경우에만)
        const prevRole = initial?.workspaceRole;
        if (workspaceRole !== prevRole) {
          if (workspaceRole === "manager" && prevRole === "member") {
            updated = await promoteToManagerApi(props.member.memberId);
          } else if (workspaceRole === "member" && prevRole === "manager") {
            updated = await demoteToMemberApi(props.member.memberId);
          }
        }
        props.onUpdated({ ...props.member, ...updated });
        props.onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류가 발생했습니다.");
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
        className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* 상단 프로필 영역 */}
        <div className="flex flex-col items-center gap-1.5 border-b border-zinc-100 px-4 pb-3 pt-4 dark:border-zinc-800">
          <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-blue-200 bg-blue-100 text-2xl dark:border-blue-900 dark:bg-blue-950">
            {initial?.avatarUrl ? (
              <img
                src={initial.avatarUrl}
                className="h-full w-full rounded-full object-cover"
                alt=""
              />
            ) : (
              "👤"
            )}
          </div>
          {props.mode === "edit" ? (
            <>
              <div className="text-sm font-semibold">{name || initial?.name}</div>
              <div className="flex gap-1">
                {workspaceRole !== "member" && (
                  <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                    {workspaceRole === "owner" ? "Owner" : "Manager"}
                  </span>
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
                className="w-full rounded border border-zinc-300 px-2 py-1 outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-950"
              />
            </div>
            <div>
              <div className="mb-0.5 text-[9px] font-medium text-zinc-500">이메일</div>
              {props.mode === "create" ? (
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
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
              onAdd={addJobFunction}
              onRemove={removeJobFunction}
            />
            <DropdownWithAdd
              label="직책"
              value={jobTitle}
              options={jobTitles}
              onChange={setJobTitle}
              onAdd={addJobTitle}
              onRemove={removeJobTitle}
            />
            <div>
              <div className="mb-0.5 text-[9px] font-medium text-zinc-500">역할 (권한)</div>
              <select
                value={workspaceRole}
                onChange={(e) => setWorkspaceRole(e.target.value as Member["workspaceRole"])}
                disabled={isOwner}
                className="w-full rounded border border-zinc-300 px-2 py-1 dark:border-zinc-600 dark:bg-zinc-950 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isOwner && <option value="owner">Owner</option>}
                <option value="member">Member</option>
                <option value="manager">Manager</option>
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
            {props.mode === "edit" && !isOwner ? (
              <button
                type="button"
                onClick={() => void handleRemove()}
                disabled={submitting}
                className="rounded bg-red-50 px-3 py-1 text-xs text-red-600 hover:bg-red-100 dark:bg-red-950/30 dark:text-red-400 disabled:opacity-60"
              >
                구성원 제거
              </button>
            ) : (
              <span />
            )}
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
          </div>
        </div>
      </div>
    </div>
  );
}
