type Props = {
  open: boolean;
  workspaceName: string;
  deleteConfirmPhrase: string;
  deletePhraseDraft: string;
  onDeletePhraseChange: (v: string) => void;
  onClose: () => void;
  onConfirmDelete: () => void;
};

export function WorkspaceDeleteConfirmDialog({
  open,
  workspaceName,
  deleteConfirmPhrase,
  deletePhraseDraft,
  onDeletePhraseChange,
  onClose,
  onConfirmDelete,
}: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/45 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="qn-workspace-delete-title"
        className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2
          id="qn-workspace-delete-title"
          className="text-base font-semibold text-zinc-900 dark:text-zinc-100"
        >
          워크스페이스 삭제
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          「{workspaceName}」와 연결된 페이지/데이터베이스 접근이 함께 제거될 수 있습니다.
        </p>
        <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">
          계속하려면 아래 입력란에 다음 문구를{" "}
          <span className="font-semibold">정확히</span> 입력하세요.
        </p>
        <p className="mt-1 rounded-md bg-zinc-100 px-2 py-1.5 font-mono text-sm text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
          {deleteConfirmPhrase}
        </p>
        <input
          type="text"
          value={deletePhraseDraft}
          onChange={(e) => onDeletePhraseChange(e.target.value)}
          placeholder={deleteConfirmPhrase}
          autoComplete="off"
          className="mt-3 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirmDelete}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            삭제 실행
          </button>
        </div>
      </div>
    </div>
  );
}
