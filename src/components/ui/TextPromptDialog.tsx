import { useEffect, useState } from "react";
import { useUiStore } from "../../store/uiStore";
import { DialogBase } from "../../lib/ui-primitives";

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

  const cancel = () => completeTextPrompt(null);

  return (
    <DialogBase
      open
      onClose={cancel}
      widthClassName="max-w-md"
      // 텍스트 선택 BubbleToolbar(z-[760]) 위에 떠야 링크 입력창이 가려지지 않는다.
      zClassName="z-[900]"
    >
      <DialogBase.Header>{textPrompt.title}</DialogBase.Header>
      <DialogBase.Body>
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
          }}
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
        />
      </DialogBase.Body>
      <DialogBase.Footer>
        <button
          type="button"
          onClick={cancel}
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
      </DialogBase.Footer>
    </DialogBase>
  );
}
