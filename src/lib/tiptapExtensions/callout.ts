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
      {
        tag: "aside",
      },
      // 노션 (web/desktop) 콜아웃: <div role="note" aria-roledescription="콜아웃">...본문 블록들...</div>
      // 본문은 notion-text-block / notion-bulleted_list-block 등 여러 div 로 구성되며,
      // PM 이 schema 에 없는 wrapper div 들을 통과시키며 안의 텍스트만 paragraph 로 매핑.
      {
        tag: "div[role='note']",
        getAttrs: (el) => {
          const html = el as HTMLElement;
          const desc = html.getAttribute("aria-roledescription") ?? "";
          if (!/콜아웃|callout/i.test(desc)) return false;
          // 노션 클립보드는 emoji 를 별도 element 로 안 실어 보내는 경우가 많음 — default preset 사용.
          // emoji 가 보이는 형태(예: aria-label) 가 있으면 매핑 시도.
          const iconEl =
            html.querySelector("[aria-label][data-icon-shape='emoji']") ??
            html.querySelector("img[alt]");
          const emoji = iconEl?.textContent?.trim() || iconEl?.getAttribute("alt") || "💡";
          return { preset: presetFromLegacyEmoji(emoji) };
        },
        contentElement: (dom) => dom as HTMLElement,
      },
      // 노션 web export(공개 페이지): <figure class="callout">
      {
        tag: "figure",
        getAttrs: (el) => {
          const html = el as HTMLElement;
          if (!/(^|\s)callout(\s|$)/.test(html.className)) return false;
          const firstChild = html.firstElementChild as HTMLElement | null;
          const emoji = firstChild?.textContent?.trim() ?? "💡";
          return { preset: presetFromLegacyEmoji(emoji) };
        },
        contentElement: (dom) => {
          const html = dom as HTMLElement;
          return (html.lastElementChild as HTMLElement | null) ?? html;
        },
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
