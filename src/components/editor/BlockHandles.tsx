import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { GripVertical, Plus, Trash2, ArrowUp, ArrowDown, Copy } from "lucide-react";

type HoverInfo = {
  rect: DOMRect;
  pos: number;
};

type Props = {
  editor: Editor | null;
};

// 에디터 DOM에 mousemove를 걸어 최상위 블록 호버 좌표를 추적하고,
// 좌측 여백에 ⋮⋮ / ➕ 핸들을 절대 위치로 렌더한다.
export function BlockHandles({ editor }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const wrapper = containerRef.current?.parentElement;
    if (!wrapper) return;

    const onMove = (e: MouseEvent) => {
      // dom.children == 최상위 블록들
      const children = Array.from(dom.children) as HTMLElement[];
      let target: HTMLElement | null = null;
      for (const child of children) {
        const rect = child.getBoundingClientRect();
        if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
          target = child;
          break;
        }
      }
      if (!target) {
        setHover(null);
        return;
      }
      // ProseMirror 위치 계산: 자식 인덱스 -> doc 내 시작 위치
      const idx = children.indexOf(target);
      let pmPos = 0;
      for (let i = 0; i < idx; i++) {
        pmPos += editor.state.doc.child(i).nodeSize;
      }
      setHover({ rect: target.getBoundingClientRect(), pos: pmPos });
    };
    const onLeave = () => setHover(null);

    wrapper.addEventListener("mousemove", onMove);
    wrapper.addEventListener("mouseleave", onLeave);
    return () => {
      wrapper.removeEventListener("mousemove", onMove);
      wrapper.removeEventListener("mouseleave", onLeave);
    };
  }, [editor]);

  if (!editor || !hover) {
    return <div ref={containerRef} className="absolute inset-0 pointer-events-none" />;
  }

  const wrapper = containerRef.current?.parentElement;
  if (!wrapper) return null;
  const wrapperRect = wrapper.getBoundingClientRect();
  const top = hover.rect.top - wrapperRect.top + 4;
  const left = hover.rect.left - wrapperRect.left - 48;

  const insertBelow = () => {
    const pos = hover.pos + editor.state.doc.resolve(hover.pos + 1).parent.nodeSize;
    editor
      .chain()
      .focus()
      .insertContentAt(pos, { type: "paragraph" })
      .run();
    // 슬래시 명령 트리거: '/' 입력 시뮬
    setTimeout(() => {
      editor.chain().insertContent("/").run();
    }, 0);
  };

  const moveBlock = (dir: "up" | "down") => {
    const node = editor.state.doc.nodeAt(hover.pos);
    if (!node) return;
    const idx = childIndexFromPos(editor, hover.pos);
    if (idx === -1) return;
    const sibling = dir === "up" ? idx - 1 : idx + 1;
    if (sibling < 0 || sibling >= editor.state.doc.childCount) return;
    const tr = editor.state.tr;
    const nodes =
      dir === "up"
        ? [editor.state.doc.child(idx), editor.state.doc.child(sibling)]
        : [editor.state.doc.child(sibling), editor.state.doc.child(idx)];
    const start =
      dir === "up"
        ? hover.pos - editor.state.doc.child(sibling).nodeSize
        : hover.pos;
    const end =
      dir === "up"
        ? hover.pos + node.nodeSize
        : hover.pos + node.nodeSize + editor.state.doc.child(sibling).nodeSize;
    tr.replaceWith(start, end, nodes);
    editor.view.dispatch(tr.scrollIntoView());
  };

  const duplicateBlock = () => {
    const node = editor.state.doc.nodeAt(hover.pos);
    if (!node) return;
    editor
      .chain()
      .insertContentAt(hover.pos + node.nodeSize, node.toJSON())
      .run();
  };

  const deleteBlock = () => {
    const node = editor.state.doc.nodeAt(hover.pos);
    if (!node) return;
    if (editor.state.doc.childCount <= 1) {
      // 마지막 블록은 비우기만
      editor.chain().focus().clearContent().setParagraph().run();
      return;
    }
    const tr = editor.state.tr.delete(hover.pos, hover.pos + node.nodeSize);
    editor.view.dispatch(tr);
  };

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-0"
    >
      <div
        className="pointer-events-auto absolute flex items-center gap-0.5"
        style={{ top, left }}
      >
        <button
          type="button"
          onClick={insertBelow}
          title="아래에 블록 추가"
          className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          <Plus size={14} />
        </button>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          title="블록 메뉴"
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          <GripVertical size={14} />
        </button>
        {menuOpen && (
          <div className="absolute left-12 top-0 z-30 w-44 rounded-md border border-zinc-200 bg-white py-1 text-xs shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            <BlockMenuItem
              icon={ArrowUp}
              label="위로 이동"
              onClick={() => {
                moveBlock("up");
                setMenuOpen(false);
              }}
            />
            <BlockMenuItem
              icon={ArrowDown}
              label="아래로 이동"
              onClick={() => {
                moveBlock("down");
                setMenuOpen(false);
              }}
            />
            <BlockMenuItem
              icon={Copy}
              label="복제"
              onClick={() => {
                duplicateBlock();
                setMenuOpen(false);
              }}
            />
            <hr className="my-1 border-zinc-200 dark:border-zinc-700" />
            <BlockMenuItem
              icon={Trash2}
              label="삭제"
              danger
              onClick={() => {
                deleteBlock();
                setMenuOpen(false);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function BlockMenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: typeof Plus;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex w-full items-center gap-2 px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800",
        danger ? "text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30" : "",
      ].join(" ")}
    >
      <Icon size={12} />
      {label}
    </button>
  );
}

function childIndexFromPos(editor: Editor, pos: number): number {
  let cursor = 0;
  for (let i = 0; i < editor.state.doc.childCount; i++) {
    if (cursor === pos) return i;
    cursor += editor.state.doc.child(i).nodeSize;
  }
  return -1;
}
