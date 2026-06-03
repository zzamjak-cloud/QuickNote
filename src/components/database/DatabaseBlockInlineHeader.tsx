import { ChevronDown, Database, History, Link2, Maximize2 } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";

type Props = {
  displayDbTitle: string;
  onTitleCommit: (draft: string) => boolean;
  inlineTitleLocked: boolean;
  dbHomePageId: string | null;
  /** 호스트 페이지가 없으면 부모에서 lazy 생성한다. */
  onOpenDbHomePage: (pageId: string | null) => void;
  onOpenDbHistory: () => void;
  onOpenLink: () => void;
  inlineControlsCollapsed: boolean;
  onToggleInlineControls: () => void;
  /** 제목 영역 드래그 — 인라인 DB 블럭을 통째로 이동 */
  onTitleDragStart?: (e: ReactDragEvent<HTMLDivElement>) => void;
  onTitleDragEnd?: () => void;
};

export const DatabaseBlockInlineHeader = memo(function DatabaseBlockInlineHeader({
  displayDbTitle,
  onTitleCommit,
  inlineTitleLocked,
  dbHomePageId,
  onOpenDbHomePage,
  onOpenDbHistory,
  onOpenLink,
  inlineControlsCollapsed,
  onToggleInlineControls,
  onTitleDragStart,
  onTitleDragEnd,
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
    <>
      {/* 제목 바 전체가 드래그 핸들 — 노션처럼 빈 영역 드래그시 블럭 이동.
          input/button 등 인터랙티브 자식은 자체 동작이 우선되어 드래그가 시작되지 않음. */}
      <div
        draggable={onTitleDragStart ? true : undefined}
        onDragStart={(e) => {
          const t = e.target as HTMLElement | null;
          if (
            t?.closest(
              "input, textarea, button, a[href], select, [contenteditable='true']",
            )
          ) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          onTitleDragStart?.(e);
        }}
        onDragEnd={onTitleDragEnd}
        className={[
          "group flex items-center justify-between gap-2 px-2 py-2",
          onTitleDragStart ? "cursor-grab active:cursor-grabbing" : "",
        ].join(" ")}
        title={onTitleDragStart ? "드래그하여 블럭 이동" : undefined}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <Database size={16} className="shrink-0 text-zinc-500" />
          {inlineTitleLocked ? (
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
              onKeyDownCapture={(e) => {
                // 에디터 단축키/트랜잭션으로 전파되지 않게 차단
                e.stopPropagation();
              }}
              onKeyUpCapture={(e) => {
                e.stopPropagation();
              }}
              onBeforeInput={(e) => {
                e.stopPropagation();
              }}
              onInput={(e) => {
                e.stopPropagation();
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
          {/* "전체 페이지로 이동" 버튼은 항상 노출 — 호스트 페이지가 없으면 클릭 시 부모가 lazy 생성. */}
          <button
            type="button"
            title="데이터베이스 전체 페이지로 이동"
            onClick={() => onOpenDbHomePage(dbHomePageId)}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <Maximize2 size={15} />
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
            title={inlineControlsCollapsed ? "모드/필터 펼치기" : "모드/필터 접기"}
            onClick={onToggleInlineControls}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-expanded={!inlineControlsCollapsed}
          >
            <ChevronDown
              size={15}
              className={inlineControlsCollapsed ? "-rotate-90 transition-transform" : "transition-transform"}
            />
          </button>
        </div>
      </div>
    </>
  );
});
