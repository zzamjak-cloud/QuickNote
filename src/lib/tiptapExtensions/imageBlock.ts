import Image from "@tiptap/extension-image";
import { mergeAttributes } from "@tiptap/core";
import { EDITOR_IMAGE_PLACEHOLDER_SRC } from "../editorImageStorage";

function attrsFromImgEl(
  img: HTMLImageElement,
  frameBase: Record<string, unknown>,
): Record<string, unknown> {
  const qn = img.getAttribute("data-qn-image-id");
  return {
    src: img.getAttribute("src"),
    alt: img.getAttribute("alt"),
    title: img.getAttribute("title"),
    width: img.getAttribute("width")
      ? parseInt(img.getAttribute("width")!, 10)
      : null,
    height: img.getAttribute("height")
      ? parseInt(img.getAttribute("height")!, 10)
      : null,
    qnImageId: qn && qn.length > 0 ? qn : null,
    ...frameBase,
  };
}

/**
 * 이미지 블록: 인라인 크롭( img clip-path ) + 셸의 실루엣 아웃라인( drop-shadow ).
 * clip-path 가 걸린 요소에 outline 을 주면 잘리므로, 아웃라인은 .qn-image-shell 에만 filter 적용.
 * → inline-block 하단 여백 제거: line-height:0
 */

function insetCropPercent(t: number, l: number, w: number, h: number): string {
  const top = Math.min(100, Math.max(0, t));
  const left = Math.min(100, Math.max(0, l));
  const cw = Math.min(100 - left, Math.max(1, w));
  const ch = Math.min(100 - top, Math.max(1, h));
  const right = 100 - left - cw;
  const bottom = 100 - top - ch;
  return `inset(${top}% ${right}% ${bottom}% ${left}%)`;
}

const OUTLINE_DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
];

function outlineSilhouetteFilter(width: number, color: string): string {
  if (width <= 0) return "none";
  const o =
    width <= 1
      ? Math.max(0.45, width * 0.65)
      : Math.min(6, width);
  const layers: string[] = [];
  for (const [dx, dy] of OUTLINE_DIRS) {
    layers.push(`drop-shadow(${dx * o}px ${dy * o}px 0 ${color})`);
  }
  return layers.join(" ");
}

/** 미리보기에서 동일 스타일 */
export function imageOutlineFilterFromAttrs(
  attrs: Record<string, unknown>,
): string {
  const ow = Number(attrs.outlineWidth ?? 0);
  const oc = String(attrs.outlineColor ?? "#3b82f6");
  return outlineSilhouetteFilter(ow, oc);
}

function shellStyle(attrs: Record<string, unknown>): string {
  const ow = Number(attrs.outlineWidth ?? 0);
  const oc = String(attrs.outlineColor ?? "#3b82f6");
  const f = ow > 0 ? outlineSilhouetteFilter(ow, oc) : "none";
  const parts = [
    "display: inline-block",
    "max-width: 100%",
    "line-height: 0",
    "vertical-align: middle",
  ];
  if (f !== "none") {
    parts.push(`filter: ${f}`);
  }
  return parts.join("; ");
}

function imgCropStyle(attrs: Record<string, unknown>): string {
  const t = Number(attrs.cropTop ?? 0);
  const l = Number(attrs.cropLeft ?? 0);
  const w = Number(attrs.cropWidth ?? 100);
  const h = Number(attrs.cropHeight ?? 100);
  return [
    `clip-path: ${insetCropPercent(t, l, w, h)}`,
    "display: block",
    "max-width: 100%",
    "height: auto",
    "vertical-align: top",
  ].join("; ");
}

function readFrameDataAttrs(wrap: HTMLElement): Record<string, unknown> {
  return {
    outlineWidth:
      parseFloat(wrap.getAttribute("data-outline-w") ?? "0") || 0,
    outlineColor: wrap.getAttribute("data-outline-color") ?? "#3b82f6",
    cropTop: parseFloat(wrap.getAttribute("data-crop-t") ?? "0") || 0,
    cropLeft: parseFloat(wrap.getAttribute("data-crop-l") ?? "0") || 0,
    cropWidth: parseFloat(wrap.getAttribute("data-crop-w") ?? "100") || 100,
    cropHeight: parseFloat(wrap.getAttribute("data-crop-h") ?? "100") || 100,
  };
}

export const ImageBlock = Image.extend({
  name: "image",

  addAttributes() {
    return {
      ...this.parent?.(),
      outlineWidth: {
        default: 0,
        parseHTML: (el) =>
          parseFloat(
            (el.closest("[data-qn-image]") as HTMLElement | null)?.getAttribute(
              "data-outline-w",
            ) ?? "0",
          ) || 0,
        renderHTML: (attrs) => ({
          "data-outline-w": String(attrs.outlineWidth ?? 0),
        }),
      },
      outlineColor: {
        default: "#3b82f6",
        parseHTML: (el) =>
          (el.closest("[data-qn-image]") as HTMLElement | null)?.getAttribute(
            "data-outline-color",
          ) ?? "#3b82f6",
        renderHTML: (attrs) => ({
          "data-outline-color": attrs.outlineColor ?? "#3b82f6",
        }),
      },
      shadow: {
        default: "none",
        parseHTML: (el) =>
          (el.closest("[data-qn-image-shell]") as HTMLElement | null)?.getAttribute(
            "data-shadow",
          ) ??
          (el.closest("[data-qn-image]") as HTMLElement | null)?.getAttribute(
            "data-shadow",
          ) ??
          "none",
        renderHTML: () => ({}),
      },
      cropTop: {
        default: 0,
        parseHTML: (el) =>
          parseFloat(
            (el.closest("[data-qn-image]") as HTMLElement | null)?.getAttribute(
              "data-crop-t",
            ) ?? "0",
          ) || 0,
        renderHTML: (attrs) => ({
          "data-crop-t": String(attrs.cropTop ?? 0),
        }),
      },
      cropLeft: {
        default: 0,
        parseHTML: (el) =>
          parseFloat(
            (el.closest("[data-qn-image]") as HTMLElement | null)?.getAttribute(
              "data-crop-l",
            ) ?? "0",
          ) || 0,
        renderHTML: (attrs) => ({
          "data-crop-l": String(attrs.cropLeft ?? 0),
        }),
      },
      cropWidth: {
        default: 100,
        parseHTML: (el) =>
          parseFloat(
            (el.closest("[data-qn-image]") as HTMLElement | null)?.getAttribute(
              "data-crop-w",
            ) ?? "100",
          ) || 100,
        renderHTML: (attrs) => ({
          "data-crop-w": String(attrs.cropWidth ?? 100),
        }),
      },
      cropHeight: {
        default: 100,
        parseHTML: (el) =>
          parseFloat(
            (el.closest("[data-qn-image]") as HTMLElement | null)?.getAttribute(
              "data-crop-h",
            ) ?? "100",
          ) || 100,
        renderHTML: (attrs) => ({
          "data-crop-h": String(attrs.cropHeight ?? 100),
        }),
      },
      qnImageId: {
        default: null,
        parseHTML: (el) =>
          (el as HTMLElement).getAttribute?.("data-qn-image-id") ?? null,
        renderHTML: (attrs) => {
          const id = attrs.qnImageId as string | null | undefined;
          if (typeof id === "string" && id.length > 0) {
            return { "data-qn-image-id": id };
          }
          return {};
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-qn-image-shell] div[data-qn-image] img[src]",
        getAttrs: (el) => {
          const inner = (el as HTMLElement).closest(
            "[data-qn-image]",
          ) as HTMLElement | null;
          if (!inner) return false;
          const img = el as HTMLImageElement;
          const base = readFrameDataAttrs(inner);
          return attrsFromImgEl(img, base);
        },
      },
      {
        tag: "div[data-qn-image] img[src]",
        getAttrs: (el) => {
          const wrap = (el as HTMLElement).closest(
            "[data-qn-image]",
          ) as HTMLElement | null;
          if (!wrap) return false;
          const img = el as HTMLImageElement;
          const base = readFrameDataAttrs(wrap);
          return attrsFromImgEl(img, base);
        },
      },
      // allowBase64 off 일 때도 IDB 이미지(data: 플레이스홀더 src)는 복사·HTML 붙여넣기로 복원
      {
        tag: "img[data-qn-image-id][src]",
        getAttrs: (el) => attrsFromImgEl(el as HTMLImageElement, {}),
      },
      {
        tag: this.options.allowBase64 ? "img[src]" : 'img[src]:not([src^="data:"])',
        getAttrs: (el) => attrsFromImgEl(el as HTMLImageElement, {}),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const a = node.attrs as Record<string, unknown>;
    const shell = mergeAttributes(
      {
        "data-qn-image-shell": "",
        class: "qn-image-shell my-1 max-w-full",
        style: shellStyle(a),
      },
      {},
    );

    const frame = mergeAttributes(
      {
        "data-qn-image": "",
        class: "qn-image-frame inline-block max-w-full",
        "data-outline-w": String(a.outlineWidth ?? 0),
        "data-outline-color": String(a.outlineColor ?? "#3b82f6"),
        "data-crop-t": String(a.cropTop ?? 0),
        "data-crop-l": String(a.cropLeft ?? 0),
        "data-crop-w": String(a.cropWidth ?? 100),
        "data-crop-h": String(a.cropHeight ?? 100),
      },
      {},
    );

    const qnId = a.qnImageId as string | null | undefined;
    const imgSrc =
      typeof qnId === "string" && qnId.length > 0
        ? EDITOR_IMAGE_PLACEHOLDER_SRC
        : String(a.src ?? "");

    const imgAttrs = mergeAttributes(
      this.options.HTMLAttributes,
      HTMLAttributes,
      {
        style: imgCropStyle(a),
        src: imgSrc,
      },
    );

    return ["div", shell, ["div", frame, ["img", imgAttrs]]];
  },
});
