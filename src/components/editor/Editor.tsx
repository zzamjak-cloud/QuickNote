import { useEffect, useMemo, useRef, useState } from "react";
import { NodeSelection } from "@tiptap/pm/state";
import { useEditor, EditorContent, ReactRenderer } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { NodeRange } from "@tiptap/extension-node-range";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { ImageBlock } from "../../lib/tiptapExtensions/imageBlock";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
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
import EmojiPickerReact, { EmojiStyle, Theme } from "emoji-picker-react";
import { usePageStore } from "../../store/pageStore";
import { useSettingsStore } from "../../store/settingsStore";
import { SlashCommand } from "../../lib/tiptapExtensions/slashCommand";
import { MoveBlock } from "../../lib/tiptapExtensions/moveBlock";
import { Callout } from "../../lib/tiptapExtensions/callout";
import {
  Toggle,
  ToggleHeader,
  ToggleContent,
} from "../../lib/tiptapExtensions/toggle";
import { ColumnLayout, Column } from "../../lib/tiptapExtensions/columns";
import { CodeBlockLowlightStable } from "../../lib/tiptapExtensions/codeBlockLowlightStable";
import { CodeBlockCopy } from "../../lib/tiptapExtensions/codeBlockCopy";
import { decideDropMode } from "../../lib/blockDropMode";
import { BlockquoteNoInput } from "../../lib/tiptapExtensions/blockquote";
import { PageMention } from "../../lib/tiptapExtensions/pageMention";
import { EmojiShortcode } from "../../lib/tiptapExtensions/emojiShortcode";
import {
  filterSlashMenuEntries,
  type SlashMenuEntry,
  type SlashLeafItem,
} from "../../lib/tiptapExtensions/slashItems";
import { DatabaseBlock } from "../../lib/tiptapExtensions/databaseBlock";
import { SlashMenu, type SlashMenuHandle } from "./SlashMenu";
import { ImageUpload } from "./ImageUpload";
import { IconPicker } from "../common/IconPicker";
import { BubbleToolbar } from "./BubbleToolbar";
import { ImageResizeOverlay } from "./ImageResizeOverlay";
import { BlockHandles } from "./BlockHandles";
import type { JSONContent } from "@tiptap/react";
import { stripStaleBlobImages } from "../../lib/sanitizeDocImages";
import { useBoxSelect } from "../../hooks/useBoxSelect";
import { useDatabaseStore } from "../../store/databaseStore";

/** 풀 페이지 DB — 페이지 제목 입력 시 blur 에서만 DB 메타 제목 갱신(중복 검사) */
function trySyncFullPageDatabaseTitle(
  doc: JSONContent,
  pageTitle: string,
): boolean {
  const c = doc.content;
  if (!c?.length) return true;
  const first = c[0];
  if (
    first?.type === "databaseBlock" &&
    first.attrs &&
    typeof first.attrs.databaseId === "string"
  ) {
    return useDatabaseStore
      .getState()
      .setDatabaseTitle(first.attrs.databaseId, pageTitle);
  }
  return true;
}

/** 전체 페이지 DB — 문서 첫 노드가 fullPage databaseBlock 일 때 하위에 붙은 빈 문단 등을 제거 */
function normalizeFullPageDatabaseDoc(doc: JSONContent): JSONContent {
  const c = doc.content;
  if (!c?.length) return doc;
  const first = c[0];
  if (
    first?.type === "databaseBlock" &&
    first.attrs &&
    (first.attrs as { layout?: string }).layout === "fullPage"
  ) {
    if (c.length === 1) return doc;
    return {
      type: "doc",
      content: [JSON.parse(JSON.stringify(first)) as JSONContent],
    };
  }
  return doc;
}

const lowlight = createLowlight(common);
const AUTOSAVE_DEBOUNCE_MS = 300;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** useEditor content 폴백 — 매 렌더 새 객체를 넘기면 옵션 비교 실패 → setOptions 반복 → 무한 업데이트 */
const EMPTY_EDITOR_DOC: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

function loadImageDimensions(
  src: string,
): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () =>
      resolve({ w: im.naturalWidth, h: im.naturalHeight });
    im.onerror = () => resolve(null);
    im.src = src;
  });
}

/** 로컬 저장 후에도 유지되도록 data URL 로 삽입(blob URL 은 새로고침 시 깨짐). */
function insertImageFromFile(
  file: File,
  insert: (src: string, dim?: { w: number; h: number }) => void,
): boolean {
  if (file.size > MAX_IMAGE_BYTES) {
    alert(
      `5MB 이하 이미지만 가능합니다 (현재 ${(file.size / 1024 / 1024).toFixed(1)}MB).`,
    );
    return false;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const src = String(reader.result);
    void loadImageDimensions(src).then((dim) => insert(src, dim ?? undefined));
  };
  reader.readAsDataURL(file);
  return true;
}

type EditorProps = {
  /** 지정 시 해당 페이지를 편집(예: 사이드 피크). 미지정이면 activePageId 사용. */
  pageId?: string;
  /** 본문만 렌더(아이콘·제목 영역 숨김). 피크처럼 외부에서 제목을 따로 표시할 때 사용. */
  bodyOnly?: boolean;
};

export function Editor({ pageId, bodyOnly = false }: EditorProps = {}) {
  const activeId = usePageStore((s) => s.activePageId);
  const effectivePageId = pageId ?? activeId;
  const page = usePageStore((s) =>
    effectivePageId ? s.pages[effectivePageId] : undefined,
  );
  const updateDoc = usePageStore((s) => s.updateDoc);
  const renamePage = usePageStore((s) => s.renamePage);
  const setIcon = usePageStore((s) => s.setIcon);

  const darkMode = useSettingsStore((s) => s.darkMode);
  const fullWidth = useSettingsStore((s) => s.fullWidth);

  const titleRef = useRef<HTMLInputElement | null>(null);
  /** 풀 페이지 DB 제목 중복 시 입력 되돌리기용 — 마지막으로 저장에 성공한 제목 */
  const dbTitleBaselineRef = useRef("");
  const debounceRef = useRef<number | null>(null);
  const [imageOpen, setImageOpen] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [emojiAnchor, setEmojiAnchor] = useState<{ top: number; left: number; insertPos: number } | null>(null);

  const columnDropRef = useRef<{
    side: "left" | "right";
    targetBlockStart: number;
  } | null>(null);

  const [columnDropIndicator, setColumnDropIndicator] = useState<{
    x: number;
    top: number;
    height: number;
  } | null>(null);

  const extensions = useMemo(
    () => [
      NodeRange.configure({}),
      StarterKit.configure({
        codeBlock: false,
        blockquote: false,
        // 아래는 동일 이름으로 별도 등록하므로 StarterKit 쪽은 끈다.
        link: false,
        horizontalRule: false,
        dropcursor: {
          color: false,
          width: 2,
          class: "qn-dropcursor",
        },
      }),
      BlockquoteNoInput,
      Placeholder.configure({
        placeholder: "/ 를 입력해 명령 보기...",
      }),
      Link.configure({ openOnClick: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      CodeBlockLowlightStable.configure({
        lowlight,
        /* null + fallbackLanguage: highlightAuto 없이 고정 언어로만 강조(입력 중 색 요동 방지) */
        defaultLanguage: null,
        fallbackLanguage: "javascript",
        HTMLAttributes: {
          class: "hljs qn-code-block not-prose",
        },
      }),
      CodeBlockCopy,
      ImageBlock.configure({ allowBase64: true }),
      HorizontalRule,
      MoveBlock,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Youtube.configure({ width: 560, height: 315 }),
      Callout,
      ColumnLayout,
      Column,
      Toggle,
      ToggleHeader,
      ToggleContent,
      PageMention,
      EmojiShortcode,
      DatabaseBlock,
      SlashCommand.configure({
        suggestion: {
          char: "/",
          startOfLine: false,
          command: ({ editor, range, props }) => {
            const e = props as SlashMenuEntry;
            if (e.kind === "leaf") {
              e.command({ editor, range });
            }
          },
          items: ({ query }) => filterSlashMenuEntries(query).slice(0, 40),
          render: createSlashRenderer,
          shouldShow: ({ editor }) => {
            const { $from } = editor.state.selection;
            for (let d = $from.depth; d > 0; d--) {
              if ($from.node(d).type.name === "codeBlock") return false;
            }
            return true;
          },
        },
      }),
      Extension.create({
        name: "blockDuplicate",
        addKeyboardShortcuts() {
          return {
            "Mod-d": () => {
              const { state, view } = this.editor;
              const { $from } = state.selection;
              if ($from.depth < 1) return false;

              const nodeStart = $from.before(1);
              const node = $from.node(1);
              if (!node) return false;

              const insertAt = nodeStart + node.nodeSize;
              const tr = state.tr.insert(insertAt, node.copy(node.content));
              view.dispatch(tr.scrollIntoView());
              return true;
            },
          };
        },
      }),
    ],
    [],
  );

  const editorProps = useMemo(
    () => ({
      attributes: {
        class:
          "prose prose-zinc dark:prose-invert max-w-none focus:outline-none px-12 py-8 min-h-[min(85vh,900px)] qn-prose-marquee-host",
      },
      handlePaste: (view: import("@tiptap/pm/view").EditorView, event: ClipboardEvent) => {
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const item of Array.from(items)) {
          if (item.type.startsWith("image/")) {
            const file = item.getAsFile();
            if (file) {
              const ok = insertImageFromFile(file, (src, dim) => {
                view.dispatch(
                  view.state.tr.replaceSelectionWith(
                    view.state.schema.nodes.image!.create({
                      src,
                      ...(dim
                        ? { width: dim.w, height: dim.h }
                        : {}),
                    }),
                  ),
                );
              });
              if (ok) {
                event.preventDefault();
                return true;
              }
            }
          }
        }
        return false;
      },
      handleDrop: (
        view: import("@tiptap/pm/view").EditorView,
        event: DragEvent,
        _slice: unknown,
        moved: boolean,
      ) => {
        // 컬럼 분할 드롭
        if (moved && columnDropRef.current) {
          const { side, targetBlockStart } = columnDropRef.current;
          columnDropRef.current = null;
          setColumnDropIndicator(null);
          document.body.classList.remove("quicknote-column-drop");

          const sel = view.state.selection;
          if (!(sel instanceof NodeSelection)) return false;

          const draggedStart = sel.from;
          const draggedNode = sel.node;
          const targetNode = view.state.doc.nodeAt(targetBlockStart);
          if (!targetNode || draggedStart === targetBlockStart) return false;

          const { schema } = view.state;
          if (!schema.nodes.column || !schema.nodes.columnLayout) return false;

          event.preventDefault();

          const pos1 = Math.min(draggedStart, targetBlockStart);
          const pos2 = Math.max(draggedStart, targetBlockStart);
          const node1 = view.state.doc.nodeAt(pos1)!;
          const node2 = view.state.doc.nodeAt(pos2)!;

          // 기존 columnLayout에 열 추가 (최대 4열)
          if (targetNode.type.name === "columnLayout") {
            const existingCols: import("@tiptap/pm/model").Node[] = [];
            targetNode.content.forEach((col) => existingCols.push(col));
            if (existingCols.length >= 4) return false;
            const newCol = schema.nodes.column.create({}, draggedNode.copy(draggedNode.content));
            const newCols = side === "right"
              ? [...existingCols, newCol]
              : [newCol, ...existingCols];
            const newLayout = schema.nodes.columnLayout.create({ columns: newCols.length }, newCols);
            const tr = view.state.tr;
            tr.delete(pos2, pos2 + node2.nodeSize);
            tr.delete(pos1, pos1 + node1.nodeSize);
            tr.insert(pos1, newLayout);
            view.dispatch(tr.scrollIntoView());
            return true;
          }

          // 새 2열 레이아웃 생성
          const leftNode =
            side === "left"
              ? (draggedStart < targetBlockStart ? draggedNode : targetNode)
              : (draggedStart < targetBlockStart ? targetNode : draggedNode);
          const rightNode =
            side === "left"
              ? (draggedStart < targetBlockStart ? targetNode : draggedNode)
              : (draggedStart < targetBlockStart ? draggedNode : targetNode);

          const col1 = schema.nodes.column.create({}, leftNode.copy(leftNode.content));
          const col2 = schema.nodes.column.create({}, rightNode.copy(rightNode.content));
          const layout = schema.nodes.columnLayout.create({ columns: 2 }, [col1, col2]);

          const tr = view.state.tr;
          tr.delete(pos2, pos2 + node2.nodeSize);
          tr.delete(pos1, pos1 + node1.nodeSize);
          tr.insert(pos1, layout);
          view.dispatch(tr.scrollIntoView());
          return true;
        }

        // 기존 이미지 파일 드롭
        if (moved) return false;
        event.preventDefault?.();
        const dt = event.dataTransfer;
        const files = dt?.files;
        if (!files || files.length === 0) return false;
        const imgFile = Array.from(files).find((f) => f.type.startsWith("image/"));
        if (!imgFile) return false;
        const coord = view.posAtCoords({ left: event.clientX, top: event.clientY });
        const ok = insertImageFromFile(imgFile, (src, dim) => {
          const tr = view.state.tr;
          const node = view.state.schema.nodes.image!.create({
            src,
            ...(dim ? { width: dim.w, height: dim.h } : {}),
          });
          if (coord) {
            tr.insert(coord.pos, node);
          } else {
            tr.replaceSelectionWith(node);
          }
          view.dispatch(tr.scrollIntoView());
        });
        return ok;
      },
    }),
    [],
  );

  // 풀 페이지 데이터베이스 — 첫 블록이 fullPage databaseBlock 이면 해당 페이지는 본문 에디터로 쓰지 않음(인라인 DB 와 구분).
  // 예전에는 doc 가 단일 블록일 때만 잡아서, 빈 문단 하나만 생겨도 편집이 다시 켜지는 문제가 있었음.
  const isFullPageDatabase = useMemo(() => {
    if (!page) return false;
    const c = page.doc.content;
    if (!c?.length) return false;
    const first = c[0];
    return (
      first?.type === "databaseBlock" &&
      first.attrs?.layout === "fullPage"
    );
  }, [page?.doc]);

  // content 로 store 의 page.doc 를 넘기면 자동저장마다 참조가 바뀌어 setOptions 가 무한 호출됨.
  // 초기값은 고정 EMPTY 만 넘기고, 실제 문서는 아래 effect 에서만 주입한다.
  const editor = useEditor({
    extensions,
    content: EMPTY_EDITOR_DOC,
    editorProps,
    shouldRerenderOnTransaction: false,
    editable: !isFullPageDatabase,
  });

  // 활성 페이지 변경 시 본문 동기화. page.doc 를 deps 에 넣지 않음(타이핑·저장마다 doc 참조 변경 → setContent 루프·내용 되살림).
  useEffect(() => {
    if (!editor || !page || !effectivePageId) return;
    let safeDoc = stripStaleBlobImages(page.doc);
    safeDoc = normalizeFullPageDatabaseDoc(safeDoc);
    if (JSON.stringify(safeDoc) !== JSON.stringify(page.doc)) {
      updateDoc(effectivePageId, safeDoc);
    }
    const current = editor.getJSON();
    if (JSON.stringify(current) === JSON.stringify(safeDoc)) return;
    queueMicrotask(() => {
      if (editor.isDestroyed) return;
      editor.commands.setContent(safeDoc, { emitUpdate: false });
    });
  }, [editor, page?.id, effectivePageId, updateDoc]); // eslint-disable-line react-hooks/exhaustive-deps -- page.doc 변경 시 재동기화는 id 전환만

  // 디바운스 자동 저장
  useEffect(() => {
    if (!editor) return;
    const handler = () => {
      if (!effectivePageId) return;
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
      debounceRef.current = window.setTimeout(() => {
        const json = normalizeFullPageDatabaseDoc(editor.getJSON());
        updateDoc(effectivePageId, json);
      }, AUTOSAVE_DEBOUNCE_MS);
    };
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, [editor, effectivePageId, updateDoc]);

  // 컬럼 분할 드래그오버 감지
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;

    const clearDrop = () => {
      columnDropRef.current = null;
      setColumnDropIndicator(null);
      // 컬럼 모드 해제 → dropcursor(가로 점선) 다시 표시 허용
      document.body.classList.remove("quicknote-column-drop");
    };

    const onDragOver = (e: DragEvent) => {
      if (!document.body.classList.contains("quicknote-block-dragging")) return;
      e.preventDefault();

      const coords = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
      if (!coords) { clearDrop(); return; }
      let $pos;
      try { $pos = editor.state.doc.resolve(coords.pos); } catch { clearDrop(); return; }

      let targetNode = null;
      let targetStart = -1;
      for (let d = $pos.depth; d >= 1; d--) {
        const n = $pos.node(d);
        if (n.isBlock && n.type.name !== "doc") {
          if (d === 1 || $pos.node(d - 1).type.name === "doc") {
            targetNode = n;
            targetStart = $pos.before(d);
            break;
          }
        }
      }
      if (!targetNode || targetStart < 0) { clearDrop(); return; }

      const domEl = editor.view.nodeDOM(targetStart);
      const el = domEl instanceof HTMLElement ? domEl : (domEl as Node | null)?.parentElement;
      if (!el) { clearDrop(); return; }
      const rect = el.getBoundingClientRect();

      // 좌·우 가장자리 ~20% 영역만 컬럼 분할 모드, 그 외는 리스트 모드로 단일 결정.
      // 컬럼 모드일 때만 컬럼 인디케이터를 켜고 body 클래스 토글로 dropcursor 를 숨겨
      // 두 인디케이터가 동시에 표시되지 않도록 한다.
      const mode = decideDropMode(rect.left, rect.width, e.clientX, 0.2);
      if (mode === "column-left") {
        columnDropRef.current = { side: "left", targetBlockStart: targetStart };
        setColumnDropIndicator({ x: rect.left - 1, top: rect.top, height: rect.height });
        document.body.classList.add("quicknote-column-drop");
      } else if (mode === "column-right") {
        columnDropRef.current = { side: "right", targetBlockStart: targetStart };
        setColumnDropIndicator({ x: rect.right - 1, top: rect.top, height: rect.height });
        document.body.classList.add("quicknote-column-drop");
      } else {
        clearDrop();
      }
    };

    dom.addEventListener("dragover", onDragOver);
    dom.addEventListener("dragleave", clearDrop);
    document.addEventListener("dragend", clearDrop);
    return () => {
      dom.removeEventListener("dragover", onDragOver);
      dom.removeEventListener("dragleave", clearDrop);
      document.removeEventListener("dragend", clearDrop);
    };
  }, [editor]);

  // 이미지 업로드 모달 트리거
  useEffect(() => {
    const open = () => setImageOpen(true);
    window.addEventListener("quicknote:open-image-upload", open);
    return () =>
      window.removeEventListener("quicknote:open-image-upload", open);
  }, []);

  // 이모지 피커 모달 트리거
  useEffect(() => {
    const open = () => {
      if (!editor) return;
      const insertPos = editor.state.selection.from;
      let top = 200;
      let left = 200;
      try {
        const coords = editor.view.coordsAtPos(insertPos);
        top = coords.bottom + 8;
        left = coords.left;
      } catch {
        // 기본값 유지
      }
      setEmojiAnchor({ top, left, insertPos });
      setEmojiPickerOpen(true);
    };
    window.addEventListener("quicknote:open-emoji-picker", open);
    return () => window.removeEventListener("quicknote:open-emoji-picker", open);
  }, []);

  // 새 페이지 생성 시 제목 자동 포커스
  useEffect(() => {
    if (page && page.title === "새 페이지") {
      titleRef.current?.focus();
      titleRef.current?.select();
    }
  }, [page?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 풀 페이지 DB 제목 되돌리기 기준 — 페이지 전환 시에만 동기화(입력 중 매 글자로 덮어쓰지 않음)
  useEffect(() => {
    if (page) dbTitleBaselineRef.current = page.title;
  }, [page?.id, effectivePageId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // editor.editable 토글 — read-only 상태로 두면 슬래시 메뉴, 텍스트 입력, 블록 추가 모두 차단.
  // DB 블록의 React NodeView 내부 input/button 은 contenteditable 영향 밖이라 정상 동작.
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!isFullPageDatabase);
    if (isFullPageDatabase) {
      // PM 이 atom 단독 doc 에 자동으로 NodeSelection 을 만들어 .ProseMirror-selectednode 가
      // 보이는 현상 + BubbleToolbar 가 뜨는 현상을 막기 위해 선택을 점선택으로 접고 포커스 해제.
      try {
        editor.commands.setTextSelection(0);
      } catch {
        // doc 첫 위치가 atom 시작이라 TextSelection 부적합한 경우 무시
      }
      if (editor.view.dom instanceof HTMLElement) editor.view.dom.blur();
    }
  }, [editor, isFullPageDatabase]);

  // 풀 페이지 DB 모드에서는 박스 드래그 자체가 무의미 — null 전달로 비활성.
  const { selectedStarts: boxSelectedStarts, clearSelection: clearBoxSelection } =
    useBoxSelect(isFullPageDatabase ? null : editor);

  if (!page || !effectivePageId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        페이지를 선택하거나 좌측 + 버튼으로 새 페이지를 만드세요.
      </div>
    );
  }

  return (
    <div className="relative flex flex-1 flex-col overflow-y-auto bg-white dark:bg-zinc-950">
      <div
        className={`relative mx-auto w-full ${fullWidth ? "max-w-none px-4" : "max-w-3xl"}`}
        data-qn-editor-column
      >
        {!bodyOnly && (
          <>
            <div className="mt-12 px-12">
              <IconPicker
                current={page.icon}
                onChange={(icon) => setIcon(effectivePageId, icon)}
              />
            </div>
            <input
              ref={titleRef}
              value={page.title}
              onChange={(e) => {
                renamePage(effectivePageId, e.target.value);
              }}
              onBlur={() => {
                if (!isFullPageDatabase) return;
                const ok = trySyncFullPageDatabaseTitle(page.doc, page.title);
                if (!ok) {
                  alert("이미 사용 중인 데이터베이스 이름입니다.");
                  renamePage(effectivePageId, dbTitleBaselineRef.current);
                } else {
                  dbTitleBaselineRef.current = page.title;
                }
              }}
              placeholder="제목 없음"
              className="mt-2 w-full bg-transparent px-12 text-4xl font-bold tracking-tight text-zinc-900 outline-none placeholder:text-zinc-300 dark:text-zinc-100 dark:placeholder:text-zinc-700"
            />
          </>
        )}
        <div className="relative">
          <EditorContent editor={editor} />
          {!isFullPageDatabase && (
            <BlockHandles
              editor={editor}
              boxSelectedStarts={boxSelectedStarts}
              onClearBoxSelection={clearBoxSelection}
            />
          )}
          {columnDropIndicator && (
            <div
              className="qn-column-drop-indicator"
              style={{
                left: columnDropIndicator.x,
                top: columnDropIndicator.top,
                height: columnDropIndicator.height,
              }}
            />
          )}
        </div>
      </div>
      <BubbleToolbar editor={editor} />
      <ImageResizeOverlay editor={editor} />
      <ImageUpload
        open={imageOpen}
        onClose={() => setImageOpen(false)}
        editor={editor}
      />
      {emojiPickerOpen && emojiAnchor && (
        <div
          className="fixed inset-0 z-50"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setEmojiPickerOpen(false);
          }}
        >
          <div
            className="absolute"
            style={{
              top: emojiAnchor.top,
              left: emojiAnchor.left,
            }}
          >
            <EmojiPickerReact
              theme={darkMode ? Theme.DARK : Theme.LIGHT}
              emojiStyle={EmojiStyle.NATIVE}
              previewConfig={{ showPreview: false }}
              searchDisabled={false}
              lazyLoadEmojis
              width={320}
              height={380}
              onEmojiClick={(data) => {
                if (editor && emojiAnchor.insertPos != null) {
                  editor
                    .chain()
                    .focus()
                    .insertContentAt(emojiAnchor.insertPos, data.emoji)
                    .run();
                }
                setEmojiPickerOpen(false);
                setEmojiAnchor(null);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// tippy.js 기반 SuggestionRenderer.
type RendererProps = {
  editor: import("@tiptap/react").Editor;
  clientRect?: (() => DOMRect | null) | null;
  command: (item: SlashMenuEntry) => void;
  items: SlashMenuEntry[];
  query: string;
  event?: KeyboardEvent;
};

function createSlashRenderer() {
  let component: ReactRenderer<SlashMenuHandle> | null = null;
  let popup: TippyInstance[] = [];

  const pickProps = (p: RendererProps) => ({
    entries: filterSlashMenuEntries(p.query),
    query: p.query,
    command: (item: SlashLeafItem) => p.command(item),
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
        theme: "quicknote-suggestion",
        arrow: false,
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
