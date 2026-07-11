import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { usePopoverFlip } from "../../hooks/usePopoverFlip";
import { NodeSelection } from "@tiptap/pm/state";
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  Captions,
  Download,
  MessageSquarePlus,
  SquarePen,
} from "lucide-react";
import { useUiStore } from "../../store/uiStore";
import { useImageMultiSelectStore } from "../../store/imageMultiSelectStore";
import { ensureBlockId } from "../../lib/comments/ensureBlockId";
import { applyCaptionToggle } from "../../lib/tiptapExtensions/mediaCaption";
import { decodeImageRef } from "../../lib/sync/imageScheme";
import { decodeFileRef } from "../../lib/files/scheme";
import { imageUrlCache } from "../../lib/images/registry";

// 캡션 토글 단축키 표시(플랫폼별). 바인딩은 imageBlock.tsx addKeyboardShortcuts.
const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iP(hone|ad|od)/.test(navigator.platform);
const CAPTION_SHORTCUT_LABEL = IS_MAC ? "⌘⌥M" : "Ctrl+Alt+M";

type Props = {
  editor: Editor;
  pageId: string | null;
};

type Align = "left" | "center" | "right";

// 아웃라인 두께·모서리 라운드 프리셋과 컬러 팔레트.
const OUTLINE_WIDTHS = [0, 1, 2, 3, 4] as const;
const BORDER_RADII = [0, 4, 8, 12, 16, 24] as const;
const OUTLINE_COLORS = [
  "#000000",
  "#4b5563",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#0891b2",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#ffffff",
] as const;

async function fetchDownloadBlob(assetId: string | null, rawSrc: string): Promise<Blob> {
  const resolveHref = async () => (assetId ? await imageUrlCache.get(assetId) : rawSrc);
  try {
    const resp = await fetch(await resolveHref());
    if (!resp.ok) throw new Error(`download failed: ${resp.status}`);
    return await resp.blob();
  } catch (err) {
    if (!assetId) throw err;
    await imageUrlCache.invalidate(assetId);
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
  const [outlineOpen, setOutlineOpen] = useState(false);
  // 아웃라인 팝오버가 하단에서 잘리면 위로 뒤집는다(≈230px 높이).
  const { triggerRef: outlineTriggerRef, dropUp: outlineDropUp } =
    usePopoverFlip<HTMLDivElement>(outlineOpen, 230);
  // 다중 선택 이미지 개수(Ctrl/Cmd+클릭). 아웃라인·라운드를 한꺼번에 적용하기 위해 사용.
  const multiCount = useImageMultiSelectStore((s) => s.positions.length);

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
    outlineWidth?: number | null;
    outlineColor?: string | null;
    borderRadius?: number | null;
  };
  const align = (attrs.align as Align) ?? "left";
  const hasCaption = typeof attrs.caption === "string";
  const nodeType = sel.node.type.name;
  const blockStart = sel.from;
  const isImage = nodeType === "image";
  const outlineWidth = typeof attrs.outlineWidth === "number" ? attrs.outlineWidth : 0;
  const outlineColor = attrs.outlineColor ?? "#4b5563";
  const borderRadius = typeof attrs.borderRadius === "number" ? attrs.borderRadius : 0;

  const setOutline = (patch: {
    outlineWidth?: number;
    outlineColor?: string;
    borderRadius?: number;
  }) => {
    // 다중 선택이 있으면 모든 이미지에, 없으면 현재 이미지에 적용.
    // attrs 만 바뀌어 nodeSize 가 그대로이므로 위치가 체인 도중에도 유효하다.
    const positions = useImageMultiSelectStore.getState().positions;
    const doc = editor.state.doc;
    // 위치가 여전히 image 노드를 가리키는지 검증(구조 편집으로 stale 된 위치 제외).
    const targets = (positions.length > 0 ? positions : [blockStart]).filter(
      (p) => doc.nodeAt(p)?.type.name === "image",
    );
    if (targets.length === 0) return;
    let chain = editor.chain();
    for (const pos of targets) {
      chain = chain.setNodeSelection(pos).updateAttributes("image", patch);
    }
    // 앵커 이미지로 선택 복원(툴바 유지).
    chain.setNodeSelection(blockStart).run();
  };

  const setAlign = (next: Align) => {
    editor
      .chain()
      .setNodeSelection(blockStart)
      .updateAttributes(nodeType, { align: next })
      .run();
  };

  const toggleCaption = () => {
    // 내용 있는 캡션은 버튼 재클릭으로 지워지지 않는다(포커스만) — mediaCaption 3단계 로직 공유.
    applyCaptionToggle(editor, nodeType, blockStart, {
      caption: attrs.caption ?? null,
      captionAlign: attrs.captionAlign ?? null,
    });
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
      <AlignBtn
        active={hasCaption}
        title={`캡션 (${CAPTION_SHORTCUT_LABEL})`}
        onClick={toggleCaption}
      >
        <Captions size={14} />
      </AlignBtn>
      {isImage ? (
        <div className="relative" ref={outlineTriggerRef}>
          <AlignBtn
            active={outlineOpen || outlineWidth > 0 || borderRadius > 0}
            title="아웃라인 · 모서리"
            onClick={() => setOutlineOpen((v) => !v)}
          >
            <SquarePen size={14} />
          </AlignBtn>
          {outlineOpen ? (
            <div
              className={`absolute right-0 z-50 w-52 rounded-md border border-zinc-200 bg-white p-2.5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900 ${
                outlineDropUp ? "bottom-9" : "top-9"
              }`}
            >
              {multiCount > 1 ? (
                <div className="mb-2 rounded bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300">
                  선택한 {multiCount}개 이미지에 일괄 적용
                </div>
              ) : null}
              <div className="mb-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                아웃라인 두께
              </div>
              <div className="mb-2.5 flex gap-1">
                {OUTLINE_WIDTHS.map((w) => (
                  <PresetBtn
                    key={w}
                    active={outlineWidth === w}
                    label={w === 0 ? "없음" : String(w)}
                    onClick={() =>
                      setOutline({
                        outlineWidth: w,
                        // 두께를 처음 켤 때 색이 없으면 기본색 지정.
                        ...(w > 0 && !attrs.outlineColor ? { outlineColor } : {}),
                      })
                    }
                  />
                ))}
              </div>
              <div className="mb-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                아웃라인 색
              </div>
              <div className="mb-2.5 flex flex-wrap gap-1">
                {OUTLINE_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    title={c}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setOutline({
                        outlineColor: c,
                        ...(outlineWidth === 0 ? { outlineWidth: 2 } : {}),
                      });
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    className={`h-5 w-5 shrink-0 rounded border ${
                      outlineColor.toLowerCase() === c.toLowerCase()
                        ? "ring-2 ring-blue-400 ring-offset-1 dark:ring-offset-zinc-900"
                        : "border-zinc-200 dark:border-zinc-700"
                    }`}
                    style={{ background: c }}
                  />
                ))}
              </div>
              <div className="mb-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                모서리 라운드
              </div>
              <div className="flex flex-wrap gap-1">
                {BORDER_RADII.map((r) => (
                  <PresetBtn
                    key={r}
                    active={borderRadius === r}
                    label={r === 0 ? "없음" : String(r)}
                    onClick={() => setOutline({ borderRadius: r })}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      <AlignBtn active={false} title="다운로드" onClick={() => void downloadMedia()}>
        <Download size={14} />
      </AlignBtn>
      <AlignBtn active={false} title="댓글 추가" onClick={addComment}>
        <MessageSquarePlus size={14} />
      </AlignBtn>
    </div>
  );
}

// 아웃라인 두께·라운드 프리셋 버튼 (팝오버 내부).
function PresetBtn({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
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
      className={`flex h-6 min-w-6 items-center justify-center rounded px-1 text-[11px] ${
        active
          ? "bg-blue-500 text-white"
          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
      }`}
    >
      {label}
    </button>
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
