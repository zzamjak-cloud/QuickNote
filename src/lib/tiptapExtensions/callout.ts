import { Node, mergeAttributes } from "@tiptap/core";
import {
  type CalloutPresetId,
  CALLOUT_PRESET_MAP,
  presetFromLegacyEmoji,
} from "./calloutPresets";

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      preset: {
        default: "idea",
        parseHTML: (el) => {
          const raw = (el as HTMLElement).getAttribute("data-preset");
          if (raw && raw in CALLOUT_PRESET_MAP) {
            return raw as CalloutPresetId;
          }
          const em =
            (el as HTMLElement).getAttribute("data-emoji") ?? "💡";
          return presetFromLegacyEmoji(em);
        },
        renderHTML: (attrs) => ({
          "data-preset": String(attrs.preset ?? "idea"),
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-callout]",
        /** 이모지 열은 무시하고 본문만 편집 영역으로 매핑 */
        contentElement: (dom: HTMLElement) =>
          dom.querySelector(".callout-body") ?? dom,
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const presetId = (node.attrs.preset as CalloutPresetId) ?? "idea";
    const def = CALLOUT_PRESET_MAP[presetId] ?? CALLOUT_PRESET_MAP.idea;

    const rootAttrs = mergeAttributes(HTMLAttributes, {
      "data-callout": "",
      "data-preset": presetId,
      class:
        presetId === "empty"
          ? [
              "callout callout--empty relative my-3 w-full rounded-xl px-3 py-2",
              def.frameClass,
            ].join(" ")
          : [
              "callout relative my-3 flex gap-2 rounded-xl px-3 py-2",
              def.frameClass,
            ].join(" "),
    });

    if (presetId === "empty") {
      return [
        "div",
        rootAttrs,
        ["div", { class: "callout-body w-full min-w-0" }, 0],
      ];
    }

    const emojiCol = [
      "div",
      {
        contenteditable: "false",
        class: "callout-emoji shrink-0 select-none text-xl leading-7",
      },
      def.emoji,
    ];

    return [
      "div",
      rootAttrs,
      emojiCol,
      ["div", { class: "callout-body flex-1 min-w-0" }, 0],
    ];
  },

  addCommands() {
    return {
      setCallout:
        (preset: CalloutPresetId = "idea") =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { preset },
            content: [{ type: "paragraph" }],
          }),
      updateCalloutPreset:
        (preset: CalloutPresetId) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, { preset }),
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (preset?: CalloutPresetId) => ReturnType;
      updateCalloutPreset: (preset: CalloutPresetId) => ReturnType;
    };
  }
}
