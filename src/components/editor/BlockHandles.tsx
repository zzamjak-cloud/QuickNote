import {
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import type { Editor } from "@tiptap/react";
import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import {
  GripVertical,
  Heading1,
  Heading2,
  Heading3,
  List,
  CheckSquare,
  Code2,
  Quote,
  ChevronRight,
  Lightbulb,
  Pilcrow,
  Copy,
  Trash2,
  LayoutTemplate,
  Download,
} from "lucide-react";
import {
  CALLOUT_PRESETS,
  type CalloutPresetId,
} from "../../lib/tiptapExtensions/calloutPresets";
import { decodeFileRef } from "../../lib/files/scheme";
import { imageUrlCache } from "../../lib/images/registry";
import { startGripNativeDrag } from "../../lib/startBlockNativeDrag";
import { topLevelBlockStartsInSelectionRange } from "../../lib/pm/topLevelBlocks";
import { reportNonFatal } from "../../lib/reportNonFatal";

type HoverInfo = {
  rect: DOMRect;
  blockStart: number;
  depth: number;
  node: PMNode;
};

type Props = {
  editor: Editor | null;
  /** 박스 선택으로 잡은 최상위 블럭 시작 위치 — 연속이면 그립으로 한꺼번에 이동 */
  boxSelectedStarts?: readonly number[];
  onClearBoxSelection?: () => void;
};

type DownloadNotice = {
  kind: "loading" | "success" | "error";
  message: string;
} | null;

// 토글 자체는 핸들을 띄우되, 내부 toggleHeader/toggleContent는 제외(헤더/본문 hover 시 toggle 로 승격).
const SKIP_HANDLE_TYPES = new Set(["columnLayout", "column", "toggleHeader", "toggleContent"]);
// 타입 변경 시 새 타입을 적용하기 전에 단순 paragraph로 평탄화할 wrapper 노드들.
const WRAPPER_TYPES_TO_FLATTEN = new Set(["callout", "toggle", "blockquote"]);

/** wrapper(콜아웃·토글·인용) 블록을 그 안의 텍스트만 담은 단일 paragraph로 치환.
 *  치환 성공 시 true 반환 — 호출자는 이후 setHeading 등 단일 타입 명령을 적용한다. */
function flattenWrapperToParagraph(editor: Editor, blockStart: number): boolean {
  const node = editor.state.doc.nodeAt(blockStart);
  if (!node || !WRAPPER_TYPES_TO_FLATTEN.has(node.type.name)) return false;
  const paragraphType = editor.schema.nodes.paragraph;
  if (!paragraphType) return false;
  let text = "";
  node.descendants((n) => {
    if (n.isText) text += n.text;
    return true;
  });
  const paragraph = paragraphType.create(
    null,
    text ? editor.schema.text(text) : null,
  );
  editor.view.dispatch(
    editor.state.tr.replaceWith(blockStart, blockStart + node.nodeSize, paragraph),
  );
  return true;
}
const HANDLE_STRIP_PX = 32;
const MIN_HANDLE_LEFT = 6;
const GRIP_SIZE_PX = 28;
const GRIP_ZONE_PAD_PX = 14;
const GUTTER_LEFT_PX = 56;
const RECT_PAD_X = 20;
const RECT_PAD_Y = 18;
const HANDLE_TOP_OFFSET_PX = -2;

/** 렌더와 동일한 수식으로 그립 버튼의 화면 영역을 내고, 호버가 풀리지 않게 한다. */
function pointInGripZone(
  clientX: number,
  clientY: number,
  hover: HoverInfo,
  wrapperRect: DOMRect,
): boolean {
  const top = hover.rect.top - wrapperRect.top + HANDLE_TOP_OFFSET_PX;
  const rawLeft = hover.rect.left - wrapperRect.left - HANDLE_STRIP_PX;
  const left = Math.max(MIN_HANDLE_LEFT, rawLeft);
  const z = GRIP_ZONE_PAD_PX;
  const x0 = wrapperRect.left + left - z;
  const y0 = wrapperRect.top + top - z;
  const x1 = wrapperRect.left + left + GRIP_SIZE_PX + z;
  const y1 = wrapperRect.top + top + GRIP_SIZE_PX + z;
  return clientX >= x0 && clientX <= x1 && clientY >= y0 && clientY <= y1;
}

function hoverFromResolvedPos(editor: Editor, $pos: ResolvedPos): HoverInfo | null {
  // wrapper(콜아웃/토글/인용) 안의 내부 블럭이 우선 — wrapper는 fallback.
  let inner: HoverInfo | null = null;
  let wrapper: HoverInfo | null = null;
  for (let d = $pos.depth; d > 0; d--) {
    const n = $pos.node(d);
    if (!n.isBlock || n.type.name === "doc") continue;
    if (SKIP_HANDLE_TYPES.has(n.type.name)) continue;
    const start = $pos.before(d);
    const dom = editor.view.nodeDOM(start);
    const el = dom instanceof HTMLElement ? dom : (dom?.parentElement ?? null);
    if (!el) continue;
    const rectEl =
      n.type.name === "databaseBlock"
        ? el.closest(".qn-database-block") ?? el
        : el;
    const candidate: HoverInfo = {
      rect: rectEl.getBoundingClientRect(),
      blockStart: start,
      depth: d,
      node: n,
    };
    if (WRAPPER_TYPES_TO_FLATTEN.has(n.type.name)) {
      // 가장 외곽 wrapper만 보존 (깊이 작은 것)
      if (!wrapper || candidate.depth < wrapper.depth) wrapper = candidate;
    } else {
      // inner는 가장 깊은 것
      if (!inner || candidate.depth > inner.depth) inner = candidate;
    }
  }
  // doc 직속 atom 블록(databaseBlock 등)은 $pos.depth == 0 이라 위 루프가 잡지 못함.
  // posAtCoords/posAtDOM 결과가 atom 경계에 떨어지므로 nodeAfter/nodeBefore 모두 검사.
  if (!inner && $pos.parent.type.name === "doc") {
    const idx = $pos.index();
    const probes: { node: PMNode; start: number }[] = [];
    const after = $pos.parent.maybeChild(idx);
    if (after) probes.push({ node: after, start: $pos.posAtIndex(idx) });
    if (idx > 0) {
      const before = $pos.parent.maybeChild(idx - 1);
      if (before) probes.push({ node: before, start: $pos.posAtIndex(idx - 1) });
    }
    for (const p of probes) {
      const n = p.node;
      if (!n.isBlock || !n.isAtom) continue;
      if (SKIP_HANDLE_TYPES.has(n.type.name)) continue;
      const dom = editor.view.nodeDOM(p.start);
      const el = dom instanceof HTMLElement ? dom : (dom?.parentElement ?? null);
      if (!el) continue;
      const rectEl =
        n.type.name === "databaseBlock"
          ? el.closest(".qn-database-block") ?? el
          : el;
      inner = {
        rect: rectEl.getBoundingClientRect(),
        blockStart: p.start,
        depth: 1, // doc 직속 → top-level paragraph 와 동일 우선순위
        node: n,
      };
      break;
    }
  }
  return inner ?? wrapper;
}

/** TD 등 React NodeView 내부에서 posAtDOM 이 막힐 때 — 래퍼 .qn-database-block 으로 직접 해석 */
function considerDatabaseBlockFromStack(
  editor: Editor,
  stack: Element[],
  considerPosition: (pos: number) => void,
) {
  const view = editor.view;
  for (const raw of stack) {
    if (!(raw instanceof HTMLElement)) continue;
    if (!view.dom.contains(raw)) continue;
    const db = raw.closest(".qn-database-block");
    if (!db || !view.dom.contains(db)) continue;
    try {
      considerPosition(view.posAtDOM(db, 0));
    } catch {
      try {
        considerPosition(view.posAtDOM(db, 1));
      } catch {
        /* noop */
      }
    }
  }
}

function blockAtPoint(editor: Editor, clientX: number, clientY: number): HoverInfo | null {
  const view = editor.view;
  const byStart = new Map<number, HoverInfo>();

  const considerPosition = (pos: number) => {
    let $pos: ResolvedPos;
    try {
      const max = editor.state.doc.content.size;
      $pos = editor.state.doc.resolve(Math.min(Math.max(0, pos), max));
    } catch (err) {
      reportNonFatal(err, "blockHandles.considerPosition.resolve");
      return;
    }
    const h = hoverFromResolvedPos(editor, $pos);
    if (!h) return;
    const prev = byStart.get(h.blockStart);
    if (!prev || h.depth > prev.depth) byStart.set(h.blockStart, h);
  };

  let stack: Element[] = [];
  try {
    stack = document.elementsFromPoint(clientX, clientY) as Element[];
  } catch (err) {
    reportNonFatal(err, "blockHandles.elementsFromPoint");
  }

  considerDatabaseBlockFromStack(editor, stack, considerPosition);

  const coords = view.posAtCoords({ left: clientX, top: clientY });
  if (coords) considerPosition(coords.pos);

  for (const raw of stack) {
    if (!(raw instanceof HTMLElement)) continue;
    if (!view.dom.contains(raw)) continue;
    let el: HTMLElement | null = raw;
    let steps = 0;
    while (el && el !== view.dom && steps++ < 24) {
      try {
        const p = view.posAtDOM(el, 0);
        considerPosition(p);
        break;
      } catch (err) {
        reportNonFatal(err, "blockHandles.posAtDOM");
      }
      el = el.parentElement;
    }
  }

  if (byStart.size === 0) return null;
  let best: HoverInfo | null = null;
  for (const h of byStart.values()) {
    if (!best || h.depth > best.depth) best = h;
  }
  // 타이틀/input 등 NodeView 크롬 위에서는 깊은 블록보다 databaseBlock 을 우선
  for (const h of byStart.values()) {
    if (h.node.type.name !== "databaseBlock") continue;
    const dom = editor.view.nodeDOM(h.blockStart);
    const wrap =
      dom instanceof Element ? dom.closest(".qn-database-block") : null;
    if (!(wrap instanceof HTMLElement)) continue;
    const r = wrap.getBoundingClientRect();
    if (
      clientX >= r.left &&
      clientX <= r.right &&
      clientY >= r.top &&
      clientY <= r.bottom
    ) {
      return { ...h, rect: r };
    }
  }
  return best;
}

const TYPE_MENU_ITEMS = [
  { label: "본문", icon: Pilcrow, cmd: (e: Editor) => e.chain().focus().setParagraph().run() },
  { label: "제목 1", icon: Heading1, cmd: (e: Editor) => e.chain().focus().setHeading({ level: 1 }).run() },
  { label: "제목 2", icon: Heading2, cmd: (e: Editor) => e.chain().focus().setHeading({ level: 2 }).run() },
  { label: "제목 3", icon: Heading3, cmd: (e: Editor) => e.chain().focus().setHeading({ level: 3 }).run() },
  { label: "글머리 목록", icon: List, cmd: (e: Editor) => e.chain().focus().toggleBulletList().run() },
  { label: "할 일", icon: CheckSquare, cmd: (e: Editor) => e.chain().focus().toggleTaskList().run() },
  { label: "인용", icon: Quote, cmd: (e: Editor) => e.chain().focus().toggleBlockquote().run() },
  { label: "코드 블록", icon: Code2, cmd: (e: Editor) => e.chain().focus().toggleCodeBlock().run() },
  { label: "토글", icon: ChevronRight, cmd: (e: Editor) => e.chain().focus().setToggle().run() },
  { label: "콜아웃", icon: Lightbulb, cmd: (e: Editor) => e.chain().focus().setCallout("idea").run() },
];

export function BlockHandles({
  editor,
  boxSelectedStarts,
  onClearBoxSelection,
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
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [downloadNotice, setDownloadNotice] = useState<DownloadNotice>(null);
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
    if (boxSelectionActive) return;
    const root = containerRef.current?.parentElement;
    if (!root) return;

    let rafId: number | null = null;
    let pending: MouseEvent | null = null;

    const flushHover = () => {
      rafId = null;
      const e = pending;
      pending = null;
      if (!e || menuOpen) return;
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
      if (menuOpen) return;
      pending = e;
      if (rafId == null) {
        rafId = requestAnimationFrame(flushHover);
      }
    };
    const onLeave = (e: MouseEvent) => {
      if (menuOpen) return;
      pending = null;
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      const related = e.relatedTarget as Node | null;
      if (related && root.contains(related)) return;
      setHover(null);
    };

    root.addEventListener("mousemove", onMove);
    root.addEventListener("mouseleave", onLeave);
    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      root.removeEventListener("mousemove", onMove);
      root.removeEventListener("mouseleave", onLeave);
    };
  }, [editor, computeHover, menuOpen, boxSelectionActive]);

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
          h.node.type.name === "databaseBlock"
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
    setMenuOpen(false);
  };

  const deleteBlock = () => {
    if (!editor || !hover) return;
    const { blockStart, node } = hover;
    const tr = editor.state.tr.delete(blockStart, blockStart + node.nodeSize);
    editor.view.dispatch(tr);
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

  const isCallout = hover?.node.type.name === "callout";
  const isAttachmentBlock =
    hover?.node.type.name === "fileBlock";
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
      node.type.name === "databaseBlock"
        ? el.closest(".qn-database-block") ?? el
        : el;
    setHover({
      blockStart: anchorStart,
      node,
      rect: rectEl.getBoundingClientRect(),
      depth: 1,
    });
  }, [editor, boxSelectionActive, boxSelectedStarts]);

  if (boxSelecting) return null;

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0 z-10">
      {hover && bar && wrapperRect ? (
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
                {isAttachmentBlock ? (
                  <button
                    type="button"
                    onClick={downloadAttachment}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <Download size={14} />
                    다운로드
                  </button>
                ) : (
                  <div className="relative">
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
                )}

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

                <hr className="my-1 border-zinc-200 dark:border-zinc-700" />

                {/* 복제 */}
                <button
                  type="button"
                  onClick={duplicateBlock}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <Copy size={14} />
                  복제
                </button>

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
      ) : null}
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
