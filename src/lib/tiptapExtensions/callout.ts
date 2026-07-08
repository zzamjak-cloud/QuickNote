import { Node, mergeAttributes } from "@tiptap/core";
import {
  Plugin,
  NodeSelection,
  TextSelection,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import {
  type CalloutPresetId,
  CALLOUT_PRESET_MAP,
  presetFromLegacyEmoji,
} from "./calloutPresets";

/**
 * 현재 선택/커서가 가리키는 단일 콜아웃 노드 하나에만 attr 을 적용한다.
 * updateAttributes 는 selection 범위 내 모든 동일 타입 노드를 갱신하므로,
 * 중첩 콜아웃에서 부모(또는 자식)까지 함께 바뀌는 회귀가 발생한다. 이를 방지한다.
 */
function updateSingleCallout(
  typeName: string,
  state: EditorState,
  tr: Transaction,
  dispatch: ((tr: Transaction) => void) | undefined,
  attrs: Record<string, unknown>,
): boolean {
  const { selection } = state;
  // NodeSelection 으로 콜아웃이 직접 선택된 경우(블록 핸들 프리셋 적용 경로)
  if (
    selection instanceof NodeSelection &&
    selection.node.type.name === typeName
  ) {
    if (dispatch) {
      tr.setNodeMarkup(selection.from, undefined, {
        ...selection.node.attrs,
        ...attrs,
      });
    }
    return true;
  }
  // 커서가 콜아웃 내부에 있는 경우 가장 가까운 콜아웃 하나만 갱신
  const { $from } = selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === typeName) {
      if (dispatch) {
        tr.setNodeMarkup($from.before(depth), undefined, {
          ...node.attrs,
          ...attrs,
        });
      }
      return true;
    }
  }
  return false;
}

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
              "callout callout--empty relative w-full rounded-xl px-3 py-2",
              def.frameClass,
            ].join(" ")
          : [
              "callout relative flex gap-2 rounded-xl px-3 py-2",
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

  addKeyboardShortcuts() {
    return {
      // 콜아웃 내부 "마지막 빈 문단"에서 Enter → 콜아웃을 벗어나 바로 뒤에 빈 문단 생성.
      // (콜아웃끼리 붙어 있을 때 사이 여백을 만들 수 있도록 탈출 경로 제공)
      // 빈 문단이 아니거나 마지막이 아니면 기본 동작(콜아웃 내부 새 문단).
      Enter: ({ editor }) => {
        const { state } = editor;
        const { selection } = state;
        if (!selection.empty) return false;
        const { $from } = selection;
        // 커서가 문단(빈) 안에 있어야 한다.
        if ($from.parent.type.name !== "paragraph") return false;
        if ($from.parent.content.size !== 0) return false;

        // 가장 가까운 조상 callout 을 찾는다.
        let calloutDepth = -1;
        for (let depth = $from.depth - 1; depth > 0; depth -= 1) {
          if ($from.node(depth).type.name === this.name) {
            calloutDepth = depth;
            break;
          }
        }
        if (calloutDepth === -1) return false;

        const calloutNode = $from.node(calloutDepth);
        // 이 빈 문단이 콜아웃(또는 그 최하위 컨테이너)의 마지막 자식이어야 한다.
        // 콜아웃 content 는 block+ 이므로 문단이 직접 자식이다.
        const paragraphDepth = $from.depth;
        if (paragraphDepth !== calloutDepth + 1) return false;
        const indexInCallout = $from.index(calloutDepth);
        if (indexInCallout !== calloutNode.childCount - 1) return false;
        // 콜아웃에 문단이 하나뿐이면 탈출 시 콜아웃이 비어 스키마 위반 → 유지.
        if (calloutNode.childCount <= 1) return false;

        const calloutAfter = $from.before(calloutDepth) + calloutNode.nodeSize;
        const paragraphType = state.schema.nodes.paragraph;
        if (!paragraphType) return false;

        // 마지막 빈 문단 제거 → 콜아웃 뒤(매핑된 위치)에 빈 문단 삽입 후 커서 이동.
        const tr = state.tr;
        tr.delete($from.before(paragraphDepth), $from.after(paragraphDepth));
        const insertPos = tr.mapping.map(calloutAfter);
        tr.insert(insertPos, paragraphType.create());
        tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 1)));
        editor.view.dispatch(tr.scrollIntoView());
        return true;
      },
    };
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
        ({ state, tr, dispatch }) => {
          // plain 컬러칩 변형은 색만 바꾸고 이모지 유지, 일반 프리셋은 이모지 초기화
          const attrs: Record<string, unknown> = { preset };
          if (!preset.endsWith("-plain")) attrs.emoji = null;
          return updateSingleCallout(this.name, state, tr, dispatch, attrs);
        },
      updateCalloutEmoji:
        (emoji: string | null) =>
        ({ state, tr, dispatch }) =>
          updateSingleCallout(this.name, state, tr, dispatch, { emoji }),
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
