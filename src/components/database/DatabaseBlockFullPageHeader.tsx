import { History, Link2, Trash2 } from "lucide-react";

type Props = {
  onOpenDbHistory: () => void;
  onOpenLink: () => void;
  onOpenDeleteModal: () => void;
};

export function DatabaseBlockFullPageHeader({
  onOpenDbHistory,
  onOpenLink,
  onOpenDeleteModal,
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
  );
}
