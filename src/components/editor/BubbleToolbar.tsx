import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Highlighter,
  Palette,
  Link as LinkIcon,
} from "lucide-react";
import { ImageBubbleToolbar } from "./ImageBubbleToolbar";

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

type Props = {
  editor: Editor | null;
};

// 텍스트 선택 또는 이미지 노드 선택 시 부유 툴바.
export function BubbleToolbar({ editor }: Props) {
  const [mode, setMode] = useState<ToolbarMode>("hidden");
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [colorOpen, setColorOpen] = useState(false);
  const [hlOpen, setHlOpen] = useState(false);

  useEffect(() => {
    if (!editor) return;
    let dragging = false;

    const compute = () => {
      // read-only(예: 풀 페이지 DB) 에서는 부유 툴바 자체를 띄우지 않는다.
      if (!editor.isEditable) {
        setMode("hidden");
        setPos(null);
        return;
      }
      const sel = editor.state.selection;

      if (sel instanceof NodeSelection && sel.node.type.name === "image") {
        const dom = editor.view.nodeDOM(sel.from);
        const el =
          dom instanceof HTMLElement ? dom : dom?.parentElement ?? null;
        if (el instanceof HTMLElement) {
          const r = el.getBoundingClientRect();
          setMode("image");
          setPos({
            top: r.top + window.scrollY - 44,
            left: r.left + r.width / 2 + window.scrollX,
          });
          setColorOpen(false);
          setHlOpen(false);
          return;
        }
      }

      // 인라인 DB·HR 등 원자 블록의 NodeSelection — 텍스트 포매팅 툴바 숨김
      if (sel instanceof NodeSelection) {
        setMode("hidden");
        setPos(null);
        return;
      }

      const { from, to } = sel;
      if (from === to) {
        setMode("hidden");
        setPos(null);
        return;
      }

      const start = editor.view.coordsAtPos(from);
      const end = editor.view.coordsAtPos(to);
      setMode("text");
      setPos({
        top: Math.min(start.top, end.top) + window.scrollY - 44,
        left: (start.left + end.left) / 2 + window.scrollX,
      });
    };

    const onMouseDown = () => {
      dragging = true;
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

    const dom = editor.view.dom;
    dom.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    editor.on("selectionUpdate", onSelectionUpdate);
    return () => {
      dom.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      editor.off("selectionUpdate", onSelectionUpdate);
    };
  }, [editor]);

  if (!editor || !pos || mode === "hidden") return null;

  return (
    <div
      className="fixed z-40 -translate-x-1/2 rounded-md border border-zinc-200 bg-white px-1 py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      style={{ top: pos.top, left: pos.left }}
      onPointerDownCapture={(e) => {
        const t = e.target as HTMLElement;
        if (t.closest("button, a, input, textarea, select, [data-allow-focus]")) {
          return;
        }
        e.preventDefault();
      }}
    >
      <div className="flex items-center gap-0.5">
        {mode === "image" ? (
          <ImageBubbleToolbar editor={editor} />
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
                const url = prompt("URL을 입력하세요:");
                if (url === null) return;
                if (url === "") {
                  editor.chain().focus().unsetLink().run();
                } else {
                  editor.chain().focus().setLink({ href: url }).run();
                }
              }}
              title="링크"
            >
              <LinkIcon size={14} />
            </ToolbarBtn>
            <div className="relative">
              <ToolbarBtn
                active={colorOpen}
                onClick={() => {
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
                    if (c === null) editor.chain().focus().unsetColor().run();
                    else editor.chain().focus().setColor(c).run();
                    setColorOpen(false);
                  }}
                />
              )}
            </div>
            <div className="relative">
              <ToolbarBtn
                active={hlOpen}
                onClick={() => {
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
                    if (c === null)
                      editor.chain().focus().unsetHighlight().run();
                    else
                      editor.chain().focus().setHighlight({ color: c }).run();
                    setHlOpen(false);
                  }}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
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
      onClick={onClick}
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
          onClick={() => onPick(it.value)}
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
