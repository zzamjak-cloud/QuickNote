// tippy.js 기반 SuggestionRenderer.
import tippy, { type Instance as TippyInstance } from "tippy.js";
import { ReactRenderer } from "@tiptap/react";
import {
  filterSlashMenuEntries,
  type SlashMenuEntry,
  type SlashLeafItem,
} from "../../lib/tiptapExtensions/slashItems";
import { SlashMenu, type SlashMenuHandle } from "./SlashMenu";

type RendererProps = {
  editor: import("@tiptap/react").Editor;
  clientRect?: (() => DOMRect | null) | null;
  command: (item: SlashMenuEntry) => void;
  items: SlashMenuEntry[];
  query: string;
  event?: KeyboardEvent;
};

export function createSlashRenderer() {
  let component: ReactRenderer<SlashMenuHandle> | null = null;
  let popup: TippyInstance[] = [];

  const pickProps = (p: RendererProps) => ({
    entries: filterSlashMenuEntries(p.query, p.editor),
    query: p.query,
    command: (item: SlashLeafItem) => p.command(item),
  });

  return {
    onStart: (props: RendererProps) => {
      component = new ReactRenderer(SlashMenu, {
        props: pickProps(props),
        editor: props.editor,
      });
      if (!props.clientRect) return;
      popup = tippy("body", {
        getReferenceClientRect: () => {
          const r = props.clientRect?.();
          return r ?? new DOMRect(0, 0, 0, 0);
        },
        appendTo: () => document.body,
        content: component.element,
        showOnCreate: true,
        interactive: true,
        trigger: "manual",
        placement: "bottom-start",
        offset: [0, 8],
        popperOptions: {
          modifiers: [
            {
              name: "flip",
              options: {
                fallbackPlacements: [
                  "top-start",
                  "bottom-end",
                  "top-end",
                  "right-start",
                  "left-start",
                ],
              },
            },
            {
              name: "preventOverflow",
              options: {
                boundary: "viewport",
                padding: 8,
                altAxis: true,
              },
            },
          ],
        },
        theme: "quicknote-suggestion",
        arrow: false,
      });
    },
    onUpdate: (props: RendererProps) => {
      component?.updateProps(pickProps(props));
      if (!props.clientRect) return;
      popup[0]?.setProps({
        getReferenceClientRect: () => {
          const r = props.clientRect?.();
          return r ?? new DOMRect(0, 0, 0, 0);
        },
      });
    },
    onKeyDown: (props: { event: KeyboardEvent }) => {
      if (props.event.key === "Escape") {
        popup[0]?.hide();
        return true;
      }
      return component?.ref?.onKeyDown(props.event) ?? false;
    },
    onExit: () => {
      popup[0]?.destroy();
      component?.destroy();
      popup = [];
      component = null;
    },
  };
}
