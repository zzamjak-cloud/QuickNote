import { ChevronLeft, History, Trash2 } from "lucide-react";

type Props = {
  onOpenDbHistory: () => void;
  onOpenDeleteModal: () => void;
  /** 이전 페이지가 있을 때 true — 뒤로가기 버튼 표시. */
  hasPreviousPage?: boolean;
  /** 뒤로가기 클릭 핸들러. */
  onGoBack?: () => void;
};

export function DatabaseBlockFullPageHeader({
  onOpenDbHistory,
  onOpenDeleteModal,
  hasPreviousPage,
  onGoBack,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-1 px-2 py-1.5">
      {hasPreviousPage && (
        <button
          type="button"
          onClick={onGoBack}
          title="이전 페이지로 이동"
          className="inline-flex items-center gap-0.5 rounded px-1.5 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <ChevronLeft size={14} />
          <span>이전 페이지</span>
        </button>
      )}
      <div className="ml-auto flex items-center gap-0.5">
        <button
          type="button"
          title="DB 버전 히스토리"
          onClick={onOpenDbHistory}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <History size={15} />
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
  );
}
