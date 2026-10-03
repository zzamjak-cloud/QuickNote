// 관리자 강제 폐기 확인 — 사유(선택, 200자)를 받아 확인한다. 사유는 토큰 소유자 목록에도 보인다.
import { useEffect, useState } from "react";
import { DialogBase } from "../../lib/ui-primitives";

type Props = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
};

export function McpRevokeReasonDialog({ open, title, message, confirmLabel, onCancel, onConfirm }: Props) {
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  return (
    <DialogBase open={open} onClose={onCancel} widthClassName="max-w-md" labelId="qn-mcp-revoke-title" overlayStyle={{ zIndex: 520 }}>
      <DialogBase.Header id="qn-mcp-revoke-title">{title}</DialogBase.Header>
      <DialogBase.Body>
        <p className="whitespace-pre-wrap break-words text-sm">{message}</p>
        <label className="mt-3 block space-y-1">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">사유(선택, 소유자에게 표시)</span>
          <input
            type="text"
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
            placeholder="예: 퇴사, 기기 분실"
            className="min-h-[44px] w-full rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-red-400 md:min-h-0 md:py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
      </DialogBase.Body>
      <DialogBase.Footer>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          취소
        </button>
        <button
          type="button"
          onClick={() => onConfirm(reason.trim())}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
        >
          {confirmLabel}
        </button>
      </DialogBase.Footer>
    </DialogBase>
  );
}
