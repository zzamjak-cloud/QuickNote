import { Database, History, Link2, PanelTop, Trash2 } from "lucide-react";
import type { DragEvent as ReactDragEvent } from "react";

type Props = {
  displayDbTitle: string;
  titleDraft: string;
  onTitleDraftChange: (v: string) => void;
  onTitleCommit: () => void;
  inlineTitleLocked: boolean;
  dbHomePageId: string | null;
  onOpenDbHomePage: (pageId: string) => void;
  onOpenDbHistory: () => void;
  onOpenLink: () => void;
  onOpenDeleteModal: () => void;
  /** 제목 영역 드래그 — 인라인 DB 블럭을 통째로 이동 */
  onTitleDragStart?: (e: ReactDragEvent<HTMLDivElement>) => void;
  onTitleDragEnd?: () => void;
};

export function DatabaseBlockInlineHeader({
  displayDbTitle,
  titleDraft,
  onTitleDraftChange,
  onTitleCommit,
  inlineTitleLocked,
  dbHomePageId,
  onOpenDbHomePage,
  onOpenDbHistory,
  onOpenLink,
  onOpenDeleteModal,
  onTitleDragStart,
  onTitleDragEnd,
}: Props) {
  return (
    <>
      {/* 제목 바 전체가 드래그 핸들 — 노션처럼 빈 영역 드래그시 블럭 이동.
          input/button 등 인터랙티브 자식은 자체 동작이 우선되어 드래그가 시작되지 않음. */}
      <div
        draggable={onTitleDragStart ? true : undefined}
        onDragStart={onTitleDragStart}
        onDragEnd={onTitleDragEnd}
        className={[
          "group flex items-center justify-between gap-2 border-b border-zinc-200 px-2 py-2 dark:border-zinc-700",
          onTitleDragStart ? "cursor-grab active:cursor-grabbing" : "",
        ].join(" ")}
        title={onTitleDragStart ? "드래그하여 블럭 이동" : undefined}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <Database size={16} className="shrink-0 text-zinc-500" />
          {inlineTitleLocked ? (
            <span
              className="min-w-0 truncate text-left text-sm font-medium text-zinc-800 dark:text-zinc-200"
              title={displayDbTitle}
            >
              {displayDbTitle}
            </span>
          ) : (
            <input
              type="text"
              value={titleDraft}
              onChange={(e) => onTitleDraftChange(e.target.value)}
              onBlur={onTitleCommit}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder="데이터베이스 이름"
              title="이름 변경"
              className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-left text-sm font-medium text-zinc-800 outline-none focus:border-zinc-300 dark:text-zinc-200 dark:focus:border-zinc-600"
            />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            title="DB 버전 히스토리"
            onClick={onOpenDbHistory}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <History size={15} />
          </button>
          {dbHomePageId != null ? (
            <button
              type="button"
              title="데이터베이스 전체 페이지로 이동"
              onClick={() => onOpenDbHomePage(dbHomePageId)}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <PanelTop size={15} />
            </button>
          ) : null}
          <button
            type="button"
            title="다른 DB 연결"
            onClick={onOpenLink}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <Link2 size={15} />
          </button>
          <button
            type="button"
            title="데이터베이스 영구 삭제…"
            onClick={onOpenDeleteModal}
            className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </>
  );
}
