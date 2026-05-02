import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, ReactRenderer } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import "tippy.js/dist/tippy.css";
import "highlight.js/styles/github-dark.css";

import { usePageStore } from "../../store/pageStore";
import { SlashCommand } from "../../lib/tiptapExtensions/slashCommand";
import { MoveBlock } from "../../lib/tiptapExtensions/moveBlock";
import {
  filterSlashItems,
  type SlashItem,
} from "../../lib/tiptapExtensions/slashItems";
import { SlashMenu, type SlashMenuHandle } from "./SlashMenu";
import { ImageUpload } from "./ImageUpload";

const lowlight = createLowlight(common);

const AUTOSAVE_DEBOUNCE_MS = 300;

export function Editor() {
  const activeId = usePageStore((s) => s.activePageId);
  const page = usePageStore((s) =>
    activeId ? s.pages[activeId] : undefined,
  );
  const updateDoc = usePageStore((s) => s.updateDoc);
  const renamePage = usePageStore((s) => s.renamePage);

  const titleRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<number | null>(null);
  const [imageOpen, setImageOpen] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      Placeholder.configure({
        placeholder: "/ 를 입력해 명령 보기...",
      }),
      Link.configure({ openOnClick: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      CodeBlockLowlight.configure({ lowlight, defaultLanguage: "plaintext" }),
      Image,
      HorizontalRule,
      MoveBlock,
      SlashCommand.configure({
        suggestion: {
          char: "/",
          startOfLine: false,
          command: ({ editor, range, props }) => {
            (props as SlashItem).command({ editor, range });
          },
          items: ({ query }) => filterSlashItems(query).slice(0, 10),
          render: createSlashRenderer,
        },
      }),
    ],
    content: page?.doc ?? { type: "doc", content: [{ type: "paragraph" }] },
    editorProps: {
      attributes: {
        class:
          "prose prose-zinc dark:prose-invert max-w-none focus:outline-none px-12 py-8 min-h-[60vh]",
      },
    },
  });

  // 활성 페이지 변경 시 본문 동기화
  useEffect(() => {
    if (!editor || !page) return;
    const current = editor.getJSON();
    if (JSON.stringify(current) === JSON.stringify(page.doc)) return;
    editor.commands.setContent(page.doc, { emitUpdate: false });
  }, [editor, page?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 디바운스 자동 저장
  useEffect(() => {
    if (!editor) return;
    const handler = () => {
      if (!activeId) return;
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
      debounceRef.current = window.setTimeout(() => {
        updateDoc(activeId, editor.getJSON());
      }, AUTOSAVE_DEBOUNCE_MS);
    };
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, [editor, activeId, updateDoc]);

  // 이미지 업로드 모달 트리거
  useEffect(() => {
    const open = () => setImageOpen(true);
    window.addEventListener("quicknote:open-image-upload", open);
    return () =>
      window.removeEventListener("quicknote:open-image-upload", open);
  }, []);

  // 새 페이지 생성 시 제목 자동 포커스
  useEffect(() => {
    if (page && page.title === "새 페이지") {
      titleRef.current?.focus();
      titleRef.current?.select();
    }
  }, [page?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!page || !activeId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        페이지를 선택하거나 좌측 + 버튼으로 새 페이지를 만드세요.
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-white dark:bg-zinc-950">
      <div className="mx-auto w-full max-w-3xl">
        <input
          ref={titleRef}
          value={page.title}
          onChange={(e) => renamePage(activeId, e.target.value)}
          placeholder="제목 없음"
          className="mt-12 w-full bg-transparent px-12 text-4xl font-bold tracking-tight text-zinc-900 outline-none placeholder:text-zinc-300 dark:text-zinc-100 dark:placeholder:text-zinc-700"
        />
        <EditorContent editor={editor} />
      </div>
      <ImageUpload
        open={imageOpen}
        onClose={() => setImageOpen(false)}
        editor={editor}
      />
    </div>
  );
}

// tippy.js 기반 SuggestionRenderer. 공식 노션 클론 패턴 참고.
type RendererProps = {
  editor: import("@tiptap/react").Editor;
  clientRect?: (() => DOMRect | null) | null;
  command: (item: SlashItem) => void;
  items: SlashItem[];
  query: string;
  event?: KeyboardEvent;
};

function createSlashRenderer() {
  // ReactRenderer 제네릭은 컴포넌트의 props 시그니처를 따른다.
  // Suggestion이 넘기는 RendererProps는 슈퍼셋이므로 SlashMenu가 사용하는 키만 골라 전달.
  let component: ReactRenderer<SlashMenuHandle> | null = null;
  let popup: TippyInstance[] = [];

  const pickProps = (p: RendererProps) => ({
    items: p.items,
    command: p.command,
  });

  return {
    onStart: (props: RendererProps) => {
      component = new ReactRenderer(SlashMenu, {
        props: pickProps(props),
        editor: props.editor,
      });
      if (!props.clientRect) return;
      popup = tippy("body", {
        getReferenceClientRect: () => {
          const r = props.clientRect?.();
          return r ?? new DOMRect(0, 0, 0, 0);
        },
        appendTo: () => document.body,
        content: component.element,
        showOnCreate: true,
        interactive: true,
        trigger: "manual",
        placement: "bottom-start",
      });
    },
    onUpdate: (props: RendererProps) => {
      component?.updateProps(pickProps(props));
      if (!props.clientRect) return;
      popup[0]?.setProps({
        getReferenceClientRect: () => {
          const r = props.clientRect?.();
          return r ?? new DOMRect(0, 0, 0, 0);
        },
      });
    },
    onKeyDown: (props: { event: KeyboardEvent }) => {
      if (props.event.key === "Escape") {
        popup[0]?.hide();
        return true;
      }
      return component?.ref?.onKeyDown(props.event) ?? false;
    },
    onExit: () => {
      popup[0]?.destroy();
      component?.destroy();
      popup = [];
      component = null;
    },
  };
}
