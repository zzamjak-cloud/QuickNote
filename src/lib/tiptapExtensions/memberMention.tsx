import Mention from "@tiptap/extension-mention";
import { mergeAttributes } from "@tiptap/core";
import { Plugin } from "prosemirror-state";
import { usePageStore } from "../../store/pageStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useUiStore } from "../../store/uiStore";

/** 인라인 @ 제안은 사용하지 않음 — Editor/CommentComposer 에서 @ 키로 검색 모달 연결 */
const MemberMentionNode = Mention.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      mentionKind: {
        default: "member",
        parseHTML: (element) =>
          element.getAttribute("data-mention-kind") ?? "member",
        renderHTML: (attributes) => {
          const k = attributes.mentionKind as string | undefined;
          if (!k || k === "member") return {};
          return { "data-mention-kind": k };
        },
      },
      /** 삽입 시 목록에서만 쓰며 DOM에는 내보내지 않음 */
      subtitle: {
        default: null,
        parseHTML: () => null,
        renderHTML: () => ({}),
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            click(_view, event) {
              const target = event.target as HTMLElement;
              const el = target.closest<HTMLElement>(
                '[data-type="mention"][data-id]',
              );
              if (!el) return false;
              const rawId = el.getAttribute("data-id");
              if (!rawId) return false;

              event.preventDefault();

              /** 멤버 멘션(m:)은 페이지 이동하지 않음 */
              if (rawId.startsWith("m:")) {
                return true;
              }

              const kindAttr =
                el.getAttribute("data-mention-kind") ??
                (rawId.startsWith("p:")
                  ? "page"
                  : rawId.startsWith("d:")
                    ? "database"
                    : "member");

              if (kindAttr === "page" || rawId.startsWith("p:")) {
                const pageId = rawId.startsWith("p:") ? rawId.slice(2) : rawId;
                usePageStore.getState().setActivePage(pageId);
                useSettingsStore.getState().setCurrentTabPage(pageId);
                return true;
              }

              if (kindAttr === "database" || rawId.startsWith("d:")) {
                useUiStore.getState().showToast(
                  "데이터베이스는 왼쪽 사이드바 하단「데이터베이스 관리」에서 열 수 있습니다.",
                  { kind: "info" },
                );
                return true;
              }

              const page = usePageStore.getState().pages[rawId];
              if (page) {
                usePageStore.getState().setActivePage(rawId);
                useSettingsStore.getState().setCurrentTabPage(rawId);
                return true;
              }

              return false;
            },
          },
        },
      }),
    ];
  },

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
        {
          class:
            "select-none text-[11px] font-semibold text-zinc-500 dark:text-zinc-400",
          "aria-hidden": "true",
        },
        "@",
      ],
      ["span", { class: "truncate font-medium" }, (node.attrs.label as string) ?? ""],
    ];
  },
  renderText({ node }) {
    return `@${(node.attrs.label as string) ?? ""}`;
  },
});

/** 인라인 @ 제안 미등록 — 클릭 네비만 사용. @ 삽입은 MentionSearchModal 로 처리 */
export const MemberMention = MemberMentionNode.configure({});
