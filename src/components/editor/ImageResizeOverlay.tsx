import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { useImageMultiSelectStore } from "../../store/imageMultiSelectStore";

const MIN_PX = 48;
/** selectionUpdate 마다 소수 픽셀만 달라도 리렌더 → 화면 깜빡임 방지 */
const BOX_EPS = 0.75;

function boxOverlayEqual(
  a: {
    pos: number;
    left: number;
    top: number;
    width: number;
    height: number;
  },
  b: typeof a,
): boolean {
  return (
    a.pos === b.pos &&
    Math.abs(a.left - b.left) < BOX_EPS &&
    Math.abs(a.top - b.top) < BOX_EPS &&
    Math.abs(a.width - b.width) < BOX_EPS &&
    Math.abs(a.height - b.height) < BOX_EPS
  );
}

type HandleId =
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w";

type DragState = {
  handle: HandleId;
  startX: number;
  startY: number;
  startW: number;
  startH: number;
  ratio: number;
  pos: number;
};

function cursorFor(h: HandleId): string {
  const m: Record<HandleId, string> = {
    nw: "nwse-resize",
    n: "ns-resize",
    ne: "nesw-resize",
    e: "ew-resize",
    se: "nwse-resize",
    s: "ns-resize",
    sw: "nesw-resize",
    w: "ew-resize",
  };
  return m[h];
}

/** 리사이즈 대상 미디어 노드 판별 — 이미지·유튜브·미디어(이미지/동영상) fileBlock(GIF 포함). */
function isResizableMediaNode(node: {
  type: { name: string };
  attrs: Record<string, unknown>;
}): boolean {
  const name = node.type.name;
  if (name === "image" || name === "youtube") return true;
  if (name !== "fileBlock") return false;
  const attrs = node.attrs;
  let mime =
    (typeof attrs.mime === "string" && attrs.mime) ||
    (typeof attrs.mimeType === "string" && attrs.mimeType) ||
    (typeof attrs.contentType === "string" && attrs.contentType) ||
    "";
  // mime 이 비어 있거나 일반(octet-stream)이면 파일명 확장자로 보강 — fileBlock 렌더 로직과 동일.
  if (!mime || mime === "application/octet-stream") {
    const nm = (typeof attrs.name === "string" ? attrs.name : "").toLowerCase();
    if (/\.gif$/.test(nm)) mime = "image/gif";
    else if (/\.(png|jpe?g|webp|avif)$/.test(nm)) mime = "image/png";
    else if (/\.(mp4|m4v|mov|webm)$/.test(nm)) mime = "video/mp4";
  }
  return mime.startsWith("image/") || mime.startsWith("video/");
}

/** 이미지/동영상/유튜브 노드 선택 시 테두리에 비율 유지 리사이즈 핸들 */
export function ImageResizeOverlay({ editor }: { editor: Editor | null }) {
  const [box, setBox] = useState<{
    pos: number;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  const dragRef = useRef<DragState | null>(null);
  const skipSyncRef = useRef(false);

  const measure = useCallback(() => {
    if (!editor || editor.isDestroyed || skipSyncRef.current) return;
    const sel = editor.state.selection;
    if (!(sel instanceof NodeSelection)) {
      setBox((prev) => (prev === null ? prev : null));
      return;
    }
    if (!isResizableMediaNode(sel.node)) {
      setBox((prev) => (prev === null ? prev : null));
      return;
    }
    const dom = editor.view.nodeDOM(sel.from);
    const el = dom instanceof HTMLElement ? dom : null;
    if (!el) {
      setBox((prev) => (prev === null ? prev : null));
      return;
    }
    // outer wrapper 가 block 이면 row 전체를 차지하므로 실제 미디어 element 의 rect 를 사용.
    const mediaEl = el.querySelector("img,video,iframe") as HTMLElement | null;
    const target: HTMLElement = mediaEl ?? el;
    const r = target.getBoundingClientRect();
    const next = {
      pos: sel.from,
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
    };
    setBox((prev) => (prev && boxOverlayEqual(prev, next) ? prev : next));
  }, [editor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    measure();
    const measureSoon = () => requestAnimationFrame(measure);
    editor.on("selectionUpdate", measure);
    editor.on("transaction", measureSoon);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      editor.off("selectionUpdate", measure);
      editor.off("transaction", measureSoon);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [editor, measure]);

  // 이미지 다중 선택(Ctrl/Cmd+클릭) 정리 — 선택이 이미지 NodeSelection 을 벗어나면 세트를 비운다.
  // (아웃라인 일괄 적용은 attrs 만 바꿔 위치가 유지되고 앵커도 이미지라 이때는 비우지 않는다.)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const onSel = () => {
      const sel = editor.state.selection;
      const isImageNode =
        sel instanceof NodeSelection && sel.node.type.name === "image";
      if (!isImageNode) useImageMultiSelectStore.getState().clear();
    };
    editor.on("selectionUpdate", onSel);
    return () => {
      editor.off("selectionUpdate", onSel);
    };
  }, [editor]);

  const onPointerDown = useCallback(
    (handle: HandleId, e: React.PointerEvent) => {
      if (!editor || !box) return;
      e.preventDefault();
      e.stopPropagation();

      const sel = editor.state.selection;
      if (!(sel instanceof NodeSelection)) return;
      const nodeName = sel.node.type.name;
      if (!isResizableMediaNode(sel.node)) return;
      const node = sel.node;
      const attrs = node.attrs as {
        width?: number | null;
        height?: number | null;
      };
      const dom = editor.view.nodeDOM(sel.from);
      const shell = dom instanceof HTMLElement ? dom : null;
      const mediaEl = shell?.querySelector("img,video,iframe") as
        | HTMLImageElement
        | HTMLVideoElement
        | HTMLIFrameElement
        | null;
      const rect = (mediaEl ?? shell)?.getBoundingClientRect();
      if (!rect) return;

      const natW = Number(
        (mediaEl as HTMLImageElement | null)?.naturalWidth ??
        (mediaEl as HTMLVideoElement | null)?.videoWidth ??
        (mediaEl as HTMLIFrameElement | null)?.width ??
        1,
      );
      const natH = Number(
        (mediaEl as HTMLImageElement | null)?.naturalHeight ??
        (mediaEl as HTMLVideoElement | null)?.videoHeight ??
        (mediaEl as HTMLIFrameElement | null)?.height ??
        1,
      );
      let ratio: number;
      if (
        attrs.width != null &&
        attrs.height != null &&
        attrs.width > 0 &&
        attrs.height > 0
      ) {
        ratio = attrs.width / attrs.height;
      } else {
        ratio = natW / natH;
      }
      if (!Number.isFinite(ratio) || ratio <= 0) {
        ratio = rect.width / Math.max(1, rect.height);
      }

      const startW =
        attrs.width != null && attrs.width > 0 ? attrs.width : rect.width;
      const startH =
        attrs.height != null && attrs.height > 0
          ? attrs.height
          : startW / ratio;

      dragRef.current = {
        handle,
        startX: e.clientX,
        startY: e.clientY,
        startW,
        startH,
        ratio,
        pos: box.pos,
      };
      skipSyncRef.current = true;

      try {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }

      const onMove = (ev: PointerEvent) => {
        const d = dragRef.current;
        if (!d) return;
        const dx = ev.clientX - d.startX;
        const dy = ev.clientY - d.startY;
        const { handle: h, startW: sw, startH: sh, ratio: rw } = d;

        let newW = sw;
        let newH = sh;

        if (h === "se") {
          const s = Math.max((sw + dx) / sw, (sh + dy) / sh);
          newW = Math.max(MIN_PX, sw * s);
          newH = newW / rw;
        } else if (h === "nw") {
          const s = Math.min((sw - dx) / sw, (sh - dy) / sh);
          newW = Math.max(MIN_PX, sw * s);
          newH = newW / rw;
        } else if (h === "ne") {
          const s = Math.max((sw + dx) / sw, (sh - dy) / sh);
          newW = Math.max(MIN_PX, sw * s);
          newH = newW / rw;
        } else if (h === "sw") {
          const s = Math.max((sw - dx) / sw, (sh + dy) / sh);
          newW = Math.max(MIN_PX, sw * s);
          newH = newW / rw;
        } else if (h === "e") {
          newW = Math.max(MIN_PX, sw + dx);
          newH = newW / rw;
        } else if (h === "w") {
          newW = Math.max(MIN_PX, sw - dx);
          newH = newW / rw;
        } else if (h === "s") {
          newH = Math.max(MIN_PX / rw, sh + dy);
          newW = newH * rw;
        } else if (h === "n") {
          newH = Math.max(MIN_PX / rw, sh - dy);
          newW = newH * rw;
        }

        // 50px 단위 스냅
        newW = Math.round(newW / 50) * 50;
        newW = Math.max(MIN_PX, newW);
        newH = newW / rw;

        const maxPx = editor.view.dom.getBoundingClientRect().width;
        if (Number.isFinite(maxPx) && maxPx > MIN_PX) {
          newW = Math.min(maxPx, newW);
          newH = newW / rw;
        }

        editor
          .chain()
          .setNodeSelection(d.pos)
          .updateAttributes(nodeName, {
            width: Math.round(newW),
            height: Math.round(newH),
          })
          .run();

        const shellNow = editor.view.nodeDOM(d.pos);
        const el = shellNow instanceof HTMLElement ? shellNow : null;
        if (el) {
          const mediaNow = el.querySelector("img,video,iframe") as HTMLElement | null;
          const nr = (mediaNow ?? el).getBoundingClientRect();
          setBox({
            pos: d.pos,
            left: nr.left,
            top: nr.top,
            width: nr.width,
            height: nr.height,
          });
        }
      };

      const onUp = () => {
        dragRef.current = null;
        skipSyncRef.current = false;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        measure();
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [editor, box, measure],
  );

  if (!editor || !box || box.width < 8) return null;

  const handles: HandleId[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

  // 피크 패널(DatabaseRowPeek) 처럼 조상에 CSS transform 이 걸려 있으면 position:fixed 의
  // 컨테이닝 블록이 viewport 가 아닌 transformed ancestor 로 바뀌어, getBoundingClientRect
  // (viewport 좌표) 와 어긋난다. Portal 로 body 직속에 렌더해 항상 viewport 기준이 되도록 한다.
  return createPortal(
    <div
      data-qn-editor-chrome="image-resize-overlay"
      // 피크 패널(DatabaseRowPeek) 의 backdrop/panel 이 z-[650] 이라 그 위에 떠야 한다.
      // 본문 컬럼 컨텍스트에선 z-35 였지만, body 직속 portal 로 바꾸면서 더 이상 상위 컨테이너의
      // stacking context 가 자동으로 격리해 주지 않으므로 명시적으로 그 위에 둔다.
      className="pointer-events-none fixed z-[660]"
      aria-hidden
      style={{
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
      }}
    >
      {handles.map((h) => {
        const style: CSSProperties = {
          position: "absolute",
          width: 10,
          height: 10,
          marginLeft: -5,
          marginTop: -5,
          pointerEvents: "auto",
          cursor: cursorFor(h),
          borderRadius: 2,
          border: "2px solid white",
          background: "rgb(59 130 246)",
          boxShadow: "0 0 0 1px rgb(24 24 27 / 0.22)",
        };
        if (h === "nw") {
          style.left = 0;
          style.top = 0;
        } else if (h === "n") {
          style.left = "50%";
          style.top = 0;
        } else if (h === "ne") {
          style.left = "100%";
          style.top = 0;
        } else if (h === "e") {
          style.left = "100%";
          style.top = "50%";
        } else if (h === "se") {
          style.left = "100%";
          style.top = "100%";
        } else if (h === "s") {
          style.left = "50%";
          style.top = "100%";
        } else if (h === "sw") {
          style.left = 0;
          style.top = "100%";
        } else {
          style.left = 0;
          style.top = "50%";
        }

        return (
          <div
            key={h}
            role="presentation"
            style={style}
            onPointerDown={(e) => onPointerDown(h, e)}
          />
        );
      })}
    </div>,
    document.body,
  );
}
