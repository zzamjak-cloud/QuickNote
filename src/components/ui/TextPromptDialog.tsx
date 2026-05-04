import { useEffect, useState } from "react";
import { useUiStore } from "../../store/uiStore";

/** `useUiStore.requestTextPrompt`와 연동되는 전역 한 줄 입력 모달 */
export function TextPromptDialog() {
  const textPrompt = useUiStore((s) => s.textPrompt);
  const completeTextPrompt = useUiStore((s) => s.completeTextPrompt);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (textPrompt) setDraft(textPrompt.initialValue ?? "");
  }, [textPrompt]);

  if (!textPrompt) return null;

  const submit = () => {
    const v = draft.trim();
    completeTextPrompt(v === "" ? null : v);
  };

  return (
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center bg-black/45 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) completeTextPrompt(null);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {textPrompt.title}
        </h2>
        <input
          type="text"
          autoFocus
          placeholder={textPrompt.placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
            if (e.key === "Escape") completeTextPrompt(null);
          }}
          className="mt-3 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => completeTextPrompt(null)}
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            취소
          </button>
          <button
            type="button"
            onClick={submit}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
