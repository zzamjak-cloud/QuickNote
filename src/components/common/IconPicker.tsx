import { useEffect, useRef, useState } from "react";

const PRESET_ICONS = [
  "📄","📝","📚","📒","📁","📌","✅","⭐","💡","🔥",
  "🎯","🚀","🧠","💼","💻","🛠️","📈","🧪","🎨","🎵",
  "🌱","🌟","🔖","🗓️","🧩","🍕","☕","🌸","🌍","🎉",
];

type Props = {
  current: string | null;
  onChange: (icon: string | null) => void;
};

// 페이지 아이콘 picker. 클릭 시 그리드를 띄우고, 직접 입력도 허용한다.
export function IconPicker({ current, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-12 w-12 items-center justify-center rounded-md text-3xl hover:bg-zinc-100 dark:hover:bg-zinc-800"
        aria-label="페이지 아이콘"
      >
        {current ?? <span className="text-xs text-zinc-400">아이콘 추가</span>}
      </button>
      {open && (
        <div className="absolute left-0 top-14 z-30 w-64 rounded-md border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          <div className="mb-2 grid grid-cols-6 gap-1">
            {PRESET_ICONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  onChange(emoji);
                  setOpen(false);
                }}
                className="rounded p-1 text-xl hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                {emoji}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value.slice(0, 4))}
              placeholder="직접 입력"
              className="flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-xs outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-500"
            />
            <button
              type="button"
              onClick={() => {
                if (custom.trim()) {
                  onChange(custom.trim());
                  setCustom("");
                  setOpen(false);
                }
              }}
              className="rounded bg-zinc-900 px-2 py-1 text-xs text-white dark:bg-zinc-200 dark:text-zinc-900"
            >
              적용
            </button>
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="rounded px-2 py-1 text-xs text-zinc-500 hover:text-red-500"
              title="아이콘 제거"
            >
              제거
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
