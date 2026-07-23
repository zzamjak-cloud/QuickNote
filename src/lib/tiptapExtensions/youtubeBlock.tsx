// YouTube 블록 — 기본 확장은 renderHTML 로 iframe 만 갱신되어 탭/리렌더 시 동영상이 깜빡일 수 있음.
// React NodeView 로 분리해 동일 속성에서는 iframe 을 재사용하고, 선택 상태도 메모 비교로 반영한다.

import { memo, useEffect, useMemo } from "react";
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
import { useLazyNodeViewActivation } from "./useLazyNodeViewActivation";
import { isTauri } from "../auth/config";
import { toDesktopYoutubeEmbedUrl } from "./desktopYoutubeEmbed";
import {
  YOUTUBE_IFRAME_ALLOW,
  YOUTUBE_IFRAME_ALLOW_WITH_AUTOPLAY,
} from "./youtubePermissionsPolicy";

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

// 이번 세션에 한 번이라도 iframe 이 로드된(활성화된) 비디오 src 집합.
// 에디터 리마운트(협업 바인딩)·페이지 재진입 시 이미 본 비디오는 즉시 active 로 시작해
// placeholder→iframe 재로딩 깜빡임을 없앤다. 한 번도 안 본/오프스크린 비디오는 기존대로 lazy.
const activatedVideoSrcs = new Set<string>();

const YoutubeEmbedView = memo(function YoutubeEmbedView(props: NodeViewProps) {
  const opts = props.extension.options as YoutubeOptions;
  const { src, start, width, height } = props.node.attrs as {
    src?: string | null;
    start?: number;
    width?: number;
    height?: number;
  };
  const srcKey = typeof src === "string" && src ? src : null;
  const activation = useLazyNodeViewActivation<HTMLDivElement>({
    selected: props.selected,
    initialActive: srcKey ? activatedVideoSrcs.has(srcKey) : false,
    preserveScrollOnActivate: true,
  });
  // 활성화된 src 를 기록 — 다음 마운트(재진입)부터 즉시 active.
  useEffect(() => {
    if (activation.active && srcKey) activatedVideoSrcs.add(srcKey);
  }, [activation.active, srcKey]);

  const embedUrl = useMemo(() => {
    if (!activation.active) return null;
    const input = embedInputFromAttrs({ src, start }, opts);
    if (!input) return null;
    const direct = getEmbedUrlFromYoutubeUrl(input);
    if (!direct) return null;
    // Tauri 문서(tauri://)는 Referer 가 전송되지 않아 유튜브가 오류 153 으로 거부한다.
    // https 래퍼 페이지를 경유해 Referer 를 확보한다. (desktopYoutubeEmbed.ts 참고)
    return isTauri ? toDesktopYoutubeEmbedUrl(direct) : direct;
  }, [activation.active, src, start, opts]);

  const w = typeof width === "number" && width > 0 ? width : opts.width;
  const h = typeof height === "number" && height > 0 ? height : opts.height;
  const mergedAttrs = mergeAttributes(
    {
      "data-youtube-video": "",
      class: "qn-youtube-shell my-1 max-w-full leading-none",
    },
    opts.HTMLAttributes ?? {},
  ) as Record<string, unknown>;
  const { class: classAttr, ...restAttrs } = mergedAttrs;
  const className =
    typeof classAttr === "string" && classAttr.length > 0
      ? classAttr
      : "qn-youtube-shell my-1 max-w-full leading-none";

  return (
    <NodeViewWrapper
      as="div"
      ref={activation.ref}
      className={className}
      {...restAttrs}
      onPointerDown={activation.activate}
      onFocusCapture={activation.activate}
    >
      {embedUrl ? (
        <iframe
          src={embedUrl}
          width={w}
          height={h}
          title="YouTube video"
          allowFullScreen={opts.allowFullscreen !== false}
          // COEP credentialless 환경에서 cross-origin iframe이 차단되지 않도록
          {...({ credentialless: "" } as object)}
          allow={opts.autoplay ? YOUTUBE_IFRAME_ALLOW_WITH_AUTOPLAY : YOUTUBE_IFRAME_ALLOW}
          className="max-w-full rounded-lg border border-zinc-200 dark:border-zinc-700"
          onLoad={activation.preserveScroll}
        />
      ) : !activation.active ? (
        <div
          className="flex items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-xs text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-500"
          style={{ width: w, height: h, maxWidth: "100%" }}
        >
          YouTube
        </div>
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
