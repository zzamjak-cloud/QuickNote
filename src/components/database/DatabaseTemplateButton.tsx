import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil, Plus, X } from "lucide-react";
import { useDatabaseStore } from "../../store/databaseStore";
import { usePageStore } from "../../store/pageStore";
import { useSettingsStore } from "../../store/settingsStore";

type Props = {
  databaseId: string;
};

/**
 * DB 템플릿 관리 버튼.
 * "새 템플릿" 클릭 시 전용 페이지를 생성하고 해당 페이지로 이동해 편집.
 * 편집 아이콘 클릭 시 기존 템플릿 페이지로 이동.
 */
export function DatabaseTemplateButton({ databaseId }: Props) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const templates = useDatabaseStore((s) => s.dbTemplates[databaseId] ?? []);
  const addTemplate = useDatabaseStore((s) => s.addTemplate);
  const deleteTemplate = useDatabaseStore((s) => s.deleteTemplate);
  const applyTemplate = useDatabaseStore((s) => s.applyTemplate);

  const pages = usePageStore((s) => s.pages);
  const setActivePage = usePageStore((s) => s.setActivePage);
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);

  // 팝업 외부 클릭 시 닫기.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current?.contains(e.target as Node)) return;
      if (buttonRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  const toggle = () => {
    if (open) { setOpen(false); return; }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const width = 220;
      const left = Math.min(rect.right - width, window.innerWidth - width - 8);
      setCoords({ top: rect.bottom + 4, left: Math.max(8, left) });
    }
    setOpen(true);
  };

  const navigateToPage = (pageId: string) => {
    setOpen(false);
    setActivePage(pageId);
    setCurrentTabPage(pageId);
  };

  const handleAdd = () => {
    // 템플릿 페이지 생성 후 즉시 이동해서 편집.
    const pageId = addTemplate(databaseId);
    if (pageId) navigateToPage(pageId);
  };

  const handleDelete = (id: string, title: string) => {
    if (!window.confirm(`'${title}'을 삭제하시겠습니까?`)) return;
    deleteTemplate(databaseId, id);
  };

  const handleApply = (id: string) => {
    applyTemplate(databaseId, id);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        title="템플릿"
        className="inline-flex h-7 items-center gap-1 rounded-md bg-blue-500 px-2 text-xs font-medium text-white hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-700"
      >
        템플릿
        {templates.length > 0 && (
          <span className="rounded bg-blue-400 px-1 text-[10px] text-white dark:bg-blue-500">
            {templates.length}
          </span>
        )}
      </button>

      {open && coords &&
        createPortal(
          <div
            ref={popoverRef}
            style={{ position: "fixed", top: coords.top, left: coords.left, width: 220 }}
            className="z-50 overflow-hidden rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          >
            <div className="border-b border-zinc-100 px-2 py-1.5 dark:border-zinc-800">
              <button
                type="button"
                onClick={handleAdd}
                className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <Plus size={12} />
                새 템플릿
              </button>
            </div>

            {templates.length === 0 ? (
              <div className="px-3 py-3 text-center text-xs text-zinc-400">
                템플릿이 없습니다
              </div>
            ) : (
              <ul className="max-h-60 overflow-y-auto py-1">
                {templates.map((tmpl) => {
                  // 연결된 페이지의 최신 제목을 우선 사용.
                  const pageTitle = tmpl.pageId
                    ? (pages[tmpl.pageId]?.title ?? tmpl.title)
                    : tmpl.title;
                  return (
                    <li
                      key={tmpl.id}
                      className="flex items-center gap-1 px-2 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    >
                      <button
                        type="button"
                        onClick={() => handleApply(tmpl.id)}
                        className="min-w-0 flex-1 truncate text-left text-xs text-zinc-700 dark:text-zinc-300"
                        title={`'${pageTitle}' 템플릿으로 새 항목 추가`}
                      >
                        {pageTitle}
                      </button>
                      {tmpl.pageId && (
                        <button
                          type="button"
                          title="템플릿 페이지 편집"
                          onClick={() => navigateToPage(tmpl.pageId!)}
                          className="shrink-0 rounded p-0.5 text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                        >
                          <Pencil size={11} />
                        </button>
                      )}
                      <button
                        type="button"
                        title="템플릿 삭제"
                        onClick={() => handleDelete(tmpl.id, pageTitle)}
                        className="shrink-0 rounded p-0.5 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                      >
                        <X size={11} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
