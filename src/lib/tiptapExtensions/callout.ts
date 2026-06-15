import { Node, mergeAttributes } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import {
  type CalloutPresetId,
  CALLOUT_PRESET_MAP,
  presetFromLegacyEmoji,
} from "./calloutPresets";

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  isolating: true,
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
      // 사용자가 직접 지정한 아이콘 — null 이면 프리셋 기본 이모지 사용
      emoji: {
        default: null,
        parseHTML: (el) =>
          (el as HTMLElement).getAttribute("data-emoji-override") ?? null,
        renderHTML: (attrs) =>
          attrs.emoji ? { "data-emoji-override": String(attrs.emoji) } : {},
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
      {
        tag: "aside",
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const presetId = (node.attrs.preset as CalloutPresetId) ?? "idea";
    const def = CALLOUT_PRESET_MAP[presetId] ?? CALLOUT_PRESET_MAP.idea;
    // 사용자 지정 아이콘 우선, 없으면 프리셋 기본 이모지
    const displayEmoji = (node.attrs.emoji as string | null) || def.emoji;

    const rootAttrs = mergeAttributes(HTMLAttributes, {
      "data-callout": "",
      "data-preset": presetId,
      style: def.color ? `background: ${def.color}; border-color: ${def.color};` : undefined,
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

    if (!displayEmoji) {
      return [
        "div",
        rootAttrs,
        [
          "div",
          { class: "callout-body w-full min-w-0", "data-callout-body": "" },
          0,
        ],
      ];
    }

    const emojiCol = [
      "div",
      {
        contenteditable: "false",
        class:
          "callout-emoji shrink-0 cursor-pointer select-none rounded-md text-xl leading-7 transition hover:bg-black/10 dark:hover:bg-white/10",
        "data-callout-icon": "",
        "data-callout-icon-value": displayEmoji,
        title: "아이콘 변경",
      },
      displayEmoji,
    ];

    return [
      "div",
      rootAttrs,
      emojiCol,
      [
        "div",
        { class: "callout-body flex-1 min-w-0", "data-callout-body": "" },
        0,
      ],
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleClickOn: (_view, _pos, node, nodePos, event) => {
            if (node.type.name !== this.name) return false;
            const target = event.target as HTMLElement | null;
            const icon = target?.closest<HTMLElement>("[data-callout-icon]");
            if (!icon) return false;
            event.preventDefault();
            event.stopPropagation();
            const rect = icon.getBoundingClientRect();
            window.dispatchEvent(
              new CustomEvent("quicknote:open-callout-icon-picker", {
                detail: {
                  pos: nodePos,
                  top: rect.top,
                  bottom: rect.bottom,
                  left: rect.left,
                },
              }),
            );
            return true;
          },
        },
      }),
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
        ({ commands }) => {
          // plain 컬러칩 변형은 색만 바꾸고 이모지 유지, 일반 프리셋은 이모지 초기화
          const attrs: Record<string, unknown> = { preset };
          if (!preset.endsWith("-plain")) attrs.emoji = null;
          return commands.updateAttributes(this.name, attrs);
        },
      updateCalloutEmoji:
        (emoji: string | null) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, { emoji }),
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (preset?: CalloutPresetId) => ReturnType;
      updateCalloutPreset: (preset: CalloutPresetId) => ReturnType;
      updateCalloutEmoji: (emoji: string | null) => ReturnType;
    };
  }
}
