import { Node as TiptapNode, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { ExternalLink, Globe2 } from "lucide-react";
import { useEffect } from "react";
import {
  fallbackBookmarkMetadata,
  fetchBookmarkMetadata,
} from "../bookmarks/metadata";
import { useLazyNodeViewActivation } from "./useLazyNodeViewActivation";

type BookmarkBlockAttrs = {
  href: string;
  title: string;
  description: string;
  siteName: string;
  imageUrl: string;
  status: "loading" | "ready";
};

function openBookmarkUrl(href: string) {
  if (!href) return;
  const url = href.startsWith("http") ? href : `https://${href}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

function BookmarkBlockView({ node, updateAttributes, selected }: NodeViewProps) {
  const attrs = node.attrs as BookmarkBlockAttrs;
  const activation = useLazyNodeViewActivation<HTMLDivElement>({
    selected,
  });
  const fallback = fallbackBookmarkMetadata(attrs.href);
  const title = attrs.title || fallback.title;
  const description = attrs.description || fallback.description;
  const siteName = attrs.siteName || fallback.siteName;
  const metadataLoading = attrs.status === "loading" && activation.active;

  useEffect(() => {
    if (attrs.status !== "loading" || !attrs.href || !activation.active) return;
    const controller = new AbortController();
    void fetchBookmarkMetadata(attrs.href, controller.signal).then((meta) => {
      if (controller.signal.aborted) return;
      // 기존 attrs 가 비어 있는 필드만 fetched 메타로 보강 — Notion 임포트에서 추출한 메타를 덮지 않음.
      updateAttributes({
        title: attrs.title || meta.title,
        description: attrs.description || meta.description,
        siteName: attrs.siteName || meta.siteName,
        imageUrl: attrs.imageUrl || meta.imageUrl,
        status: "ready",
      });
    });
    return () => controller.abort();
  }, [activation.active, attrs.href, attrs.status, attrs.title, attrs.description, attrs.siteName, attrs.imageUrl, updateAttributes]);

  return (
    <NodeViewWrapper
      as="div"
      ref={activation.ref}
      data-bookmark-block=""
      className="qn-bookmark-shell my-1.5"
      onPointerDown={activation.activate}
      onFocusCapture={activation.activate}
    >
      <button
        type="button"
        contentEditable={false}
        onClick={() => openBookmarkUrl(attrs.href)}
        className={[
          "group flex w-full cursor-pointer overflow-hidden rounded-lg border bg-white text-left shadow-sm transition-colors",
          "hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/70",
          selected ? "ring-2 ring-blue-400" : "border-zinc-200",
        ].join(" ")}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1 px-3 py-2.5">
          <span className="line-clamp-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {metadataLoading ? "북마크를 불러오는 중..." : title}
          </span>
          <span className="line-clamp-2 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
            {description}
          </span>
          <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
            <Globe2 size={12} className="shrink-0" />
            <span className="truncate">{siteName}</span>
            <ExternalLink size={11} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
          </span>
        </span>
        {attrs.imageUrl && activation.active ? (
          <span className="hidden w-32 shrink-0 border-l border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 sm:block">
            <img
              src={attrs.imageUrl}
              alt=""
              loading="lazy"
              className="h-full min-h-[104px] w-full object-cover"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          </span>
        ) : null}
      </button>
    </NodeViewWrapper>
  );
}

export const BookmarkBlock = TiptapNode.create({
  name: "bookmarkBlock",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      href: { default: "" },
      title: { default: "" },
      description: { default: "" },
      siteName: { default: "" },
      imageUrl: { default: "" },
      status: { default: "ready" },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-bookmark-block]" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-bookmark-block": "",
        "data-href": node.attrs.href,
        "data-title": node.attrs.title,
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(BookmarkBlockView);
  },
});
