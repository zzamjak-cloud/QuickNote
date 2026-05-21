import { useEffect } from "react";
import { DialogBase } from "../../lib/ui-primitives";

type Props = {
  open: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  zIndex?: number;
  onCancel: () => void;
  onConfirm: () => void;
};

export function SimpleConfirmDialog({
  open,
  title = "확인",
  message,
  confirmLabel = "확인",
  cancelLabel = "취소",
  danger = false,
  zIndex = 500,
  onCancel,
  onConfirm,
}: Props) {
  // Enter 커밋은 DialogBase 의 ESC 닫기와 별개로 본 컴포넌트에서 처리한다.
  // capture 단계 + stopImmediatePropagation 으로 이전 동작 유지.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      onConfirm();
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onConfirm, open]);

  return (
    <DialogBase
      open={open}
      onClose={onCancel}
      widthClassName="max-w-md"
      labelId="qn-simple-confirm-title"
      overlayStyle={{ zIndex }}
    >
      <DialogBase.Header id="qn-simple-confirm-title">{title}</DialogBase.Header>
      <DialogBase.Body>
        <p className="whitespace-pre-wrap break-words">{message}</p>
      </DialogBase.Body>
      <DialogBase.Footer>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={
            danger
              ? "rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              : "rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          }
        >
          {confirmLabel}
        </button>
      </DialogBase.Footer>
    </DialogBase>
  );
}
