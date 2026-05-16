import { useMemo, useState } from "react";
import { Search } from "lucide-react";
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
  const [query, setQuery] = useState("");

  const allTargets = useMemo(
    () => workspaces.filter((w) => w.workspaceId !== currentWorkspaceId && !w.removedAt),
    [workspaces, currentWorkspaceId],
  );

  const targets = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allTargets;
    return allTargets.filter((w) => w.name.toLowerCase().includes(q));
  }, [allTargets, query]);

  if (!pageId) return null;
  const page = pages[pageId];
  if (!page) return null;

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
        className="w-full max-w-xl rounded-lg bg-white p-4 shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 px-1 text-base font-semibold text-zinc-900 dark:text-zinc-100">
          "{page.title || "페이지"}" 복제할 워크스페이스 선택
        </h3>
        <div className="mb-3 flex items-center gap-1.5 rounded-md bg-white px-2 py-1.5 ring-1 ring-zinc-200 focus-within:ring-zinc-400 dark:bg-zinc-950 dark:ring-zinc-800">
          <Search size={15} className="text-zinc-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="워크스페이스 검색"
            autoFocus
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400"
          />
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {allTargets.length === 0 ? (
            <p className="px-2 py-4 text-center text-sm text-zinc-400">
              이동 가능한 다른 워크스페이스가 없습니다.
            </p>
          ) : targets.length === 0 ? (
            <p className="px-2 py-4 text-center text-sm text-zinc-400">
              검색 결과가 없습니다.
            </p>
          ) : (
            targets.map((ws) => (
              <button
                key={ws.workspaceId}
                type="button"
                onClick={() => handleCopy(ws.workspaceId, ws.name)}
                className="flex w-full items-center gap-3 rounded px-2 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-zinc-200 text-xs font-medium dark:bg-zinc-700">
                  {ws.name.charAt(0).toUpperCase()}
                </span>
                <span className="truncate">{ws.name}</span>
              </button>
            ))
          )}
        </div>
        <div className="mt-3 flex justify-end border-t border-zinc-200 pt-3 dark:border-zinc-700">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
