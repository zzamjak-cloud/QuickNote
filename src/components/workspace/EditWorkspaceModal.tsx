import { useEffect, useState } from "react";
import { AccessEntriesEditor } from "./AccessEntriesEditor";
import type { WorkspaceAccessInput } from "../../lib/sync/workspaceApi";

type Props = {
  open: boolean;
  workspaceName: string;
  initialEntries: WorkspaceAccessInput[];
  onClose: () => void;
  onSave: (input: { name: string; entries: WorkspaceAccessInput[] }) => Promise<void> | void;
  onRequestDelete?: () => void;
};

export function EditWorkspaceModal({
  open,
  workspaceName,
  initialEntries,
  onClose,
  onSave,
  onRequestDelete,
}: Props) {
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

  if (!open) return null;

  const submit = async () => {
    const n = name.trim();
    if (!n) {
      setError("워크스페이스 이름을 입력해 주세요.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave({ name: n, entries });
      onClose();
    } catch (e) {
      const gqlMsg = (e as { errors?: Array<{ message?: string }> })?.errors?.[0]?.message;
      setError(gqlMsg ?? (e instanceof Error ? e.message : "저장에 실패했습니다."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[520] flex items-center justify-center bg-black/45 p-4" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="edit-workspace-title" className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex-1 overflow-y-auto p-4">
          <input
            id="edit-workspace-title"
            placeholder="워크스페이스 이름"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-transparent bg-transparent px-2 py-1 text-xl font-bold outline-none hover:border-zinc-200 focus:border-zinc-400 dark:hover:border-zinc-700 dark:focus:border-zinc-500"
          />
          <div className="mt-4">
            <AccessEntriesEditor value={entries} onChange={setEntries} />
          </div>
          {error ? <p className="mt-2 text-sm text-red-500">{error}</p> : null}
        </div>
        <div className="flex justify-between gap-2 border-t border-zinc-100 p-4 dark:border-zinc-800">
          {onRequestDelete ? (
            <button
              type="button"
              onClick={onRequestDelete}
              className="rounded bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-700"
            >
              워크스페이스 삭제
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={saving} className="rounded border px-3 py-1 text-sm disabled:opacity-50">취소</button>
            <button type="button" onClick={() => void submit()} disabled={saving} className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-60">
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
