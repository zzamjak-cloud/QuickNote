import {
  Suspense,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useEditor, EditorContent, ReactRenderer } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import type { Editor as TiptapEditorClass } from "@tiptap/core";
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
import { YoutubeBlock } from "../../lib/tiptapExtensions/youtubeBlock";
import {
  InsertBeforeBlock,
  syncInsertBeforeBlockSelection,
} from "../../lib/tiptapExtensions/insertBeforeBlock";
import { Indentation } from "../../lib/tiptapExtensions/indentation";
import { BracketAutoClose } from "../../lib/tiptapExtensions/bracketAutoClose";
import TextAlign from "@tiptap/extension-text-align";
import type { createLowlight } from "lowlight";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import "tippy.js/dist/tippy.css";
type LowlightApi = ReturnType<typeof createLowlight>;

type EmojiAnchor = {
  top: number;
  left: number;
  insertPos: number;
};

type PasteUrlChoice = {
  url: string;
  range: { from: number; to: number };
  top: number;
  left: number;
};

import { usePageStore } from "../../store/pageStore";
import { useSettingsStore } from "../../store/settingsStore";
import { SlashCommand } from "../../lib/tiptapExtensions/slashCommand";
import { PageContext, setPageContext } from "../../lib/tiptapExtensions/pageContext";
import { MoveBlock } from "../../lib/tiptapExtensions/moveBlock";
import { DeleteCurrentBlock } from "../../lib/tiptapExtensions/deleteCurrentBlock";
import { Callout } from "../../lib/tiptapExtensions/callout";
import {
  Toggle,
  ToggleHeader,
  ToggleContent,
} from "../../lib/tiptapExtensions/toggle";
import { ColumnLayout, Column } from "../../lib/tiptapExtensions/columns";
import { TabBlock, TabPanel } from "../../lib/tiptapExtensions/tabBlock";
import { CodeBlockLowlightWithMarkdownPreview } from "../../lib/tiptapExtensions/markdownCodeBlockPreview";
import { CodeBlockCopy } from "../../lib/tiptapExtensions/codeBlockCopy";
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
import { BookmarkBlock } from "../../lib/tiptapExtensions/bookmarkBlock";
import { LucideInlineIcon } from "../../lib/tiptapExtensions/lucideInlineIcon";
import { DateInline } from "../../lib/tiptapExtensions/dateInline";
import { SlashMenu, type SlashMenuHandle } from "./SlashMenu";
import { ImageUpload } from "./ImageUpload";
import { IconPicker, IconPickerPanel } from "../common/IconPicker";
import { Star, FileText, Database } from "lucide-react";
import { BubbleToolbar } from "./BubbleToolbar";
import { ImageResizeOverlay } from "./ImageResizeOverlay";
import { BlockHandles } from "./BlockHandles";
import { ColumnReorderHandles } from "./ColumnReorderHandles";
import { TableBlockControls } from "./TableBlockControls";
import { stripStaleBlobImages } from "../../lib/sanitizeDocImages";
import { isAllowedTipTapLinkUri, isTrustedYoutubeInput } from "../../lib/safeUrl";
import { useBoxSelect } from "../../hooks/useBoxSelect";
import { tipTapJsonDocEquals } from "../../lib/pm/jsonDocEquals";
import { scheduleEditorMutation } from "../../lib/pm/scheduleEditorMutation";
import { reportNonFatal } from "../../lib/reportNonFatal";
import {
  createEditorHandleDragOver,
  createEditorHandleDrop,
  type BlockDropIndicatorRect,
  type ColumnDropState,
} from "../../lib/editor/editorHandleDrop";
import { insertImageFromFile } from "../../lib/editor/insertImageFromFile";
import { insertFileFromFile } from "../../lib/editor/insertFileFromFile";
import { extractClipboardFiles } from "../../lib/editor/clipboardFiles";
import { FileBlock } from "../../lib/tiptapExtensions/fileBlock";
import { BlockBackground } from "../../lib/tiptapExtensions/blockBackground";
import UniqueID from "@tiptap/extension-unique-id";
import type { Transaction } from "@tiptap/pm/state";
import { SimpleAlertDialog } from "../ui/SimpleAlertDialog";
import { PageCoverImage } from "./PageCoverImage";
import {
  registerEditorNavigation,
  unregisterEditorNavigation,
  scrollToBlockId,
} from "../../lib/editor/editorNavigationBridge";
import {
  parseQuickNoteLink,
  quickNoteLinkLabel,
} from "../../lib/navigation/quicknoteLinks";
import { useUiStore } from "../../store/uiStore";
import { useMemberStore } from "../../store/memberStore";
import { useBlockCommentStore } from "../../store/blockCommentStore";
import {
  createBlockCommentDecorations,
  dispatchDecoRefresh,
} from "../../lib/tiptapExtensions/blockCommentDecorations";
import { registerEditorForPage } from "../../lib/editor/editorByPageRegistry";
import { PageCommentBar, PAGE_COMMENT_SENTINEL } from "../comments/PageCommentBar";
import { MentionSearchModal } from "./MentionSearchModal";
import type { EditorView as PmEditorView } from "@tiptap/pm/view";
import {
  EDITOR_UNIQUE_ID_TYPES,
  isFullPageDatabaseDoc,
  normalizeFullPageDatabaseDoc,
} from "../../lib/blocks/editorPolicy";
import {
  AUTOSAVE_DEBOUNCE_MS,
  EMPTY_EDITOR_DOC,
  PASTE_URL_MENU_HEIGHT,
  PASTE_URL_MENU_WIDTH,
  clampFloatingPanelPosition,
  computeEditorTailSpacerPx,
  suppressScrollToSelectionForTableInteraction,
  trySyncFullPageDatabaseTitle,
  uniqueIdStepsHaveBoundary,
  uniqueIdTypingInsertedSize,
  uniqueIdTypingOnlySteps,
} from "./editorHelpers";

/**
 * UniqueID.configure.filterTransaction 에서 `view.composing` 을 읽기 위한 핸들.
 * onCreate 에서만 설정 — 조합 중 appendTransaction(setNodeMarkup) 이 IME 를 끊는 것을 막는다.
 */
let uniqueIdFilterHostEditor: TiptapEditorClass | null = null;

/**
 * UniqueID appendTransaction 스킵 여부. false 를 반환하면 스킵(@tiptap/extension-unique-id 규약).
 * useMemo 밖에 둬서 performance.now 정합성·React purity 린트 이슈를 피한다.
 */
function editorUniqueIdFilterTransaction(tr: Transaction): boolean {
  if (tr.getMeta("composition")) {
    return false;
  }
  if (uniqueIdFilterHostEditor?.view.composing) {
    return false;
  }
  if (!tr.docChanged) return true;
  if (tr.getMeta("__uniqueIDTransaction")) return true;
  if (tr.getMeta("paste")) return true;
  // 블록 분할(Enter) 등 노드 경계가 변하는 트랜잭션은 새 ID 가 필요하므로 처리
  if (uniqueIdStepsHaveBoundary(tr.steps)) return true;
  if (!uniqueIdTypingOnlySteps(tr.steps)) return true;
  const inserted = uniqueIdTypingInsertedSize(tr.steps);
  if (inserted > 160) return true;
  return false;
}

type EditorProps = {
  /** 지정 시 해당 페이지를 편집(예: 사이드 피크). 미지정이면 activePageId 사용. */
  pageId?: string;
  /** 본문만 렌더(아이콘·제목 영역 숨김). 피크처럼 외부에서 제목을 따로 표시할 때 사용. */
  bodyOnly?: boolean;
  /** 사이드 피크(좁은 패널) 컨텍스트 — 사이드바 레이아웃 시프트 비활성 + 댓글은 컴팩트 배지로 표시 */
  peek?: boolean;
};

/** editor 인스턴스 참조만 바뀔 때 재마운트 — 본문 state 변경 시 무분별 리렌더 방지 */
const MemoBubbleToolbar = memo(BubbleToolbar);
const MemoImageResizeOverlay = memo(ImageResizeOverlay);

export function Editor({ pageId, bodyOnly = false, peek = false }: EditorProps = {}) {
  const activeId = usePageStore((s) => s.activePageId);
  const effectivePageId = pageId ?? activeId;
  // 블록 댓글이 하나라도 존재하면 사이드바 공간을 예약해 본문을 좌측으로 밀어냄.
  // 페이지 레벨 댓글(PAGE_COMMENT_SENTINEL)은 PageCommentBar 가 인라인 처리 → 우측 거터 불필요.
  // 단, 피크 모드에서는 사이드바 공간을 만들지 않고 컴팩트 배지만 표시 → hasPageComments 무시.
  const hasPageComments = useBlockCommentStore((s) =>
    effectivePageId
      ? s.messages.some(
          (m) =>
            m.pageId === effectivePageId &&
            m.blockId !== PAGE_COMMENT_SENTINEL,
        )
      : false,
  );
  const page = usePageStore((s) =>
    effectivePageId ? s.pages[effectivePageId] : undefined,
  );
  const updateDoc = usePageStore((s) => s.updateDoc);
  const renamePage = usePageStore((s) => s.renamePage);
  const setIcon = usePageStore((s) => s.setIcon);
  const setCoverImage = usePageStore((s) => s.setCoverImage);

  const globalFullWidth = useSettingsStore((s) => s.fullWidth);
  const pageFullWidthById = useSettingsStore((s) => s.pageFullWidthById);
  const fullWidth = effectivePageId
    ? (pageFullWidthById[effectivePageId] ?? globalFullWidth)
    : globalFullWidth;
  /** 다른 페이지 즐겨찾기 변경 시 전체 에디터 리렌더를 줄이기 위해 boolean 만 구독 */
  const isCurrentPageFavorite = useSettingsStore(
    (s) =>
      effectivePageId != null && s.favoritePageIds.includes(effectivePageId),
  );
  const toggleFavoritePage = useSettingsStore((s) => s.toggleFavoritePage);

  const myMemberId = useMemberStore((s) => s.me?.memberId);

  const pageDoc = page?.doc;
  const isFullPageDatabase = useMemo(() => {
    return isFullPageDatabaseDoc(pageDoc);
  }, [pageDoc]);

  const titleRef = useRef<HTMLInputElement | null>(null);
  /** 풀 페이지 DB 제목 중복 시 입력 되돌리기용 — 마지막으로 저장에 성공한 제목 */
  const dbTitleBaselineRef = useRef("");
  const debounceRef = useRef<number | null>(null);
  const [imageOpen, setImageOpen] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [emojiAnchor, setEmojiAnchor] = useState<EmojiAnchor | null>(null);
  const [pasteUrlChoice, setPasteUrlChoice] = useState<PasteUrlChoice | null>(null);

  const columnDropRef = useRef<ColumnDropState>(null);
  const [blockDropIndicator, setBlockDropIndicator] =
    useState<BlockDropIndicatorRect | null>(null);

  const [simpleAlert, setSimpleAlert] = useState<string | null>(null);
  /** @ 키로 멘션 검색 모달 — 인라인 제안과 분리 */
  const [mentionRange, setMentionRange] = useState<{
    from: number;
    to: number;
  } | null>(null);

  const editorScrollHostRef = useRef<HTMLDivElement | null>(null);

  // 페이지 전환 시 스크롤 최상단으로 초기화
  useEffect(() => {
    const host = editorScrollHostRef.current;
    if (host) host.scrollTop = 0;
  }, [effectivePageId]);

  const [editorTailSpacerPx, setEditorTailSpacerPx] = useState(420);

  const clearColumnDropUi = useCallback(() => {
    document.body.classList.remove("quicknote-column-drop");
  }, []);
  const clearBlockDropIndicator = useCallback(() => {
    setBlockDropIndicator(null);
  }, [setBlockDropIndicator]);

  const handleAtOpenMention = useCallback(
    (view: PmEditorView, event: KeyboardEvent) => {
      if (
        event.key !== "@" ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      ) {
        return false;
      }
      const { $from } = view.state.selection;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === "codeBlock") return false;
      }
      event.preventDefault();
      const { from, to } = view.state.selection;
      setMentionRange({ from, to });
      return true;
    },
    [setMentionRange],
  );

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
      PageContext,
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
            CodeBlockLowlightWithMarkdownPreview.configure({
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
      // 동영상·PDF·zip 등 모든 파일은 fileBlock 으로 통합. mimeType 에 따라 NodeView 가 분기.
      FileBlock,
      HorizontalRule,
      MoveBlock,
      DeleteCurrentBlock,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      YoutubeBlock.configure({ width: 560, height: 315, nocookie: true }),
      Callout,
      ColumnLayout,
      Column,
      TabBlock,
      TabPanel,
      Toggle,
      ToggleHeader,
      ToggleContent,
      MemberMention,
      createBlockCommentDecorations(effectivePageId ?? undefined, myMemberId),
      EmojiShortcode,
      DatabaseBlock,
      PageLink,
      ButtonBlock,
      BookmarkBlock,
      InsertBeforeBlock,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      LucideInlineIcon,
      DateInline,
      BlockBackground,
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
          items: ({ editor, query }) => filterSlashMenuEntries(query, editor).slice(0, 40),
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
      Indentation,
      BracketAutoClose,
      UniqueID.configure({
        types: EDITOR_UNIQUE_ID_TYPES,
        updateDocument: !isFullPageDatabase,
        /** 짧은 텍스트 입력마다 appendTransaction 생략 → youtube·임베드 불필요 갱신 방지 */
        filterTransaction: editorUniqueIdFilterTransaction,
      }),
    ],
    [lowlightApi, isFullPageDatabase, effectivePageId, myMemberId],
  );

  const editorProps = useMemo(
    () => ({
      attributes: {
        class: `prose prose-zinc dark:prose-invert max-w-none focus:outline-none ${
          bodyOnly
            ? "px-12 py-4"
            : "px-12 py-8 min-h-[min(85vh,900px)]"
        } qn-prose-marquee-host`,
      },
      handlePaste: (view: import("@tiptap/pm/view").EditorView, event: ClipboardEvent) => {
        // image 는 image 노드, 그 외 file 항목은 fileBlock 노드로 삽입.
        // string item(text/html 등) 은 PM 기본 paste 흐름에 위임.
        const fileItems = extractClipboardFiles(event.clipboardData);
        if (fileItems.length > 0) {
          event.preventDefault();
          for (const item of fileItems) {
            const { file } = item;
            if (item.isImage) {
              void handleEditorInsertImage(file, (attrs) => {
                view.dispatch(
                  view.state.tr.replaceSelectionWith(
                    view.state.schema.nodes.image!.create(attrs),
                  ),
                );
              });
            } else {
              void insertFileFromFile(file, (attrs) => {
                const fileNode = view.state.schema.nodes.fileBlock?.create(attrs);
                if (!fileNode) return;
                view.dispatch(
                  view.state.tr.replaceSelectionWith(fileNode).scrollIntoView(),
                );
              });
            }
          }
          return true;
        }

        const text = event.clipboardData?.getData("text/plain")?.trim() ?? "";
        if (!text || /\s/.test(text)) return false;

        const internalTarget = parseQuickNoteLink(text);
        if (internalTarget) {
          event.preventDefault();
          const title = usePageStore.getState().pages[internalTarget.pageId]?.title;
          const buttonType = view.state.schema.nodes.buttonBlock;
          if (!buttonType) return true;
          view.dispatch(
            view.state.tr.replaceSelectionWith(
              buttonType.create({
                label: quickNoteLinkLabel(title, internalTarget),
                href: text,
              }),
            ),
          );
          return true;
        }

        let parsedUrl: URL | null = null;
        try {
          parsedUrl = new URL(text);
        } catch {
          return false;
        }
        if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
          return false;
        }
        event.preventDefault();
        const coords = view.coordsAtPos(view.state.selection.from);
        const pos = clampFloatingPanelPosition(coords, {
          width: PASTE_URL_MENU_WIDTH,
          height: PASTE_URL_MENU_HEIGHT,
        });
        setPasteUrlChoice({
          url: text,
          range: { from: view.state.selection.from, to: view.state.selection.to },
          top: pos.top,
          left: pos.left,
        });
        return true;
      },
      handleDrop: createEditorHandleDrop({
        columnDropRef,
        clearColumnDropUi,
        clearBlockDropIndicator,
        insertImageFromFile: handleEditorInsertImage,
      }),
      handleDOMEvents: {
        dragover: createEditorHandleDragOver({
          showBlockDropIndicator: setBlockDropIndicator,
          clearBlockDropIndicator,
        }),
        dragleave: (view: PmEditorView, event: DragEvent) => {
          const next = event.relatedTarget;
          if (!(next instanceof Node) || !view.dom.contains(next)) {
            clearBlockDropIndicator();
          }
          return false;
        },
      },
      handleKeyDown(view: PmEditorView, event: KeyboardEvent) {
        if (handleAtOpenMention(view, event)) return true;
        return false;
      },
      handleScrollToSelection: (view: PmEditorView) => {
        if (suppressScrollToSelectionForTableInteraction(view)) return true;
        const host = editorScrollHostRef.current;
        if (!host) return false;
        const { from } = view.state.selection;
        try {
          const coords = view.coordsAtPos(from);
          const rect = host.getBoundingClientRect();
          // 커서가 이미 뷰포트 안에 있으면 PM의 자동 스크롤 억제
          if (coords.top >= rect.top && coords.bottom <= rect.bottom) return true;
        } catch {
          // coordsAtPos가 실패하면 기본 동작에 위임
        }
        return false;
      },
    }),
    [
      clearColumnDropUi,
      setBlockDropIndicator,
      clearBlockDropIndicator,
      handleEditorInsertImage,
      handleAtOpenMention,
      setPasteUrlChoice,
      bodyOnly,
    ],
  );

  // 슬래시 명령 등 editor 인스턴스만 받는 콜백에서 현재 페이지 ID 를 알 수 있도록
  // PageContext storage 에 effectivePageId 를 주입한다.
  // content 로 store 의 page.doc 를 넘기면 자동저장마다 참조가 바뀌어 setOptions 가 무한 호출됨.
  // 초기값은 고정 EMPTY 만 넘기고, 실제 문서는 아래 effect 에서만 주입한다.
  const editor = useEditor(
    {
      extensions,
      content: EMPTY_EDITOR_DOC,
      editorProps,
      shouldRerenderOnTransaction: false,
      editable: !isFullPageDatabase,
      onCreate: ({ editor: created }) => {
        uniqueIdFilterHostEditor = created;
      },
      onDestroy: () => {
        uniqueIdFilterHostEditor = null;
      },
    },
    [lowlightApi, isFullPageDatabase],
  );

  // PageContext storage 동기화 — 슬래시 명령(/페이지 등) 이 현재 호스트 페이지를 식별하기 위함.
  useEffect(() => {
    setPageContext(editor, effectivePageId ?? null);
  }, [editor, effectivePageId]);

  // 댓글 스레드 패널은 App 에서 단일 마운트 — layout 단계에서 등록해 같은 커밋의 패널 effect 보다 먼저 둔다
  useLayoutEffect(() => {
    if (!editor || editor.isDestroyed || !effectivePageId) return;
    return registerEditorForPage(effectivePageId, editor);
  }, [editor, effectivePageId]);

  const applyPasteUrlChoice = useCallback(
    (mode: "mention" | "url" | "bookmark" | "embed") => {
      if (!editor || !pasteUrlChoice) return;
      const { url, range } = pasteUrlChoice;
      const chain = editor.chain().focus().deleteRange(range);
      if (mode === "embed" && isTrustedYoutubeInput(url)) {
        chain.setYoutubeVideo({ src: url }).run();
      } else if (mode === "url") {
        chain
          .insertContent({
            type: "text",
            text: url,
            marks: [{ type: "link", attrs: { href: url } }],
          })
          .run();
      } else if (mode === "bookmark") {
        const fallbackHost = (() => {
          try {
            return new URL(url).hostname.replace(/^www\./, "");
          } catch {
            return "웹 페이지";
          }
        })();
        chain
          .insertContent({
            type: "bookmarkBlock",
            attrs: {
              href: url,
              title: fallbackHost,
              description: url,
              siteName: fallbackHost,
              status: "loading",
            },
          })
          .run();
      } else {
        const host = (() => {
          try {
            return new URL(url).hostname.replace(/^www\./, "");
          } catch {
            return "링크";
          }
        })();
        chain
          .insertContent({
            type: "buttonBlock",
            attrs: {
              label: mode === "mention" ? host : `북마크 · ${host}`,
              href: url,
            },
          })
          .run();
      }
      setPasteUrlChoice(null);
    },
    [editor, pasteUrlChoice],
  );

  const commentThread = useUiStore((s) => s.commentThread);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    registerEditorNavigation(editor);
    return () => unregisterEditorNavigation(editor);
  }, [editor]);

  /** 핸들 메뉴 삭제 등으로 포커스가 PM 밖에 있을 때 Ctrl+Z/Y 가 브라우저·앱으로 새지 않고 본문 히스토리로 가도록 함 */
  useEffect(() => {
    if (!editor || editor.isDestroyed || !editor.isEditable) return;

    const shouldForwardUndoRedo = (): boolean => {
      const ae = document.activeElement;
      if (ae instanceof HTMLElement && editor.view.dom.contains(ae)) return false;
      const tag = ae?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return false;
      if (ae instanceof HTMLElement && ae.isContentEditable) return false;
      return true;
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.key === "Process") return;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (!shouldForwardUndoRedo()) return;
      if (e.code !== "KeyZ" && e.code !== "KeyY") return;

      const undo = e.code === "KeyZ" && !e.shiftKey;
      const redo =
        (e.code === "KeyZ" && e.shiftKey) ||
        (e.code === "KeyY" && e.ctrlKey && !e.metaKey);

      if (undo && editor.can().undo()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        editor.chain().focus().undo().run();
        return;
      }
      if (redo && editor.can().redo()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        editor.chain().focus().redo().run();
      }
    };

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || !commentThread) return;
    if (commentThread.pageId !== effectivePageId) return;
    if (commentThread.skipScroll) return;
    const t = window.setTimeout(() => {
      scrollToBlockId(commentThread.blockId);
    }, 60);
    return () => window.clearTimeout(t);
  }, [commentThread, editor, effectivePageId]);

  /** 이 페이지 댓글·방문 기록·멤버와 관련된 스토어 변경만 decoration 갱신(prev 인자 미지원·persist 경로 대비) */
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const pid = effectivePageId;
    const buildSig = (): string => {
      if (!pid) return "";
      const s = useBlockCommentStore.getState();
      const mid = useMemberStore.getState().me?.memberId ?? "";
      const msgs = s.messages.filter((m) => m.pageId === pid);
      const visit = s.threadVisitedAt;
      const vk = Object.keys(visit)
        .filter((k) => k.startsWith(`${pid}:`))
        .sort()
        .map((k) => `${k}:${visit[k]}`)
        .join("|");
      return `${mid}|${msgs.map((m) => `${m.id}:${m.createdAt}:${m.bodyText.length}`).join(",")}|${vk}`;
    };
    let last = buildSig();
    dispatchDecoRefresh(editor);
    const tick = () => {
      const next = buildSig();
      if (next === last) return;
      last = next;
      dispatchDecoRefresh(editor);
    };
    const unsub1 = useBlockCommentStore.subscribe(tick);
    const unsub2 = useMemberStore.subscribe(tick);
    return () => {
      unsub1();
      unsub2();
    };
  }, [editor, effectivePageId]);

  /** 스토어 본문이 에디터에 반영되기 전 자동저장으로 빈 doc 이 덮어쓰이지 않도록 함 */
  const storeDocHydratedRef = useRef(false);
  useEffect(() => {
    storeDocHydratedRef.current = false;
  }, [editor, effectivePageId]);

  const safePageDoc = useMemo(() => {
    if (!pageDoc) return null;
    return normalizeFullPageDatabaseDoc(stripStaleBlobImages(pageDoc));
  }, [pageDoc]);

  // 활성 페이지 변경 + 원격 변경 수신 시 본문 동기화.
  // deps 에 page?.updatedAt 을 포함해 다른 클라이언트의 push (subscription → applyRemotePageToStore) 가
  // 즉시 editor 에 반영되도록 한다. 자기 타이핑은 editor.getJSON() === safeDoc 비교로 걸러지므로 무한 루프 없음.
  // 사용자 입력 중(focused)이면 cursor 보존을 위해 blur 까지 setContent 를 보류.
  const lastSyncedPageIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editor || !pageDoc || !safePageDoc || !effectivePageId) return;
    if (!tipTapJsonDocEquals(editor.schema, safePageDoc, pageDoc)) {
      updateDoc(effectivePageId, safePageDoc, { skipHistory: true });
    }
    // 페이지 자체가 바뀌었으면 blur 대기 없이 즉시 본문을 교체한다.
    // (같은 페이지 안에서 원격 변경 등으로 doc 만 갱신될 때만 cursor 보존을 위한 blur 대기 의미가 있음.)
    const pageChanged = lastSyncedPageIdRef.current !== effectivePageId;
    const sync = () => {
      if (editor.isDestroyed) return;
      const current = editor.getJSON();
      if (tipTapJsonDocEquals(editor.schema, current, safePageDoc)) {
        storeDocHydratedRef.current = true;
        lastSyncedPageIdRef.current = effectivePageId;
        return;
      }
      editor.commands.setContent(safePageDoc, { emitUpdate: false });
      storeDocHydratedRef.current = true;
      lastSyncedPageIdRef.current = effectivePageId;
    };
    if (!pageChanged && editor.isFocused) {
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
  }, [
    editor,
    page?.id,
    effectivePageId,
    page?.updatedAt,
    pageDoc,
    safePageDoc,
    updateDoc,
  ]);

  // 디바운스 자동 저장
  // doc 가 실제로 변경됐을 때만 normalize/저장 — 이전 저장 시점 doc 참조로 빠른 skip
  const lastSavedDocRef = useRef<unknown>(null);
  useEffect(() => {
    if (!editor) return;
    const handler = () => {
      if (!effectivePageId) return;
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
      debounceRef.current = window.setTimeout(() => {
        if (!effectivePageId) return;
        if (!storeDocHydratedRef.current) return;
        // PM doc 참조가 바뀌지 않았으면 내용 변경 없음 — normalize/저장 skip
        const currentDoc = editor.state.doc;
        if (currentDoc === lastSavedDocRef.current) return;
        lastSavedDocRef.current = currentDoc;
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

  // 이미지 업로드 모달 트리거
  useEffect(() => {
    const open = () => setImageOpen(true);
    window.addEventListener("quicknote:open-image-upload", open);
    return () =>
      window.removeEventListener("quicknote:open-image-upload", open);
  }, []);

  // 이모지 피커 모달 트리거
  const getEmojiAnchor = useCallback(
    (insertPos: number): EmojiAnchor => {
      let top = 200;
      let left = 200;
      try {
        const coords = editor?.view.coordsAtPos(insertPos);
        if (coords) {
          const next = clampFloatingPanelPosition(coords);
          top = next.top;
          left = next.left;
        }
      } catch (err) {
        reportNonFatal(err, "emojiPicker.coordsAtPos");
      }
      return { top, left, insertPos };
    },
    [editor],
  );

  useEffect(() => {
    const open = () => {
      if (!editor) return;
      const insertPos = editor.state.selection.from;
      setEmojiAnchor(getEmojiAnchor(insertPos));
      setEmojiPickerOpen(true);
    };
    window.addEventListener("quicknote:open-emoji-picker", open);
    return () => window.removeEventListener("quicknote:open-emoji-picker", open);
  }, [editor, getEmojiAnchor]);

  useEffect(() => {
    if (!emojiPickerOpen || !emojiAnchor) return;
    const reposition = () => {
      setEmojiAnchor((current) =>
        current ? getEmojiAnchor(current.insertPos) : current,
      );
    };
    window.addEventListener("resize", reposition, { passive: true });
    window.visualViewport?.addEventListener("resize", reposition, { passive: true });
    window.visualViewport?.addEventListener("scroll", reposition, { passive: true });
    return () => {
      window.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("scroll", reposition);
    };
  }, [emojiAnchor, emojiPickerOpen, getEmojiAnchor]);

  // 새 페이지 생성 시 제목 자동 포커스
  useEffect(() => {
    if (page && page.title === "새 페이지") {
      titleRef.current?.focus();
      titleRef.current?.select();
    }
  }, [page?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 페이지 제목 변경 시 에디터 내 mention 노드의 label 동기화
  useEffect(() => {
    if (!editor) return;
    let prevPages = usePageStore.getState().pages;
    const unsub = usePageStore.subscribe((s) => {
      const cur = s.pages;
      if (cur === prevPages) { prevPages = cur; return; }
      const changed = new Map<string, string>();
      for (const [id, page] of Object.entries(cur)) {
        const prev = prevPages[id];
        if (prev && prev.title !== page.title) changed.set(id, page.title);
      }
      prevPages = cur;
      if (changed.size === 0) return;
      const updates: Array<{ pos: number; attrs: Record<string, unknown> }> = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "mention") {
          const newTitle = changed.get(node.attrs.id as string);
          if (newTitle !== undefined && newTitle !== (node.attrs.label as string)) {
            updates.push({ pos, attrs: { ...node.attrs, label: newTitle } });
          }
        }
        return true;
      });
      if (updates.length === 0) return;
      const tr = editor.state.tr;
      // 역순 적용으로 위치 오프셋 충돌 방지
      for (const { pos, attrs } of updates.reverse()) {
        tr.setNodeMarkup(pos, undefined, attrs);
      }
      tr.setMeta("addToHistory", false);
      editor.view.dispatch(tr);
    });
    return unsub;
  }, [editor]);

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

  // 슬래시 "페이지 링크" 명령이 발행하는 커스텀 이벤트를 수신 → mention search modal 열기
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const dom = editor.view.dom;
    const handler = (e: Event) => {
      const { from, to } = (e as CustomEvent<{ from: number; to: number }>).detail;
      setMentionRange({ from, to });
    };
    dom.addEventListener("qn:open-mention-search", handler);
    return () => dom.removeEventListener("qn:open-mention-search", handler);
  }, [editor, setMentionRange]);

  // 풀 페이지 DB 모드에서는 박스 드래그 자체가 무의미 — null 전달로 비활성.
  const { selectedStarts: boxSelectedStarts, clearSelection: clearBoxSelection } =
    useBoxSelect(isFullPageDatabase ? null : editor);

  // InsertBeforeBlock 익스텐션이 박스 선택 위치를 참조할 수 있도록 storage 동기화.
  useEffect(() => {
    if (!editor) return;
    syncInsertBeforeBlockSelection(editor, boxSelectedStarts);
  }, [editor, boxSelectedStarts]);

  useLayoutEffect(() => {
    const host = editorScrollHostRef.current;
    /* 호스트 미마운트(페이지 미선택 등)에서는 스킵 — page 는 early return 과 별개로 ref 만 본다 */
    if (!host) return;
    const run = (): void => {
      const px = computeEditorTailSpacerPx();
      host.style.scrollPaddingBottom = `${px}px`;
      setEditorTailSpacerPx(px);
    };
    run();
    window.addEventListener("resize", run, { passive: true });
    const vv = window.visualViewport;
    vv?.addEventListener("resize", run, { passive: true });
    vv?.addEventListener("scroll", run, { passive: true });
    return () => {
      window.removeEventListener("resize", run);
      vv?.removeEventListener("resize", run);
      vv?.removeEventListener("scroll", run);
    };
  }, [effectivePageId, page?.id]);

  if (!page || !effectivePageId) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-zinc-400">
        페이지를 선택하거나 좌측 + 버튼으로 새 페이지를 만드세요.
      </div>
    );
  }

  return (
    <div
      ref={editorScrollHostRef}
      className={`qn-editor-body-scroll relative flex flex-col bg-white dark:bg-[#111111] ${bodyOnly ? "min-h-0" : "min-h-0 flex-1 overflow-y-auto"}`}
    >
      {/* 커버는 max-w- 컬럼 밖에 두어 좁은 본문 폭에서도 에디터 패널 전체 너비로 펼친다(웹·Tauri 공통). */}
      {!bodyOnly && page.coverImage ? (
        <div className="w-full shrink-0">
          <PageCoverImage
            url={page.coverImage}
            onChange={(url) => setCoverImage(effectivePageId, url)}
            onRemove={() => setCoverImage(effectivePageId, null)}
            onUploadError={(msg) => setSimpleAlert(msg)}
          />
        </div>
      ) : null}
      <div
        className={`relative mx-auto w-full ${
          fullWidth
            ? "max-w-none px-4"
            : hasPageComments && !peek
              ? "max-w-[1256px] pr-[256px]"
              : "max-w-[968px]"
        }`}
        data-qn-editor-column
      >
        {!bodyOnly && (
          <>
            {!page.coverImage ? (
              <PageCoverImage
                url={page.coverImage}
                onChange={(url) => setCoverImage(effectivePageId, url)}
                onRemove={() => setCoverImage(effectivePageId, null)}
                onUploadError={(msg) => setSimpleAlert(msg)}
              />
            ) : null}
            <div className={`${page.coverImage ? "mt-12" : "mt-4"} px-12`}>
              <div className="flex items-center gap-2">
                <IconPicker
                  current={page.icon}
                  onChange={(icon) => setIcon(effectivePageId, icon)}
                  onUploadMessage={(msg) => setSimpleAlert(msg)}
                  defaultIcon={
                    isFullPageDatabase
                      ? <Database size={28} className="text-zinc-400" />
                      : <FileText size={28} className="text-zinc-400" />
                  }
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
                  className="min-w-0 flex-1 bg-transparent text-4xl font-bold tracking-tight text-zinc-900 outline-none placeholder:text-zinc-300 dark:text-zinc-100 dark:placeholder:text-zinc-700"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === "ArrowDown") {
                      e.preventDefault();
                      editor?.chain().focus().run();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => toggleFavoritePage(effectivePageId)}
                  className="shrink-0 rounded-md p-2 text-zinc-400 hover:bg-zinc-100 hover:text-amber-500 dark:hover:bg-zinc-800 dark:hover:text-amber-400"
                  aria-label={
                    isCurrentPageFavorite ? "즐겨찾기 해제" : "즐겨찾기"
                  }
                  aria-pressed={isCurrentPageFavorite}
                  title="즐겨찾기"
                >
                  <Star
                    size={22}
                    strokeWidth={1.75}
                    className={
                      isCurrentPageFavorite ? "fill-amber-400 text-amber-500" : ""
                    }
                  />
                </button>
              </div>
            </div>
            {/* 페이지 레벨 댓글 — 제목 바로 아래 */}
            <div className="px-12">
              <PageCommentBar pageId={effectivePageId ?? pageId ?? ""} />
            </div>
          </>
        )}
        <div className="relative">
          <EditorContent editor={editor} />
          {blockDropIndicator ? (
            <div
              className="qn-block-drop-indicator"
              style={{
                top: blockDropIndicator.top,
                left: blockDropIndicator.left,
                width: blockDropIndicator.width,
              }}
            />
          ) : null}
          {!isFullPageDatabase && (
            <ColumnReorderHandles editor={editor} boxSelectedStarts={boxSelectedStarts} />
          )}
          {!isFullPageDatabase && <TableBlockControls editor={editor} />}
        </div>
        {/* BlockHandles 는 외곽 wrapper 의 padding 영역(pr-[256px] 등 사이드바 예약)에서도
            카드를 렌더할 수 있어야 하므로 inner relative 컨테이너 밖, 외곽 wrapper 의 직접 자식으로 둠.
            pageId 를 명시 전달해 피크 뷰처럼 activePageId 와 다른 페이지를 편집 중일 때도
            올바른 페이지의 댓글로 필터링됨. */}
        {!isFullPageDatabase && (
          <BlockHandles
            editor={editor}
            pageId={effectivePageId ?? null}
            compactComments={peek}
            boxSelectedStarts={boxSelectedStarts}
            onClearBoxSelection={clearBoxSelection}
          />
        )}
        <div
          aria-hidden
          className="qn-editor-scroll-tail-spacer shrink-0 select-none"
          style={{
            height: editorTailSpacerPx,
            minHeight: editorTailSpacerPx,
          }}
        />
      </div>
      <MemoBubbleToolbar editor={editor} />
      <MemoImageResizeOverlay editor={editor} />
      <ImageUpload
        open={imageOpen}
        onClose={() => setImageOpen(false)}
        editor={editor}
      />
      {pasteUrlChoice && (
        <div
          className="fixed inset-0 z-[480]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPasteUrlChoice(null);
          }}
        >
          <div
            className="absolute w-72 max-w-[calc(100vw-24px)] rounded-lg border border-zinc-200 bg-white p-1 text-xs shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            style={{ top: pasteUrlChoice.top, left: pasteUrlChoice.left }}
          >
            <div className="truncate px-2 py-1.5 text-[11px] text-zinc-400">
              {pasteUrlChoice.url}
            </div>
            {[
              ["mention", "멘션"],
              ["url", "URL"],
              ["bookmark", "북마크"],
              ["embed", isTrustedYoutubeInput(pasteUrlChoice.url) ? "임베드" : "버튼"],
            ].map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() =>
                  applyPasteUrlChoice(mode as "mention" | "url" | "bookmark" | "embed")
                }
                className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
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
              <IconPickerPanel
                title="아이콘 삽입"
                onPickEmoji={(emoji) => {
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
                onPickLucide={(name, color) => {
                  if (editor && emojiAnchor.insertPos != null) {
                    editor
                      .chain()
                      .focus()
                      .insertContentAt(emojiAnchor.insertPos, {
                        type: "lucideInlineIcon",
                        attrs: { name, color },
                      })
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
      <MentionSearchModal
        open={mentionRange !== null}
        onClose={() => setMentionRange(null)}
        editor={editor}
        range={mentionRange}
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
    entries: filterSlashMenuEntries(p.query, p.editor),
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
        offset: [0, 8],
        popperOptions: {
          modifiers: [
            {
              name: "flip",
              options: {
                fallbackPlacements: [
                  "top-start",
                  "bottom-end",
                  "top-end",
                  "right-start",
                  "left-start",
                ],
              },
            },
            {
              name: "preventOverflow",
              options: {
                boundary: "viewport",
                padding: 8,
                altAxis: true,
              },
            },
          ],
        },
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
