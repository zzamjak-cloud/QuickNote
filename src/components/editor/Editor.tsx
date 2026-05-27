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
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useEditor, EditorContent } from "@tiptap/react";
import type { createLowlight } from "lowlight";
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

import { enqueuePageUpsertForSync, usePageStore } from "../../store/pageStore";
import { useSettingsStore } from "../../store/settingsStore";
import { setPageContext } from "../../lib/tiptapExtensions/pageContext";
import { syncInsertBeforeBlockSelection } from "../../lib/tiptapExtensions/insertBeforeBlock";
import { ImageUpload } from "./ImageUpload";
import { ServerImagePicker } from "./ServerImagePicker";
import { IconPickerPanel } from "../common/IconPicker";
import { FileText, Database } from "lucide-react";
import { PageTitleBar } from "../page/PageTitleBar";
import { getEditorColumnClass } from "../../lib/editorLayout";
import { BubbleToolbar } from "./BubbleToolbar";
import { ImageResizeOverlay } from "./ImageResizeOverlay";
import { BlockHandles } from "./BlockHandles";
import { ColumnReorderHandles } from "./ColumnReorderHandles";
import { TableBlockControls } from "./TableBlockControls";
import { stripStaleBlobImages } from "../../lib/sanitizeDocImages";
import {
  isTrustedYoutubeInput,
  sanitizeWebLinkHref,
} from "../../lib/safeUrl";
import { useBoxSelect } from "../../hooks/useBoxSelect";
import { tipTapJsonDocEquals } from "../../lib/pm/jsonDocEquals";
import { scheduleEditorMutation } from "../../lib/pm/scheduleEditorMutation";
import { reportNonFatal } from "../../lib/reportNonFatal";
import {
  type BlockDropIndicatorRect,
  type ColumnDropState,
} from "../../lib/editor/editorHandleDrop";
import { insertImageFromFile } from "../../lib/editor/insertImageFromFile";
import { SimpleAlertDialog } from "../ui/SimpleAlertDialog";
import { PageCoverImage } from "./PageCoverImage";
import { PageSubpageTree } from "../page/PageSubpageTree";
import { countPageDescendants } from "../page/pageSubpageTreeUtils";
import { useAnchoredPopover } from "../../hooks/useAnchoredPopover";
import {
  registerEditorNavigation,
  unregisterEditorNavigation,
  scrollToBlockId,
} from "../../lib/editor/editorNavigationBridge";
import { useUiStore } from "../../store/uiStore";
import { useMemberStore } from "../../store/memberStore";
import { useBlockCommentStore } from "../../store/blockCommentStore";
import {
  dispatchDecoRefresh,
} from "../../lib/tiptapExtensions/blockCommentDecorations";
import { registerEditorForPage } from "../../lib/editor/editorByPageRegistry";
import { PageCommentBar, PAGE_COMMENT_SENTINEL } from "../comments/PageCommentBar";
import { MentionSearchModal } from "./MentionSearchModal";
import type { EditorView as PmEditorView } from "@tiptap/pm/view";
import {
  isFullPageDatabaseDoc,
  normalizeFullPageDatabaseDoc,
} from "../../lib/blocks/editorPolicy";
import {
  AUTOSAVE_DEBOUNCE_MS,
  EMPTY_EDITOR_DOC,
  clampFloatingPanelPosition,
  computeEditorTailSpacerPx,
  isResolvedPosInDynamicLayoutContainer,
  trySyncFullPageDatabaseTitle,
} from "./editorHelpers";
import { useEditorExtensions } from "./useEditorExtensions";
import { useEditorProps } from "./useEditorProps";
import { setUniqueIdFilterHostEditor } from "./editorUniqueIdFilter";


type EditorProps = {
  /** 지정 시 해당 페이지를 편집(예: 사이드 피크). 미지정이면 activePageId 사용. */
  pageId?: string;
  /** 본문만 렌더(아이콘·제목 영역 숨김). 피크처럼 외부에서 제목을 따로 표시할 때 사용. */
  bodyOnly?: boolean;
  /** 사이드 피크(좁은 패널) 컨텍스트 — 사이드바 레이아웃 시프트 비활성 + 댓글은 컴팩트 배지로 표시 */
  peek?: boolean;
  /** 본문 컬럼 내부 하단 spacer 렌더 여부. 기본 true */
  showTailSpacer?: boolean;
  /** bodyOnly 모드에서 본문과 같은 컬럼 안에 먼저 렌더할 영역 */
  bodyPrefix?: ReactNode;
};

/** editor 인스턴스 참조만 바뀔 때 재마운트 — 본문 state 변경 시 무분별 리렌더 방지 */
const MemoBubbleToolbar = memo(BubbleToolbar);
const MemoImageResizeOverlay = memo(ImageResizeOverlay);
const DOC_SYNC_IDLE_MS = 3000;
const DYNAMIC_LAYOUT_INPUT_AUTOSAVE_DEBOUNCE_MS = 1200;

export function Editor({
  pageId,
  bodyOnly = false,
  peek = false,
  showTailSpacer = true,
  bodyPrefix,
}: EditorProps = {}) {
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
  const myMemberId = useMemberStore((s) => s.me?.memberId);

  const pageDoc = page?.doc;
  const currentPageId = page?.id ?? null;
  const currentPageTitle = page?.title ?? "";
  const isFullPageDatabase = useMemo(() => {
    return isFullPageDatabaseDoc(pageDoc);
  }, [pageDoc]);
  const isDatabaseRowPage = Boolean(page?.databaseId) && !isFullPageDatabase;

  const titleRef = useRef<HTMLInputElement | null>(null);
  /** 제목 입력 포커스가 잡힌 페이지 — 전환 후 지연 blur 가 새 페이지를 덮어쓰지 않도록 */
  const titleFocusPageIdRef = useRef<string | null>(null);
  /** 풀 페이지 DB 제목 중복 시 입력 되돌리기용 — 마지막으로 저장에 성공한 제목 */
  const dbTitleBaselineRef = useRef("");
  const debounceRef = useRef<number | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [imageOpen, setImageOpen] = useState(false);
  const [serverImageOpen, setServerImageOpen] = useState(false);
  const [serverVideoOpen, setServerVideoOpen] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [emojiAnchor, setEmojiAnchor] = useState<EmojiAnchor | null>(null);
  const [pasteUrlChoice, setPasteUrlChoice] = useState<PasteUrlChoice | null>(null);

  const columnDropRef = useRef<ColumnDropState>(null);
  const [blockDropIndicator, setBlockDropIndicator] =
    useState<BlockDropIndicatorRect | null>(null);

  const [simpleAlert, setSimpleAlert] = useState<string | null>(null);
  const subpagePopover = useAnchoredPopover(280);
  /** @ 키로 멘션 검색 모달 — 인라인 제안과 분리 */
  const [mentionRange, setMentionRange] = useState<{
    from: number;
    to: number;
  } | null>(null);

  const editorScrollHostRef = useRef<HTMLDivElement | null>(null);

  // 페이지 전환 시 스크롤 최상단으로 초기화.
  // 단, 피크/본문전용(bodyOnly) 모드에서는 상위 스크롤 컨테이너(DatabaseRowPeek 등)가
  // 스크롤 위치를 관리하므로 여기서 강제로 0으로 되돌리지 않는다.
  useEffect(() => {
    if (bodyOnly || peek) return;
    const host = editorScrollHostRef.current;
    if (host) host.scrollTop = 0;
  }, [bodyOnly, effectivePageId, peek]);

  const [editorTailSpacerPx, setEditorTailSpacerPx] = useState(240);

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

  const extensions = useEditorExtensions({
    lowlightApi,
    isFullPageDatabase,
    effectivePageId,
    myMemberId,
  });

  const editorProps = useEditorProps({
    bodyOnly,
    columnDropRef,
    clearColumnDropUi,
    clearBlockDropIndicator,
    setBlockDropIndicator,
    handleEditorInsertImage,
    handleAtOpenMention,
    setPasteUrlChoice,
    editorScrollHostRef,
  });

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
        setUniqueIdFilterHostEditor(created);
      },
      onDestroy: () => {
        setUniqueIdFilterHostEditor(null);
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
      const normalizedUrl = sanitizeWebLinkHref(url) ?? url;
      const chain = editor.chain().focus().deleteRange(range);
      if (mode === "embed" && isTrustedYoutubeInput(normalizedUrl)) {
        chain.setYoutubeVideo({ src: normalizedUrl }).run();
      } else if (mode === "url") {
        chain
          .insertContent({
            type: "text",
            text: normalizedUrl,
            marks: [{ type: "link", attrs: { href: normalizedUrl } }],
          })
          .run();
      } else if (mode === "bookmark") {
        const fallbackHost = (() => {
          try {
            return new URL(normalizedUrl).hostname.replace(/^www\./, "");
          } catch {
            return "웹 페이지";
          }
        })();
        chain
          .insertContent({
            type: "bookmarkBlock",
            attrs: {
              href: normalizedUrl,
              title: fallbackHost,
              description: normalizedUrl,
              siteName: fallbackHost,
              status: "loading",
            },
          })
          .run();
      } else {
        const host = (() => {
          try {
            return new URL(normalizedUrl).hostname.replace(/^www\./, "");
          } catch {
            return "링크";
          }
        })();
        chain
          .insertContent({
            type: "buttonBlock",
            attrs: {
              label: mode === "mention" ? host : `북마크 · ${host}`,
              href: normalizedUrl,
            },
          })
          .run();
      }
      setPasteUrlChoice(null);
    },
    [editor, pasteUrlChoice],
  );

  const commentThread = useUiStore((s) => s.commentThread);
  const descendantCount = usePageStore((s) =>
    effectivePageId ? countPageDescendants(effectivePageId, s.pages) : 0,
  );

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    registerEditorNavigation(editor);
    return () => unregisterEditorNavigation(editor);
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
  useLayoutEffect(() => {
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
      // 히스토리에 "빈 본문 → 실제 본문" 한 줄을 남기지 않도록, undo 가능 메타를 false 로 두고 직접 dispatch.
      // 이전에는 setContent 가 트랜잭션을 히스토리에 적재해, Ctrl+Z 한 번이면 본문 전체가 사라지는
      // 치명적 회귀가 있었다. 같은 페이지의 원격 push 동기화도 마찬가지로 사용자 undo 스택을 오염시키지 않아야 한다.
      try {
        const newDoc = editor.schema.nodeFromJSON(safePageDoc);
        const tr = editor.state.tr
          .replaceWith(0, editor.state.doc.content.size, newDoc.content)
          .setMeta("addToHistory", false)
          .setMeta("preventUpdate", true);
        editor.view.dispatch(tr);
      } catch {
        // 파싱 실패 시 안전망 — 어차피 빈 페이지보다 일관성 회복이 우선.
        editor.commands.setContent(safePageDoc, { emitUpdate: false });
      }
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
  const pendingDocSyncRef = useRef(false);
  const docSyncTimerRef = useRef<number | null>(null);
  const flushDocSync = useCallback(() => {
    if (!effectivePageId) return;
    if (!pendingDocSyncRef.current) return;
    const latest = usePageStore.getState().pages[effectivePageId];
    if (!latest) return;
    enqueuePageUpsertForSync(latest);
    pendingDocSyncRef.current = false;
    if (docSyncTimerRef.current !== null) {
      window.clearTimeout(docSyncTimerRef.current);
      docSyncTimerRef.current = null;
    }
  }, [effectivePageId]);

  const scheduleDocSync = useCallback(() => {
    if (docSyncTimerRef.current !== null) {
      window.clearTimeout(docSyncTimerRef.current);
    }
    docSyncTimerRef.current = window.setTimeout(() => {
      docSyncTimerRef.current = null;
      flushDocSync();
    }, DOC_SYNC_IDLE_MS);
  }, [flushDocSync]);

  useEffect(() => {
    if (!editor) return;
    const handler = () => {
      if (!effectivePageId) return;
      if (!storeDocHydratedRef.current) return;
      // selection 변경 등 doc 내용이 바뀌지 않은 경우 타이머 스케줄 자체를 생략
      if (editor.state.doc === lastSavedDocRef.current) return;
      const inDynamicLayout = isResolvedPosInDynamicLayoutContainer(
        editor.state.selection.$from,
      );
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
      debounceRef.current = window.setTimeout(() => {
        if (!effectivePageId) return;
        const currentDoc = editor.state.doc;
        if (currentDoc === lastSavedDocRef.current) return;
        lastSavedDocRef.current = currentDoc;
        const flushLocalDoc = () => {
          const json = normalizeFullPageDatabaseDoc(editor.getJSON());
          updateDoc(effectivePageId, json, { deferSync: true });
          pendingDocSyncRef.current = true;
          scheduleDocSync();
        };
        if (inDynamicLayout && "requestIdleCallback" in window) {
          (window as Window & {
            requestIdleCallback: (
              cb: () => void,
              opts?: { timeout: number },
            ) => number;
          }).requestIdleCallback(flushLocalDoc, { timeout: 1200 });
          return;
        }
        flushLocalDoc();
      }, inDynamicLayout ? DYNAMIC_LAYOUT_INPUT_AUTOSAVE_DEBOUNCE_MS : AUTOSAVE_DEBOUNCE_MS);
    };
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
      if (docSyncTimerRef.current !== null) {
        window.clearTimeout(docSyncTimerRef.current);
        docSyncTimerRef.current = null;
      }
    };
  }, [editor, effectivePageId, flushDocSync, scheduleDocSync, updateDoc]);

  useEffect(() => {
    if (!editor) return;
    editor.on("blur", flushDocSync);
    return () => {
      editor.off("blur", flushDocSync);
    };
  }, [editor, flushDocSync]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") flushDocSync();
    };
    const onBeforeUnload = () => flushDocSync();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [flushDocSync]);

  // 이미지 업로드 모달 트리거 — 포커스된 Editor 인스턴스만 열도록 가드 (피크 + 메인 동시 마운트 시 중복 노출 방지).
  useEffect(() => {
    const open = () => {
      if (!editor?.isFocused) return;
      setImageOpen(true);
    };
    window.addEventListener("quicknote:open-image-upload", open);
    return () =>
      window.removeEventListener("quicknote:open-image-upload", open);
  }, [editor]);

  // 서버 이미지 검색 모달 트리거 (/이미지검색)
  // 메인 + 피크(DatabaseRowPage 등) 양쪽 Editor 가 동시에 마운트돼 있을 수 있어
  // 포커스된 인스턴스에서만 열리도록 가드한다. 두 모달이 동시에 뜨는 회귀 방지.
  useEffect(() => {
    const open = () => {
      if (!editor?.isFocused) return;
      setServerImageOpen(true);
    };
    window.addEventListener("quicknote:open-server-image-picker", open);
    return () =>
      window.removeEventListener("quicknote:open-server-image-picker", open);
  }, [editor]);

  // 서버 동영상 검색 모달 트리거 (/동영상검색)
  useEffect(() => {
    const open = () => {
      if (!editor?.isFocused) return;
      setServerVideoOpen(true);
    };
    window.addEventListener("quicknote:open-server-video-picker", open);
    return () =>
      window.removeEventListener("quicknote:open-server-video-picker", open);
  }, [editor]);

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

  // 페이지 전환 시 draft·포커스 정리 — 사이드바 + 등으로 새 페이지를 만들 때 이전 제목이 붙는 것 방지.
  useLayoutEffect(() => {
    if (!currentPageId) {
      setTitleDraft("");
      titleFocusPageIdRef.current = null;
      return;
    }
    setTitleDraft(currentPageTitle);
    titleFocusPageIdRef.current = null;
    if (titleRef.current && document.activeElement === titleRef.current) {
      titleRef.current.blur();
    }
  }, [currentPageId]); // eslint-disable-line react-hooks/exhaustive-deps -- 전환 시에만 draft 리셋

  // 같은 페이지에서 원격·다른 UI 로 제목만 바뀐 경우 draft 동기화(입력 중 제외).
  useEffect(() => {
    if (!currentPageId) return;
    if (titleFocusPageIdRef.current === currentPageId) return;
    setTitleDraft(currentPageTitle);
  }, [currentPageId, currentPageTitle]);

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
      const nextPadding = `${px}px`;
      if (host.style.scrollPaddingBottom !== nextPadding) {
        host.style.scrollPaddingBottom = nextPadding;
      }
      setEditorTailSpacerPx((prev) => (prev === px ? prev : px));
    };
    run();
    window.addEventListener("resize", run, { passive: true });
    const vv = window.visualViewport;
    vv?.addEventListener("resize", run, { passive: true });
    return () => {
      window.removeEventListener("resize", run);
      vv?.removeEventListener("resize", run);
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
        className={`relative mx-auto w-full ${getEditorColumnClass({ fullWidth, hasPageComments, peek })}`}
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
              <PageTitleBar
                pageId={effectivePageId}
                icon={page.icon}
                titleDraft={titleDraft}
                titleClassName="min-w-0 flex-1 bg-transparent text-4xl font-bold tracking-tight text-zinc-900 outline-none placeholder:text-zinc-300 dark:text-zinc-100 dark:placeholder:text-zinc-700"
                titleRef={titleRef}
                onTitleChange={(v) => setTitleDraft(v)}
                onTitleFocus={() => {
                  titleFocusPageIdRef.current = effectivePageId;
                }}
                onTitleBlur={() => {
                  const focusPageId = titleFocusPageIdRef.current;
                  titleFocusPageIdRef.current = null;
                  if (!focusPageId || focusPageId !== effectivePageId) return;

                  const nextTitle = titleDraft.trim() || "제목 없음";
                  if (nextTitle !== page.title) {
                    renamePage(focusPageId, nextTitle);
                  }
                  if (!isFullPageDatabase) return;
                  const ok = trySyncFullPageDatabaseTitle(page.doc, nextTitle);
                  if (!ok) {
                    setSimpleAlert("이미 사용 중인 데이터베이스 이름입니다.");
                    renamePage(effectivePageId, dbTitleBaselineRef.current);
                    setTitleDraft(dbTitleBaselineRef.current);
                  } else {
                    dbTitleBaselineRef.current = nextTitle;
                    setTitleDraft(nextTitle);
                  }
                }}
                onTitleKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "ArrowDown") {
                    e.preventDefault();
                    editor?.chain().focus().run();
                  }
                }}
                onIconChange={(icon) => setIcon(effectivePageId, icon)}
                onIconUploadMessage={(msg) => setSimpleAlert(msg)}
                defaultIcon={
                  isFullPageDatabase
                    ? <Database size={56} className="text-zinc-400" />
                    : <FileText size={56} className="text-zinc-400" />
                }
                showSubpageTree={!isDatabaseRowPage && (descendantCount > 0 || !!page?.parentId)}
                subpagePopover={subpagePopover}
              />
            </div>
            {/* 페이지 레벨 댓글 — 제목 바로 아래 */}
            <div className="px-12">
              <PageCommentBar pageId={effectivePageId ?? pageId ?? ""} />
            </div>
          </>
        )}
        {bodyPrefix}
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
        {subpagePopover.open && subpagePopover.coords && createPortal(
          <div
            ref={subpagePopover.popoverRef}
            style={{ position: "fixed", top: subpagePopover.coords.top, left: subpagePopover.coords.left, width: 280, zIndex: 9999 }}
            className="rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          >
            <PageSubpageTree currentPageId={effectivePageId} className="px-2 pb-3 pt-1" hideHeader />
          </div>,
          document.body,
        )}
        {showTailSpacer ? (
          <div
            aria-hidden
            className="qn-editor-scroll-tail-spacer shrink-0 select-none"
            style={{
              height: editorTailSpacerPx,
              minHeight: editorTailSpacerPx,
            }}
          />
        ) : null}
      </div>
      <MemoBubbleToolbar editor={editor} pageId={effectivePageId} />
      <MemoImageResizeOverlay editor={editor} />
      <ImageUpload
        open={imageOpen}
        onClose={() => setImageOpen(false)}
        editor={editor}
      />
      <ServerImagePicker
        open={serverImageOpen}
        onClose={() => setServerImageOpen(false)}
        editor={editor}
        mode="image"
      />
      <ServerImagePicker
        open={serverVideoOpen}
        onClose={() => setServerVideoOpen(false)}
        editor={editor}
        mode="video"
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
