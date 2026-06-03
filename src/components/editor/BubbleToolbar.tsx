import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Strikethrough,
  Code,
  Highlighter,
  Palette,
  Link as LinkIcon,
  MessageSquarePlus,
  AlignHorizontalDistributeCenter,
} from "lucide-react";
import { ImageBubbleToolbar } from "./ImageBubbleToolbar";
import { sanitizeWebLinkHref } from "../../lib/safeUrl";
import { useUiStore } from "../../store/uiStore";
import { ensureBlockId } from "../../lib/comments/ensureBlockId";
import { canBlockHaveComment } from "../../lib/comments/blockCommentTargets";
import {
  distributeSelectedColumnsEvenly,
  getSelectedColumnCount,
} from "../../lib/editor/tableColumnWidths";

const COLORS = [
  { label: "기본", value: null },
  { label: "진회색", value: "#27272a" },
  { label: "빨강", value: "#ef4444" },
  { label: "로즈", value: "#f43f5e" },
  { label: "주황", value: "#f97316" },
  { label: "앰버", value: "#d97706" },
  { label: "노랑", value: "#ca8a04" },
  { label: "라임", value: "#65a30d" },
  { label: "초록", value: "#16a34a" },
  { label: "에메랄드", value: "#059669" },
  { label: "틸", value: "#0d9488" },
  { label: "시안", value: "#0891b2" },
  { label: "파랑", value: "#2563eb" },
  { label: "인디고", value: "#4f46e5" },
  { label: "바이올렛", value: "#7c3aed" },
  { label: "퍼플", value: "#9333ea" },
  { label: "퓨시아", value: "#c026d3" },
  { label: "핑크", value: "#db2777" },
];

const HIGHLIGHTS = [
  { label: "없음", value: null },
  { label: "노랑", value: "#fef08a" },
  { label: "피치", value: "#fed7aa" },
  { label: "살몬", value: "#fecaca" },
  { label: "분홍", value: "#fbcfe8" },
  { label: "라벤더", value: "#e9d5ff" },
  { label: "연보라", value: "#ddd6fe" },
  { label: "연파랑", value: "#bfdbfe" },
  { label: "민트", value: "#a7f3d0" },
  { label: "연초록", value: "#bbf7d0" },
  { label: "라임", value: "#d9f99d" },
  { label: "모카", value: "#e7e5e4" },
];

type ToolbarMode = "hidden" | "text" | "image";

type ToolbarAnchor = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

type Props = {
  editor: Editor | null;
  pageId: string | null;
};

const TOOLBAR_VIEWPORT_PADDING = 8;
const TOOLBAR_GAP = 8;
const TOOLBAR_ESTIMATED_SIZE: Record<Exclude<ToolbarMode, "hidden">, { width: number; height: number }> = {
  text: { width: 400, height: 40 },
  image: { width: 190, height: 40 },
};

function getViewportBox() {
  const vv = window.visualViewport;
  return {
    left: vv?.offsetLeft ?? 0,
    top: vv?.offsetTop ?? 0,
    width: vv?.width ?? window.innerWidth,
    height: vv?.height ?? window.innerHeight,
  };
}

function placeToolbar(
  anchor: ToolbarAnchor,
  mode: Exclude<ToolbarMode, "hidden">,
  width = TOOLBAR_ESTIMATED_SIZE[mode].width,
  height = TOOLBAR_ESTIMATED_SIZE[mode].height,
): { top: number; left: number } {
  const viewport = getViewportBox();
  const minLeft = viewport.left + TOOLBAR_VIEWPORT_PADDING;
  const maxLeft = viewport.left + viewport.width - width - TOOLBAR_VIEWPORT_PADDING;
  const minTop = viewport.top + TOOLBAR_VIEWPORT_PADDING;
  const maxTop = viewport.top + viewport.height - height - TOOLBAR_VIEWPORT_PADDING;
  const centerX = anchor.left + (anchor.right - anchor.left) / 2;
  const topAbove = anchor.top - height - TOOLBAR_GAP;
  const topBelow = anchor.bottom + TOOLBAR_GAP;
  const preferredTop = topAbove >= minTop ? topAbove : topBelow;

  return {
    top: Math.max(minTop, Math.min(preferredTop, Math.max(minTop, maxTop))),
    left: Math.max(minLeft, Math.min(centerX - width / 2, Math.max(minLeft, maxLeft))),
  };
}

/**
 * 텍스트 선택 위치에서 댓글을 부착할 행(블록)의 시작 좌표를 찾는다.
 * 가장 안쪽 텍스트 블록(문단/제목 등)부터 위로 올라가며 댓글 가능한 블록을 고른다.
 * 컨테이너(코드블록·표 등)는 canBlockHaveComment 로 제외된다.
 */
function resolveCommentBlockStart(editor: Editor): number | null {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d -= 1) {
    const node = $from.node(d);
    if (node.isTextblock && canBlockHaveComment(node.type.name)) {
      return $from.before(d);
    }
  }
  return null;
}

/** 선택 앵커가 tableCell / tableHeader 안인지 */
function isInTableCell(editor: Editor): boolean {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d -= 1) {
    const name = $from.node(d).type.name;
    if (name === "tableCell" || name === "tableHeader") return true;
  }
  return false;
}

/** 앵커 기준 셀의 align 속성(null 이면 브라우저 기본 왼쪽) */
function getTableCellAlign(editor: Editor): string | null {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d -= 1) {
    const node = $from.node(d);
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
      const a = node.attrs.align as string | null | undefined;
      return a ?? null;
    }
  }
  return null;
}

// 텍스트 범위 선택·표 셀(CellSelection) 선택·이미지 노드 선택 시 부유 툴바(셀 안 커서만일 때는 숨김).
export function BubbleToolbar({ editor, pageId }: Props) {
  const [mode, setMode] = useState<ToolbarMode>("hidden");
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [colorOpen, setColorOpen] = useState(false);
  const [hlOpen, setHlOpen] = useState(false);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<ToolbarAnchor | null>(null);
  const savedSelectionRef = useRef<{ from: number; to: number } | null>(null);
  /** 동일 표시 상태면 setState 생략 — 클릭마다 selectionUpdate 로 깜빡임 방지 */
  const lastToolbarSigRef = useRef<string>("");

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    lastToolbarSigRef.current = "";
    let dragging = false;

    const compute = () => {
      if (editor.isDestroyed) return;
      let nextMode: ToolbarMode = "hidden";
      let nextPos: { top: number; left: number } | null = null;
      let nextAnchor: ToolbarAnchor | null = null;

      // read-only(예: 풀 페이지 DB) 에서는 부유 툴바 자체를 띄우지 않는다.
      if (!editor.isEditable) {
        nextMode = "hidden";
        nextPos = null;
      } else {
        const sel = editor.state.selection;

        if (
          sel instanceof NodeSelection &&
          (sel.node.type.name === "image" || sel.node.type.name === "fileBlock")
        ) {
          const dom = editor.view.nodeDOM(sel.from);
          const el =
            dom instanceof HTMLElement ? dom : dom?.parentElement ?? null;
          // 실제 미디어(img/video) 요소 기준으로 위치 — 컬럼 등에서 wrapper 가 더 클 수 있음.
          const mediaEl =
            el?.querySelector("img,video") instanceof HTMLElement
              ? (el.querySelector("img,video") as HTMLElement)
              : el;
          if (mediaEl instanceof HTMLElement) {
            const r = mediaEl.getBoundingClientRect();
            nextMode = "image";
            nextAnchor = { top: r.top, right: r.right, bottom: r.bottom, left: r.left };
            nextPos = placeToolbar(nextAnchor, nextMode);
          } else {
            nextMode = "hidden";
            nextPos = null;
            nextAnchor = null;
          }
        } else if (sel instanceof NodeSelection) {
          // 인라인 DB·HR 등 원자 블록의 NodeSelection — 텍스트 포매팅 툴바 숨김
          nextMode = "hidden";
          nextPos = null;
        } else if (sel instanceof CellSelection) {
          // 표 셀 드래그 선택 — 셀 정렬 등 부유 툴바
          const start = editor.view.coordsAtPos(sel.from);
          const end = editor.view.coordsAtPos(sel.to);
          nextMode = "text";
          nextAnchor = {
            top: Math.min(start.top, end.top),
            right: Math.max(start.left, end.left),
            bottom: Math.max(start.bottom, end.bottom),
            left: Math.min(start.left, end.left),
          };
          nextPos = placeToolbar(nextAnchor, nextMode);
        } else {
          const { from, to } = sel;
          if (from === to) {
            nextMode = "hidden";
            nextPos = null;
          } else {
            const start = editor.view.coordsAtPos(from);
            const end = editor.view.coordsAtPos(to);
            nextMode = "text";
            nextAnchor = {
              top: Math.min(start.top, end.top),
              right: Math.max(start.left, end.left),
              bottom: Math.max(start.bottom, end.bottom),
              left: Math.min(start.left, end.left),
            };
            nextPos = placeToolbar(nextAnchor, nextMode);
          }
        }
      }

      const curSel = editor.state.selection;
      const cellAlignSig =
        nextMode === "text" && isInTableCell(editor)
          ? `:ca:${getTableCellAlign(editor) ?? "null"}:${curSel.from}:${curSel.to}`
          : "";
      const sig =
        nextMode === "hidden"
          ? "hidden"
          : `${nextMode}:${Math.round(nextPos!.top)}:${Math.round(nextPos!.left)}${cellAlignSig}`;
      if (lastToolbarSigRef.current === sig) return;
      lastToolbarSigRef.current = sig;

      anchorRef.current = nextAnchor;
      setMode(nextMode);
      setPos(nextPos);
      setColorOpen(false);
      setHlOpen(false);
    };

    const onMouseDown = () => {
      dragging = true;
      lastToolbarSigRef.current = "hidden";
      anchorRef.current = null;
      setMode("hidden");
      setPos(null);
    };
    const onMouseUp = () => {
      if (!dragging) return;
      dragging = false;
      requestAnimationFrame(() => {
        requestAnimationFrame(compute);
      });
    };
    const onSelectionUpdate = () => {
      if (dragging) return;
      compute();
    };
    const onViewportChange = () => {
      if (dragging) return;
      requestAnimationFrame(compute);
    };

    const dom = editor.view.dom;
    dom.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    window.visualViewport?.addEventListener("resize", onViewportChange);
    window.visualViewport?.addEventListener("scroll", onViewportChange);
    editor.on("selectionUpdate", onSelectionUpdate);
    return () => {
      dom.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
      window.visualViewport?.removeEventListener("resize", onViewportChange);
      window.visualViewport?.removeEventListener("scroll", onViewportChange);
      editor.off("selectionUpdate", onSelectionUpdate);
    };
  }, [editor]);

  useLayoutEffect(() => {
    if (mode === "hidden" || !pos || !anchorRef.current || !toolbarRef.current) return;
    const activeMode = mode;
    const update = () => {
      const rect = toolbarRef.current?.getBoundingClientRect();
      if (!rect || !anchorRef.current) return;
      const next = placeToolbar(anchorRef.current, activeMode, rect.width, rect.height);
      setPos((prev) =>
        prev && Math.abs(prev.top - next.top) < 1 && Math.abs(prev.left - next.left) < 1
          ? prev
          : next,
      );
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(toolbarRef.current);
    return () => ro.disconnect();
  }, [mode, pos]);

  if (!editor || !pos || mode === "hidden") return null;

  const saveSelection = () => {
    const { from, to } = editor.state.selection;
    if (from === to) return;
    savedSelectionRef.current = { from, to };
  };

  const applyTextColor = (color: string | null) => {
    const chain = editor.chain().focus();
    const saved = savedSelectionRef.current;
    if (saved && saved.from < saved.to) {
      chain.setTextSelection(saved);
    }
    if (color === null) chain.unsetColor().run();
    else chain.setColor(color).run();
    savedSelectionRef.current = null;
  };

  const applyHighlightColor = (color: string | null) => {
    const chain = editor.chain().focus();
    const saved = savedSelectionRef.current;
    if (saved && saved.from < saved.to) {
      chain.setTextSelection(saved);
    }
    if (color === null) chain.unsetHighlight().run();
    else chain.setHighlight({ color }).run();
    savedSelectionRef.current = null;
  };

  /** 선택된 텍스트가 있는 행에 댓글 스레드를 연다 — 블록 댓글 시스템 재사용. */
  const openCommentOnSelection = () => {
    if (!pageId) return;
    const blockStart = resolveCommentBlockStart(editor);
    if (blockStart === null) return;
    const blockId = ensureBlockId(editor, blockStart);
    if (!blockId) return;
    const anchor = anchorRef.current;
    useUiStore.getState().openCommentThread({
      pageId,
      blockId,
      blockStart,
      skipScroll: true,
      anchorViewport: anchor
        ? {
            top: anchor.top,
            left: anchor.left,
            right: anchor.right,
            bottom: anchor.bottom,
          }
        : undefined,
    });
    // 패널이 열리면 선택이 바뀌며 툴바가 자동으로 닫히지만, 즉시 숨겨 깜빡임을 줄인다.
    setMode("hidden");
    setPos(null);
  };

  const showCellAlign = mode === "text" && isInTableCell(editor);
  const cellAlign = showCellAlign ? getTableCellAlign(editor) : null;
  // 연속된 여러 열을 CellSelection 으로 선택한 경우에만 "균등 너비" 버튼 노출.
  const showColEqualize = showCellAlign && getSelectedColumnCount(editor) >= 2;

  return createPortal(
    <div
      ref={toolbarRef}
      className="fixed z-[760] rounded-md border border-zinc-200 bg-white px-1 py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      style={{ top: pos.top, left: pos.left }}
      onPointerDownCapture={(e) => {
        const t = e.target as HTMLElement;
        if (t.closest("button, a, input, textarea, select, [data-allow-focus]")) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="flex items-center gap-0.5">
        {mode === "image" ? (
          <ImageBubbleToolbar editor={editor} pageId={pageId} />
        ) : (
          <>
            <ToolbarBtn
              active={editor.isActive("bold")}
              onClick={() => editor.chain().focus().toggleBold().run()}
              title="굵게 (Cmd/Ctrl+B)"
            >
              <Bold size={14} />
            </ToolbarBtn>
            <ToolbarBtn
              active={editor.isActive("italic")}
              onClick={() => editor.chain().focus().toggleItalic().run()}
              title="기울임 (Cmd/Ctrl+I)"
            >
              <Italic size={14} />
            </ToolbarBtn>
            <ToolbarBtn
              active={editor.isActive("strike")}
              onClick={() => editor.chain().focus().toggleStrike().run()}
              title="취소선"
            >
              <Strikethrough size={14} />
            </ToolbarBtn>
            <ToolbarBtn
              active={editor.isActive("code")}
              onClick={() => editor.chain().focus().toggleCode().run()}
              title="인라인 코드"
            >
              <Code size={14} />
            </ToolbarBtn>
            <ToolbarBtn
              active={editor.isActive("link")}
              onClick={() => {
                void (async () => {
                  const url = await useUiStore
                    .getState()
                    .requestTextPrompt("URL을 입력하세요", {
                      placeholder: "https://…",
                    });
                  if (url === null) return;
                  if (url === "") {
                    editor.chain().focus().unsetLink().run();
                  } else {
                    const safe = sanitizeWebLinkHref(url);
                    if (!safe) return;
                    editor.chain().focus().setLink({ href: safe }).run();
                  }
                })();
              }}
              title="링크"
            >
              <LinkIcon size={14} />
            </ToolbarBtn>
            <div className="relative">
              <ToolbarBtn
                active={colorOpen}
                onClick={() => {
                  saveSelection();
                  setColorOpen((v) => !v);
                  setHlOpen(false);
                }}
                title="텍스트 색"
              >
                <Palette size={14} />
              </ToolbarBtn>
              {colorOpen && (
                <ColorPalette
                  items={COLORS}
                  onPick={(c) => {
                    applyTextColor(c);
                    setColorOpen(false);
                  }}
                />
              )}
            </div>
            <div className="relative">
              <ToolbarBtn
                active={hlOpen}
                onClick={() => {
                  saveSelection();
                  setHlOpen((v) => !v);
                  setColorOpen(false);
                }}
                title="형광펜"
              >
                <Highlighter size={14} />
              </ToolbarBtn>
              {hlOpen && (
                <ColorPalette
                  items={HIGHLIGHTS}
                  onPick={(c) => {
                    applyHighlightColor(c);
                    setHlOpen(false);
                  }}
                />
              )}
            </div>
            <div
              className="mx-0.5 h-5 w-px shrink-0 bg-zinc-200 dark:bg-zinc-600"
              aria-hidden
            />
            <ToolbarBtn onClick={openCommentOnSelection} title="댓글">
              <MessageSquarePlus size={14} />
            </ToolbarBtn>
            {showCellAlign ? (
              <>
                <div
                  className="mx-0.5 h-5 w-px shrink-0 bg-zinc-200 dark:bg-zinc-600"
                  aria-hidden
                />
                <ToolbarBtn
                  active={cellAlign == null || cellAlign === "left"}
                  onClick={() =>
                    editor.chain().focus().setCellAttribute("align", "left").run()
                  }
                  title="셀 텍스트 왼쪽 정렬"
                >
                  <AlignLeft size={14} />
                </ToolbarBtn>
                <ToolbarBtn
                  active={cellAlign === "center"}
                  onClick={() =>
                    editor.chain().focus().setCellAttribute("align", "center").run()
                  }
                  title="셀 텍스트 가운데 정렬"
                >
                  <AlignCenter size={14} />
                </ToolbarBtn>
                <ToolbarBtn
                  active={cellAlign === "right"}
                  onClick={() =>
                    editor.chain().focus().setCellAttribute("align", "right").run()
                  }
                  title="셀 텍스트 오른쪽 정렬"
                >
                  <AlignRight size={14} />
                </ToolbarBtn>
                {showColEqualize ? (
                  <ToolbarBtn
                    onClick={() => distributeSelectedColumnsEvenly(editor)}
                    title="선택한 열 너비 균등 분배"
                  >
                    <AlignHorizontalDistributeCenter size={14} />
                  </ToolbarBtn>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function ToolbarBtn({
  active,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onClick();
      }}
      title={title}
      className={[
        "flex h-7 w-7 items-center justify-center rounded text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
        active ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100" : "",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function ColorPalette({
  items,
  onPick,
}: {
  items: { label: string; value: string | null }[];
  onPick: (v: string | null) => void;
}) {
  return (
    <div className="absolute left-0 top-9 z-50 flex max-h-52 w-56 flex-wrap gap-1 overflow-y-auto rounded-md border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onPick(it.value);
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => e.preventDefault()}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-zinc-200 text-[10px] hover:scale-105 dark:border-zinc-700"
          style={{ background: it.value ?? "transparent" }}
          title={it.label}
        >
          {it.value === null ? "✕" : ""}
        </button>
      ))}
    </div>
  );
}
