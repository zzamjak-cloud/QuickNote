import { useEffect, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  onSave: (email: string, displayName: string) => void;
};

export function AddContactDialog({ open, onClose, onSave }: Props) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");

  useEffect(() => {
    if (open) {
      setEmail("");
      setDisplayName("");
    }
  }, [open]);

  if (!open) return null;

  const submit = () => {
    const e = email.trim();
    const n = displayName.trim();
    if (!e || !n) return;
    onSave(e, n);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center bg-black/45 p-4"
      role="presentation"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="qn-add-contact-title"
        className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        onMouseDown={(ev) => ev.stopPropagation()}
      >
        <h2
          id="qn-add-contact-title"
          className="text-base font-semibold text-zinc-900 dark:text-zinc-100"
        >
          사람 추가
        </h2>
        <div className="mt-3 space-y-2">
          <label className="block text-[11px] font-medium text-zinc-500">
            이메일
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
            />
          </label>
          <label className="block text-[11px] font-medium text-zinc-500">
            이름
            <input
              type="text"
              autoComplete="name"
              value={displayName}
              onChange={(ev) => setDisplayName(ev.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
            />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            취소
          </button>
          <button
            type="button"
            onClick={submit}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            추가
          </button>
        </div>
      </div>
    </div>
  );
}
