import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const TITLE_COLORS = [
  { label: "기본", value: null },
  { label: "진회색", value: "#27272a" },
  { label: "빨강", value: "#ef4444" },
  { label: "주황", value: "#f97316" },
  { label: "노랑", value: "#ca8a04" },
  { label: "초록", value: "#16a34a" },
  { label: "파랑", value: "#2563eb" },
  { label: "보라", value: "#9333ea" },
  { label: "핑크", value: "#db2777" },
] as const;

type Props = {
  anchorRef: React.RefObject<HTMLInputElement | null>;
  open: boolean;
  currentColor: string | null | undefined;
  onPick: (color: string | null) => void;
  onClose: () => void;
};

export function PageTitleColorToolbar({
  anchorRef,
  open,
  currentColor,
  onPick,
  onClose,
}: Props) {
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) {
      setPos(null);
      return;
    }
    const input = anchorRef.current;
    const rect = input.getBoundingClientRect();
    const width = toolbarRef.current?.offsetWidth ?? 280;
    const height = toolbarRef.current?.offsetHeight ?? 36;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const top = Math.max(8, rect.top - height - 8);
    setPos({ top, left });
  }, [anchorRef, open, currentColor]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (toolbarRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    window.addEventListener("mousedown", onPointerDown, true);
    return () => window.removeEventListener("mousedown", onPointerDown, true);
  }, [anchorRef, onClose, open]);

  if (!open || !pos) return null;

  return createPortal(
    <div
      ref={toolbarRef}
      className="fixed z-[780] flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-1.5 py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      style={{ top: pos.top, left: pos.left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {TITLE_COLORS.map((item) => (
        <button
          key={item.label}
          type="button"
          title={item.label}
          aria-label={`제목 색 ${item.label}`}
          onClick={() => onPick(item.value)}
          className={[
            "h-5 w-5 rounded-full border",
            currentColor === item.value || (!currentColor && item.value === null)
              ? "border-zinc-900 ring-2 ring-zinc-300 dark:border-white dark:ring-zinc-600"
              : "border-zinc-200 dark:border-zinc-700",
          ].join(" ")}
          style={
            item.value
              ? { backgroundColor: item.value }
              : { background: "linear-gradient(135deg, #fafafa 50%, #18181b 50%)" }
          }
        />
      ))}
    </div>,
    document.body,
  );
}
