import {
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Copy,
  Download,
  GripVertical,
  LayoutTemplate,
  Link2,
  MessageSquare,
  MessageSquarePlus,
  Pilcrow,
  Trash2,
} from "lucide-react";
import {
  CALLOUT_PRESETS,
  type CalloutPresetId,
} from "../../lib/tiptapExtensions/calloutPresets";
import {
  BLOCK_BG_PRESETS,
  type BlockBgColor,
} from "../../lib/tiptapExtensions/blockBackground";
import { decodeFileRef } from "../../lib/files/scheme";
import { imageUrlCache } from "../../lib/images/registry";
import { startGripNativeDrag } from "../../lib/startBlockNativeDrag";
import { topLevelBlockStartsInSelectionRange } from "../../lib/pm/topLevelBlocks";
import { reportNonFatal } from "../../lib/reportNonFatal";
import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { useUiStore } from "../../store/uiStore";
import { useBlockCommentStore } from "../../store/blockCommentStore";
import { useMemberStore } from "../../store/memberStore";
import { ensureBlockId } from "../../lib/comments/ensureBlockId";
import {
  isAttachmentBlockNodeType,
  isCalloutBlockNodeType,
  shouldUseDatabaseBlockChrome,
} from "../../lib/blocks/uiPolicy";
import { buildQuickNotePageUrl } from "../../lib/navigation/quicknoteLinks";
import {
  COMMENT_BTN_GAP_PX,
  GUTTER_LEFT_PX,
  HANDLE_STRIP_PX,
  HANDLE_TOP_OFFSET_PX,
  type HoverInfo,
  MIN_HANDLE_LEFT,
  RECT_PAD_X,
  RECT_PAD_Y,
  TYPE_MENU_ITEMS,
  blockAtPoint,
  flattenWrapperToParagraph,
  pointInGripZone,
} from "./blockHandles/helpers";


type Props = {
  editor: Editor | null;
  /** 박스 선택으로 잡은 최상위 블럭 시작 위치 — 연속이면 그립으로 한꺼번에 이동 */
  boxSelectedStarts?: readonly number[];
  onClearBoxSelection?: () => void;
  /** Editor 가 편집 중인 페이지 ID — activePageId 와 다른 페이지(피크 뷰 등) 용도 */
  pageId?: string | null;
  /** 피크 뷰처럼 좁은 컨텍스트에서 댓글을 작은 아이콘+카운트 배지로 표시 */
  compactComments?: boolean;
};

/** 댓글 1개 이상인 블록 — 오른쪽 사이드바 카드(상시) */
type PinnedCommentBadge = {
  key: string;
  blockStart: number;
  blockId: string;
  count: number;
  top: number;
  commentLeft: number;
  /** 블록의 모든 댓글(시간순) — 사이드바에서 전체 표시 */
  messages: { id: string; bodyText: string; authorName: string }[];
};

type DownloadNotice = {
  kind: "loading" | "success" | "error";
  message: string;
} | null;


export function BlockHandles({
  editor,
  boxSelectedStarts,
  onClearBoxSelection,
  pageId,
  compactComments = false,
}: Props) {
  const boxSelectionActive =
    (boxSelectedStarts?.length ?? 0) > 0 ||
    (!!editor &&
      !editor.isDestroyed &&
      !!editor.view.dom.querySelector(".ProseMirror-selectednoderange"));
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const [bgOpen, setBgOpen] = useState(false);
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [downloadNotice, setDownloadNotice] = useState<DownloadNotice>(null);
  const globalActivePageId = usePageStore((s) => s.activePageId);
  // pageId prop 우선 — 피크 뷰처럼 활성 페이지와 다른 페이지를 편집할 때 정확한 페이지 ID 사용
  const activePageId = pageId ?? globalActivePageId;
  const openCommentThread = useUiStore((s) => s.openCommentThread);
  const [isDownloading, setIsDownloading] = useState(false);
  const [boxSelecting, setBoxSelecting] = useState(false);
  const dragCommittedRef = useRef(false);
  const clickTimerRef = useRef<number | null>(null);
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);

  const computeHover = useCallback(
    (e: MouseEvent) => {
      if (!editor) return null;
      return blockAtPoint(editor, e.clientX, e.clientY);
    },
    [editor],
  );

  // menuOpen·boxSelectionActive 를 ref 로 관리 — mousemove 핸들러가 최신값을 읽되
  // 값 변경마다 리스너를 재등록하지 않도록 deps 에서 제거
  const menuOpenRef = useRef(menuOpen);
  const boxSelectionActiveRef = useRef(boxSelectionActive);
  useEffect(() => { menuOpenRef.current = menuOpen; }, [menuOpen]);
  useEffect(() => { boxSelectionActiveRef.current = boxSelectionActive; }, [boxSelectionActive]);

  useEffect(() => {
    const syncBoxSelecting = () => {
      const cls = document.body.classList;
      setBoxSelecting(
        cls.contains("qn-box-select-tracking") || cls.contains("qn-box-select-dragging"),
      );
    };
    syncBoxSelecting();
    const observer = new MutationObserver(syncBoxSelecting);
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!editor) return;
    const root = containerRef.current?.parentElement;
    if (!root) return;

    let rafId: number | null = null;
    let pending: MouseEvent | null = null;

    const flushHover = () => {
      rafId = null;
      const e = pending;
      pending = null;
      if (!e || menuOpenRef.current) return;
      setHover((prev) => {
        const next = computeHover(e);
        const wrapperRect =
          containerRef.current?.parentElement?.getBoundingClientRect();

        // 콜아웃/토글 안: 그립으로 가는 동안 coords가 wrapper나 이모지 영역으로 잡혀
        // 이전 블록이 아닌 부모 블록으로 바뀌거나 null이 된다. 그립 위에서는 이전 타깃을 유지.
        if (
          next &&
          prev &&
          next.blockStart !== prev.blockStart &&
          wrapperRect &&
          pointInGripZone(e.clientX, e.clientY, prev, wrapperRect)
        ) {
          return prev;
        }

        /** 같은 블록 위에서 커서만 움직일 때 매 프레임 새 객체 → 전체 리렌더·동영상 재로드 유발 방지 */
        if (
          next &&
          prev &&
          next.blockStart === prev.blockStart
        ) {
          return prev;
        }

        if (next) return next;

        if (prev && wrapperRect) {
          const { rect } = prev;
          if (
            e.clientX >= rect.left - GUTTER_LEFT_PX &&
            e.clientX <= rect.right + RECT_PAD_X &&
            e.clientY >= rect.top - RECT_PAD_Y &&
            e.clientY <= rect.bottom + RECT_PAD_Y
          ) {
            return prev;
          }
          if (pointInGripZone(e.clientX, e.clientY, prev, wrapperRect)) {
            return prev;
          }
        }
        return null;
      });
    };

    const onMove = (e: MouseEvent) => {
      if (menuOpenRef.current || boxSelectionActiveRef.current) return;
      pending = e;
      if (rafId == null) {
        rafId = requestAnimationFrame(flushHover);
      }
    };
    const onLeave = (e: MouseEvent) => {
      if (menuOpenRef.current) return;
      pending = null;
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      const related = e.relatedTarget as Node | null;
      // 핸들 overlay(그립, 댓글 추가 버튼 등) 위로 이동하는 경우 hover 유지
      if (
        related &&
        (root.contains(related) || containerRef.current?.contains(related))
      )
        return;
      setHover(null);
    };

    root.addEventListener("mousemove", onMove);
    root.addEventListener("mouseleave", onLeave);
    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      root.removeEventListener("mousemove", onMove);
      root.removeEventListener("mouseleave", onLeave);
    };
  }, [editor, computeHover]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) &&
          !containerRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
        setPresetOpen(false);
        setTypeMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  // 팝업 열림 상태에서 Backspace/Delete 키로 블록 삭제
  const deleteBlockRef = useRef<() => void>(() => {});
  useEffect(() => { deleteBlockRef.current = deleteBlock; });

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        deleteBlockRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const hoverBlockStart = hover?.blockStart;

  useEffect(() => {
    if (!editor || hoverBlockStart == null) return;
    const refreshRect = () => {
      setHover((h) => {
        if (!h || !editor) return h;
        const dom = editor.view.nodeDOM(h.blockStart);
        const el = dom instanceof HTMLElement ? dom : (dom?.parentElement ?? null);
        if (!el) return null;
        const rectEl =
          shouldUseDatabaseBlockChrome(h.node.type.name)
            ? el.closest(".qn-database-block") ?? el
            : el;
        return { ...h, rect: rectEl.getBoundingClientRect() };
      });
    };
    const scroller = containerRef.current?.closest(".overflow-y-auto") ?? window;
    scroller.addEventListener("scroll", refreshRect, { passive: true });
    window.addEventListener("resize", refreshRect, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", refreshRect);
      window.removeEventListener("resize", refreshRect);
    };
  }, [editor, hoverBlockStart]);

  const wrapper = containerRef.current?.parentElement;
  const wrapperRect = wrapper?.getBoundingClientRect();

  const bar =
    hover && wrapperRect
      ? (() => {
          const top = hover.rect.top - wrapperRect.top + HANDLE_TOP_OFFSET_PX;
          const rawLeft = hover.rect.left - wrapperRect.left - HANDLE_STRIP_PX;
          const left = Math.max(MIN_HANDLE_LEFT, rawLeft);
          return { top, left };
        })()
      : null;

  const [pinnedCommentBadges, setPinnedCommentBadges] = useState<
    PinnedCommentBadge[]
  >([]);

  useEffect(() => {
    if (!editor || !activePageId) {
      setPinnedCommentBadges([]);
      return;
    }

    const refreshPinned = (): void => {
      const root = containerRef.current?.parentElement;
      if (!editor || editor.isDestroyed || !root) return;
      const wrapperRectInner = root.getBoundingClientRect();

      // 블록별 모든 댓글 수집 — createdAt 오름차순(오래된 → 최신)으로 정렬
      const messagesByBlockId = new Map<
        string,
        Array<{ id: string; bodyText: string; authorMemberId: string; createdAt: number }>
      >();
      for (const m of useBlockCommentStore.getState().messages) {
        if (m.pageId !== activePageId) continue;
        // 페이지 레벨 댓글(sentinel)은 블록 배지에서 제외
        if (m.blockId === "__page__") continue;
        const arr = messagesByBlockId.get(m.blockId) ?? [];
        arr.push({
          id: m.id,
          bodyText: m.bodyText,
          authorMemberId: m.authorMemberId,
          createdAt: m.createdAt,
        });
        messagesByBlockId.set(m.blockId, arr);
      }
      for (const arr of messagesByBlockId.values()) {
        arr.sort((a, b) => a.createdAt - b.createdAt);
      }

      const members = useMemberStore.getState().members;

      const items: PinnedCommentBadge[] = [];
      // ID 중복(예: 엔터로 블록 분할 시 일시적으로 같은 id) 가 있을 때 첫 번째만 카드 렌더 — 카드 복제 방지
      const seenIds = new Set<string>();
      editor.state.doc.descendants((node, pos) => {
        if (!node.isBlock) return;
        const id = node.attrs?.id as string | undefined;
        if (!id) return;
        if (seenIds.has(id)) return;
        seenIds.add(id);
        const msgs = messagesByBlockId.get(id);
        const count = msgs?.length ?? 0;
        if (count === 0) return;

        const dom = editor.view.nodeDOM(pos);
        const el = dom instanceof HTMLElement ? dom : dom?.parentElement;
        if (!el) return;
        const rectEl =
          shouldUseDatabaseBlockChrome(node.type.name)
            ? el.closest(".qn-database-block") ?? el
            : el;
        const rect = rectEl.getBoundingClientRect();
        const top = rect.top - wrapperRectInner.top + HANDLE_TOP_OFFSET_PX;
        const commentLeft =
          rect.right - wrapperRectInner.left + COMMENT_BTN_GAP_PX;
        const rendered = (msgs ?? []).map((m) => ({
          id: m.id,
          bodyText: m.bodyText,
          authorName:
            members.find((mb) => mb.memberId === m.authorMemberId)?.name ||
            "구성원",
        }));
        items.push({
          key: `${pos}-${id}`,
          blockStart: pos,
          blockId: id,
          count,
          top,
          commentLeft,
          messages: rendered,
        });
      });

      setPinnedCommentBadges(items);
    };

    refreshPinned();
    // 초기 렌더 직후 DOM/레이아웃이 안정된 뒤 한 번 더 새로고침 — 새로고침 시 카드 누락 방지
    const deferred = window.setTimeout(refreshPinned, 50);
    const deferred2 = window.setTimeout(refreshPinned, 250);
    const unsub = useBlockCommentStore.subscribe(refreshPinned);
    const unsubMembers = useMemberStore.subscribe(refreshPinned);
    editor.on("update", refreshPinned);
    const scroller = containerRef.current?.closest(".overflow-y-auto") ?? window;
    scroller.addEventListener("scroll", refreshPinned, { passive: true });
    window.addEventListener("resize", refreshPinned, { passive: true });
    return () => {
      window.clearTimeout(deferred);
      window.clearTimeout(deferred2);
      unsub();
      unsubMembers();
      editor.off("update", refreshPinned);
      scroller.removeEventListener("scroll", refreshPinned);
      window.removeEventListener("resize", refreshPinned);
    };
  }, [editor, activePageId]);

  const onGripPointerDown = (e: React.PointerEvent) => {
    dragCommittedRef.current = false;
    pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;
    }, 200);
  };

  const onGripDragStart = (e: React.DragEvent) => {
    if (!editor || !hover) return;
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    dragCommittedRef.current = true;
    e.stopPropagation();
    document.body.classList.add("quicknote-block-dragging");

    // 다중 이동 입력 결정 우선순위:
    //   1) 박스 드래그로 잡힌 블록(boxSelectedStarts) 이 hover 를 포함 → 그대로 사용
    //   2) Shift+화살표 등으로 PM 텍스트 선택이 다수의 doc 직속 블록을 가로지르고 있고 hover 가 그중 하나 → 그 블록 시작 좌표 사용
    //   3) 둘 다 아니면 단일 블록 이동
    let multiStarts: readonly number[] | undefined = boxSelectedStarts;
    const inBoxSelection =
      !!boxSelectedStarts?.length && boxSelectedStarts.includes(hover.blockStart);
    if (!inBoxSelection) {
      const sel = editor.state.selection;
      const pmStarts = topLevelBlockStartsInSelectionRange(
        editor.state.doc,
        sel.from,
        sel.to,
      );
      if (pmStarts.length > 1 && pmStarts.includes(hover.blockStart)) {
        multiStarts = pmStarts;
      }
    }

    startGripNativeDrag(
      editor,
      e.nativeEvent,
      hover.blockStart,
      hover.node,
      multiStarts,
    );
  };

  const onGripDragEnd = () => {
    document.body.classList.remove("quicknote-block-dragging");
    onClearBoxSelection?.();
  };

  const onGripClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragCommittedRef.current) {
      setMenuOpen((v) => !v);
      setPresetOpen(false);
      setTypeMenuOpen(false);
    }
  };

  const duplicateBlock = () => {
    if (!editor || !hover) return;
    const { blockStart, node } = hover;
    const insertAt = blockStart + node.nodeSize;
    const tr = editor.state.tr.insert(insertAt, node.copy(node.content));
    editor.view.dispatch(tr.scrollIntoView());
    editor.view.focus();
    setMenuOpen(false);
  };

  const openBlockCommentAtStart = (
    e: ReactMouseEvent<HTMLElement>,
    blockStart: number,
  ) => {
    if (!editor || !activePageId) return;
    const blockId = ensureBlockId(editor, blockStart);
    if (!blockId) return;
    const r = e.currentTarget.getBoundingClientRect();
    openCommentThread({
      pageId: activePageId,
      blockId,
      blockStart,
      skipScroll: true,
      anchorViewport: {
        top: r.top,
        left: r.left,
        right: r.right,
        bottom: r.bottom,
      },
    });
  };

  const openBlockComment = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (!hover) return;
    openBlockCommentAtStart(e, hover.blockStart);
  };

  const copyBlockLink = () => {
    if (!hover || !activePageId) return;
    void navigator.clipboard.writeText(
      buildQuickNotePageUrl({ pageId: activePageId, block: hover.blockStart }),
    );
    setMenuOpen(false);
  };

  const deleteBlock = () => {
    if (!editor || !hover) return;
    const { blockStart, node } = hover;
    const tr = editor.state.tr.delete(blockStart, blockStart + node.nodeSize);
    editor.view.dispatch(tr);
    editor.view.focus();
    setMenuOpen(false);
    setHover(null);
  };

  const applyCalloutPreset = (preset: CalloutPresetId) => {
    if (!editor || !hover) return;
    editor
      .chain()
      .focus()
      .setNodeSelection(hover.blockStart)
      .updateCalloutPreset(preset)
      .run();
    setPresetOpen(false);
    setMenuOpen(false);
  };

  // 컬럼 레이아웃 노드도 같은 프리셋 색상 시스템을 공유한다.
  const applyColumnLayoutPreset = (preset: CalloutPresetId) => {
    if (!editor || !hover) return;
    editor
      .chain()
      .focus()
      .setNodeSelection(hover.blockStart)
      .updateColumnLayoutPreset(preset)
      .run();
    setPresetOpen(false);
    setMenuOpen(false);
  };

  const applyBlockBackground = (color: BlockBgColor) => {
    if (!editor || !hover) return;
    editor
      .chain()
      .focus()
      .setNodeSelection(hover.blockStart)
      .updateAttributes(hover.node.type.name, { backgroundColor: color })
      .run();
    setBgOpen(false);
    setMenuOpen(false);
  };

  const isDatabaseBlock = hover?.node.type.name === "database";
  const isDatabaseFullPage = isDatabaseBlock && hover?.node.attrs.layout === "fullPage";

  // buttonBlock 의 databaseId — buttonBlock 은 inline atom 이라 hover 는 보통 paragraph.
  // hover 노드 자체와 그 inline 자식에서 buttonBlock 을 찾고, attrs 에 저장된 databaseId 우선,
  // 없으면 href 에서 pageId 추출 후 대상 페이지의 fullPage databaseBlock 조회로 fallback.
  const buttonBlockNode: PMNode | null = (() => {
    if (!hover?.node) return null;
    if (hover.node.type.name === "buttonBlock") return hover.node;
    let found: PMNode | null = null;
    hover.node.descendants((child) => {
      if (found) return false;
      if (child.type.name === "buttonBlock") {
        found = child;
        return false;
      }
      return true;
    });
    return found;
  })();
  const buttonBlockDbId: string | null = (() => {
    if (!buttonBlockNode) return null;
    const stored = buttonBlockNode.attrs.databaseId as string | undefined;
    if (stored) return stored;
    const href = buttonBlockNode.attrs.href as string | undefined;
    if (!href) return null;
    let targetPageId: string | null = null;
    try {
      const url = new URL(href);
      targetPageId = (url.searchParams.get("page") ?? url.pathname.replace(/^\/+/, "")) || null;
    } catch {
      const m = href.match(/[?&]page=([^&]+)/);
      if (m) targetPageId = decodeURIComponent(m[1]!);
    }
    if (!targetPageId) return null;
    const targetPage = usePageStore.getState().pages[targetPageId];
    const first = targetPage?.doc?.content?.[0];
    if (first?.type === "databaseBlock" && first.attrs?.layout === "fullPage") {
      return (first.attrs?.databaseId as string) || null;
    }
    return null;
  })();

  const isDatabaseButtonBlock = !!buttonBlockDbId;
  const isDatabaseInlineBlock = hover?.node.type.name === "databaseBlock" && hover?.node.attrs.layout !== "fullPage";
  const isCallout = hover ? isCalloutBlockNodeType(hover.node.type.name) : false;
  const isColumnLayout = hover?.node.type.name === "columnLayout";
  const isTextBlock = hover
    ? [
        "paragraph",
        "heading",
        "blockquote",
        "toggle",
        "bulletList",
        "orderedList",
        "taskList",
        // 마크다운 형식 블록 — 글머리·번호·체크 항목 개별 단위에도 배경 프리셋 적용
        "listItem",
        "taskItem",
      ].includes(hover.node.type.name)
    : false;
  const isAttachmentBlock =
    hover ? isAttachmentBlockNodeType(hover.node.type.name) : false;
  const shouldShowTypeChange =
    hover != null &&
    !["columnLayout", "column", "tabBlock", "tabPanel", "table"].includes(
      hover.node.type.name,
    );
  const menuAnchor =
    hover && bar && wrapperRect
      ? {
          x: wrapperRect.left + bar.left + 28,
          y: wrapperRect.top + bar.top,
        }
      : null;
  const menuFlipLeft =
    menuAnchor != null && menuAnchor.x + 8 + 192 > window.innerWidth - 8;
  const menuFlipUp =
    menuAnchor != null && menuAnchor.y + 260 > window.innerHeight - 8;

  const downloadAttachment = async () => {
    if (!editor || !hover || isDownloading) return;
    try {
      setIsDownloading(true);
      setDownloadNotice({
        kind: "loading",
        message: "다운로드 중...",
      });
      const attrs = hover.node.attrs as {
        src?: string | null;
        name?: string | null;
      };
      const rawSrc = attrs.src ?? null;
      if (!rawSrc) return;

      // quicknote-file:// ref 는 다운로드 URL로 해석 후 강제 다운로드.
      const fileId = decodeFileRef(rawSrc);
      const href = fileId ? await imageUrlCache.get(fileId) : rawSrc;
      if (!href) return;

      // WebView 환경에서 원격 mp4 href 직접 클릭 시 "재생 열기"로 라우팅되는 문제가 있어
      // blob 다운로드로 강제 저장 경로를 사용한다.
      const resp = await fetch(href, { method: "GET" });
      if (!resp.ok) throw new Error(`download failed: ${resp.status}`);
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      try {
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = attrs.name ?? "download";
        a.rel = "noopener noreferrer";
        a.style.display = "none";
        document.body.append(a);
        a.click();
        a.remove();
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
      setDownloadNotice({
        kind: "success",
        message: "다운로드가 완료되었습니다.",
      });
      setMenuOpen(false);
    } catch (err) {
      setDownloadNotice({
        kind: "error",
        message: "다운로드에 실패했습니다. 다시 시도해 주세요.",
      });
      reportNonFatal(err, "blockHandles.downloadAttachment");
    } finally {
      setIsDownloading(false);
    }
  };

  useEffect(() => {
    if (!downloadNotice || downloadNotice.kind === "loading") return;
    const t = window.setTimeout(() => setDownloadNotice(null), 2200);
    return () => window.clearTimeout(t);
  }, [downloadNotice]);

  useEffect(() => {
    if (!editor || !boxSelectionActive || (boxSelectedStarts?.length ?? 0) === 0) return;
    const anchorStart = boxSelectedStarts?.[0];
    if (anchorStart == null) return;
    const node = editor.state.doc.nodeAt(anchorStart);
    if (!node) return;
    const dom = editor.view.nodeDOM(anchorStart);
    const el = dom instanceof HTMLElement ? dom : (dom?.parentElement ?? null);
    if (!el) return;
    const rectEl =
      shouldUseDatabaseBlockChrome(node.type.name)
        ? el.closest(".qn-database-block") ?? el
        : el;
    setHover({
      blockStart: anchorStart,
      node,
      rect: rectEl.getBoundingClientRect(),
      depth: 1,
    });
  }, [editor, boxSelectionActive, boxSelectedStarts]);

  // 박스 드래그(마퀴) 중에는 그립·호버 UI만 숨긴다 — 고정 댓글 배지는 계속 보이게 함
  return (
    <div
      ref={containerRef}
      data-qn-editor-chrome="block-handles"
      className={[
        "pointer-events-none absolute inset-0",
        menuOpen ? "z-[320]" : "z-10",
      ].join(" ")}
    >
      {!boxSelecting && hover && bar && wrapperRect ? (
        <>
        <div
          className="pointer-events-auto absolute z-30 flex items-start"
          style={{ top: bar.top, left: bar.left }}
        >
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              data-qn-block-grip
              draggable
              onPointerDown={onGripPointerDown}
              onDragStart={onGripDragStart}
              onDragEnd={onGripDragEnd}
              onClick={onGripClick}
              title="클릭: 메뉴 | 드래그: 블록 이동"
              className="flex h-7 w-7 shrink-0 cursor-grab items-center justify-center rounded-md border border-transparent bg-white/90 text-zinc-500 shadow-sm ring-1 ring-zinc-200/80 hover:bg-zinc-50 hover:text-zinc-800 active:cursor-grabbing dark:bg-zinc-900/90 dark:ring-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <GripVertical size={15} />
            </button>

            {menuOpen && (
              <div
                className="absolute z-50 w-48 rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
                style={{
                  left: menuFlipLeft ? undefined : 32,
                  right: menuFlipLeft ? 32 : undefined,
                  top: menuFlipUp ? undefined : 0,
                  bottom: menuFlipUp ? 0 : undefined,
                }}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openBlockComment(e);
                    setMenuOpen(false);
                    setPresetOpen(false);
                    setTypeMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
                >
                  <MessageSquare size={14} />
                  댓글 추가
                </button>

                {isAttachmentBlock ? (
                  <button
                    type="button"
                    onClick={downloadAttachment}
                    className="flex w-full items-center gap-2 border-t border-zinc-200 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    <Download size={14} />
                    다운로드
                  </button>
                ) : shouldShowTypeChange ? (
                  <div className="relative border-t border-zinc-200 dark:border-zinc-700">
                    <button
                      type="button"
                      onMouseEnter={() => setTypeMenuOpen(true)}
                      onMouseLeave={() => setTypeMenuOpen(false)}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <span className="flex items-center gap-2">
                        <Pilcrow size={14} />
                        타입 변경
                      </span>
                      <span className="text-zinc-400">›</span>
                    </button>
                    {typeMenuOpen && (
                      <div
                        className="absolute left-full top-0 z-50 w-40 rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
                        onMouseEnter={() => setTypeMenuOpen(true)}
                        onMouseLeave={() => setTypeMenuOpen(false)}
                      >
                        {TYPE_MENU_ITEMS.map((item) => (
                          <button
                            key={item.label}
                            type="button"
                            onClick={() => {
                              if (!editor) return;
                              if (hover) {
                                // wrapper(콜아웃·토글·인용) → 새 타입 적용 시 wrapper를 먼저 평탄화하여
                                // 중첩(예: 콜아웃 안의 헤딩)이 만들어지지 않도록 한다.
                                const flattened = flattenWrapperToParagraph(
                                  editor,
                                  hover.blockStart,
                                );
                                if (flattened) {
                                  // 평탄화된 새 paragraph 안의 텍스트 위치로 selection 이동
                                  editor
                                    .chain()
                                    .focus()
                                    .setTextSelection(hover.blockStart + 1)
                                    .run();
                                } else {
                                  editor
                                    .chain()
                                    .focus()
                                    .setNodeSelection(hover.blockStart)
                                    .run();
                                }
                              }
                              item.cmd(editor);
                              setMenuOpen(false);
                              setTypeMenuOpen(false);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                          >
                            <item.icon size={14} />
                            {item.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}

                {/* 콜아웃 프리셋 (콜아웃 블럭일 때만) */}
                {isCallout && (
                  <div className="relative">
                    <button
                      type="button"
                      onMouseEnter={() => setPresetOpen(true)}
                      onMouseLeave={() => setPresetOpen(false)}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <span className="flex items-center gap-2">
                        <LayoutTemplate size={14} />
                        프리셋
                      </span>
                      <span className="text-zinc-400">›</span>
                    </button>
                    {presetOpen && (
                      <div
                        className="absolute left-full top-0 z-50 max-h-64 w-56 overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
                        onMouseEnter={() => setPresetOpen(true)}
                        onMouseLeave={() => setPresetOpen(false)}
                      >
                        {CALLOUT_PRESETS.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => applyCalloutPreset(p.id)}
                            className="flex w-full items-start gap-2 px-2 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                          >
                            <span className="w-6 shrink-0 text-center text-base leading-6">
                              {p.emoji || "·"}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="font-medium text-zinc-800 dark:text-zinc-100">
                                {p.label}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 컬럼 레이아웃 컬러 변경 (컬럼 블록일 때만) */}
                {isColumnLayout && (
                  <div className="relative">
                    <button
                      type="button"
                      onMouseEnter={() => setPresetOpen(true)}
                      onMouseLeave={() => setPresetOpen(false)}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <span className="flex items-center gap-2">
                        <LayoutTemplate size={14} />
                        컬러 변경
                      </span>
                      <span className="text-zinc-400">›</span>
                    </button>
                    {presetOpen && (
                      <div
                        className="absolute left-full top-0 z-50 max-h-64 w-56 overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
                        onMouseEnter={() => setPresetOpen(true)}
                        onMouseLeave={() => setPresetOpen(false)}
                      >
                        {CALLOUT_PRESETS.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => applyColumnLayoutPreset(p.id)}
                            className="flex w-full items-start gap-2 px-2 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                          >
                            <span className="w-6 shrink-0 text-center text-base leading-6">
                              {p.emoji || "·"}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="font-medium text-zinc-800 dark:text-zinc-100">
                                {p.label}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 텍스트 블록 정렬 */}
                {isTextBlock && (
                  <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-700">
                    <div className="mb-1 text-[10px] text-zinc-500 dark:text-zinc-400">정렬</div>
                    <div className="flex gap-1">
                      {([
                        { icon: AlignLeft, label: '좌측', align: 'left' },
                        { icon: AlignCenter, label: '중앙', align: 'center' },
                        { icon: AlignRight, label: '우측', align: 'right' },
                      ] as const).map(({ icon: Icon, label, align }) => (
                        <button
                          key={align}
                          type="button"
                          title={label}
                          onClick={() => {
                            if (!editor || !hover) return;
                            editor
                              .chain()
                              .focus()
                              .setNodeSelection(hover.blockStart)
                              .setTextAlign(align)
                              .run();
                            setMenuOpen(false);
                          }}
                          className="flex flex-1 items-center justify-center rounded py-1 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        >
                          <Icon size={14} />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 텍스트 블록 배경색 */}
                {isTextBlock && (
                  <div className="relative">
                    <button
                      type="button"
                      onMouseEnter={() => setBgOpen(true)}
                      onMouseLeave={() => setBgOpen(false)}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <span className="flex items-center gap-2">
                        <span className="inline-block h-3.5 w-3.5 rounded-sm border border-zinc-300 bg-gradient-to-br from-yellow-200 via-pink-200 to-blue-200 dark:border-zinc-600" />
                        배경색
                      </span>
                      <span className="text-zinc-400">›</span>
                    </button>
                    {bgOpen && (
                      <div
                        className="absolute left-full top-0 z-50 w-52 overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
                        onMouseEnter={() => setBgOpen(true)}
                        onMouseLeave={() => setBgOpen(false)}
                      >
                        <button
                          type="button"
                          onClick={() => applyBlockBackground(null)}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm border border-zinc-300 dark:border-zinc-600 text-zinc-400 text-[10px]">✕</span>
                          <span className="text-zinc-700 dark:text-zinc-300">배경색 제거</span>
                        </button>
                        <div className="mx-3 my-1 border-t border-zinc-100 dark:border-zinc-800" />
                        {BLOCK_BG_PRESETS.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => applyBlockBackground(p.id)}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                          >
                            <span
                              className="inline-block h-4 w-4 shrink-0 rounded-sm border border-zinc-200 dark:border-zinc-700"
                              style={{ backgroundColor: p.dot }}
                            />
                            <span className="text-zinc-700 dark:text-zinc-300">{p.label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <hr className="my-1 border-zinc-200 dark:border-zinc-700" />

                <button
                  type="button"
                  onClick={copyBlockLink}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <Link2 size={14} />
                  블럭 링크 복사
                </button>

                {/* 복제 */}
                <button
                  type="button"
                  onClick={duplicateBlock}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <Copy size={14} />
                  복제
                </button>

                {/* DB 인라인 보기로 변경 */}
                {isDatabaseFullPage && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!editor || !hover) return;
                      editor.chain()
                        .setNodeSelection(hover.blockStart)
                        .updateAttributes("database", { layout: "inline" })
                        .run();
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <LayoutTemplate size={14} />
                    인라인 보기로 변경
                  </button>
                )}

                {/* buttonBlock → databaseBlock 인라인 보기로 변경 */}
                {isDatabaseButtonBlock && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!editor || !hover || !buttonBlockDbId) return;
                      const databaseId = buttonBlockDbId;
                      const dbNode = editor.state.schema.nodes.databaseBlock?.create({
                        databaseId,
                        layout: "inline",
                      });
                      if (!dbNode) return;
                      const tr = editor.state.tr.replaceWith(
                        hover.blockStart,
                        hover.blockStart + hover.node.nodeSize,
                        dbNode,
                      );
                      editor.view.dispatch(tr);
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <LayoutTemplate size={14} />
                    인라인 보기로 변경
                  </button>
                )}

                {/* databaseBlock(인라인) → buttonBlock 으로 변경 */}
                {isDatabaseInlineBlock && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!editor || !hover) return;
                      const databaseId = hover.node.attrs.databaseId as string;
                      if (!databaseId) return;
                      const homePageId = usePageStore.getState().findFullPagePageIdForDatabase(databaseId);
                      if (!homePageId) return;
                      const dbTitle = useDatabaseStore.getState().databases[databaseId]?.meta.title ?? "데이터베이스";
                      const href = buildQuickNotePageUrl({ pageId: homePageId });
                      const btnNode = editor.state.schema.nodes.buttonBlock?.create({
                        label: `${dbTitle} DB`,
                        href,
                        databaseId,
                      });
                      if (!btnNode) return;
                      const tr = editor.state.tr.replaceWith(
                        hover.blockStart,
                        hover.blockStart + hover.node.nodeSize,
                        btnNode,
                      );
                      editor.view.dispatch(tr);
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <LayoutTemplate size={14} />
                    버튼 보기로 변경
                  </button>
                )}

                {/* 삭제 */}
                <button
                  type="button"
                  onClick={deleteBlock}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <Trash2 size={14} />
                  삭제
                </button>
              </div>
            )}
          </div>
        </div>
        </>
      ) : null}
      {pinnedCommentBadges.map((pin) => (
        <div
          key={pin.key}
          data-qn-comment-badge-block-id={pin.blockId}
          role="button"
          tabIndex={0}
          onMouseDown={(e) => {
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            openBlockCommentAtStart(e, pin.blockStart);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              openBlockCommentAtStart(
                e as unknown as React.MouseEvent<HTMLElement>,
                pin.blockStart,
              );
            }
          }}
          title={`댓글 ${pin.count}개 — 클릭해서 열기`}
          aria-label={`블록 댓글 ${pin.count}개`}
          className={
            compactComments
              ? "pointer-events-auto absolute z-30 flex h-7 w-7 cursor-pointer select-none items-center justify-center rounded-md border border-zinc-200 bg-white shadow-sm hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-amber-950/30"
              : "pointer-events-auto absolute z-30 cursor-pointer select-none overflow-hidden rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-left shadow-sm transition hover:border-amber-300 hover:bg-amber-50/40 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-amber-700 dark:hover:bg-amber-950/30"
          }
          // 컴팩트(피크): 작은 정사각 배지(블록 우측 가장자리)
          // 일반: 232px 카드 — wrapper 우측 가장자리 사이드바 컬럼에 고정 정렬 (전체너비 토글 시 자연스러운 확장)
          style={
            compactComments
              ? { top: pin.top, left: pin.commentLeft }
              : { top: pin.top, right: 12, width: 232, maxHeight: 240 }
          }
        >
          {compactComments ? (
            <div className="relative flex items-center justify-center">
              <MessageSquare
                size={14}
                strokeWidth={2}
                className="text-amber-500 dark:text-amber-400"
              />
              <span className="absolute -right-1.5 -top-1.5 flex min-h-[14px] min-w-[14px] items-center justify-center rounded-full bg-amber-500 px-[3px] text-[9px] font-bold tabular-nums leading-none text-white shadow-sm dark:bg-amber-600">
                {pin.count > 99 ? "99+" : pin.count}
              </span>
            </div>
          ) : (
            <>
              <div className="mb-1 flex items-center gap-1.5">
                <MessageSquare
                  size={11}
                  strokeWidth={2}
                  className="shrink-0 text-amber-500 dark:text-amber-400"
                />
                <span className="min-w-0 flex-1 text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">
                  댓글 {pin.count}개
                </span>
              </div>
              <div className="space-y-1.5">
                {pin.messages.map((m, idx) => (
                  <div
                    key={m.id}
                    className={
                      idx > 0
                        ? "border-t border-zinc-100 pt-1.5 dark:border-zinc-800"
                        : ""
                    }
                  >
                    <div className="truncate text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">
                      {m.authorName}
                    </div>
                    <div className="line-clamp-3 whitespace-pre-wrap text-[11px] leading-snug text-zinc-600 dark:text-zinc-300">
                      {m.bodyText || (
                        <span className="italic text-zinc-400">내용 없음</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      ))}
      {/* 댓글이 없는 호버 블록의 오른쪽 바깥에 작은 댓글 추가 버튼 표시 — 블록 바로 오른쪽에 정렬 */}
      {!boxSelecting && hover && wrapperRect && (() => {
        const hBlockId = hover.node.attrs?.id as string | undefined;
        if (!hBlockId) return null;
        if (pinnedCommentBadges.some((p) => p.blockId === hBlockId)) return null;
        const top = hover.rect.top - wrapperRect.top + HANDLE_TOP_OFFSET_PX + 2;
        const left = hover.rect.right - wrapperRect.left + COMMENT_BTN_GAP_PX;
        return (
          <div
            className="pointer-events-auto absolute z-30 flex items-start"
            style={{ top, left }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openBlockCommentAtStart(e, hover.blockStart);
              }}
              title="댓글 추가"
              aria-label="댓글 추가"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-300 opacity-0 transition-opacity hover:bg-amber-50 hover:text-amber-500 group-hover:opacity-100 dark:text-zinc-600 dark:hover:bg-amber-950/30 dark:hover:text-amber-400"
              style={{ opacity: 1 }}
            >
              <MessageSquarePlus size={14} />
            </button>
          </div>
        );
      })()}
      {downloadNotice ? (
        <div className="pointer-events-none fixed bottom-5 right-5 z-[420]">
          <div
            className={`rounded-lg border px-3 py-2 text-xs shadow-lg ${
              downloadNotice.kind === "error"
                ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300"
                : downloadNotice.kind === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300"
                  : "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/50 dark:text-blue-300"
            }`}
          >
            {downloadNotice.message}
          </div>
        </div>
      ) : null}
    </div>
  );
}
