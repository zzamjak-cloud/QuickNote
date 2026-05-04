import { Database, Link2, Lock, PanelTop, Trash2, Unlock } from "lucide-react";
import type { ViewKind } from "../../types/database";
import { DatabaseViewKindToggle } from "./DatabaseViewKindToggle";

type Props = {
  displayDbTitle: string;
  titleDraft: string;
  onTitleDraftChange: (v: string) => void;
  onTitleCommit: () => void;
  inlineTitleLocked: boolean;
  dbHomePageId: string | null;
  onOpenDbHomePage: (pageId: string) => void;
  deletionLocked: boolean;
  onToggleDeletionLock: () => void;
  onOpenLink: () => void;
  onOpenDeleteModal: () => void;
  view: ViewKind;
  onViewChange: (v: ViewKind) => void;
};

export function DatabaseBlockInlineHeader({
  displayDbTitle,
  titleDraft,
  onTitleDraftChange,
  onTitleCommit,
  inlineTitleLocked,
  dbHomePageId,
  onOpenDbHomePage,
  deletionLocked,
  onToggleDeletionLock,
  onOpenLink,
  onOpenDeleteModal,
  view,
  onViewChange,
}: Props) {
  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-2 py-2 dark:border-zinc-700">
        <div className="flex min-w-0 flex-1 items-center gap-2">
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
            title={
              deletionLocked
                ? "삭제 잠금 해제 — 블록 삭제 허용"
                : "삭제 잠금 — 키보드·그립 메뉴·박스 선택 삭제 방지"
            }
            onClick={onToggleDeletionLock}
            className={[
              "rounded p-1",
              deletionLocked
                ? "text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30"
                : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800",
            ].join(" ")}
          >
            {deletionLocked ? (
              <Lock size={15} strokeWidth={2.25} />
            ) : (
              <Unlock size={15} strokeWidth={2} />
            )}
          </button>
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
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5">
        <DatabaseViewKindToggle view={view} onViewChange={onViewChange} />
      </div>
    </>
  );
}
