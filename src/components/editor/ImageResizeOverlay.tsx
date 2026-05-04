import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";

const MIN_PX = 48;

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

/** 이미지 노드 선택 시 테두리에 비율 유지 리사이즈 핸들 */
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
    if (!(sel instanceof NodeSelection) || sel.node.type.name !== "image") {
      setBox(null);
      return;
    }
    const dom = editor.view.nodeDOM(sel.from);
    const el = dom instanceof HTMLElement ? dom : null;
    if (!el) {
      setBox(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setBox({
      pos: sel.from,
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
    });
  }, [editor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    measure();
    editor.on("selectionUpdate", measure);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      editor.off("selectionUpdate", measure);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [editor, measure]);

  const onPointerDown = useCallback(
    (handle: HandleId, e: React.PointerEvent) => {
      if (!editor || !box) return;
      e.preventDefault();
      e.stopPropagation();

      const sel = editor.state.selection;
      if (!(sel instanceof NodeSelection) || sel.node.type.name !== "image") {
        return;
      }
      const node = sel.node;
      const attrs = node.attrs as {
        width?: number | null;
        height?: number | null;
      };
      const dom = editor.view.nodeDOM(sel.from);
      const shell = dom instanceof HTMLElement ? dom : null;
      const imgEl = shell?.querySelector("img");
      const rect = shell?.getBoundingClientRect();
      if (!rect) return;

      const natW = imgEl?.naturalWidth ?? 1;
      const natH = imgEl?.naturalHeight ?? 1;
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

        const maxPx = editor.view.dom.getBoundingClientRect().width;
        if (Number.isFinite(maxPx) && maxPx > MIN_PX) {
          newW = Math.min(maxPx, newW);
          newH = newW / rw;
        }

        editor
          .chain()
          .setNodeSelection(d.pos)
          .updateAttributes("image", {
            width: Math.round(newW),
            height: Math.round(newH),
          })
          .run();

        const shellNow = editor.view.nodeDOM(d.pos);
        const el = shellNow instanceof HTMLElement ? shellNow : null;
        if (el) {
          const nr = el.getBoundingClientRect();
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

  return (
    <div
      className="pointer-events-none fixed z-[35]"
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
    </div>
  );
}
