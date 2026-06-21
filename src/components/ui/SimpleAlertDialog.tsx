import { DialogBase } from "../../lib/ui-primitives";

type Props = {
  open: boolean;
  title?: string;
  message: string;
  onClose: () => void;
  /** 기본: 확인 */
  actionLabel?: string;
  /** 런타임 z-index 오버라이드. 미지정 시 DialogBase 기본(z-[400]). 피커뷰(z-[650]) 위에 떠야 할 때 지정. */
  zIndex?: number;
};

export function SimpleAlertDialog({
  open,
  title = "알림",
  message,
  onClose,
  actionLabel = "확인",
  zIndex,
}: Props) {
  return (
    <DialogBase
      open={open}
      onClose={onClose}
      role="alertdialog"
      labelId="qn-simple-alert-title"
      overlayStyle={zIndex != null ? { zIndex } : undefined}
    >
      <DialogBase.Header id="qn-simple-alert-title">{title}</DialogBase.Header>
      <DialogBase.Body>{message}</DialogBase.Body>
      <DialogBase.Footer>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          {actionLabel}
        </button>
      </DialogBase.Footer>
    </DialogBase>
  );
}
