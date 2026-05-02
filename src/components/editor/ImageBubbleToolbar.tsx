import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { Crop, Square } from "lucide-react";
import { NodeSelection } from "@tiptap/pm/state";
import { ImageEditModal } from "./ImageEditModal";

type Props = {
  editor: Editor;
};

export function ImageBubbleToolbar({ editor }: Props) {
  const [editOpen, setEditOpen] = useState(false);

  const sel = editor.state.selection;
  if (!(sel instanceof NodeSelection) || sel.node.type.name !== "image") {
    return null;
  }

  const imagePos = sel.from;
  const attrs = sel.node.attrs as Record<string, unknown>;
  const hasOutline = Number(attrs.outlineWidth ?? 0) > 0;

  const toggleOutline = () => {
    if (hasOutline) {
      editor
        .chain()
        .focus()
        .setNodeSelection(imagePos)
        .updateAttributes("image", { outlineWidth: 0 })
        .run();
    } else {
      editor
        .chain()
        .focus()
        .setNodeSelection(imagePos)
        .updateAttributes("image", { outlineWidth: 1, outlineColor: "#000000" })
        .run();
    }
  };

  return (
    <>
      <div className="flex items-center gap-0.5 border-l border-zinc-200 pl-1 dark:border-zinc-700">
        <button
          type="button"
          title="이미지 크롭"
          onClick={() => setEditOpen(true)}
          className="flex h-7 w-7 items-center justify-center rounded text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          <Crop size={14} />
        </button>
        <button
          type="button"
          title="아웃라인 토글"
          onClick={toggleOutline}
          className={`flex h-7 w-7 items-center justify-center rounded text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800 ${
            hasOutline
              ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
              : ""
          }`}
        >
          <Square size={14} />
        </button>
      </div>
      <ImageEditModal
        editor={editor}
        open={editOpen}
        imagePos={imagePos}
        onClose={() => setEditOpen(false)}
      />
    </>
  );
}
