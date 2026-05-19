import { History, Trash2 } from "lucide-react";

type Props = {
  onOpenDbHistory: () => void;
  onOpenDeleteModal: () => void;
  deleteDisabled?: boolean;
};

export function DatabaseBlockFullPageHeader({
  onOpenDbHistory,
  onOpenDeleteModal,
  deleteDisabled,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-1 px-2 py-1.5">
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
          title={deleteDisabled ? "LC스케줄러 DB는 삭제할 수 없습니다." : "데이터베이스 영구 삭제…"}
          onClick={onOpenDeleteModal}
          disabled={deleteDisabled}
          className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-zinc-400 dark:hover:bg-red-950/40 dark:hover:text-red-400"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
}
