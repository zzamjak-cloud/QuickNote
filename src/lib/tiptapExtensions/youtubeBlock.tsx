// YouTube 블록 — 기본 확장은 renderHTML 로 iframe 만 갱신되어 탭/리렌더 시 동영상이 깜빡일 수 있음.
// React NodeView 로 분리해 동일 속성에서는 iframe 을 재사용하고, 선택 상태도 메모 비교로 반영한다.

import { memo, useMemo } from "react";
import Youtube from "@tiptap/extension-youtube";
import {
  getEmbedUrlFromYoutubeUrl,
  type GetEmbedUrlOptions,
  type YoutubeOptions,
} from "@tiptap/extension-youtube";
import {
  ReactNodeViewRenderer,
  NodeViewWrapper,
  type NodeViewProps,
} from "@tiptap/react";
import { mergeAttributes } from "@tiptap/core";

function embedInputFromAttrs(
  attrs: { src?: unknown; start?: unknown },
  opts: YoutubeOptions,
): GetEmbedUrlOptions | null {
  const url = attrs.src;
  if (url == null || url === "") return null;
  const startNum =
    typeof attrs.start === "number" && !Number.isNaN(attrs.start)
      ? attrs.start
      : Number(attrs.start) || 0;
  return {
    url: String(url),
    allowFullscreen: opts.allowFullscreen,
    autoplay: opts.autoplay,
    ccLanguage: opts.ccLanguage,
    ccLoadPolicy: opts.ccLoadPolicy,
    controls: opts.controls,
    disableKBcontrols: opts.disableKBcontrols,
    enableIFrameApi: opts.enableIFrameApi,
    endTime: opts.endTime,
    interfaceLanguage: opts.interfaceLanguage,
    ivLoadPolicy: opts.ivLoadPolicy,
    loop: opts.loop,
    modestBranding: opts.modestBranding,
    nocookie: opts.nocookie,
    origin: opts.origin,
    playlist: opts.playlist,
    progressBarColor: opts.progressBarColor,
    startAt: startNum,
    rel: opts.rel,
  };
}

function youtubeViewMemoEqual(prev: NodeViewProps, next: NodeViewProps): boolean {
  if (prev.selected !== next.selected) return false;
  const a = prev.node.attrs;
  const b = next.node.attrs;
  return (
    a.src === b.src &&
    a.start === b.start &&
    a.width === b.width &&
    a.height === b.height
  );
}

const YoutubeEmbedView = memo(function YoutubeEmbedView(props: NodeViewProps) {
  const opts = props.extension.options as YoutubeOptions;
  const { src, start, width, height } = props.node.attrs as {
    src?: string | null;
    start?: number;
    width?: number;
    height?: number;
  };

  const embedUrl = useMemo(() => {
    const input = embedInputFromAttrs({ src, start }, opts);
    if (!input) return null;
    return getEmbedUrlFromYoutubeUrl(input);
  }, [src, start, opts]);

  const w = typeof width === "number" && width > 0 ? width : opts.width;
  const h = typeof height === "number" && height > 0 ? height : opts.height;

  return (
    <NodeViewWrapper
      as="div"
      {...mergeAttributes(
        {
          "data-youtube-video": "",
          class: "qn-youtube-shell my-1 max-w-full leading-none",
        },
        opts.HTMLAttributes ?? {},
      )}
    >
      {embedUrl ? (
        <iframe
          src={embedUrl}
          width={w}
          height={h}
          title="YouTube video"
          allowFullScreen={opts.allowFullscreen !== false}
          allow={
            opts.autoplay
              ? "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              : "accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          }
          className="max-w-full rounded-lg border border-zinc-200 dark:border-zinc-700"
        />
      ) : (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-3 py-8 text-center text-xs text-zinc-500 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          유효한 YouTube 주소가 아닙니다.
        </div>
      )}
    </NodeViewWrapper>
  );
}, youtubeViewMemoEqual);

/** 기본 Youtube 노드 로직 유지 + React NodeView 렌더 */
export const YoutubeBlock = Youtube.extend({
  addNodeView() {
    return ReactNodeViewRenderer(YoutubeEmbedView, { as: "div" });
  },
});
