import { useEffect, useRef, useState } from "react";
import EmojiPickerReact, { EmojiStyle, Theme } from "emoji-picker-react";
import { useSettingsStore } from "../../store/settingsStore";

type Props = {
  current: string | null;
  onChange: (icon: string | null) => void;
  // 인라인 컴팩트 모드: 사이드바·트리에서 작은 아이콘 버튼만 노출
  size?: "lg" | "sm";
};

// 카테고리 탭 + 검색이 내장된 emoji-picker-react 기반 아이콘 picker.
export function IconPicker({ current, onChange, size = "lg" }: Props) {
  const darkMode = useSettingsStore((s) => s.darkMode);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const trigger =
    size === "lg" ? (
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-12 w-12 items-center justify-center rounded-md text-3xl hover:bg-zinc-100 dark:hover:bg-zinc-800"
        aria-label="페이지 아이콘"
      >
        {current ?? <span className="text-xs text-zinc-400">아이콘 추가</span>}
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-5 w-5 items-center justify-center rounded text-base hover:bg-zinc-100 dark:hover:bg-zinc-800"
        aria-label="페이지 아이콘"
      >
        {current ?? "·"}
      </button>
    );

  return (
    <div className="relative" ref={ref}>
      {trigger}
      {open && (
        <div className="absolute left-0 top-14 z-50 rounded-md border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          <EmojiPickerReact
            theme={darkMode ? Theme.DARK : Theme.LIGHT}
            emojiStyle={EmojiStyle.NATIVE}
            previewConfig={{ showPreview: false }}
            searchDisabled={false}
            lazyLoadEmojis
            width={320}
            height={380}
            onEmojiClick={(data) => {
              onChange(data.emoji);
              setOpen(false);
            }}
          />
          <div className="flex items-center justify-end gap-1 border-t border-zinc-200 p-1.5 dark:border-zinc-700">
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-red-500 dark:hover:bg-zinc-800"
            >
              아이콘 제거
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
