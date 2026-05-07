import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import type { createLowlight } from "lowlight";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import "tippy.js/dist/tippy.css";
type LowlightApi = ReturnType<typeof createLowlight>;

const LazyEditorEmojiPicker = lazy(() =>
  import("./EditorEmojiPickerPanel").then((m) => ({
    default: m.EditorEmojiPickerPanel,
  })),
);
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
import { MemberMention } from "../../lib/tiptapExtensions/memberMention";
import { EmojiShortcode } from "../../lib/tiptapExtensions/emojiShortcode";
import {
  filterSlashMenuEntries,
  type SlashMenuEntry,
  type SlashLeafItem,
} from "../../lib/tiptapExtensions/slashItems";
import { DatabaseBlock } from "../../lib/tiptapExtensions/databaseBlock";
import { PageLink } from "../../lib/tiptapExtensions/pageLink";
import { ButtonBlock } from "../../lib/tiptapExtensions/buttonBlock";
import { SlashMenu, type SlashMenuHandle } from "./SlashMenu";
import { ImageUpload } from "./ImageUpload";
import { IconPicker } from "../common/IconPicker";
import { BubbleToolbar } from "./BubbleToolbar";
import { ImageResizeOverlay } from "./ImageResizeOverlay";
import { BlockHandles } from "./BlockHandles";
import type { JSONContent } from "@tiptap/react";
import { stripStaleBlobImages } from "../../lib/sanitizeDocImages";
import { isAllowedTipTapLinkUri } from "../../lib/safeUrl";
import { useBoxSelect } from "../../hooks/useBoxSelect";
import { useDatabaseStore } from "../../store/databaseStore";
import { tipTapJsonDocEquals } from "../../lib/pm/jsonDocEquals";
import { scheduleEditorMutation } from "../../lib/pm/scheduleEditorMutation";
import { reportNonFatal } from "../../lib/reportNonFatal";
import {
  createEditorHandleDrop,
  type ColumnDropState,
} from "../../lib/editor/editorHandleDrop";
import { insertImageFromFile } from "../../lib/editor/insertImageFromFile";
import { SimpleAlertDialog } from "../ui/SimpleAlertDialog";
import { PageCoverImage } from "./PageCoverImage";

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
      content: [structuredClone(first) as JSONContent],
    };
  }
  return doc;
}

const AUTOSAVE_DEBOUNCE_MS = 300;

/** useEditor content 폴백 — 매 렌더 새 객체를 넘기면 옵션 비교 실패 → setOptions 반복 → 무한 업데이트 */
const EMPTY_EDITOR_DOC: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

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
  const setCoverImage = usePageStore((s) => s.setCoverImage);

  const darkMode = useSettingsStore((s) => s.darkMode);
  const fullWidth = useSettingsStore((s) => s.fullWidth);

  const titleRef = useRef<HTMLInputElement | null>(null);
  /** 풀 페이지 DB 제목 중복 시 입력 되돌리기용 — 마지막으로 저장에 성공한 제목 */
  const dbTitleBaselineRef = useRef("");
  const debounceRef = useRef<number | null>(null);
  const [imageOpen, setImageOpen] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [emojiAnchor, setEmojiAnchor] = useState<{ top: number; left: number; insertPos: number } | null>(null);

  const columnDropRef = useRef<ColumnDropState>(null);

  const [columnDropIndicator, setColumnDropIndicator] = useState<{
    x: number;
    top: number;
    height: number;
  } | null>(null);

  const [simpleAlert, setSimpleAlert] = useState<string | null>(null);

  const clearColumnDropUi = useCallback(() => {
    setColumnDropIndicator(null);
    document.body.classList.remove("quicknote-column-drop");
  }, [setColumnDropIndicator]);

  const handleEditorInsertImage = useCallback(
    (file: File, insert: Parameters<typeof insertImageFromFile>[1]) =>
      insertImageFromFile(file, insert, {
        onSizeExceeded: (mb) =>
          setSimpleAlert(
            `5MB 이하 이미지만 가능합니다 (현재 ${mb.toFixed(1)}MB).`,
          ),
      }),
    [setSimpleAlert],
  );

  const [lowlightApi, setLowlightApi] = useState<LowlightApi | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import("lowlight").then(({ common, createLowlight }) => {
      if (!cancelled) setLowlightApi(createLowlight(common));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const extensions = useMemo(
    () => [
      NodeRange.configure({}),
      StarterKit.configure({
        // lowlight 청크 로딩 전: 기본 codeBlock(구문강조 없음). 로드 후 CodeBlockLowlight로 교체됨.
        codeBlock: lowlightApi
          ? false
          : {
              HTMLAttributes: {
                class: "hljs qn-code-block not-prose",
              },
            },
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
      Link.configure({
        openOnClick: false,
        // protocols 를 넣으면 linkifyjs에 registerCustomProtocol이 돌아가는데,
        // 자동 링크·붙여넣기가 먼저 쓰인 뒤면 "already initialized" 경고가 난다.
        // http/https/mailto/tel 은 Link 기본 isAllowedUri에 이미 포함되므로 생략한다.
        isAllowedUri: isAllowedTipTapLinkUri,
        HTMLAttributes: {
          rel: "noopener noreferrer nofollow",
          target: "_blank",
        },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      ...(lowlightApi
        ? [
            CodeBlockLowlightStable.configure({
              lowlight: lowlightApi,
              /* null + fallbackLanguage: highlightAuto 없이 고정 언어로만 강조(입력 중 색 요동 방지) */
              defaultLanguage: null,
              fallbackLanguage: "javascript",
              HTMLAttributes: {
                class: "hljs qn-code-block not-prose",
              },
            }),
          ]
        : []),
      CodeBlockCopy,
      // 대용량 data: URL 을 문서 JSON 에 넣지 않음 — 이미지는 v4 S3 ref(quicknote-image://) 사용.
      ImageBlock.configure({ allowBase64: false }),
      HorizontalRule,
      MoveBlock,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Youtube.configure({ width: 560, height: 315, nocookie: true }),
      Callout,
      ColumnLayout,
      Column,
      Toggle,
      ToggleHeader,
      ToggleContent,
      MemberMention,
      EmojiShortcode,
      DatabaseBlock,
      PageLink,
      ButtonBlock,
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
    [lowlightApi],
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
              event.preventDefault();
              void handleEditorInsertImage(file, (attrs) => {
                view.dispatch(
                  view.state.tr.replaceSelectionWith(
                    view.state.schema.nodes.image!.create(attrs),
                  ),
                );
              });
              return true;
            }
          }
        }
        return false;
      },
      handleDrop: createEditorHandleDrop({
        columnDropRef,
        clearColumnDropUi,
        insertImageFromFile: handleEditorInsertImage,
      }),
    }),
    [clearColumnDropUi, handleEditorInsertImage],
  );

  // 풀 페이지 데이터베이스 — 첫 블록이 fullPage databaseBlock 이면 해당 페이지는 본문 에디터로 쓰지 않음(인라인 DB 와 구분).
  // 예전에는 doc 가 단일 블록일 때만 잡아서, 빈 문단 하나만 생겨도 편집이 다시 켜지는 문제가 있었음.
  const pageDoc = page?.doc;
  const isFullPageDatabase = useMemo(() => {
    if (!pageDoc) return false;
    const c = pageDoc.content;
    if (!c?.length) return false;
    const first = c[0];
    return (
      first?.type === "databaseBlock" &&
      first.attrs?.layout === "fullPage"
    );
  }, [pageDoc]);

  // content 로 store 의 page.doc 를 넘기면 자동저장마다 참조가 바뀌어 setOptions 가 무한 호출됨.
  // 초기값은 고정 EMPTY 만 넘기고, 실제 문서는 아래 effect 에서만 주입한다.
  const editor = useEditor(
    {
      extensions,
      content: EMPTY_EDITOR_DOC,
      editorProps,
      shouldRerenderOnTransaction: false,
      editable: !isFullPageDatabase,
    },
    [lowlightApi],
  );

  // 활성 페이지 변경 + 원격 변경 수신 시 본문 동기화.
  // deps 에 page?.updatedAt 을 포함해 다른 클라이언트의 push (subscription → applyRemotePageToStore) 가
  // 즉시 editor 에 반영되도록 한다. 자기 타이핑은 editor.getJSON() === safeDoc 비교로 걸러지므로 무한 루프 없음.
  // 사용자 입력 중(focused)이면 cursor 보존을 위해 blur 까지 setContent 를 보류.
  useEffect(() => {
    if (!editor || !page || !effectivePageId) return;
    let safeDoc = stripStaleBlobImages(page.doc);
    safeDoc = normalizeFullPageDatabaseDoc(safeDoc);
    if (!tipTapJsonDocEquals(editor.schema, safeDoc, page.doc)) {
      updateDoc(effectivePageId, safeDoc);
    }
    const sync = () => {
      if (editor.isDestroyed) return;
      const current = editor.getJSON();
      if (tipTapJsonDocEquals(editor.schema, current, safeDoc)) return;
      editor.commands.setContent(safeDoc, { emitUpdate: false });
    };
    if (editor.isFocused) {
      const onBlur = () => {
        editor.off("blur", onBlur);
        scheduleEditorMutation(sync);
      };
      editor.on("blur", onBlur);
      return () => {
        editor.off("blur", onBlur);
      };
    }
    scheduleEditorMutation(sync);
  }, [editor, page?.id, effectivePageId, page?.updatedAt, updateDoc]);

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
    if (!editor || editor.isDestroyed) return;
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
      try {
        $pos = editor.state.doc.resolve(coords.pos);
      } catch (err) {
        reportNonFatal(err, "columnDrop.dragOver.resolve");
        clearDrop();
        return;
      }

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
      } catch (err) {
        reportNonFatal(err, "emojiPicker.coordsAtPos");
      }
      setEmojiAnchor({ top, left, insertPos });
      setEmojiPickerOpen(true);
    };
    window.addEventListener("quicknote:open-emoji-picker", open);
    return () => window.removeEventListener("quicknote:open-emoji-picker", open);
  }, [editor]);

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

  // editor.editable 토글 — read-only 상태로 두면 슬래시 메뉴, 텍스트 입력, 블록 추가 모두 차단.
  // DB 블록의 React NodeView 내부 input/button 은 contenteditable 영향 밖이라 정상 동작.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(!isFullPageDatabase);
    if (isFullPageDatabase) {
      // PM 이 atom 단독 doc 에 자동으로 NodeSelection 을 만들어 .ProseMirror-selectednode 가
      // 보이는 현상 + BubbleToolbar 가 뜨는 현상을 막기 위해 선택을 점선택으로 접고 포커스 해제.
      try {
        editor.commands.setTextSelection(0);
      } catch (err) {
        reportNonFatal(err, "fullPageDb.setTextSelection");
      }
      if (!editor.isDestroyed && editor.view.dom instanceof HTMLElement) editor.view.dom.blur();
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
            <PageCoverImage
              url={page.coverImage}
              onChange={(url) => setCoverImage(effectivePageId, url)}
              onRemove={() => setCoverImage(effectivePageId, null)}
            />
            <div className="mt-12 px-12">
              <div className="flex items-center gap-2">
                <IconPicker
                  current={page.icon}
                  onChange={(icon) => setIcon(effectivePageId, icon)}
                />
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
                      setSimpleAlert("이미 사용 중인 데이터베이스 이름입니다.");
                      renamePage(effectivePageId, dbTitleBaselineRef.current);
                    } else {
                      dbTitleBaselineRef.current = page.title;
                    }
                  }}
                  placeholder="제목 없음"
                  className="flex-1 bg-transparent text-4xl font-bold tracking-tight text-zinc-900 outline-none placeholder:text-zinc-300 dark:text-zinc-100 dark:placeholder:text-zinc-700"
                />
              </div>
            </div>
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
            <Suspense
              fallback={
                <div className="h-[380px] w-[320px] animate-pulse rounded-md border border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800" />
              }
            >
              <LazyEditorEmojiPicker
                darkMode={darkMode}
                onPick={(emoji) => {
                  if (editor && emojiAnchor.insertPos != null) {
                    editor
                      .chain()
                      .focus()
                      .insertContentAt(emojiAnchor.insertPos, emoji)
                      .run();
                  }
                  setEmojiPickerOpen(false);
                  setEmojiAnchor(null);
                }}
              />
            </Suspense>
          </div>
        </div>
      )}
      <SimpleAlertDialog
        open={simpleAlert !== null}
        message={simpleAlert ?? ""}
        onClose={() => setSimpleAlert(null)}
      />
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
