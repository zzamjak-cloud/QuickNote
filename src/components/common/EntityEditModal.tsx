import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { IconPicker } from "./IconPicker";
import { MemberSearchPopup } from "./MemberSearchPopup";
import type { Member } from "../../store/memberStore";

type Props = {
  name: string;
  onNameChange: (name: string) => void;
  icon: string | null;
  onIconChange: (icon: string | null) => void;
  description: string;
  onDescriptionChange: (desc: string) => void;
  descriptionPlaceholder: string;
  selectedMembers: Member[];
  allMembers: Member[];
  leaderMemberIds: string[];
  onToggleLeader: (memberId: string) => void;
  onAddMember: (memberId: string) => void;
  onRemoveMember: (memberId: string) => void;
  onSave: () => void | Promise<void>;
  onArchive?: () => void | Promise<void>;
  onCancel: () => void;
  saving?: boolean;
};

export function EntityEditModal({
  name,
  onNameChange,
  icon,
  onIconChange,
  description,
  onDescriptionChange,
  descriptionPlaceholder,
  selectedMembers,
  allMembers,
  leaderMemberIds,
  onToggleLeader,
  onAddMember,
  onRemoveMember,
  onSave,
  onArchive,
  onCancel,
  saving = false,
}: Props) {
  const [memberSearchOpen, setMemberSearchOpen] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <div
      className="fixed inset-0 z-[530] flex items-center justify-center bg-black/45 p-4"
      role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex-1 space-y-3 overflow-y-auto pr-1">
          {/* 아이콘 + 제목 */}
          <div className="flex items-center gap-2">
            <IconPicker current={icon} onChange={onIconChange} size="md" />
            <input
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="프로젝트명 입력"
              className="flex-1 rounded border border-transparent bg-transparent px-2 py-1 text-2xl font-bold text-zinc-900 outline-none hover:border-zinc-200 focus:border-zinc-400 dark:text-zinc-100 dark:hover:border-zinc-700 dark:focus:border-zinc-500"
            />
          </div>

          {/* 설명 */}
          <div>
            <label className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">설명</label>
            <textarea
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
              placeholder={descriptionPlaceholder}
              rows={2}
              className="w-full resize-none rounded border border-zinc-200 px-2 py-1.5 text-sm outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>

          {/* 구성원 목록 */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                구성원 목록 ({selectedMembers.length})
              </span>
              <button
                ref={addButtonRef}
                type="button"
                onClick={() => setMemberSearchOpen(true)}
                className="inline-flex items-center gap-1 rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              >
                <Plus size={11} />
                구성원 추가
              </button>
            </div>
            <div className="max-h-[40vh] overflow-y-auto rounded border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-700 dark:bg-zinc-800/40">
              {selectedMembers.length === 0 ? (
                <div className="px-2 py-3 text-center text-sm text-zinc-400">
                  아직 등록된 구성원이 없습니다.
                </div>
              ) : (
                selectedMembers.map((member) => {
                  const isLeader = leaderMemberIds.includes(member.memberId);
                  return (
                    <div
                      key={member.memberId}
                      className="group flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-zinc-900 dark:text-zinc-100">
                          {member.name}
                          {isLeader && (
                            <span className="ml-1.5 rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700 dark:bg-green-900/40 dark:text-green-300">
                              리더
                            </span>
                          )}
                        </div>
                        <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                          {member.email} · {member.jobRole}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => onToggleLeader(member.memberId)}
                          className={`rounded px-1.5 py-1 text-xs ${
                            isLeader
                              ? "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"
                              : "bg-green-600 text-white"
                          }`}
                        >
                          {isLeader ? "리더 해제" : "리더 등록"}
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemoveMember(member.memberId)}
                          className="rounded border border-zinc-200 px-1.5 py-1 text-xs text-zinc-500 hover:bg-zinc-200 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-700"
                        >
                          제거
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* 하단 액션 */}
        <div className="mt-4 flex items-center justify-between gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          {onArchive ? (
            <button
              type="button"
              onClick={() => void onArchive()}
              disabled={saving}
              className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-60"
            >
              보관함으로 이동
            </button>
          ) : (
            <span />
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => void onSave()}
              disabled={saving}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? "저장 중..." : "저장"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              취소
            </button>
          </div>
        </div>
      </div>

      {memberSearchOpen && (
        <MemberSearchPopup
          anchorEl={addButtonRef.current}
          allMembers={allMembers}
          excludedMemberIds={selectedMembers.map((m) => m.memberId)}
          onSelect={onAddMember}
          onClose={() => setMemberSearchOpen(false)}
        />
      )}
    </div>
  );
}
