import { useMemo, useState } from "react";
import { RefreshCcw, Search } from "lucide-react";
import { listDatabases, useDatabaseStore } from "../../store/databaseStore";
import { useHistoryStore } from "../../store/historyStore";
import { usePageStore } from "../../store/pageStore";
import { useSettingsStore } from "../../store/settingsStore";
import { emptyPanelState } from "../../types/database";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function DatabaseManagerDialog({ open, onClose }: Props) {
  const dbList = useDatabaseStore(listDatabases);
  const restoreDatabaseFromHistoryEvent = useDatabaseStore(
    (s) => s.restoreDatabaseFromHistoryEvent,
  );
  const pages = usePageStore((s) => s.pages);
  const createPage = usePageStore((s) => s.createPage);
  const updateDoc = usePageStore((s) => s.updateDoc);
  const setActivePage = usePageStore((s) => s.setActivePage);
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);
  const deletedDbRestorePoints = useHistoryStore((s) =>
    s.getDeletedDbRestorePoints(),
  );
  const [query, setQuery] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);

  const activeDbIds = useMemo(
    () => new Set(dbList.map((d) => d.id)),
    [dbList],
  );
  const q = query.trim().toLowerCase();
  const visibleActive = dbList.filter((d) =>
    d.meta.title.toLowerCase().includes(q),
  );
  const visibleDeleted = deletedDbRestorePoints
    .filter((d) => !activeDbIds.has(d.databaseId))
    .filter((d) => d.title.toLowerCase().includes(q));

  const openDatabase = (databaseId: string, title: string) => {
    const existing = Object.values(pages).find((p) => {
      const first = p.doc?.content?.[0] as
        | { type?: string; attrs?: Record<string, unknown> }
        | undefined;
      return (
        first?.type === "databaseBlock" &&
        first.attrs?.layout === "fullPage" &&
        first.attrs?.databaseId === databaseId
      );
    });
    const pageId =
      existing?.id ??
      (() => {
        const id = createPage(title, null, { activate: false });
        updateDoc(id, {
          type: "doc",
          content: [
            {
              type: "databaseBlock",
              attrs: {
                databaseId,
                layout: "fullPage",
                view: "table",
                panelState: JSON.stringify(emptyPanelState()),
              },
            },
          ],
        });
        return id;
      })();
    setActivePage(pageId);
    setCurrentTabPage(pageId);
    onClose();
  };

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[430] flex items-center justify-center bg-black/45 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="qn-db-manager-title"
        className="w-full max-w-2xl rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2
            id="qn-db-manager-title"
            className="text-sm font-semibold text-zinc-900 dark:text-zinc-100"
          >
            데이터베이스 관리
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowDeleted(true)}
              className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              🗑 삭제된 DB 보기
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              닫기
            </button>
          </div>
        </div>
        <div className="mb-3 flex items-center gap-1.5 rounded-md bg-white px-2 py-1 ring-1 ring-zinc-200 focus-within:ring-zinc-400 dark:bg-zinc-950 dark:ring-zinc-800">
          <Search size={13} className="text-zinc-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="DB 검색"
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-zinc-400"
          />
        </div>

        <section className="rounded-md border border-zinc-200 dark:border-zinc-700">
          <div className="border-b border-zinc-100 px-3 py-2 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
            데이터베이스
          </div>
          <div className="max-h-72 overflow-y-auto">
            {visibleActive.length === 0 ? (
              <div className="px-3 py-2 text-xs text-zinc-500">
                표시할 데이터베이스가 없습니다.
              </div>
            ) : (
              visibleActive.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between gap-2 border-b border-zinc-100 px-3 py-2 text-xs last:border-b-0 dark:border-zinc-800"
                >
                  <span className="truncate text-zinc-700 dark:text-zinc-200">
                    {d.meta.title}
                  </span>
                  <button
                    type="button"
                    onClick={() => openDatabase(d.id, d.meta.title)}
                    className="shrink-0 rounded border border-zinc-200 px-2 py-1 text-[11px] hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    열기
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {/* 삭제된 DB 별도 중첩 모달 */}
      {showDeleted && (
        <div
          className="fixed inset-0 z-[530] flex items-center justify-center bg-black/40"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowDeleted(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-80 rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5 dark:border-zinc-800">
              <span className="text-sm font-semibold">삭제된 데이터베이스</span>
              <button
                type="button"
                onClick={() => setShowDeleted(false)}
                className="text-zinc-400 hover:text-zinc-600"
              >
                ✕
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {visibleDeleted.length === 0 ? (
                <p className="p-4 text-center text-xs text-zinc-400">
                  삭제된 데이터베이스가 없습니다.
                </p>
              ) : (
                visibleDeleted.map((d) => (
                  <div
                    key={d.eventId}
                    className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5 last:border-b-0 dark:border-zinc-800"
                  >
                    <div>
                      <div className="text-xs font-medium text-zinc-400 line-through">
                        {d.title}
                      </div>
                      <div className="text-[10px] text-zinc-400">
                        {new Date(d.ts).toLocaleString("ko-KR")}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        restoreDatabaseFromHistoryEvent(d.databaseId, d.eventId);
                        setShowDeleted(false);
                      }}
                      className="inline-flex shrink-0 items-center gap-1 rounded border border-zinc-200 px-2 py-1 text-[11px] hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    >
                      <RefreshCcw size={10} />
                      복구
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

