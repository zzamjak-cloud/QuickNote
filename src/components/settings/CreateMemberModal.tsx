import { useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreate: (input: { email: string; name: string; jobRole: string }) => Promise<void> | void;
};

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function CreateMemberModal({ open, onClose, onCreate }: Props) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [jobRole, setJobRole] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const submit = async () => {
    const e = email.trim();
    const n = name.trim();
    const j = jobRole.trim();
    if (!e || !n || !j) {
      setError("모든 필드를 입력해 주세요.");
      return;
    }
    if (!isValidEmail(e)) {
      setError("이메일 형식이 올바르지 않습니다.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onCreate({ email: e, name: n, jobRole: j });
      onClose();
      setEmail("");
      setName("");
      setJobRole("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "멤버 생성에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[520] flex items-center justify-center bg-black/45 p-4"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-member-title"
        className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 id="create-member-title" className="text-sm font-semibold">구성원 추가</h3>
        <div className="mt-3 space-y-2 text-xs">
          <input
            placeholder="이름"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-zinc-300 px-2 py-1.5 outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-950"
          />
          <input
            placeholder="이메일"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-zinc-300 px-2 py-1.5 outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-950"
          />
          <input
            placeholder="직무"
            value={jobRole}
            onChange={(e) => setJobRole(e.target.value)}
            className="w-full rounded border border-zinc-300 px-2 py-1.5 outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-950"
          />
        </div>
        {error ? <p className="mt-2 text-xs text-red-500">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border px-3 py-1 text-xs">
            취소
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting}
            className="rounded bg-zinc-900 px-3 py-1 text-xs text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {submitting ? "생성 중..." : "추가"}
          </button>
        </div>
      </div>
    </div>
  );
}
