import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  Captions,
  Download,
  MessageSquarePlus,
} from "lucide-react";
import { useUiStore } from "../../store/uiStore";
import { ensureBlockId } from "../../lib/comments/ensureBlockId";
import { focusCaptionInput } from "../../lib/tiptapExtensions/mediaCaption";
import { decodeImageRef } from "../../lib/sync/imageScheme";
import { decodeFileRef } from "../../lib/files/scheme";
import { imageUrlCache } from "../../lib/images/registry";

type Props = {
  editor: Editor;
  pageId: string | null;
};

type Align = "left" | "center" | "right";

async function fetchDownloadBlob(assetId: string | null, rawSrc: string): Promise<Blob> {
  const resolveHref = async () => (assetId ? await imageUrlCache.get(assetId) : rawSrc);
  try {
    const resp = await fetch(await resolveHref());
    if (!resp.ok) throw new Error(`download failed: ${resp.status}`);
    return await resp.blob();
  } catch (err) {
    if (!assetId) throw err;
    imageUrlCache.invalidate(assetId);
    const resp = await fetch(await resolveHref());
    if (!resp.ok) throw new Error(`download failed: ${resp.status}`);
    return await resp.blob();
  }
}

// 이미지/동영상(fileBlock) 선택 시 표시되는 미디어 전용 툴바.
// 좌/중앙/우 정렬 · 캡션 토글 · 댓글 추가.
export function ImageBubbleToolbar({ editor, pageId }: Props) {
  const openCommentThread = useUiStore((s) => s.openCommentThread);
  const showToast = useUiStore((s) => s.showToast);

  const sel = editor.state.selection;
  if (
    !(sel instanceof NodeSelection) ||
    (sel.node.type.name !== "image" && sel.node.type.name !== "fileBlock")
  ) {
    return null;
  }
  const attrs = sel.node.attrs as {
    align?: string | null;
    caption?: string | null;
    captionAlign?: string | null;
    src?: string | null;
    name?: string | null;
    alt?: string | null;
  };
  const align = (attrs.align as Align) ?? "left";
  const hasCaption = typeof attrs.caption === "string";
  const nodeType = sel.node.type.name;
  const blockStart = sel.from;

  const setAlign = (next: Align) => {
    editor
      .chain()
      .setNodeSelection(blockStart)
      .updateAttributes(nodeType, { align: next })
      .run();
  };

  const toggleCaption = () => {
    editor
      .chain()
      .setNodeSelection(blockStart)
      .updateAttributes(nodeType, {
        caption: hasCaption ? null : "",
        ...(hasCaption ? {} : { captionAlign: attrs.captionAlign ?? "left" }),
      })
      .run();
    if (!hasCaption) focusCaptionInput(editor, blockStart);
  };

  const addComment = () => {
    if (!pageId) return;
    const blockId = ensureBlockId(editor, blockStart);
    if (!blockId) return;
    const dom = editor.view.nodeDOM(blockStart);
    const el = dom instanceof HTMLElement ? dom : dom?.parentElement ?? null;
    const r = el?.getBoundingClientRect();
    openCommentThread({
      pageId,
      blockId,
      blockStart,
      skipScroll: true,
      anchorViewport: r
        ? { top: r.top, left: r.left, right: r.right, bottom: r.bottom }
        : undefined,
    });
  };

  const downloadMedia = async () => {
    const rawSrc = attrs.src ?? null;
    if (!rawSrc) return;
    try {
      const assetId = decodeImageRef(rawSrc) ?? decodeFileRef(rawSrc);
      const blob = await fetchDownloadBlob(assetId, rawSrc);
      const blobUrl = URL.createObjectURL(blob);
      try {
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = attrs.name ?? attrs.alt ?? (nodeType === "image" ? "image" : "download");
        a.rel = "noopener noreferrer";
        a.style.display = "none";
        document.body.append(a);
        a.click();
        a.remove();
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
      }
      showToast("다운로드가 완료되었습니다.", { kind: "success" });
    } catch (err) {
      console.error("[ImageBubbleToolbar] download 실패", err);
      showToast("다운로드에 실패했습니다. S3 CORS 배포 상태를 확인해 주세요.", { kind: "error" });
    }
  };

  return (
    <div className="flex items-center gap-0.5">
      <AlignBtn active={align === "left"} title="왼쪽 정렬" onClick={() => setAlign("left")}>
        <AlignLeft size={14} />
      </AlignBtn>
      <AlignBtn active={align === "center"} title="가운데 정렬" onClick={() => setAlign("center")}>
        <AlignCenter size={14} />
      </AlignBtn>
      <AlignBtn active={align === "right"} title="오른쪽 정렬" onClick={() => setAlign("right")}>
        <AlignRight size={14} />
      </AlignBtn>
      <span className="mx-0.5 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
      <AlignBtn active={hasCaption} title="캡션" onClick={toggleCaption}>
        <Captions size={14} />
      </AlignBtn>
      <AlignBtn active={false} title="다운로드" onClick={() => void downloadMedia()}>
        <Download size={14} />
      </AlignBtn>
      <AlignBtn active={false} title="댓글 추가" onClick={addComment}>
        <MessageSquarePlus size={14} />
      </AlignBtn>
    </div>
  );
}

function AlignBtn({
  active,
  title,
  onClick,
  children,
}: {
  active: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
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
      className={`flex h-7 w-7 items-center justify-center rounded text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 ${
        active ? "bg-zinc-100 text-blue-600 dark:bg-zinc-800 dark:text-blue-400" : ""
      }`}
    >
      {children}
    </button>
  );
}
