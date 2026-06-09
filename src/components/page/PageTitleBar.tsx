import React from "react";
import { MessageSquarePlus, Star } from "lucide-react";
import { IconPicker } from "../common/IconPicker";
import { useSettingsStore } from "../../store/settingsStore";

interface PageTitleBarProps {
  pageId: string;
  icon: string | null | undefined;
  titleDraft: string;
  titleClassName?: string;
  placeholder?: string;
  titleRef?: React.RefObject<HTMLInputElement | null>;
  onTitleChange: (v: string) => void;
  onTitleBlur: () => void;
  onTitleKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onTitleFocus?: () => void;
  onIconChange: (icon: string | null) => void;
  onIconUploadMessage?: (msg: string) => void;
  defaultIcon?: React.ReactNode;
  /** 제공 시 즐겨찾기 아이콘 왼쪽에 "댓글 추가" 버튼을 표시한다. */
  onAddComment?: () => void;
}

export function PageTitleBar({
  pageId,
  icon,
  titleDraft,
  titleClassName = "min-w-0 flex-1 bg-transparent text-3xl font-semibold outline-none placeholder:text-zinc-400",
  placeholder = "제목 없음",
  titleRef,
  onTitleChange,
  onTitleBlur,
  onTitleKeyDown,
  onTitleFocus,
  onIconChange,
  onIconUploadMessage,
  defaultIcon,
  onAddComment,
}: PageTitleBarProps) {
  // 즐겨찾기 상태는 내부에서 직접 구독 — 다른 페이지 변경 시 이 컴포넌트만 리렌더
  const isFavorite = useSettingsStore(
    (s) => s.favoritePageIds.includes(pageId),
  );
  const toggleFavoritePage = useSettingsStore((s) => s.toggleFavoritePage);

  return (
    <div className="flex items-center gap-2">
      <IconPicker
        current={icon ?? null}
        onChange={onIconChange}
        onUploadMessage={onIconUploadMessage}
        defaultIcon={defaultIcon}
      />
      <input
        ref={titleRef}
        type="text"
        value={titleDraft}
        onChange={(e) => onTitleChange(e.target.value)}
        onBlur={onTitleBlur}
        onKeyDown={onTitleKeyDown}
        onFocus={onTitleFocus}
        placeholder={placeholder}
        className={titleClassName}
      />
      {onAddComment && (
        <button
          type="button"
          onClick={onAddComment}
          className="shrink-0 rounded-md p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          aria-label="댓글 추가"
          title="댓글 추가"
        >
          <MessageSquarePlus size={22} strokeWidth={1.75} />
        </button>
      )}
      <button
        type="button"
        onClick={() => toggleFavoritePage(pageId)}
        className="shrink-0 rounded-md p-2 text-zinc-400 hover:bg-zinc-100 hover:text-amber-500 dark:hover:bg-zinc-800 dark:hover:text-amber-400"
        aria-label={isFavorite ? "즐겨찾기 해제" : "즐겨찾기"}
        aria-pressed={isFavorite}
        title="즐겨찾기"
      >
        <Star
          size={22}
          strokeWidth={1.75}
          className={isFavorite ? "fill-amber-400 text-amber-500" : ""}
        />
      </button>
    </div>
  );
}
