import { Node as TiptapNode, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { useState, useRef, useEffect } from "react";
import { Database, ExternalLink, Pencil, Link } from "lucide-react";
import { usePageStore } from "../../store/pageStore";
import { useSettingsStore } from "../../store/settingsStore";
import { parseQuickNoteLink } from "../navigation/quicknoteLinks";
import { useNavigationHistoryStore } from "../../store/navigationHistoryStore";
import { scrollToBlockPosition } from "../editor/editorNavigationBridge";

type ButtonBlockAttrs = {
  label: string;
  href: string;
  databaseId?: string;
};

function ButtonBlockView({ node, updateAttributes, selected }: NodeViewProps) {
  const attrs = node.attrs as ButtonBlockAttrs;
  const [editing, setEditing] = useState(false);
  const [draftLabel, setDraftLabel] = useState(attrs.label);
  const [draftHref, setDraftHref] = useState(attrs.href);
  const popoverRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);
  const setActivePage = usePageStore((s) => s.setActivePage);
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);

  useEffect(() => {
    if (!editing) return;
    labelRef.current?.focus();
    const close = (e: MouseEvent) => {
      if (!popoverRef.current?.contains(e.target as globalThis.Node)) {
        setEditing(false);
        setDraftLabel(attrs.label);
        setDraftHref(attrs.href);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [editing, attrs.label, attrs.href]);

  const handleClick = () => {
    if (!attrs.href) return;
    const internal = parseQuickNoteLink(attrs.href);
    if (internal) {
      // 이전 페이지를 히스토리 스택에 push
      const currentPageId = usePageStore.getState().activePageId;
      if (currentPageId) {
        useNavigationHistoryStore.getState().pushBack(currentPageId);
      }
      setActivePage(internal.pageId);
      setCurrentTabPage(internal.pageId);
      window.setTimeout(() => {
        if (internal.block != null) scrollToBlockPosition(internal.block);
        if (internal.tab) {
          document
            .querySelector<HTMLButtonElement>(
              `[data-qn-tab-id="${CSS.escape(internal.tab)}"]`,
            )
            ?.click();
        }
      }, 80);
      return;
    }
    const href = attrs.href.startsWith("http") ? attrs.href : `https://${attrs.href}`;
    window.open(href, "_blank", "noopener,noreferrer");
  };

  const handleSave = () => {
    updateAttributes({ label: draftLabel, href: draftHref });
    setEditing(false);
  };
  const looksLikeDatabaseButton = /\bDB\b|데이터베이스/.test(attrs.label);
  const LeadingIcon = looksLikeDatabaseButton ? Database : Link;

  return (
    <NodeViewWrapper as="span" className="inline-block my-1">
      <span className="group relative inline-flex items-center">
        <button
          type="button"
          onClick={handleClick}
          className={[
            "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
            looksLikeDatabaseButton
              ? "border-blue-500 bg-blue-500 text-white hover:border-blue-600 hover:bg-blue-600 dark:border-blue-500 dark:bg-blue-500 dark:text-white dark:hover:bg-blue-600"
              : "border-zinc-300 bg-zinc-50 text-zinc-700 hover:border-zinc-400 hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:border-zinc-500 dark:hover:bg-zinc-700",
            selected ? "ring-2 ring-blue-400" : "",
          ].join(" ")}
        >
          <LeadingIcon
            size={13}
            className={[
              "shrink-0",
              looksLikeDatabaseButton
                ? "text-white"
                : "text-zinc-400 dark:text-zinc-500",
            ].join(" ")}
          />
          <span>{attrs.label || "버튼"}</span>
          {attrs.href && (
            <ExternalLink
              size={11}
              className={[
                "shrink-0",
                looksLikeDatabaseButton
                  ? "text-blue-100"
                  : "text-zinc-400 dark:text-zinc-500",
              ].join(" ")}
            />
          )}
        </button>
        {/* 호버 시 편집 아이콘 */}
        <button
          type="button"
          contentEditable={false}
          onClick={(e) => {
            e.stopPropagation();
            setDraftLabel(attrs.label);
            setDraftHref(attrs.href);
            setEditing(true);
          }}
          className="ml-1 rounded p-0.5 text-zinc-400 opacity-0 transition-opacity hover:bg-zinc-100 hover:text-zinc-700 group-hover:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          title="편집"
        >
          <Pencil size={12} />
        </button>

        {/* 편집 팝오버 */}
        {editing && (
          <div
            ref={popoverRef}
            contentEditable={false}
            className="absolute left-0 top-full z-50 mt-1 w-64 rounded-xl border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
          >
            <div className="mb-2 text-xs font-medium text-zinc-700 dark:text-zinc-300">버튼 편집</div>
            <label className="mb-1 block text-[11px] text-zinc-500">이름</label>
            <input
              ref={labelRef}
              type="text"
              value={draftLabel}
              onChange={(e) => setDraftLabel(e.target.value)}
              placeholder="버튼 이름"
              className="mb-2 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            />
            <label className="mb-1 block text-[11px] text-zinc-500">링크 (URL)</label>
            <input
              type="text"
              value={draftHref}
              onChange={(e) => setDraftHref(e.target.value)}
              placeholder="https://..."
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") {
                  setEditing(false);
                  setDraftLabel(attrs.label);
                  setDraftHref(attrs.href);
                }
              }}
              className="mb-3 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            />
            <div className="flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setDraftLabel(attrs.label);
                  setDraftHref(attrs.href);
                }}
                className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="rounded-md bg-blue-500 px-2 py-1 text-xs text-white hover:bg-blue-600"
              >
                저장
              </button>
            </div>
          </div>
        )}
      </span>
    </NodeViewWrapper>
  );
}

export const ButtonBlock = TiptapNode.create({
  name: "buttonBlock",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      label: { default: "버튼" },
      href: { default: "" },
      databaseId: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-button-block]" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-button-block": "",
        "data-label": node.attrs.label,
        "data-href": node.attrs.href,
      }),
      node.attrs.label || "버튼",
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ButtonBlockView);
  },

  addCommands() {
    return {
      insertButtonBlock:
        (label = "버튼", href = "") =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { label, href },
          }),
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    buttonBlock: {
      insertButtonBlock: (label?: string, href?: string) => ReturnType;
    };
  }
}
