import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { X } from "lucide-react";

type ImageAttrs = {
  cropTop: number;
  cropLeft: number;
  cropWidth: number;
  cropHeight: number;
  width: number | null;
  height: number | null;
};

function attrsFromNode(editor: Editor, pos: number): ImageAttrs | null {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "image") return null;
  const a = node.attrs as Record<string, unknown>;
  const wRaw = a.width;
  const hRaw = a.height;
  return {
    cropTop: Number(a.cropTop ?? 0),
    cropLeft: Number(a.cropLeft ?? 0),
    cropWidth: Number(a.cropWidth ?? 100),
    cropHeight: Number(a.cropHeight ?? 100),
    width:
      wRaw != null && Number.isFinite(Number(wRaw)) ? Number(wRaw) : null,
    height:
      hRaw != null && Number.isFinite(Number(hRaw)) ? Number(hRaw) : null,
  };
}

type Props = {
  editor: Editor;
  open: boolean;
  imagePos: number;
  onClose: () => void;
};

export function ImageEditModal({
  editor,
  open,
  imagePos,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<ImageAttrs | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [boxPx, setBoxPx] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setDraft(null);
      setBoxPx(null);
      return;
    }
    const a = attrsFromNode(editor, imagePos);
    setDraft(a);
  }, [open, editor, imagePos]);

  const measure = useCallback(() => {
    const img = imgRef.current;
    if (!img || !img.complete) return;
    setBoxPx({ w: img.clientWidth, h: img.clientHeight });
  }, []);

  useEffect(() => {
    if (!open) return;
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, measure, draft?.cropWidth]);

  const applyToEditor = useCallback(
    (next: ImageAttrs) => {
      editor
        .chain()
        .focus()
        .setNodeSelection(imagePos)
        .updateAttributes("image", {
          cropTop: next.cropTop,
          cropLeft: next.cropLeft,
          cropWidth: next.cropWidth,
          cropHeight: next.cropHeight,
          width: next.width,
          height: next.height,
        })
        .run();
    },
    [editor, imagePos],
  );

  const onApply = () => {
    if (draft) applyToEditor(draft);
    onClose();
  };

  if (!open || !draft) return null;

  const src = String(
    (editor.state.doc.nodeAt(imagePos)?.attrs as { src?: string }).src ?? "",
  );

  const portal = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal
      aria-labelledby="qn-image-edit-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <h2
            id="qn-image-edit-title"
            className="text-sm font-semibold text-zinc-900 dark:text-zinc-100"
          >
            이미지 편집
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="닫기"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:flex-row">
          <div className="flex min-w-0 flex-1 flex-col items-center justify-center">
            <p className="mb-2 w-full text-center text-xs text-zinc-500 dark:text-zinc-400">
              캔버스에서 크롭 영역을 드래그·조절하세요.
            </p>
            <div
              ref={wrapRef}
              className="relative inline-block max-w-full rounded-lg bg-zinc-100 dark:bg-zinc-800"
            >
              <img
                ref={imgRef}
                src={src}
                alt=""
                className="block max-h-[min(56vh,520px)] max-w-full"
                style={{
                  clipPath: undefined,
                  filter: undefined,
                }}
                onLoad={measure}
              />
              {boxPx && boxPx.w > 0 && boxPx.h > 0 ? (
                <CropOverlay
                  boxW={boxPx.w}
                  boxH={boxPx.h}
                  draft={draft}
                  setDraft={setDraft}
                />
              ) : null}
            </div>
          </div>

          <div
            className="w-full shrink-0 space-y-4 md:w-80"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <PreviewThumb draft={draft} src={src} />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <button
            type="button"
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-600"
            onClick={onClose}
          >
            취소
          </button>
          <button
            type="button"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            onClick={onApply}
          >
            적용
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(portal, document.body);
}

/** 작은 미리보기 — img 크롭 */
function PreviewThumb({ draft, src }: { draft: ImageAttrs; src: string }) {
  const t = draft.cropTop;
  const l = draft.cropLeft;
  const w = draft.cropWidth;
  const h = draft.cropHeight;
  const right = 100 - l - w;
  const bottom = 100 - t - h;
  const imgClip = `inset(${t}% ${right}% ${bottom}% ${l}%)`;

  const shellStyle: CSSProperties = {
    display: "inline-block",
    maxWidth: "100%",
    lineHeight: 0,
    verticalAlign: "middle",
  };

  return (
    <div className="rounded-lg border border-zinc-200 p-2 dark:border-zinc-700">
      <p className="mb-2 text-xs font-medium text-zinc-700 dark:text-zinc-300">
        적용 미리보기
      </p>
      <div className="mx-auto max-w-[200px] text-center">
        <div style={shellStyle}>
          <img
            src={src}
            alt=""
            className="block h-auto w-full max-w-[200px] align-top"
            style={{ clipPath: imgClip }}
          />
        </div>
      </div>
    </div>
  );
}

type OverlayProps = {
  boxW: number;
  boxH: number;
  draft: ImageAttrs;
  setDraft: Dispatch<SetStateAction<ImageAttrs | null>>;
};

type DragMode =
  | { kind: "move-crop" }
  | { kind: "resize-crop"; handle: string };

function CropOverlay({
  boxW,
  boxH,
  draft,
  setDraft,
}: OverlayProps) {
  const dragRef = useRef<{
    mode: DragMode;
    startX: number;
    startY: number;
    start: ImageAttrs;
  } | null>(null);

  const draftRef = useRef(draft);
  draftRef.current = draft;

  const { cropLeft, cropTop, cropWidth, cropHeight } = draft;

  const setCrop = useCallback((partial: Partial<ImageAttrs>) => {
    setDraft((d) => (d ? { ...d, ...partial } : d));
  }, [setDraft]);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dxPct = ((e.clientX - drag.startX) / boxW) * 100;
      const dyPct = ((e.clientY - drag.startY) / boxH) * 100;
      const s = drag.start;

      if (drag.mode.kind === "move-crop") {
        let nl = s.cropLeft + dxPct;
        let nt = s.cropTop + dyPct;
        nl = Math.max(0, Math.min(100 - s.cropWidth, nl));
        nt = Math.max(0, Math.min(100 - s.cropHeight, nt));
        setCrop({ cropLeft: nl, cropTop: nt });
        return;
      }

      if (drag.mode.kind === "resize-crop") {
        const h = drag.mode.handle;
        let L = s.cropLeft;
        let T = s.cropTop;
        let W = s.cropWidth;
        let H = s.cropHeight;
        if (h.includes("e")) {
          W = Math.max(5, Math.min(100 - L, W + dxPct));
        }
        if (h.includes("w")) {
          const nL = Math.max(0, Math.min(L + W - 5, L + dxPct));
          W = W + L - nL;
          L = nL;
        }
        if (h.includes("s")) {
          H = Math.max(5, Math.min(100 - T, H + dyPct));
        }
        if (h.includes("n")) {
          const nT = Math.max(0, Math.min(T + H - 5, T + dyPct));
          H = H + T - nT;
          T = nT;
        }
        setCrop({
          cropLeft: L,
          cropTop: T,
          cropWidth: W,
          cropHeight: H,
        });
      }
    },
    [boxW, boxH, setCrop],
  );

  const endDragRef = useRef<() => void>(() => {});
  const endDrag = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", endDragRef.current);
  }, [onPointerMove]);
  endDragRef.current = endDrag;

  const startDrag = (mode: DragMode, e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const d = draftRef.current;
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      start: { ...d },
    };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
  };

  const sh = (cropTop / 100) * boxH;
  const sw = (cropLeft / 100) * boxW;
  const shh = (cropHeight / 100) * boxH;
  const sww = (cropWidth / 100) * boxW;

  return (
    <div className="pointer-events-none absolute inset-0">
      <div
        className="absolute left-0 right-0 top-0 bg-black/45"
        style={{ height: sh }}
      />
      <div
        className="absolute bottom-0 left-0 right-0 bg-black/45"
        style={{ top: sh + shh }}
      />
      <div
        className="absolute bg-black/45"
        style={{ left: 0, width: sw, top: sh, height: shh }}
      />
      <div
        className="absolute bg-black/45"
        style={{
          left: sw + sww,
          right: 0,
          top: sh,
          height: shh,
        }}
      />

      <div
        className="pointer-events-auto absolute border-2 border-white shadow-md"
        style={{
          left: sw,
          top: sh,
          width: sww,
          height: shh,
        }}
        onPointerDown={(e) => startDrag({ kind: "move-crop" }, e)}
      />

      {(["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const).map((h) => {
        const pos: CSSProperties =
          h === "nw"
            ? { left: sw - 5, top: sh - 5 }
            : h === "n"
              ? { left: sw + sww / 2 - 5, top: sh - 5 }
              : h === "ne"
                ? { left: sw + sww - 5, top: sh - 5 }
                : h === "e"
                  ? { left: sw + sww - 5, top: sh + shh / 2 - 5 }
                  : h === "se"
                    ? { left: sw + sww - 5, top: sh + shh - 5 }
                    : h === "s"
                      ? { left: sw + sww / 2 - 5, top: sh + shh - 5 }
                      : h === "sw"
                        ? { left: sw - 5, top: sh + shh - 5 }
                        : { left: sw - 5, top: sh + shh / 2 - 5 };

        return (
          <div
            key={h}
            className="pointer-events-auto absolute z-10 h-3 w-3 rounded-sm border border-white bg-sky-500"
            style={pos}
            onPointerDown={(e) =>
              startDrag({ kind: "resize-crop", handle: h }, e)
            }
          />
        );
      })}
    </div>
  );
}
