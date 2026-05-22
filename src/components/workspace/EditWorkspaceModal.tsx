import { useEffect, useState } from "react";
import { AccessEntriesEditor } from "./AccessEntriesEditor";
import type { WorkspaceAccessInput } from "../../lib/sync/workspaceApi";
import { IconPicker } from "../common/IconPicker";
import { useSettingsStore } from "../../store/settingsStore";

type Props = {
  open: boolean;
  workspaceId: string;
  workspaceName: string;
  initialEntries: WorkspaceAccessInput[];
  description: string;
  onDescriptionChange: (desc: string) => void;
  onClose: () => void;
  onSave: (input: {
    name: string;
    entries: WorkspaceAccessInput[];
    description: string;
  }) => Promise<void> | void;
  onRequestDelete?: () => void;
  lockedReason?: string;
};

export function EditWorkspaceModal({
  open,
  workspaceId,
  workspaceName,
  initialEntries,
  description,
  onDescriptionChange,
  onClose,
  onSave,
  onRequestDelete,
  lockedReason,
}: Props) {
  const entityIcons = useSettingsStore((s) => s.entityIcons);
  const setEntityIcon = useSettingsStore((s) => s.setEntityIcon);
  const [name, setName] = useState(workspaceName);
  const [entries, setEntries] = useState<WorkspaceAccessInput[]>(initialEntries);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(workspaceName);
    setEntries(initialEntries);
    setError(null);
  }, [open, workspaceName, initialEntries]);

  // 백그라운드 페치 후 entries가 갱신되면 반영
  useEffect(() => {
    if (open) setEntries(initialEntries);
  }, [initialEntries, open]);

  if (!open) return null;

  const submit = async () => {
    if (lockedReason) {
      onClose();
      return;
    }
    const n = name.trim();
    if (!n) {
      setError("워크스페이스 이름을 입력해 주세요.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave({ name: n, entries, description });
      onClose();
    } catch (e) {
      const gqlMsg = (e as { errors?: Array<{ message?: string }> })?.errors?.[0]?.message;
      setError(gqlMsg ?? (e instanceof Error ? e.message : "저장에 실패했습니다."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[520] flex items-center justify-center bg-black/45 p-4"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-workspace-title"
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* 아이콘 + 이름 */}
          <div className="flex items-center gap-2">
            <IconPicker
              current={entityIcons[workspaceId] ?? null}
              onChange={(icon) => setEntityIcon(workspaceId, icon)}
              size="md"
            />
            <input
              id="edit-workspace-title"
              placeholder="워크스페이스 이름"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={Boolean(lockedReason)}
              className="flex-1 rounded border border-transparent bg-transparent px-2 py-1 text-xl font-bold outline-none hover:border-zinc-200 focus:border-zinc-400 dark:hover:border-zinc-700 dark:focus:border-zinc-500"
            />
          </div>

          {/* 설명 */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
              워크스페이스 소개
            </label>
            <textarea
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
              placeholder="워크스페이스 소개를 입력하세요"
              rows={2}
              disabled={Boolean(lockedReason)}
              className="w-full resize-none rounded border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-400 disabled:opacity-50 dark:border-zinc-700 dark:focus:border-zinc-500"
            />
          </div>

          {/* 접근 규칙 */}
          <AccessEntriesEditor
            value={entries}
            onChange={setEntries}
            readOnly={Boolean(lockedReason)}
            readOnlyReason={lockedReason}
          />

          {error ? <p className="text-sm text-red-500">{error}</p> : null}
        </div>

        <div className="flex justify-between gap-2 border-t border-zinc-100 p-4 dark:border-zinc-800">
          {onRequestDelete && !lockedReason ? (
            <button
              type="button"
              onClick={onRequestDelete}
              className="rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-700"
            >
              보관함으로 이동
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded border px-3 py-1 text-sm disabled:opacity-50"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={saving}
              className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {lockedReason ? "닫기" : saving ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
