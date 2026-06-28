// 모달 다이얼로그 베이스. Portal + ESC + 오버레이 클릭 + ARIA modal 을 흡수한다.
import { useEffect, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface DialogBaseProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** alertdialog 로 노출할지 (기본 dialog). 파괴적/경고용에 true. */
  role?: "dialog" | "alertdialog";
  /** 오버레이 클릭으로 닫을지. AutoUpdateDialog 같이 진행 중인 작업은 false. */
  closeOnOverlay?: boolean;
  /** ESC 키로 닫을지. */
  closeOnEsc?: boolean;
  /** 모달 박스의 max-width Tailwind 클래스. 기본 max-w-sm. */
  widthClassName?: string;
  /** aria-labelledby 와 매칭되는 헤더 id. */
  labelId?: string;
  /** z-index 클래스. 기본 z-[400]. */
  zClassName?: string;
  /** 오버레이 div 에 적용할 인라인 스타일. 런타임 zIndex 오버라이드 등. */
  overlayStyle?: CSSProperties;
}

function DialogBaseRoot({
  open,
  onClose,
  children,
  role = "dialog",
  closeOnOverlay = true,
  closeOnEsc = true,
  widthClassName = "max-w-sm",
  labelId,
  zClassName = "z-[400]",
  overlayStyle,
}: DialogBaseProps) {
  useEffect(() => {
    if (!open || !closeOnEsc) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, closeOnEsc, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className={`fixed inset-0 ${zClassName} flex items-center justify-center bg-black/45 p-4`}
      style={overlayStyle}
      role="presentation"
      onMouseDown={(e) => {
        if (closeOnOverlay && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role={role}
        aria-modal="true"
        aria-labelledby={labelId}
        className={`max-h-[90dvh] w-full overflow-y-auto ${widthClassName} rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

function Header({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2
      id={id}
      className="text-base font-semibold text-zinc-900 dark:text-zinc-100"
    >
      {children}
    </h2>
  );
}

function Body({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
      {children}
    </div>
  );
}

function Footer({ children }: { children: ReactNode }) {
  return <div className="mt-5 flex justify-end gap-2">{children}</div>;
}

export const DialogBase = Object.assign(DialogBaseRoot, {
  Header,
  Body,
  Footer,
});
