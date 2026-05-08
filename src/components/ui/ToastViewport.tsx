import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useUiStore, type ToastKind } from "../../store/uiStore";

const toneClass: Record<ToastKind, string> = {
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/70 dark:text-emerald-200",
  info:
    "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/70 dark:text-blue-200",
  error:
    "border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/70 dark:text-red-200",
};

const iconClass: Record<ToastKind, typeof CheckCircle2> = {
  success: CheckCircle2,
  info: Info,
  error: XCircle,
};

export function ToastViewport() {
  const toasts = useUiStore((s) => s.toasts);
  const dismissToast = useUiStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed right-4 top-14 z-[700] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {toasts.map((toast) => {
        const Icon = iconClass[toast.kind];
        return (
          <div
            key={toast.id}
            className={[
              "pointer-events-auto flex items-center gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg ring-1 ring-black/5 backdrop-blur dark:ring-white/10",
              toneClass[toast.kind],
            ].join(" ")}
          >
            <Icon size={16} className="shrink-0" />
            <span className="min-w-0 flex-1">{toast.message}</span>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              className="rounded p-0.5 opacity-70 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
              aria-label="알림 닫기"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
