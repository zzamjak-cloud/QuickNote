import { Database, History, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Props = {
  displayDbTitle: string;
  onTitleCommit: (draft: string) => boolean;
  titleLocked?: boolean;
  onOpenDbHistory: () => void;
  onOpenDeleteModal: () => void;
  deleteDisabled?: boolean;
};

export function DatabaseBlockFullPageHeader({
  displayDbTitle,
  onTitleCommit,
  titleLocked,
  onOpenDbHistory,
  onOpenDeleteModal,
  deleteDisabled,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    if (document.activeElement === input) return;
    input.value = displayDbTitle;
  }, [displayDbTitle]);

  // tiptap이 mousedown을 가로채 blur가 발화하지 않으므로 document 레벨에서 외부 클릭 감지
  useEffect(() => {
    if (!isFocused) return;
    const handleOutside = (e: MouseEvent) => {
      if (inputRef.current && !inputRef.current.contains(e.target as Node)) {
        inputRef.current.blur();
      }
    };
    document.addEventListener("mousedown", handleOutside, true);
    return () => document.removeEventListener("mousedown", handleOutside, true);
  }, [isFocused]);

  return (
    <div className="flex flex-wrap items-center gap-2 px-2 py-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <Database size={16} className="shrink-0 text-zinc-500" />
        {titleLocked ? (
          <span
            className="min-w-0 truncate text-left text-2xl font-bold text-zinc-800 dark:text-zinc-200"
            title={displayDbTitle}
          >
            {displayDbTitle}
          </span>
        ) : (
          <input
            ref={inputRef}
            type="text"
            defaultValue={displayDbTitle}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => {
              setIsFocused(false);
              setIsHovered(false);
              const nextTitle = inputRef.current?.value ?? displayDbTitle;
              const ok = onTitleCommit(nextTitle);
              if (!ok) {
                if (inputRef.current) inputRef.current.value = displayDbTitle;
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="데이터베이스 이름"
            title="이름 변경"
            className={[
              "min-w-0 flex-1 cursor-text rounded border bg-transparent px-1 text-left text-2xl font-bold text-zinc-800 outline-none dark:text-zinc-200",
              isFocused
                ? "border-zinc-300 dark:border-zinc-600"
                : isHovered
                  ? "border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/40"
                  : "border-transparent",
            ].join(" ")}
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
