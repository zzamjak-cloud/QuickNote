// v4 단순화: 이미지 노드는 src/alt/width/height 만 보유.
// src 가 quicknote-image:// 스킴이면 React NodeView 가 PreSignedURL 로 비동기 해석.

import { memo, useEffect, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import Image from "@tiptap/extension-image";
import {
  ReactNodeViewRenderer,
  NodeViewWrapper,
  type NodeViewProps,
} from "@tiptap/react";
import { Plugin, NodeSelection } from "@tiptap/pm/state";
import { useImageUrl, initialImageUrl } from "../images/hooks";
import { useImageMultiSelectStore } from "../../store/imageMultiSelectStore";
import { useMediaPreviewStore } from "../../store/mediaPreviewStore";
import {
  nextCaptionAlign,
  toggleSelectedMediaCaption,
  type CaptionAlign,
} from "./mediaCaption";
import { useLazyNodeViewActivation } from "./useLazyNodeViewActivation";
import { useMeasuredElementWidth } from "../../hooks/useMeasuredElementWidth";
import { startBlockNativeDrag } from "../startBlockNativeDrag";
import { startBlockDragAutoScroll } from "../editor/blockDragAutoScroll";
import { publicAssetImageCrossOrigin } from "../publicView/publicAssetImage";

function shallowImageAttrsEqual(
  prev: NodeViewProps,
  next: NodeViewProps,
): boolean {
  const a = prev.node.attrs as Record<string, unknown>;
  const b = next.node.attrs as Record<string, unknown>;
  return (
    prev.selected === next.selected &&
    a.src === b.src &&
    a.alt === b.alt &&
    a.width === b.width &&
    a.height === b.height &&
    a.align === b.align &&
    a.caption === b.caption &&
    a.captionAlign === b.captionAlign &&
    a.outlineWidth === b.outlineWidth &&
    a.outlineColor === b.outlineColor &&
    a.borderRadius === b.borderRadius &&
    a.id === b.id
  );
}

const ALIGN_TO_FLEX: Record<string, string> = {
  left: "flex-start",
  center: "center",
  right: "flex-end",
};

/** 캡션 입력에서 Enter — 이미지 블럭 바로 다음에 빈 문단을 만들고 커서를 옮긴다. */
function insertParagraphAfterImage(props: NodeViewProps): void {
  const { editor } = props;
  const pos = props.getPos();
  if (typeof pos !== "number") return;
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  const after = pos + node.nodeSize;
  const paragraphType = editor.state.schema.nodes.paragraph;
  if (!paragraphType) return;
  editor
    .chain()
    .focus()
    .insertContentAt(after, { type: "paragraph" })
    .setTextSelection(after + 1)
    .run();
}

/**
 * 이미지 자체를 드래그해 블록 이동 — 그립 핸들과 동일한 네이티브 블록 드래그를 시작한다.
 * (그립 onGripDragStart 와 동일하게 드래그 커서 클래스·자동 스크롤을 켜고 dragend/drop 에서 정리)
 */
function startImageBlockDrag(props: NodeViewProps, e: ReactDragEvent): void {
  const { editor } = props;
  if (!editor.isEditable) return;
  const pos = typeof props.getPos === "function" ? props.getPos() : null;
  if (typeof pos !== "number") return;
  e.stopPropagation();
  document.body.classList.add("quicknote-block-dragging");
  const scroller =
    (e.currentTarget.closest(".overflow-y-auto") as HTMLElement | null) ?? null;
  const stopAutoScroll = startBlockDragAutoScroll(scroller);
  const cleanup = () => {
    document.body.classList.remove("quicknote-block-dragging");
    stopAutoScroll();
    document.removeEventListener("dragend", cleanup, true);
    document.removeEventListener("drop", cleanup, true);
  };
  document.addEventListener("dragend", cleanup, true);
  document.addEventListener("drop", cleanup, true);
  startBlockNativeDrag(editor, e.nativeEvent, pos, props.node);
}

/** 현재 선택이 이미지 NodeSelection 인지. */
function isImageNodeSelected(editor: { state: { selection: unknown } }): boolean {
  const s = editor.state.selection;
  return s instanceof NodeSelection && s.node.type.name === "image";
}

/** 이미지 노드가 선택돼 있으면 삭제한다(그 외 선택이면 false 로 기본 동작에 위임). */
function deleteSelectedImage(editor: {
  state: { selection: unknown; tr: import("@tiptap/pm/state").Transaction };
  view: { dispatch: (tr: import("@tiptap/pm/state").Transaction) => void; focus: () => void };
}): boolean {
  const selection = editor.state.selection;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== "image") {
    return false;
  }
  const from = selection.from;
  const tr = editor.state.tr.delete(from, from + selection.node.nodeSize);
  editor.view.dispatch(tr);
  editor.view.focus();
  return true;
}

const ImageView = memo(function ImageView(props: NodeViewProps) {
  const attrs = props.node.attrs as {
    src?: string | null;
    alt?: string | null;
    width?: number | string | null;
    height?: number | string | null;
    align?: string | null;
    caption?: string | null;
    captionAlign?: CaptionAlign | null;
    outlineWidth?: number | null;
    outlineColor?: string | null;
    borderRadius?: number | null;
  };
  const align = attrs.align ?? "left";
  const hasCaption = typeof attrs.caption === "string";
  const captionAlign = attrs.captionAlign ?? "left";
  // width attr 미지정(원본 크기) 이미지는 실측 표시 폭을 캡션 기준폭으로 쓴다 —
  // 100% 로 두면 중앙/우측 정렬이 이미지가 아닌 블록 폭 기준으로 어긋난다.
  const { ref: imageMeasureRef, width: measuredImageWidth } = useMeasuredElementWidth();
  const captionBasisWidth = attrs.width ?? measuredImageWidth;
  const intrinsicWidth = Number(attrs.width);
  const intrinsicHeight = Number(attrs.height);
  const hasIntrinsicSize =
    Number.isFinite(intrinsicWidth) &&
    intrinsicWidth > 0 &&
    Number.isFinite(intrinsicHeight) &&
    intrinsicHeight > 0;
  // 캡션 기준폭 = 저장된 이미지 폭이되, 컬럼 등 좁은 컨테이너에서 이미지가 100% 로 축소되면
  // 캡션도 표시 폭(100%)을 넘지 않게 min() 으로 캡한다 — 넘치면 중앙/우측 정렬 기준이 어긋난다.
  const captionMinWidth = captionBasisWidth ? `min(${captionBasisWidth}px, 100%)` : "100%";
  // 아웃라인·모서리 라운드 — 툴바에서 지정. outline 은 레이아웃에 영향 없이 rect 를 감싸며 border-radius 를 따른다.
  const outlineWidth = typeof attrs.outlineWidth === "number" ? attrs.outlineWidth : 0;
  const outlineColor = attrs.outlineColor ?? "#4b5563";
  const borderRadius = typeof attrs.borderRadius === "number" ? attrs.borderRadius : 0;
  // 다중 선택(Ctrl/Cmd+클릭) 표시 — 스토어 구독. 위치가 세트에 있으면 인디고 링.
  const selfPos = typeof props.getPos === "function" ? props.getPos() : null;
  const multiSelected = useImageMultiSelectStore(
    (s) => selfPos != null && s.positions.includes(selfPos),
  );
  const [previewOpen, setPreviewOpen] = useState(false);

  // 미리보기 오버레이 — ESC 로 닫기 + 열려 있는 동안 부유 툴바 숨김(전역 신호).
  useEffect(() => {
    if (!previewOpen) return;
    const setPreview = useMediaPreviewStore.getState().setOpen;
    setPreview(true);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setPreviewOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      setPreview(false);
    };
  }, [previewOpen]);
  // 이미지 URL 이 이미 캐시돼 있으면(예: 협업 바인딩으로 에디터가 리마운트된 경우) 지연 활성화를
  // 건너뛰고 즉시 active 로 시작한다 — placeholder pulse 플래시(깜빡임) 제거. 미캐시는 기존대로 lazy.
  const hasCachedUrl = initialImageUrl(attrs.src ?? null) != null;
  const activation = useLazyNodeViewActivation<HTMLDivElement>({
    selected: props.selected,
    forceActive: previewOpen,
    initialActive: hasCachedUrl,
  });
  const { url, error, reportLoadError } = useImageUrl(
    activation.active ? attrs.src ?? null : null,
  );

  return (
    <NodeViewWrapper
      as="div"
      ref={activation.ref}
      // 블록 컨테이너 내 가로 정렬 — flex + justify 로 좌/중앙/우 배치.
      className="qn-image-shell flex max-w-full flex-col leading-none"
      style={{ alignItems: ALIGN_TO_FLEX[align] ?? "flex-start" }}
      draggable={false}
      onPointerDown={activation.activate}
      onFocusCapture={activation.activate}
    >
      {error ? (
        <span className="text-xs text-red-500">[image error]</span>
      ) : url ? (
        <img
          crossOrigin={publicAssetImageCrossOrigin(url)}
          src={url}
          ref={imageMeasureRef}
          alt={attrs.alt ?? ""}
          loading="lazy"
          width={attrs.width ?? undefined}
          height={attrs.height ?? undefined}
          className="block h-auto"
          style={{
            ...(attrs.width
              ? { width: `${attrs.width}px`, maxWidth: "100%" }
              : { maxWidth: "100%" }),
            ...(outlineWidth > 0
              ? { outline: `${outlineWidth}px solid ${outlineColor}`, outlineOffset: 0 }
              : {}),
            ...(borderRadius > 0 ? { borderRadius: `${borderRadius}px` } : {}),
            // 다중 선택 링 — 아웃라인(outline)과 겹치지 않게 box-shadow 로 표시.
            ...(multiSelected
              ? { boxShadow: "0 0 0 3px rgb(99 102 241), 0 0 0 5px rgb(255 255 255)" }
              : {}),
          }}
          // 이미지 자체를 드래그해 블록 이동(그립 핸들 외 추가 경로). 편집 가능할 때만.
          draggable={props.editor.isEditable}
          onDragStart={(e) => startImageBlockDrag(props, e)}
          // 만료된 PreSignedURL·손상 blob 캐시 자가 치유 — 캐시 폐기 후 재해석.
          onError={reportLoadError}
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setPreviewOpen(true);
          }}
        />
      ) : (
        <span
          className="inline-block max-w-full bg-neutral-100 dark:bg-neutral-800 animate-pulse align-middle"
          style={
            hasIntrinsicSize
              ? {
                  width: `${intrinsicWidth}px`,
                  aspectRatio: `${intrinsicWidth} / ${intrinsicHeight}`,
                }
              : { width: 48, height: 48 }
          }
        />
      )}
      {hasCaption ? (
        <div
          className="mt-1 flex items-center gap-1"
          // 정렬 버튼 + 캡션 텍스트가 하나의 단위로 좌/중앙/우로 함께 이동.
          // 캡션 박스 폭 = 이미지 표시 폭(min())에 고정한다. max-content 로 두면 텍스트가
          // 이미지보다 넓을 때(컬럼 등 좁은 컨테이너) 박스가 내용에 꼭 맞게 커져 justify-content
          // 슬랙이 사라져 중앙/우측 정렬이 이동하지 않는다. 고정 폭이면 짧은 텍스트는 박스 안에서
          // 정렬되고, 긴 텍스트는 이미지 가장자리(좌/중앙/우) 기준으로 넘쳐 정렬된다.
          style={{
            minWidth: captionMinWidth,
            width: captionMinWidth,
            maxWidth: "100%",
            justifyContent: ALIGN_TO_FLEX[captionAlign] ?? "flex-start",
          }}
        >
          <button
            type="button"
            className="h-3 w-3 shrink-0 rounded-[2px] bg-zinc-300 hover:bg-zinc-400 dark:bg-zinc-600 dark:hover:bg-zinc-500"
            title="캡션 정렬"
            aria-label="캡션 정렬"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              props.updateAttributes({ captionAlign: nextCaptionAlign(captionAlign) });
            }}
          />
          {/* input 폭을 실제 텍스트 폭에 맞춘다(미러 span). size 속성은 CJK/비례폭에서
              부정확해 끝부분이 잘리므로 사용하지 않는다. 미러 span 이 폭을 결정하고 input 은
              absolute 로 그 위를 채운다(shrink-0 로 캡션 박스보다 좁으면 축소되지 않고 넘쳐
              이미지 가장자리 기준으로 정렬된다). 우측 정렬 시 후행 공백·우측 패딩 제거로 밀착. */}
          <span className="relative inline-block shrink-0">
            <span
              aria-hidden
              className="invisible whitespace-pre text-xs"
              style={{
                paddingLeft: 2,
                paddingRight: captionAlign === "right" ? 0 : 2,
              }}
            >
              {(attrs.caption ?? "") || "캡션 입력…"}
              {captionAlign === "right" ? "" : " "}
            </span>
            <input
              data-qn-caption-input="true"
              type="text"
              value={attrs.caption ?? ""}
              placeholder="캡션 입력…"
              // textAlign 은 주지 않는다 — 셀이 텍스트보다 넓을 때 우측 정렬이 텍스트를
              // 셀 오른쪽으로 밀어 아이콘과 텍스트 사이가 벌어진다. 정렬 위치는 바깥 flex
              // justify-end 가, 우측 끝 밀착은 후행 공백·우측 패딩 제거가 담당한다.
              style={{
                paddingLeft: 2,
                paddingRight: captionAlign === "right" ? 0 : 2,
              }}
              // 캡션은 노드 attrs.caption 에 저장 (plain text). 본문 doc 흐름과 분리.
              onChange={(e) => props.updateAttributes({ caption: e.target.value })}
              onBlur={(e) => {
                if (e.currentTarget.value.trim() === "") props.updateAttributes({ caption: null });
              }}
              onKeyDown={(e) => {
                // Enter: 캡션 편집 종료 후 이미지 블럭 다음 라인에 빈 문단을 만들고 커서 이동.
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  e.currentTarget.blur();
                  insertParagraphAfterImage(props);
                  return;
                }
                e.stopPropagation();
              }}
              className="absolute inset-0 w-full border-none bg-transparent text-xs text-zinc-500 outline-none placeholder:text-zinc-400 dark:text-zinc-400"
            />
          </span>
        </div>
      ) : null}
      {previewOpen && url ? (
        <div
          className="fixed inset-0 z-[780] flex items-center justify-center bg-black/75 p-6"
          role="dialog"
          aria-modal="true"
          onClick={() => setPreviewOpen(false)}
        >
          <img
            crossOrigin={publicAssetImageCrossOrigin(url)}
            src={url}
            alt={attrs.alt ?? ""}
            className="block h-auto w-auto max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </NodeViewWrapper>
  );
}, shallowImageAttrsEqual);

// width/height 를 Tiptap 노드 attrs 로 명시 등록.
// 누락 시 ImageResizeOverlay 의 updateAttributes 가 schema 에 없는 attr 로 간주되어 무시되고,
// 렌더 시 img 의 width/height prop 도 항상 undefined → max-w-full 로 column 전체 너비 박스로 표시됨.
export const ImageBlock = Image.extend({
  name: "image",

  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
        parseHTML: (el) => el.getAttribute("src") || el.getAttribute("data-qn-src"),
        renderHTML: (attrs) => {
          const raw = typeof attrs.src === "string" ? attrs.src : "";
          // 브라우저가 quicknote-* 스킴을 직접 로드하지 않도록 차단.
          if (raw.startsWith("quicknote-image://") || raw.startsWith("quicknote-file://")) {
            return { src: "", "data-qn-src": raw };
          }
          const crossOrigin = publicAssetImageCrossOrigin(raw);
          // 공개 asset URL 은 React NodeView 가 crossOrigin 을 먼저 적용한 뒤 lazy 로 로드한다.
          // 정적 DOM 단계에서 src 를 두면 본문 이미지가 한꺼번에 no-cors 로 요청돼 ORB/429가 날 수 있다.
          if (crossOrigin) {
            return { crossorigin: crossOrigin, src: "", "data-qn-src": raw };
          }
          return raw
            ? { src: raw }
            : {};
        },
      },
      width: {
        default: null,
        parseHTML: (el) => {
          const v = el.getAttribute("width");
          if (!v) return null;
          const n = parseInt(v, 10);
          return Number.isFinite(n) && n > 0 ? n : null;
        },
        renderHTML: (attrs) =>
          attrs.width ? { width: String(attrs.width) } : {},
      },
      height: {
        default: null,
        parseHTML: (el) => {
          const v = el.getAttribute("height");
          if (!v) return null;
          const n = parseInt(v, 10);
          return Number.isFinite(n) && n > 0 ? n : null;
        },
        renderHTML: (attrs) =>
          attrs.height ? { height: String(attrs.height) } : {},
      },
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-id"),
        renderHTML: (attrs) =>
          attrs.id ? { "data-id": String(attrs.id) } : {},
      },
      align: {
        default: "left",
        parseHTML: (el) => el.getAttribute("data-align") ?? "left",
        renderHTML: (attrs) =>
          attrs.align && attrs.align !== "left" ? { "data-align": String(attrs.align) } : {},
      },
      caption: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-caption"),
        renderHTML: (attrs) =>
          typeof attrs.caption === "string" ? { "data-caption": String(attrs.caption) } : {},
      },
      captionAlign: {
        default: "left",
        parseHTML: (el) => el.getAttribute("data-caption-align") ?? "left",
        renderHTML: (attrs) =>
          attrs.captionAlign && attrs.captionAlign !== "left"
            ? { "data-caption-align": String(attrs.captionAlign) }
            : {},
      },
      outlineWidth: {
        default: 0,
        parseHTML: (el) => {
          const n = parseInt(el.getAttribute("data-outline-width") || "", 10);
          return Number.isFinite(n) && n > 0 ? n : 0;
        },
        renderHTML: (attrs) =>
          attrs.outlineWidth ? { "data-outline-width": String(attrs.outlineWidth) } : {},
      },
      outlineColor: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-outline-color"),
        renderHTML: (attrs) =>
          attrs.outlineColor ? { "data-outline-color": String(attrs.outlineColor) } : {},
      },
      borderRadius: {
        default: 0,
        parseHTML: (el) => {
          const n = parseInt(el.getAttribute("data-border-radius") || "", 10);
          return Number.isFinite(n) && n > 0 ? n : 0;
        },
        renderHTML: (attrs) =>
          attrs.borderRadius ? { "data-border-radius": String(attrs.borderRadius) } : {},
      },
    };
  },

  addKeyboardShortcuts() {
    // 캡션 토글 — Ctrl/Cmd + Alt + M
    return {
      "Mod-Alt-m": ({ editor }) => toggleSelectedMediaCaption(editor, ["image"]),
      "Mod-Alt-M": ({ editor }) => toggleSelectedMediaCaption(editor, ["image"]),
      "Ctrl-Alt-m": ({ editor }) => toggleSelectedMediaCaption(editor, ["image"]),
      "Ctrl-Alt-M": ({ editor }) => toggleSelectedMediaCaption(editor, ["image"]),
      // 이미지 선택 상태에서 Enter — 이미지 바로 다음에 빈 문단을 만들고 커서를 옮긴다.
      Enter: ({ editor }) => {
        const { selection } = editor.state;
        if (!(selection instanceof NodeSelection) || selection.node.type.name !== "image") {
          return false;
        }
        const after = selection.from + selection.node.nodeSize;
        return editor
          .chain()
          .insertContentAt(after, { type: "paragraph" })
          .setTextSelection(after + 1)
          .focus()
          .run();
      },
      // 이미지 선택 상태에서 Backspace(Mac)/Delete(Windows) — 이미지 삭제.
      // 클릭 선택(NodeSelection) 후 뷰 포커스가 없을 수 있어 기본 삭제가 안 먹는 경우를 명시 처리.
      Backspace: ({ editor }) => deleteSelectedImage(editor),
      Delete: ({ editor }) => deleteSelectedImage(editor),
      // 이미지 선택 상태에서 Space — 기본 동작은 선택 노드를 공백으로 대체(=이미지 삭제)라 소비만 한다.
      Space: ({ editor }) => isImageNodeSelected(editor),
      " ": ({ editor }) => isImageNodeSelected(editor),
    };
  },

  addNodeView() {
    // 정렬·캡션 지원을 위해 블록 컨테이너(div) 로 렌더. selectednode 시각은 CSS 에서 이미지에만 적용.
    return ReactNodeViewRenderer(ImageView, { as: "div" });
  },

  addProseMirrorPlugins() {
    // 미디어(이미지·GIF/동영상 fileBlock·유튜브) 단일 클릭 선택 유지.
    // mousedown 에서 만들어진 NodeSelection 을 직후 click 기본 처리가 캐럿(TextSelection)으로
    // 접어버려 "한 번 클릭하면 툴바가 떴다가 선택이 풀리는(=2번 클릭)" 현상이 생긴다.
    // handleClickOn 에서 NodeSelection 을 확정하고 true 를 반환해 기본 붕괴만 막는다.
    // preventDefault 는 하지 않으므로 동영상 네이티브 컨트롤(재생 등)은 그대로 동작한다.
    const MEDIA_TYPES = new Set(["image", "fileBlock", "youtube"]);
    const parentPlugins = this.parent?.() ?? [];
    return [
      ...parentPlugins,
      new Plugin({
        props: {
          // 이미지 선택 상태에서 문자 입력 시 기본 동작이 선택 노드를 그 문자로 대체(=이미지 삭제).
          // 스페이스 등 어떤 입력도 이미지를 지우지 않도록 차단한다(Space 키맵과 이중 안전장치).
          handleTextInput: (view) => {
            const sel = view.state.selection;
            return sel instanceof NodeSelection && sel.node.type.name === "image";
          },
          handleClickOn: (view, _pos, node, nodePos, event, direct) => {
            if (!direct) return false;
            if (!MEDIA_TYPES.has(node.type.name)) return false;
            const target = event.target as HTMLElement | null;
            // 캡션 입력·폼/링크 요소 클릭은 그대로 둔다(포커스 유지·이동).
            if (
              target?.closest(
                "input, textarea, select, button, a[href], [data-qn-caption-input]",
              )
            ) {
              return false;
            }
            const multiStore = useImageMultiSelectStore.getState();
            // Ctrl/Cmd + 클릭: 이미지 다중 선택(아웃라인·라운드 일괄 적용용). 이미지 노드에만.
            if ((event.metaKey || event.ctrlKey) && node.type.name === "image") {
              const sel = view.state.selection;
              // 세트가 비어 있으면 현재 선택 이미지를 기준으로 포함.
              const base =
                multiStore.positions.length > 0
                  ? multiStore.positions
                  : sel instanceof NodeSelection && sel.node.type.name === "image"
                    ? [sel.from]
                    : [];
              const next = new Set(base);
              if (next.has(nodePos)) next.delete(nodePos);
              else next.add(nodePos);
              multiStore.setPositions([...next]);
              // 툴바 앵커 유지를 위해 PM 선택은 마지막 클릭 이미지로.
              view.dispatch(
                view.state.tr.setSelection(NodeSelection.create(view.state.doc, nodePos)),
              );
              return true;
            }
            // 일반 클릭 — 다중 선택 해제 후 단일 선택.
            multiStore.clear();
            const sel = view.state.selection;
            if (sel instanceof NodeSelection && sel.from === nodePos) {
              // 이미 이 노드가 선택됨 — 기본 click 붕괴만 차단.
              return true;
            }
            view.dispatch(
              view.state.tr.setSelection(NodeSelection.create(view.state.doc, nodePos)),
            );
            return true;
          },
        },
      }),
    ];
  },
});
