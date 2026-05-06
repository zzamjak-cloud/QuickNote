import { ReactRenderer } from "@tiptap/react";
import Mention from "@tiptap/extension-mention";
import { mergeAttributes } from "@tiptap/core";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { searchMembersForMentionApi } from "../sync/memberApi";
import { useMemberStore } from "../../store/memberStore";

type Item = { id: string; name: string; jobRole: string };

type SuggestionProps = {
  items: Item[];
  command: (item: { id: string; label: string }) => void;
  clientRect?: (() => DOMRect | null) | null;
};

type RefHandle = {
  onKeyDown: (e: KeyboardEvent) => boolean;
};

const MentionList = forwardRef<RefHandle, SuggestionProps>(({ items, command }, ref) => {
  const [selected, setSelected] = useState(0);
  useEffect(() => setSelected(0), [items]);
  useImperativeHandle(ref, () => ({
    onKeyDown: (e) => {
      if (items.length === 0) return false;
      if (e.key === "ArrowUp") {
        setSelected((i) => (i + items.length - 1) % items.length);
        return true;
      }
      if (e.key === "ArrowDown") {
        setSelected((i) => (i + 1) % items.length);
        return true;
      }
      if (e.key === "Enter") {
        const it = items[selected];
        if (it) command({ id: it.id, label: it.name });
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-2 text-xs text-zinc-600 shadow-xl ring-1 ring-black/5 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-white/10">
        멘션 가능한 멤버가 없습니다.
      </div>
    );
  }

  return (
    <div className="max-h-64 w-64 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1 text-zinc-900 shadow-xl ring-1 ring-black/5 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-white/10">
      {items.map((it, idx) => (
        <button
          key={it.id}
          type="button"
          onMouseEnter={() => setSelected(idx)}
          onClick={() => command({ id: it.id, label: it.name })}
          className={[
            "flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left text-sm",
            idx === selected
              ? "bg-zinc-100 dark:bg-zinc-800"
              : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60",
          ].join(" ")}
        >
          <span className="truncate">{it.name}</span>
          <span className="shrink-0 text-[10px] text-zinc-500">{it.jobRole}</span>
        </button>
      ))}
    </div>
  );
});
MentionList.displayName = "MemberMentionList";

const MemberMentionNode = Mention.extend({
  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(
        {
          "data-type": "mention",
          class:
            "member-mention inline-flex max-w-full items-center gap-0.5 rounded bg-zinc-100 px-1 py-0.5 align-middle text-sm text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100",
        },
        HTMLAttributes,
      ),
      [
        "span",
        { class: "select-none text-[11px] font-semibold text-zinc-500 dark:text-zinc-400", "aria-hidden": "true" },
        "@",
      ],
      ["span", { class: "truncate font-medium" }, (node.attrs.label as string) ?? "멤버"],
    ];
  },
  renderText({ node }) {
    return `@${(node.attrs.label as string) ?? "멤버"}`;
  },
});

export const MemberMention = MemberMentionNode.configure({
  suggestion: {
    char: "@",
    items: async ({ query }) => {
      const candidates = await searchMembersForMentionApi(query, 8);
      useMemberStore.getState().setMentionCandidates(query, candidates);
      return candidates.map((m) => ({
        id: m.memberId,
        name: m.name,
        jobRole: m.jobRole,
      }));
    },
    render: () => {
      let component: ReactRenderer<RefHandle, SuggestionProps> | null = null;
      let popup: TippyInstance[] = [];
      return {
        onStart: (props: SuggestionProps & { editor: import("@tiptap/react").Editor }) => {
          component = new ReactRenderer(MentionList, {
            props,
            editor: props.editor,
          });
          if (!props.clientRect) return;
          popup = tippy("body", {
            getReferenceClientRect: () => props.clientRect?.() ?? new DOMRect(0, 0, 0, 0),
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: "manual",
            placement: "bottom-start",
            theme: "quicknote-suggestion",
            arrow: false,
          });
        },
        onUpdate(props: SuggestionProps) {
          component?.updateProps(props);
          if (!props.clientRect) return;
          popup[0]?.setProps({
            getReferenceClientRect: () => props.clientRect?.() ?? new DOMRect(0, 0, 0, 0),
          });
        },
        onKeyDown(props: { event: KeyboardEvent }) {
          if (props.event.key === "Escape") {
            popup[0]?.hide();
            return true;
          }
          return component?.ref?.onKeyDown(props.event) ?? false;
        },
        onExit() {
          popup[0]?.destroy();
          component?.destroy();
          popup = [];
          component = null;
        },
      };
    },
  },
});
