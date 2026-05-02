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
} from "lucide-react";
import {
  CALLOUT_PRESETS,
  type CalloutPresetId,
} from "../../lib/tiptapExtensions/calloutPresets";
import { startBlockNativeDrag } from "../../lib/startBlockNativeDrag";

type HoverInfo = {
  rect: DOMRect;
  blockStart: number;
  depth: number;
  node: PMNode;
};

type Props = {
  editor: Editor | null;
};

const SKIP_HANDLE_TYPES = new Set(["columnLayout", "column"]);
const HANDLE_STRIP_PX = 32;
const MIN_HANDLE_LEFT = 6;

function hoverFromResolvedPos(editor: Editor, $pos: ResolvedPos): HoverInfo | null {
  let best: HoverInfo | null = null;
  for (let d = $pos.depth; d > 0; d--) {
    const n = $pos.node(d);
    if (!n.isBlock || n.type.name === "doc") continue;
    if (SKIP_HANDLE_TYPES.has(n.type.name)) continue;
    const start = $pos.before(d);
    const dom = editor.view.nodeDOM(start);
    const el = dom instanceof HTMLElement ? dom : (dom?.parentElement ?? null);
    if (!el) continue;
    const candidate: HoverInfo = {
      rect: el.getBoundingClientRect(),
      blockStart: start,
      depth: d,
      node: n,
    };
    if (!best || candidate.depth > best.depth) best = candidate;
  }
  return best;
}

function blockAtPoint(editor: Editor, clientX: number, clientY: number): HoverInfo | null {
  const view = editor.view;
  const byStart = new Map<number, HoverInfo>();

  const considerPosition = (pos: number) => {
    let $pos: ResolvedPos;
    try {
      const max = editor.state.doc.content.size;
      $pos = editor.state.doc.resolve(Math.min(Math.max(0, pos), max));
    } catch { return; }
    const h = hoverFromResolvedPos(editor, $pos);
    if (!h) return;
    const prev = byStart.get(h.blockStart);
    if (!prev || h.depth > prev.depth) byStart.set(h.blockStart, h);
  };

  const coords = view.posAtCoords({ left: clientX, top: clientY });
  if (coords) considerPosition(coords.pos);

  let stack: Element[] = [];
  try { stack = document.elementsFromPoint(clientX, clientY) as Element[]; } catch {}

  for (const raw of stack) {
    if (!(raw instanceof HTMLElement)) continue;
    if (!view.dom.contains(raw)) continue;
    let el: HTMLElement | null = raw;
    let steps = 0;
    while (el && el !== view.dom && steps++ < 24) {
      try { const p = view.posAtDOM(el, 0); considerPosition(p); break; } catch {}
      el = el.parentElement;
    }
  }

  if (byStart.size === 0) return null;
  let best: HoverInfo | null = null;
  for (const h of byStart.values()) {
    if (!best || h.depth > best.depth) best = h;
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

export function BlockHandles({ editor }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
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
    if (!editor) return;
    const root = containerRef.current?.parentElement;
    if (!root) return;

    const onMove = (e: MouseEvent) => {
      if (menuOpen) return;
      setHover(computeHover(e));
    };
    const onLeave = (e: MouseEvent) => {
      if (menuOpen) return;
      const related = e.relatedTarget as Node | null;
      if (related && root.contains(related)) return;
      setHover(null);
    };

    root.addEventListener("mousemove", onMove);
    root.addEventListener("mouseleave", onLeave);
    return () => {
      root.removeEventListener("mousemove", onMove);
      root.removeEventListener("mouseleave", onLeave);
    };
  }, [editor, computeHover, menuOpen]);

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

  useEffect(() => {
    if (!editor || !hover) return;
    const refreshRect = () => {
      setHover((h) => {
        if (!h || !editor) return h;
        const dom = editor.view.nodeDOM(h.blockStart);
        const el = dom instanceof HTMLElement ? dom : (dom?.parentElement ?? null);
        if (!el) return null;
        return { ...h, rect: el.getBoundingClientRect() };
      });
    };
    const scroller = containerRef.current?.closest(".overflow-y-auto") ?? window;
    scroller.addEventListener("scroll", refreshRect, { passive: true });
    window.addEventListener("resize", refreshRect, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", refreshRect);
      window.removeEventListener("resize", refreshRect);
    };
  }, [editor, hover?.blockStart]);

  const wrapper = containerRef.current?.parentElement;
  const wrapperRect = wrapper?.getBoundingClientRect();

  const bar =
    hover && wrapperRect
      ? (() => {
          const top = hover.rect.top - wrapperRect.top + 2;
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
    startBlockNativeDrag(editor, e.nativeEvent, hover.blockStart, hover.node);
  };

  const onGripDragEnd = () => {
    document.body.classList.remove("quicknote-block-dragging");
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
              <div className="absolute left-8 top-0 z-50 w-48 rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
                {/* 타입 변경 */}
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
                              editor.chain().focus().setNodeSelection(hover.blockStart).run();
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
    </div>
  );
}
