import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Highlighter,
  Palette,
  Link as LinkIcon,
} from "lucide-react";

const COLORS = [
  { label: "기본", value: null },
  { label: "빨강", value: "#ef4444" },
  { label: "주황", value: "#f97316" },
  { label: "노랑", value: "#eab308" },
  { label: "초록", value: "#22c55e" },
  { label: "파랑", value: "#3b82f6" },
  { label: "보라", value: "#8b5cf6" },
];

const HIGHLIGHTS = [
  { label: "없음", value: null },
  { label: "노랑", value: "#fef08a" },
  { label: "초록", value: "#bbf7d0" },
  { label: "파랑", value: "#bfdbfe" },
  { label: "분홍", value: "#fbcfe8" },
];

type Props = {
  editor: Editor | null;
};

// 텍스트 선택 시 화면 상단에 떠 있는 부유 툴바.
// (TipTap BubbleMenu 대신 단순한 셀렉션 좌표 추적 + 절대 위치).
export function BubbleToolbar({ editor }: Props) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [colorOpen, setColorOpen] = useState(false);
  const [hlOpen, setHlOpen] = useState(false);

  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const { from, to } = editor.state.selection;
      if (from === to) {
        setPos(null);
        return;
      }
      const start = editor.view.coordsAtPos(from);
      const end = editor.view.coordsAtPos(to);
      setPos({
        top: Math.min(start.top, end.top) + window.scrollY - 44,
        left: (start.left + end.left) / 2 + window.scrollX,
      });
    };
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
    };
  }, [editor]);

  if (!editor || !pos) return null;

  return (
    <div
      className="fixed z-40 -translate-x-1/2 rounded-md border border-zinc-200 bg-white px-1 py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      style={{ top: pos.top, left: pos.left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="flex items-center gap-0.5">
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
                if (c === null) editor.chain().focus().unsetHighlight().run();
                else editor.chain().focus().setHighlight({ color: c }).run();
                setHlOpen(false);
              }}
            />
          )}
        </div>
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
    <div className="absolute left-0 top-9 z-50 flex w-44 flex-wrap gap-1 rounded-md border border-zinc-200 bg-white p-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          onClick={() => onPick(it.value)}
          className="flex h-7 w-7 items-center justify-center rounded border border-zinc-200 text-xs hover:scale-110 dark:border-zinc-700"
          style={{ background: it.value ?? "transparent" }}
          title={it.label}
        >
          {it.value === null ? "✕" : ""}
        </button>
      ))}
    </div>
  );
}
