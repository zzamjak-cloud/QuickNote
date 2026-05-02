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
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { Highlight } from "@tiptap/extension-highlight";
import { Youtube } from "@tiptap/extension-youtube";
import { common, createLowlight } from "lowlight";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import "tippy.js/dist/tippy.css";
import "highlight.js/styles/github-dark.css";

import { usePageStore } from "../../store/pageStore";
import { SlashCommand } from "../../lib/tiptapExtensions/slashCommand";
import { MoveBlock } from "../../lib/tiptapExtensions/moveBlock";
import { Callout } from "../../lib/tiptapExtensions/callout";
import {
  Toggle,
  ToggleHeader,
  ToggleContent,
} from "../../lib/tiptapExtensions/toggle";
import { PageMention } from "../../lib/tiptapExtensions/pageMention";
import {
  filterSlashItems,
  type SlashItem,
} from "../../lib/tiptapExtensions/slashItems";
import { SlashMenu, type SlashMenuHandle } from "./SlashMenu";
import { ImageUpload } from "./ImageUpload";
import { IconPicker } from "../common/IconPicker";
import { BubbleToolbar } from "./BubbleToolbar";
import { BlockHandles } from "./BlockHandles";

const lowlight = createLowlight(common);
const AUTOSAVE_DEBOUNCE_MS = 300;

export function Editor() {
  const activeId = usePageStore((s) => s.activePageId);
  const page = usePageStore((s) =>
    activeId ? s.pages[activeId] : undefined,
  );
  const updateDoc = usePageStore((s) => s.updateDoc);
  const renamePage = usePageStore((s) => s.renamePage);
  const setIcon = usePageStore((s) => s.setIcon);

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
      // 표
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      // 인라인 스타일
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      // 임베드
      Youtube.configure({ width: 560, height: 315 }),
      // 커스텀 노드
      Callout,
      Toggle,
      ToggleHeader,
      ToggleContent,
      // 페이지 멘션
      PageMention,
      SlashCommand.configure({
        suggestion: {
          char: "/",
          startOfLine: false,
          command: ({ editor, range, props }) => {
            (props as SlashItem).command({ editor, range });
          },
          items: ({ query }) => filterSlashItems(query).slice(0, 12),
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

  // 페이지 멘션 클릭 시 해당 페이지로 이동
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const onClick = (e: Event) => {
      const target = (e.target as HTMLElement).closest(".page-mention");
      if (!target) return;
      const id = target.getAttribute("data-id");
      if (id) {
        usePageStore.getState().setActivePage(id);
      }
    };
    dom.addEventListener("click", onClick);
    return () => dom.removeEventListener("click", onClick);
  }, [editor]);

  if (!page || !activeId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        페이지를 선택하거나 좌측 + 버튼으로 새 페이지를 만드세요.
      </div>
    );
  }

  return (
    <div className="relative flex flex-1 flex-col overflow-y-auto bg-white dark:bg-zinc-950">
      <div className="relative mx-auto w-full max-w-3xl">
        <div className="mt-12 px-12">
          <IconPicker
            current={page.icon}
            onChange={(icon) => setIcon(activeId, icon)}
          />
        </div>
        <input
          ref={titleRef}
          value={page.title}
          onChange={(e) => renamePage(activeId, e.target.value)}
          placeholder="제목 없음"
          className="mt-2 w-full bg-transparent px-12 text-4xl font-bold tracking-tight text-zinc-900 outline-none placeholder:text-zinc-300 dark:text-zinc-100 dark:placeholder:text-zinc-700"
        />
        <div className="relative">
          <EditorContent editor={editor} />
          <BlockHandles editor={editor} />
        </div>
      </div>
      <BubbleToolbar editor={editor} />
      <ImageUpload
        open={imageOpen}
        onClose={() => setImageOpen(false)}
        editor={editor}
      />
    </div>
  );
}

// tippy.js 기반 SuggestionRenderer.
type RendererProps = {
  editor: import("@tiptap/react").Editor;
  clientRect?: (() => DOMRect | null) | null;
  command: (item: SlashItem) => void;
  items: SlashItem[];
  query: string;
  event?: KeyboardEvent;
};

function createSlashRenderer() {
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
