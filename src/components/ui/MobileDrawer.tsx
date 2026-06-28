// 모바일/컴팩트 화면용 좌측 오버레이 드로어. 사이드바를 화면을 잠식하지 않고 띄운다.
// Portal + 스크림 + ESC. z-[360] — TopBar/TabBar(z-[350])보다 위(헤더 가림 방지),
// 사이드바에서 여는 다이얼로그(DialogBase z-[400]·Settings z-[500])보다는 아래.
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** 패널 폭 클래스. 기본 w-[280px] max-w-[85vw]. */
  widthClassName?: string;
}

export function MobileDrawer({
  open,
  onClose,
  children,
  widthClassName = "w-[280px] max-w-[85vw]",
}: MobileDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[360] bg-black/45"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`absolute inset-y-0 left-0 ${widthClassName} bg-zinc-50 shadow-xl dark:bg-zinc-900`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
