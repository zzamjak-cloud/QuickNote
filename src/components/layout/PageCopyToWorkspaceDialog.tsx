import { usePageStore } from "../../store/pageStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useUiStore } from "../../store/uiStore";

type Props = {
  pageId: string | null;
  onClose: () => void;
};

export function PageCopyToWorkspaceDialog({ pageId, onClose }: Props) {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const pages = usePageStore((s) => s.pages);
  const duplicatePageToWorkspace = usePageStore((s) => s.duplicatePageToWorkspace);
  const showToast = useUiStore((s) => s.showToast);

  if (!pageId) return null;
  const page = pages[pageId];
  if (!page) return null;

  const targets = workspaces.filter(
    (w) => w.workspaceId !== currentWorkspaceId && !w.removedAt,
  );

  const handleCopy = (targetWorkspaceId: string, targetName: string) => {
    const count = duplicatePageToWorkspace(pageId, targetWorkspaceId);
    onClose();
    showToast(
      `"${page.title || "페이지"}" 외 ${count - 1}개 자식 페이지를 "${targetName}"에 복제했습니다.`,
      { kind: "success" },
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-80 rounded-lg bg-white p-3 shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-2 px-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          "{page.title || "페이지"}" 복제할 워크스페이스 선택
        </h3>
        <div className="max-h-64 overflow-y-auto">
          {targets.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-zinc-400">
              이동 가능한 다른 워크스페이스가 없습니다.
            </p>
          ) : (
            targets.map((ws) => (
              <button
                key={ws.workspaceId}
                type="button"
                onClick={() => handleCopy(ws.workspaceId, ws.name)}
                className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <span className="h-5 w-5 shrink-0 rounded bg-zinc-200 text-center text-[10px] leading-5 dark:bg-zinc-700">
                  {ws.name.charAt(0).toUpperCase()}
                </span>
                <span className="truncate">{ws.name}</span>
              </button>
            ))
          )}
        </div>
        <div className="mt-2 flex justify-end border-t border-zinc-200 pt-2 dark:border-zinc-700">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
