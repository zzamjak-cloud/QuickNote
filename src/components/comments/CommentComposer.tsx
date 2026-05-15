// 블록 댓글 입력 — 단일 문단 + @멘션

import { useEffect, useCallback, useRef, useState } from "react";
import Document from "@tiptap/extension-document";
import HardBreak from "@tiptap/extension-hard-break";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { EditorContent, useEditor } from "@tiptap/react";
import { MemberMention } from "../../lib/tiptapExtensions/memberMention";
import { extractMentionMemberIdsFromDoc } from "../../lib/comments/extractMentions";
import type { JSONContent } from "@tiptap/react";
import { MentionSearchModal } from "../editor/MentionSearchModal";

type Props = {
  placeholder?: string;
  autoFocus?: boolean;
  submitLabel?: string;
  onSubmit: (bodyText: string, mentionIds: string[]) => void;
  disabled?: boolean;
  /** 수정 모드 등 — 전송 후 에디터 비우기 비활성화 */
  clearOnSubmit?: boolean;
  /** 초기 문서(수정 시 기존 본문) */
  initialJson?: JSONContent;
  /** initialJson 재적용 타이밍(부모 key와 함께 사용) */
  initialJsonVersion?: number | string;
  onCancel?: () => void;
};

export function CommentComposer({
  placeholder = "댓글 입력 (@ 로 멘션 검색) — Enter 전송, Shift+Enter 줄바꿈",
  autoFocus = false,
  submitLabel = "보내기",
  onSubmit,
  disabled = false,
  clearOnSubmit = true,
  initialJson,
  initialJsonVersion,
  onCancel,
}: Props) {
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  const clearOnSubmitRef = useRef(clearOnSubmit);
  clearOnSubmitRef.current = clearOnSubmit;
  const editorRef = useRef<import("@tiptap/react").Editor | null>(null);
  const [mentionRange, setMentionRange] = useState<{
    from: number;
    to: number;
  } | null>(null);
  const mentionModalOpenRef = useRef(false);
  mentionModalOpenRef.current = mentionRange !== null;

  const editor = useEditor({
    extensions: [
      Document,
      Paragraph,
      Text,
      HardBreak,
      MemberMention,
    ],
    content:
      (initialJson ??
        ({ type: "doc", content: [{ type: "paragraph" }] } as JSONContent)),
    editable: !disabled,
    editorProps: {
      attributes: {
        class:
          "qn-comment-composer prose prose-sm dark:prose-invert max-w-none min-h-[40px] rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950",
        "data-placeholder": placeholder,
      },
      handleKeyDown: (view, event) => {
        if (
          event.key === "@" &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey
        ) {
          const { $from } = view.state.selection;
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === "codeBlock") return false;
          }
          event.preventDefault();
          setMentionRange({
            from: view.state.selection.from,
            to: view.state.selection.to,
          });
          return true;
        }
        // Shift+Enter: 줄바꿈 (HardBreak)
        if (event.key === "Enter" && event.shiftKey) {
          if (mentionModalOpenRef.current) return false;
          const ed = editorRef.current;
          if (!ed || ed.isDestroyed) return false;
          event.preventDefault();
          ed.chain().focus().setHardBreak().run();
          return true;
        }
        // Enter: 전송
        if (event.key !== "Enter" || event.shiftKey) return false;
        if (mentionModalOpenRef.current) return false;
        if (
          document.body.querySelector(
            ".tippy-box[data-state='visible'], .tippy-box[style*='visibility: visible']",
          )
        ) {
          return false;
        }
        event.preventDefault();
        const ed = editorRef.current;
        if (!ed || ed.isDestroyed) return true;
        const text = ed.getText().trim();
        if (!text) return true;
        const mentionIds = extractMentionMemberIdsFromDoc(ed.getJSON());
        onSubmitRef.current(text, mentionIds);
        if (clearOnSubmitRef.current) ed.commands.clearContent();
        ed.commands.focus();
        return true;
      },
    },
  });

  useEffect(() => {
    editorRef.current = editor ?? null;
  }, [editor]);

  useEffect(() => {
    if (!editor || initialJson === undefined) return;
    editor.commands.setContent(initialJson);
  }, [editor, initialJson, initialJsonVersion]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  useEffect(() => {
    if (!editor || !autoFocus) return;
    editor.commands.focus("end");
  }, [editor, autoFocus]);

  const handleSend = useCallback(() => {
    if (!editor || disabled) return;
    const text = editor.getText().trim();
    if (!text) return;
    const mentionIds = extractMentionMemberIdsFromDoc(editor.getJSON());
    onSubmit(text, mentionIds);
    if (clearOnSubmit) editor.commands.clearContent();
    editor.commands.focus();
  }, [editor, disabled, clearOnSubmit, onSubmit]);

  if (!editor) return null;

  return (
    <div className="flex flex-col gap-2">
      <MentionSearchModal
        open={mentionRange !== null}
        onClose={() => setMentionRange(null)}
        editor={editor}
        range={mentionRange}
      />
      <EditorContent editor={editor} />
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <button
            type="button"
            disabled={disabled}
            onClick={onCancel}
            className="rounded-md border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            취소
          </button>
        ) : null}
        <button
          type="button"
          disabled={disabled}
          onClick={handleSend}
          className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
