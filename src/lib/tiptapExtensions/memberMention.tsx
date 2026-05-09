import Mention from "@tiptap/extension-mention";
import { mergeAttributes } from "@tiptap/core";
import { Plugin } from "prosemirror-state";
import { usePageStore } from "../../store/pageStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useUiStore } from "../../store/uiStore";
import { useMemberStore } from "../../store/memberStore";

function navigateToPage(pageId: string): void {
  if (!pageId) return;
  useSettingsStore.getState().setCurrentTabPage(pageId);
  usePageStore.getState().setActivePage(pageId);
}

let memberProfilePopup: HTMLDivElement | null = null;

function closeMemberProfilePopup(): void {
  memberProfilePopup?.remove();
  memberProfilePopup = null;
}

function showMemberProfilePopup(memberId: string, anchor: HTMLElement): void {
  closeMemberProfilePopup();
  const member = useMemberStore
    .getState()
    .members.find((m) => m.memberId === memberId);
  const panel = document.createElement("div");
  panel.className =
    "fixed z-[620] w-64 rounded-lg border border-blue-200 bg-white p-3 text-sm shadow-2xl ring-1 ring-blue-100 dark:border-blue-800 dark:bg-zinc-900 dark:ring-blue-950";
  const rect = anchor.getBoundingClientRect();
  const left = Math.min(Math.max(rect.left, 8), window.innerWidth - 264);
  const below = rect.bottom + 8;
  const top =
    below + 132 < window.innerHeight ? below : Math.max(8, rect.top - 140);
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  const row = document.createElement("div");
  row.className = "flex items-start gap-2";
  const avatar = document.createElement("div");
  avatar.className =
    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-200";
  avatar.textContent = (member?.name ?? "구").slice(0, 1);
  const body = document.createElement("div");
  body.className = "min-w-0";
  const name = document.createElement("div");
  name.className = "truncate font-semibold text-zinc-900 dark:text-zinc-100";
  name.textContent = member?.name ?? "구성원";
  const role = document.createElement("div");
  role.className = "truncate text-xs text-zinc-500 dark:text-zinc-400";
  role.textContent = member?.jobRole || "멤버";
  const email = document.createElement("div");
  email.className = "mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400";
  email.textContent = member?.email ?? "";
  body.append(name, role, email);
  row.append(avatar, body);
  panel.append(row);
  document.body.appendChild(panel);
  memberProfilePopup = panel;
  const close = (event: MouseEvent) => {
    const target = event.target as Node;
    if (panel.contains(target) || anchor.contains(target)) return;
    closeMemberProfilePopup();
    document.removeEventListener("mousedown", close);
  };
  window.setTimeout(() => document.addEventListener("mousedown", close), 0);
}

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
            mousedown(_view, event) {
              const target = event.target as HTMLElement;
              const el = target.closest<HTMLElement>(
                '[data-type="mention"][data-id]',
              );
              if (!el) return false;
              const rawId = el.getAttribute("data-id");
              if (!rawId) return false;
              const kindAttr =
                el.getAttribute("data-mention-kind") ??
                (rawId.startsWith("p:")
                  ? "page"
                  : rawId.startsWith("d:")
                    ? "database"
                    : rawId.startsWith("m:")
                      ? "member"
                      : "page");
              if (kindAttr === "member" || rawId.startsWith("m:")) {
                event.preventDefault();
                showMemberProfilePopup(rawId.startsWith("m:") ? rawId.slice(2) : rawId, el);
                return true;
              }
              if (kindAttr === "page" || rawId.startsWith("p:")) {
                event.preventDefault();
                navigateToPage(rawId.startsWith("p:") ? rawId.slice(2) : rawId);
                return true;
              }
              return false;
            },
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
                showMemberProfilePopup(rawId.slice(2), el);
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
                navigateToPage(pageId);
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
                navigateToPage(rawId);
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
    const kind = (node.attrs.mentionKind as string | undefined) ?? "member";
    const rawId = (node.attrs.id as string | undefined) ?? "";
    const isPage = kind === "page" || rawId.startsWith("p:");
    const isDatabase = kind === "database" || rawId.startsWith("d:");
    const label =
      isPage && rawId.startsWith("p:")
        ? (usePageStore.getState().pages[rawId.slice(2)]?.title ??
          ((node.attrs.label as string) || "페이지"))
        : (node.attrs.label as string) || "";
    return [
      "span",
      mergeAttributes(
        {
          "data-type": "mention",
          class:
            "member-mention inline-flex max-w-full cursor-pointer items-center gap-0.5 rounded bg-blue-50 px-1 py-0.5 align-middle text-sm text-blue-800 hover:bg-blue-100 dark:bg-blue-950/60 dark:text-blue-100 dark:hover:bg-blue-900/70",
        },
        HTMLAttributes,
      ),
      [
        "span",
        {
          class:
            "select-none text-[11px] font-semibold text-blue-500 dark:text-blue-300",
          "aria-hidden": "true",
        },
        "@",
      ],
      isPage ? ["span", { class: "select-none text-xs" }, "↗"] : "",
      isDatabase ? ["span", { class: "select-none text-xs" }, "DB"] : "",
      ["span", { class: "truncate font-medium" }, label],
    ];
  },
  renderText({ node }) {
    return `@${(node.attrs.label as string) ?? ""}`;
  },
});

/** 인라인 @ 제안 미등록 — 클릭 네비만 사용. @ 삽입은 MentionSearchModal 로 처리 */
export const MemberMention = MemberMentionNode.configure({});
