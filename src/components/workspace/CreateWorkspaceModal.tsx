import { useState } from "react";
import { AccessEntriesEditor } from "./AccessEntriesEditor";
import type { WorkspaceAccessInput } from "../../lib/sync/workspaceApi";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreate: (input: { name: string; access: WorkspaceAccessInput[] }) => Promise<void> | void;
};

export function CreateWorkspaceModal({ open, onClose, onCreate }: Props) {
  const [name, setName] = useState("");
  const [entries, setEntries] = useState<WorkspaceAccessInput[]>([]);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const submit = async () => {
    const n = name.trim();
    if (!n) {
      setError("워크스페이스 이름을 입력해 주세요.");
      return;
    }
    setError(null);
    await onCreate({ name: n, access: entries });
    setName("");
    setEntries([]);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[520] flex items-center justify-center bg-black/45 p-4" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="create-workspace-title" className="w-full max-w-2xl rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900" onMouseDown={(e) => e.stopPropagation()}>
        <h3 id="create-workspace-title" className="text-sm font-semibold">워크스페이스 생성</h3>
        <input
          placeholder="워크스페이스 이름"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-3 w-full rounded border border-zinc-300 px-2 py-1.5 text-xs outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
        />

        <div className="mt-3">
          <p className="mb-1 text-xs font-medium">접근 권한 설정</p>
          <AccessEntriesEditor value={entries} onChange={setEntries} />
        </div>

        {error ? <p className="mt-2 text-xs text-red-500">{error}</p> : null}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border px-3 py-1 text-xs">취소</button>
          <button type="button" onClick={() => void submit()} className="rounded bg-zinc-900 px-3 py-1 text-xs text-white dark:bg-zinc-100 dark:text-zinc-900">
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
