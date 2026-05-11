import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { usePageStore } from "../../store/pageStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useUiStore } from "../../store/uiStore";

function PageLinkView({ node }: NodeViewProps) {
  const id = node.attrs.id as string;
  const label = node.attrs.label as string;
  const title = usePageStore((s) => s.pages[id]?.title ?? label ?? "페이지");
  const setActivePage = usePageStore((s) => s.setActivePage);
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);
  const peekNavigate = useUiStore((s) => s.peekNavigate);
  const peekPageId = useUiStore((s) => s.peekPageId);

  return (
    <NodeViewWrapper as="span" contentEditable={false}>
      <button
        type="button"
        onClick={(e) => {
          const isInPeek = !!(e.currentTarget.closest(".qn-peek-editor"));
          if (isInPeek && peekPageId) {
            peekNavigate(id);
          } else {
            setActivePage(id);
            setCurrentTabPage(id);
          }
        }}
        className="inline-flex cursor-pointer items-center rounded border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
      >
        {title}
      </button>
    </NodeViewWrapper>
  );
}

export const PageLink = Node.create({
  name: "pageLink",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      id: { default: null },
      label: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-page-link]" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-page-link": "",
        "data-id": node.attrs.id as string,
      }),
      (node.attrs.label as string) ?? "",
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PageLinkView);
  },
});
