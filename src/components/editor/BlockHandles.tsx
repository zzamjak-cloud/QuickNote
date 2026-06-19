import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { HandleLayerBase } from "./handles/HandleLayerBase";
import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Baseline,
  Copy,
  Download,
  GripVertical,
  LayoutTemplate,
  Link2,
  MessageSquare,
  MessageSquarePlus,
  PaintBucket,
  Pilcrow,
  Trash2,
} from "lucide-react";
import {
  CALLOUT_COLOR_CHIP_PRESETS,
  CALLOUT_PRESETS,
  COLUMN_LAYOUT_PRESETS,
  type CalloutPresetId,
} from "../../lib/tiptapExtensions/calloutPresets";
import {
  BLOCK_BG_PRESETS,
  type BlockBgColor,
  BLOCK_TEXT_PRESETS,
  type BlockTextColor,
} from "../../lib/tiptapExtensions/blockBackground";
import { decodeFileRef } from "../../lib/files/scheme";
import { imageUrlCache } from "../../lib/images/registry";
import { startGripNativeDrag } from "../../lib/startBlockNativeDrag";
import {
  applyHeaderColToggle,
  applyHeaderRowToggle,
  isHeaderColActive,
  isHeaderRowActive,
} from "../../lib/editor/tableHeaders";
import { topLevelBlockStartsInSelectionRange } from "../../lib/pm/topLevelBlocks";
import { reportNonFatal } from "../../lib/reportNonFatal";
import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { useUiStore } from "../../store/uiStore";
import { useBlockCommentStore } from "../../store/blockCommentStore";
import { useMemberStore } from "../../store/memberStore";
import { POINTER_PRESS_FEEDBACK_CLASS } from "../common/interactionClasses";
import { ensureBlockId } from "../../lib/comments/ensureBlockId";
import { canBlockHaveComment } from "../../lib/comments/blockCommentTargets";
import {
  isAttachmentBlockNodeType,
  isCalloutBlockNodeType,
} from "../../lib/blocks/uiPolicy";
import { buildQuickNotePageUrl } from "../../lib/navigation/quicknoteLinks";
import {
  COMMENT_BTN_GAP_PX,
  GUTTER_LEFT_PX,
  HANDLE_TOP_OFFSET_PX,
  type HoverInfo,
  RECT_PAD_X,
  RECT_PAD_Y,
  TYPE_MENU_ITEMS,
  TOGGLE_VARIANT_MENU_ITEMS,
  applyToggleTitleLevel,
  blockAtPoint,
  unwrapWrapperBlock,
  isAncestorListHover,
  isListHandleNodeType,
  pointInGripZone,
  pointInsideListOwnRow,
  listElementForHover,
  resolveHandleLeft,
  resolveHandleTop,
  visualElementForBlockNode,
} from "./blockHandles/helpers";
import { HoverMenuGroup, HoverMenuRow } from "./blockHandles/HoverMenuRow";
import {
  applyLinkBlockChoice,
  getConvertibleLinkHref,
  type LinkBlockMode,
} from "../../lib/editor/linkBlockConvert";
import { isTrustedYoutubeInput } from "../../lib/safeUrl";


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


function getEditorViewDom(editor: Editor | null | undefined): Element | null {
  if (!editor || editor.isDestroyed) return null;
  try {
    return editor.view.dom;
  } catch {
    return null;
  }
}

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
      !!getEditorViewDom(editor)?.querySelector(".ProseMirror-selectednoderange"));
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // 열린 메뉴 패널 DOM — 실제 높이 측정 후 viewport 안으로 세로 보정
  const menuPanelRef = useRef<HTMLDivElement | null>(null);
  // 메뉴 패널의 부모(.relative 그립 컨테이너) 기준 세로 오프셋(px). 0 = 그립 상단 정렬
  const [menuVOffset, setMenuVOffset] = useState(0);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
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
          isListHandleNodeType(next.node.type.name) &&
          isListHandleNodeType(prev.node.type.name)
        ) {
          if (
            isAncestorListHover(editor, next, prev) &&
            !pointInsideListOwnRow(editor, next, e.clientX, e.clientY)
          ) {
            return prev;
          }
          return next;
        }
        if (
          next &&
          prev &&
          next.blockStart !== prev.blockStart &&
          wrapperRect &&
          pointInGripZone(e.clientX, e.clientY, prev, wrapperRect)
        ) {
          return prev;
        }

        // prev 블록의 우측 댓글 추가 아이콘 영역(rect.right+8 ~ rect.right+32 × rect.top-4 ~ rect.top+24)에
        // 커서가 있다면 prev 유지. 인접 블록(컬럼·리스트 부모 등)으로 hover 가 전환되거나
        // next === null 이 되어도 아이콘이 사라지지 않도록 보장. 블록 타입(리스트 여부)과 무관하게 적용.
        if (
          prev &&
          (!next || next.blockStart !== prev.blockStart) &&
          e.clientX > prev.rect.right &&
          e.clientX <= prev.rect.right + COMMENT_BTN_GAP_PX + 24 &&
          e.clientY >= prev.rect.top - 4 &&
          e.clientY <= prev.rect.top + 24
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

        // prev 가 리스트 항목이고 커서가 그 항목 행 왼쪽(텍스트→핸들 경로) 의 넉넉한 존 안에 있으면
        // next 가 (컬럼·콜아웃 등) 다른 블록으로 잡혀도 prev 를 유지한다.
        // 콜아웃/컬럼 안 글머리에서 핸들로 가려고 거터로 이동할 때, own-row/grip 존 사이의 데드존에서
        // next 가 컨테이너로 잡혀 핸들이 사라지던 회귀를 차단. li 의 "현재" rect 를 직접 측정해 stale 방지.
        if (prev && isListHandleNodeType(prev.node.type.name)) {
          const liEl = listElementForHover(editor, prev);
          const liRect = liEl?.getBoundingClientRect() ?? prev.rect;
          const inListPreserveZone =
            e.clientX >= liRect.left - 80 &&
            e.clientX <= liRect.right + 40 &&
            e.clientY >= liRect.top - 4 &&
            e.clientY <= liRect.bottom + 4;
          if (
            inListPreserveZone ||
            (wrapperRect && pointInGripZone(e.clientX, e.clientY, prev, wrapperRect))
          ) {
            return prev;
          }
        }

        if (next) return next;

        if (prev && wrapperRect) {
          const { rect } = prev;
          const isPrevListItem = isListHandleNodeType(prev.node.type.name);
          if (
            isPrevListItem &&
            pointInsideListOwnRow(editor, prev, e.clientX, e.clientY)
          ) {
            return prev;
          }
          if (isPrevListItem && pointInGripZone(e.clientX, e.clientY, prev, wrapperRect)) {
            return prev;
          }
          if (
            !isPrevListItem &&
            e.clientX >= rect.left - GUTTER_LEFT_PX &&
            // 우측 댓글 추가 아이콘(rect.right + COMMENT_BTN_GAP_PX 위치, 20px 너비)을 호버 유지 영역에 포함
            e.clientX <= rect.right + Math.max(RECT_PAD_X, COMMENT_BTN_GAP_PX + 24) &&
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
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  // 메뉴 패널 세로 위치 보정 — 실제 높이를 측정해 viewport 밖으로 잘리지 않게 시프트.
  // offsetHeight 는 CSS top 과 무관하므로 보정값 누적(피드백) 없이 안정적으로 계산된다.
  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuVOffset(0);
      return;
    }
    const PAD = 8;
    const compute = () => {
      const panel = menuPanelRef.current;
      const gripBox = menuRef.current; // 그립(.relative) 컨테이너 — 메뉴 위치와 무관하게 그립 좌표 제공
      if (!panel || !gripBox) return;
      const gripTopVp = gripBox.getBoundingClientRect().top;
      const menuH = panel.offsetHeight;
      let topVp = gripTopVp; // 기본: 그립 상단에 맞춰 아래로 펼침
      if (topVp + menuH > window.innerHeight - PAD) {
        topVp = window.innerHeight - PAD - menuH; // 하단 초과 시 위로 시프트
      }
      if (topVp < PAD) topVp = PAD; // 상단 클램프(메뉴가 화면보다 큰 극단 케이스)
      setMenuVOffset(topVp - gripTopVp);
    };
    const rafId = window.requestAnimationFrame(compute);
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [menuOpen, hover]);

  // 팝업 열림 상태에서 단축키(삭제·복제)
  const deleteBlockRef = useRef<() => void>(() => {});
  const duplicateBlockRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!menuOpen || boxSelectionActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.key === "Process") return;
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        deleteBlockRef.current();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        e.stopPropagation();
        duplicateBlockRef.current();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [menuOpen, boxSelectionActive]);

  const hoverBlockStart = hover?.blockStart;

  useEffect(() => {
    if (!editor || hoverBlockStart == null) return;
    const refreshRect = () => {
      setHover((h) => {
        if (!h || !editor) return h;
        const dom = editor.view.nodeDOM(h.blockStart);
        const el = dom instanceof HTMLElement ? dom : (dom?.parentElement ?? null);
        if (!el) return null;
        const rectEl = visualElementForBlockNode(h.node.type.name, el);
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
          const top = resolveHandleTop(hover, wrapperRect);
          const left = resolveHandleLeft(hover, wrapperRect);
          return { top, left };
        })()
      : null;

  const [pinnedCommentBadges, setPinnedCommentBadges] = useState<
    PinnedCommentBadge[]
  >([]);
  // setState 반복 방지 — 안정 키(blockId·count·messageIds)가 같으면 업데이트 건너뜀
  const pinnedStableKeyRef = useRef<string>("");
  // 렌더된 카드 DOM 참조(key→element) — 실제 높이 측정용
  const badgeElRef = useRef<Map<string, HTMLDivElement>>(new Map());
  // 겹침 보정 후 카드별 top(key→px). 비어 있으면 자연 위치(pin.top) 사용
  const [stackedTops, setStackedTops] = useState<Record<string, number>>({});

  useLayoutEffect(() => {
    if (!editor || !activePageId) {
      setPinnedCommentBadges([]);
      return;
    }

    let rafId: number | null = null;

    // 실제 계산 및 setState — 항상 RAF 안에서만 호출되므로 React 커밋 단계와 겹치지 않음
    const computeAndSet = (): void => {
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
        const rectEl = visualElementForBlockNode(node.type.name, el);
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

      // 같은 행(컬럼 블록 등)에 달린 카드들이 right:12 에 정렬돼 겹치는 문제는
      // 실제 렌더 높이를 알아야 정확히 나열할 수 있으므로, 여기서는 자연 위치(top)만
      // 둔다. 겹침 보정은 렌더 후 높이를 측정하는 별도 layout effect 에서 수행한다.
      // 단, 측정 전 첫 페인트에서 완전히 겹쳐 보이지 않도록 top 오름차순으로 정렬해 둔다.
      if (!compactComments && items.length > 1) {
        items.sort((a, b) => a.top - b.top || a.commentLeft - b.commentLeft);
      }

      const nextKey = items
        .map((i) => `${i.blockId}:${i.count}:${i.messages.map((m) => m.id).join(",")}`)
        .join("|");
      if (nextKey !== pinnedStableKeyRef.current) {
        pinnedStableKeyRef.current = nextKey;
        setPinnedCommentBadges(items);
      }
    };

    // 여러 이벤트가 동시에 몰려도 한 프레임에 한 번만 계산 — 동기 setState 금지
    const refreshPinned = (): void => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        computeAndSet();
      });
    };

    // 초기 계산도 RAF로 미뤄 React 커밋 단계를 완전히 벗어난 뒤 실행
    rafId = requestAnimationFrame(() => {
      rafId = null;
      computeAndSet();
    });

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(refreshPinned)
        : null;
    const root = containerRef.current?.parentElement;
    if (resizeObserver && root) resizeObserver.observe(root);
    const unsub = useBlockCommentStore.subscribe(refreshPinned);
    const unsubMembers = useMemberStore.subscribe(refreshPinned);
    editor.on("update", refreshPinned);
    const scroller = containerRef.current?.closest(".overflow-y-auto") ?? window;
    scroller.addEventListener("scroll", refreshPinned, { passive: true });
    window.addEventListener("resize", refreshPinned, { passive: true });
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      unsub();
      unsubMembers();
      editor.off("update", refreshPinned);
      scroller.removeEventListener("scroll", refreshPinned);
      window.removeEventListener("resize", refreshPinned);
    };
  }, [editor, activePageId, compactComments]);

  // 렌더된 카드의 실제 높이를 측정해 겹치지 않게 세로로 나열한다(카드 높이에 맞춰 자동 보정).
  // 자연 위치(pin.top)에서 시작하되, 위 카드와 겹치면 그 카드 '실측 높이 + 간격'만큼만 밀어낸다.
  useLayoutEffect(() => {
    if (compactComments || pinnedCommentBadges.length === 0) {
      setStackedTops((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }
    const GAP_PX = 8;
    const sorted = [...pinnedCommentBadges].sort(
      (a, b) => a.top - b.top || a.commentLeft - b.commentLeft,
    );
    const next: Record<string, number> = {};
    let prevBottom = Number.NEGATIVE_INFINITY;
    for (const pin of sorted) {
      const el = badgeElRef.current.get(pin.key);
      const height = el?.offsetHeight ?? 0;
      const top =
        prevBottom === Number.NEGATIVE_INFINITY
          ? pin.top
          : Math.max(pin.top, prevBottom + GAP_PX);
      next[pin.key] = top;
      prevBottom = top + height;
    }
    setStackedTops((prev) => {
      const keys = Object.keys(next);
      const same =
        keys.length === Object.keys(prev).length &&
        keys.every(
          (k) =>
            Math.abs((prev[k] ?? Number.NaN) - (next[k] ?? Number.NaN)) < 0.5,
        );
      return same ? prev : next;
    });
  }, [pinnedCommentBadges, compactComments]);

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

  useEffect(() => {
    deleteBlockRef.current = deleteBlock;
    duplicateBlockRef.current = duplicateBlock;
  });

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
    // 편집(블록 추가/삭제)에도 안전하도록 블록에 안정적 id 를 부여해 링크에 싣는다.
    // 숫자 위치(blockStart)는 폴백으로 함께 저장한다.
    const blockId = editor ? ensureBlockId(editor, hover.blockStart) : null;
    void navigator.clipboard.writeText(
      buildQuickNotePageUrl({ pageId: activePageId, blockId, block: hover.blockStart }),
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
    setMenuOpen(false);
  };

  // 2컬럼 너비 비율 프리셋 — 각 컬럼 노드의 width(flex-grow) attr 을 PM 트랜잭션으로 설정.
  const applyColumnRatio = (ratios: number[]) => {
    if (!editor || !hover) return;
    try {
      const { state } = editor.view;
      const layoutStart = hover.blockStart;
      const layoutNode = state.doc.nodeAt(layoutStart);
      if (!layoutNode || layoutNode.type.name !== "columnLayout") return;
      let tr = state.tr;
      // attr 변경은 nodeSize 를 바꾸지 않으므로 offset 은 루프 내내 유효하다.
      layoutNode.forEach((col, offset, index) => {
        tr = tr.setNodeMarkup(layoutStart + 1 + offset, undefined, {
          ...col.attrs,
          width: ratios[index] ?? null,
        });
      });
      editor.view.dispatch(tr);
    } catch { /* noop */ }
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
    setMenuOpen(false);
  };

  const applyBlockTextColor = (color: BlockTextColor) => {
    if (!editor || !hover) return;
    editor
      .chain()
      .focus()
      .setNodeSelection(hover.blockStart)
      .updateAttributes(hover.node.type.name, { blockTextColor: color })
      .run();
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
  // 비율 프리셋은 정확히 2컬럼일 때만 노출
  const isTwoColumnLayout = isColumnLayout && hover?.node.childCount === 2;
  const isToggleBlock = hover?.node.type.name === "toggle";
  const isTable = hover?.node.type.name === "table";
  // 표 헤더 상태는 토글 직후 hover.node 가 갱신되기 전일 수 있어 live doc 에서 조회.
  const liveTableNode =
    isTable && hover && editor
      ? (() => {
          const n = editor.state.doc.nodeAt(hover.blockStart);
          return n?.type.name === "table" ? n : hover.node;
        })()
      : null;
  const tableHeaderRowActive = liveTableNode ? isHeaderRowActive(liveTableNode) : false;
  const tableHeaderColActive = liveTableNode ? isHeaderColActive(liveTableNode) : false;
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
  // 붙여넣기 링크 선택지로 만든 블록(버튼·북마크·유튜브)이면 형식 변환 메뉴를 노출한다.
  const linkBlockHref = hover ? getConvertibleLinkHref(hover.node) : null;
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
        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
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
    const rectEl = visualElementForBlockNode(node.type.name, el);
    setHover({
      blockStart: anchorStart,
      node,
      rect: rectEl.getBoundingClientRect(),
      depth: 1,
    });
  }, [editor, boxSelectionActive, boxSelectedStarts]);

  // 박스 드래그(마퀴) 중에는 그립·호버 UI만 숨긴다 — 고정 댓글 배지는 계속 보이게 함
  return (
    <HandleLayerBase
      ref={containerRef}
      zClassName={menuOpen ? "z-[740]" : "z-10"}
      dataAttrs={{ "data-qn-editor-chrome": "block-handles" }}
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
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent bg-white/90 text-zinc-500 shadow-sm ring-1 ring-zinc-200/80 hover:bg-zinc-50 hover:text-zinc-800 dark:bg-zinc-900/90 dark:ring-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 ${POINTER_PRESS_FEEDBACK_CLASS}`}
            >
              <GripVertical size={15} />
            </button>

            {menuOpen && (
              <div
                ref={menuPanelRef}
                className="absolute z-[740] w-48 rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
                style={{
                  left: menuFlipLeft ? undefined : 32,
                  right: menuFlipLeft ? 32 : undefined,
                  // 세로는 측정 기반 오프셋으로 viewport 안에 고정 (clipping 방지)
                  top: menuVOffset,
                }}
              >
                <HoverMenuGroup>
                {hover && canBlockHaveComment(hover.node.type.name) ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      openBlockComment(e);
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
                  >
                    <MessageSquare size={14} />
                    댓글 추가
                  </button>
                ) : null}

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
                  <HoverMenuRow icon={<Pilcrow size={14} />} label="타입 변경" topSeparator panelWidth="w-44" preferredMaxHeight={320}>
                    {isToggleBlock ? (
                      <>
                        {TOGGLE_VARIANT_MENU_ITEMS.map((item) => (
                          <button
                            key={item.label}
                            type="button"
                            onClick={() => {
                              if (!editor || !hover) return;
                              applyToggleTitleLevel(editor, hover.blockStart, item.level);
                              setMenuOpen(false);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                          >
                            <item.icon size={14} />
                            {item.label}
                          </button>
                        ))}
                        <div className="my-1 border-t border-zinc-200 dark:border-zinc-700" />
                      </>
                    ) : null}
                    {TYPE_MENU_ITEMS.filter(
                      (item) => !(isToggleBlock && item.label === "토글"),
                    ).map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => {
                          if (!editor) return;
                          if (hover) {
                            // wrapper(콜아웃·토글·인용) → 새 타입 적용 시 wrapper를 먼저 unwrap 하여
                            // 내부 블록을 버리지 않고 바깥으로 꺼낸다(이미지·리스트 등 보존).
                            // 중첩(예: 콜아웃 안의 헤딩)도 방지된다.
                            const flattened = unwrapWrapperBlock(editor, hover.blockStart);
                            if (flattened) {
                              // unwrap 된 첫 블록 안으로 selection 이동
                              editor.chain().focus().setTextSelection(hover.blockStart + 1).run();
                            } else {
                              editor.chain().focus().setNodeSelection(hover.blockStart).run();
                            }
                          }
                          item.cmd(editor);
                          setMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        <item.icon size={14} />
                        {item.label}
                      </button>
                    ))}
                  </HoverMenuRow>
                ) : null}

                {/* 링크 형식 변환 (붙여넣기 링크 선택지로 만든 블록일 때만) */}
                {linkBlockHref && (
                  <HoverMenuRow icon={<Link2 size={14} />} label="링크 형식 변환" panelWidth="w-44" preferredMaxHeight={320}>
                    {(
                      [
                        ["mention", "멘션"],
                        ["url", "URL"],
                        ["bookmark", "북마크"],
                        ["embed", isTrustedYoutubeInput(linkBlockHref) ? "임베드" : "버튼"],
                      ] as Array<[LinkBlockMode, string]>
                    ).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => {
                          if (!editor || !hover) return;
                          applyLinkBlockChoice(editor, {
                            url: linkBlockHref,
                            range: {
                              from: hover.blockStart,
                              to: hover.blockStart + hover.node.nodeSize,
                            },
                            mode,
                          });
                          setMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        {label}
                      </button>
                    ))}
                  </HoverMenuRow>
                )}

                {/* 콜아웃 프리셋 (콜아웃 블럭일 때만) */}
                {isCallout && (
                  <HoverMenuRow icon={<LayoutTemplate size={14} />} label="프리셋" panelWidth="w-56">
                    {/* 전체 프리셋 목록 — 아이콘+라벨 행 */}
                    {CALLOUT_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => applyCalloutPreset(p.id)}
                        className="flex w-full items-start gap-2 px-2 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
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
                    {/* 컬러칩 — 아이콘 없이 배경색만 적용 */}
                    <div className="flex flex-wrap gap-2 border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">
                      {CALLOUT_COLOR_CHIP_PRESETS.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => applyCalloutPreset(p.id)}
                          title={p.label}
                          aria-label={p.label}
                          className="h-5 w-5 shrink-0 rounded-full border border-zinc-300 transition hover:scale-110 dark:border-zinc-600"
                          style={{ backgroundColor: p.color ?? undefined }}
                        />
                      ))}
                    </div>
                  </HoverMenuRow>
                )}

                {/* 컬럼 레이아웃 컬러 변경 (컬럼 블록일 때만) */}
                {isColumnLayout && (
                  <HoverMenuRow icon={<LayoutTemplate size={14} />} label="컬러 변경" panelWidth="w-56">
                    {/* None·프레임 텍스트 행 (색 없는 옵션) */}
                    {COLUMN_LAYOUT_PRESETS.filter((p) => p.color == null).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => applyColumnLayoutPreset(p.id)}
                        className="flex w-full items-center px-3 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        <span className="font-medium text-zinc-800 dark:text-zinc-100">
                          {p.label}
                        </span>
                      </button>
                    ))}
                    {/* 컬러칩 — 아이콘 없이 배경색만 적용 */}
                    <div className="flex flex-wrap gap-2 border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">
                      {COLUMN_LAYOUT_PRESETS.filter((p) => p.color != null).map((p) => (
                        <button
                          key={`chip-${p.id}`}
                          type="button"
                          onClick={() => applyColumnLayoutPreset(p.id)}
                          title={p.label}
                          aria-label={p.label}
                          className="h-5 w-5 shrink-0 rounded-full border border-zinc-300 transition hover:scale-110 dark:border-zinc-600"
                          style={{ backgroundColor: p.color ?? undefined }}
                        />
                      ))}
                    </div>
                  </HoverMenuRow>
                )}

                {/* 컬럼 너비 비율 (2컬럼 전용) */}
                {isTwoColumnLayout && (
                  <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-700">
                    <div className="mb-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                      너비 비율
                    </div>
                    <div className="flex items-center gap-1">
                      {([
                        [2, 8],
                        [3, 7],
                        [5, 5],
                        [7, 3],
                        [8, 2],
                      ] as const).map(([l, r]) => (
                        <button
                          key={`${l}:${r}`}
                          type="button"
                          onClick={() => applyColumnRatio([l, r])}
                          className="flex-1 rounded border border-zinc-200 px-1 py-1 text-center text-[11px] font-medium text-zinc-700 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-blue-500 dark:hover:bg-blue-950/40 dark:hover:text-blue-300"
                        >
                          {l}:{r}
                        </button>
                      ))}
                    </div>
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

                {/* 텍스트 컬러 */}
                {isTextBlock && (
                  <HoverMenuRow icon={<Baseline size={14} />} label="텍스트 컬러" panelWidth="w-52">
                    <button
                      type="button"
                      onClick={() => applyBlockTextColor(null)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm border border-red-300 text-[10px] text-red-500 dark:border-red-500/60 dark:text-red-400">✕</span>
                      <span className="text-red-600 dark:text-red-400">텍스트 컬러 제거</span>
                    </button>
                    <div className="mx-3 my-1 border-t border-zinc-100 dark:border-zinc-800" />
                    {BLOCK_TEXT_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => applyBlockTextColor(p.id)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        <span
                          className="inline-block h-4 w-4 shrink-0 rounded-sm border border-zinc-200 dark:border-zinc-700"
                          style={{ backgroundColor: p.dot }}
                        />
                        <span className="text-zinc-700 dark:text-zinc-300">{p.label}</span>
                      </button>
                    ))}
                  </HoverMenuRow>
                )}

                {/* 배경 컬러 */}
                {isTextBlock && (
                  <HoverMenuRow icon={<PaintBucket size={14} />} label="배경 컬러" panelWidth="w-52">
                    <button
                      type="button"
                      onClick={() => applyBlockBackground(null)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm border border-red-300 text-[10px] text-red-500 dark:border-red-500/60 dark:text-red-400">✕</span>
                      <span className="text-red-600 dark:text-red-400">배경 컬러 제거</span>
                    </button>
                    <div className="mx-3 my-1 border-t border-zinc-100 dark:border-zinc-800" />
                    {BLOCK_BG_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => applyBlockBackground(p.id)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        <span
                          className="inline-block h-4 w-4 shrink-0 rounded-sm border border-zinc-200 dark:border-zinc-700"
                          style={{ backgroundColor: p.dot }}
                        />
                        <span className="text-zinc-700 dark:text-zinc-300">{p.label}</span>
                      </button>
                    ))}
                  </HoverMenuRow>
                )}

                {/* 표 헤더행/헤더열 토글 (표 블록일 때만) */}
                {isTable && (
                  <div className="px-1 py-1">
                    {(["row", "col"] as const).map((kind) => {
                      const active = kind === "row" ? tableHeaderRowActive : tableHeaderColActive;
                      return (
                        <button
                          key={kind}
                          type="button"
                          className="flex w-full items-center justify-between rounded px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                          onClick={() => {
                            if (!editor || !hover) return;
                            if (kind === "row") applyHeaderRowToggle(editor, hover.blockStart);
                            else applyHeaderColToggle(editor, hover.blockStart);
                            setMenuOpen(false);
                          }}
                        >
                          <span className="text-sm text-zinc-800 dark:text-zinc-200">
                            {kind === "row" ? "헤더행" : "헤더열"}
                          </span>
                          <div
                            className={[
                              "relative inline-flex h-[18px] w-8 flex-shrink-0 items-center rounded-full transition-colors duration-200",
                              active ? "bg-blue-500" : "bg-zinc-200 dark:bg-zinc-600",
                            ].join(" ")}
                          >
                            <span
                              className={[
                                "inline-block h-3 w-3 transform rounded-full bg-white shadow-sm transition-transform duration-200",
                                active ? "translate-x-[18px]" : "translate-x-[3px]",
                              ].join(" ")}
                            />
                          </div>
                        </button>
                      );
                    })}
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
                      ).setMeta("addToHistory", false);
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
                      const dbTitle = useDatabaseStore.getState().databases[databaseId]?.meta.title ?? "데이터베이스";
                      const btnNode = editor.state.schema.nodes.buttonBlock?.create({
                        label: `${dbTitle} DB`,
                        href: "",
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
                </HoverMenuGroup>
              </div>
            )}
          </div>
        </div>
        </>
      ) : null}
      {pinnedCommentBadges.map((pin) => (
        <div
          key={pin.key}
          ref={(el) => {
            if (el) badgeElRef.current.set(pin.key, el);
            else badgeElRef.current.delete(pin.key);
          }}
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
              : {
                  top: stackedTops[pin.key] ?? pin.top,
                  right: 12,
                  width: 232,
                  maxHeight: 240,
                }
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
        // 컨테이너 블록(컬럼/탭/콜아웃/인용/코드/표 등) 자체에는 댓글 입력 불허
        if (!canBlockHaveComment(hover.node.type.name)) return null;
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
    </HandleLayerBase>
  );
}
