// 모든 멘션(@) 의 단일 노드 — member / page / database 를 mentionKind 로 분기 처리한다.
// 페이지 멘션도 여기서 렌더한다. (과거 별도 pageMention.tsx 가 있었으나 미사용 dead code 라 제거함)
// 멘션 관련 수정은 반드시 이 파일에서 한다.
import Mention from "@tiptap/extension-mention";
import { mergeAttributes } from "@tiptap/core";
import { Plugin } from "prosemirror-state";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { usePageStore } from "../../store/pageStore";
import { useUiStore } from "../../store/uiStore";
import { useMemberStore } from "../../store/memberStore";
import { PageIconDisplay } from "../../components/common/PageIconDisplay";
import { isImageLikePageIcon, LUCIDE_PAGE_ICON_PREFIX } from "../pageIcon";
import {
  shouldOpenInternalLinkInNewTab,
  openPageInCurrentTab,
  openPageInNewTab,
} from "../navigation/internalNavigation";
import { useNavigationHistoryStore } from "../../store/navigationHistoryStore";

/** 정적 직렬화(renderHTML/renderText)에서 텍스트로 노출해도 되는 아이콘인지 — 이모지만 허용 */
function isPlainEmojiIcon(icon: string | null | undefined): icon is string {
  if (!icon) return false;
  if (isImageLikePageIcon(icon)) return false;
  if (icon.startsWith(LUCIDE_PAGE_ICON_PREFIX)) return false;
  return true;
}

/** 멘션 노드뷰 — 페이지 멘션의 경우 pageStore 를 구독해 페이지 제목 변경을 즉시 반영 */
function MentionNodeView({ node }: NodeViewProps) {
  const id = (node.attrs.id as string | undefined) ?? "";
  const rawLabel = (node.attrs.label as string | undefined) ?? "";
  const kindAttr = (node.attrs.mentionKind as string | undefined) ?? "member";
  const isPage = kindAttr === "page" || id.startsWith("p:");
  const isDatabase = kindAttr === "database" || id.startsWith("d:");
  const isMember = !isPage && !isDatabase;
  const pageId = id.startsWith("p:") ? id.slice(2) : id;
  const reactivePageIcon = usePageStore((s) =>
    isPage ? s.pages[pageId]?.icon ?? null : null,
  );
  // 페이지 멘션일 때만 스토어 구독 — title 변경 시 자동 재렌더
  const reactivePageTitle = usePageStore((s) =>
    isPage ? s.pages[pageId]?.title : undefined,
  );
  const reactivePageTitleColor = usePageStore((s) =>
    isPage ? s.pages[pageId]?.titleColor ?? null : null,
  );
  const label = isPage ? (reactivePageTitle ?? rawLabel ?? "페이지") : rawLabel;
  const dataKind = kindAttr === "member" ? undefined : kindAttr;
  const mentionClass = isPage
    ? "page-mention"
    : "member-mention inline-flex max-w-full cursor-pointer items-center gap-0.5 rounded bg-blue-50 px-1 py-0.5 align-middle text-base text-blue-800 hover:bg-blue-100 dark:bg-blue-950/60 dark:text-blue-100 dark:hover:bg-blue-900/70";

  return (
    <NodeViewWrapper as="span" contentEditable={false}>
      <span
        data-type="mention"
        data-id={id}
        {...(dataKind ? { "data-mention-kind": dataKind } : {})}
        className={mentionClass}
      >
        {isMember ? (
          <span
            className="select-none text-[11px] font-semibold text-blue-500 dark:text-blue-300"
            aria-hidden="true"
          >
            @
          </span>
        ) : null}
        {isPage ? (
          <PageIconDisplay
            icon={reactivePageIcon}
            size="md"
            className="page-mention-icon select-none"
          />
        ) : null}
        {isDatabase ? (
          <span className="select-none text-xs">DB</span>
        ) : null}
        <span
          className="truncate"
          style={reactivePageTitleColor ? { color: reactivePageTitleColor } : undefined}
        >
          {label}
        </span>
      </span>
    </NodeViewWrapper>
  );
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
  body.className = "min-w-0 space-y-0.5";
  const name = document.createElement("div");
  name.className = "truncate font-semibold text-zinc-900 dark:text-zinc-100";
  name.textContent = member?.name ?? "구성원";

  // 직책 + 직무 한 줄
  const roleRow = document.createElement("div");
  roleRow.className = "truncate text-xs text-zinc-500 dark:text-zinc-400";
  const titlePart = member?.jobTitle ? member.jobTitle : "";
  const rolePart = member?.jobRole || member?.jobCategory || "멤버";
  roleRow.textContent = titlePart ? `${titlePart} · ${rolePart}` : rolePart;

  // 소속(실) + 팀
  const deptRow = document.createElement("div");
  deptRow.className = "truncate text-xs text-zinc-500 dark:text-zinc-400";
  const deptPart = member?.department ?? "";
  const teamPart = member?.team ?? "";
  deptRow.textContent = deptPart && teamPart
    ? `${deptPart} / ${teamPart}`
    : deptPart || teamPart;

  const email = document.createElement("div");
  email.className = "mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400";
  email.textContent = member?.email ?? "";

  // 입사일 + 재직상태
  const metaRow = document.createElement("div");
  metaRow.className = "flex gap-1.5 mt-0.5";
  if (member?.employmentStatus && member.employmentStatus !== "재직중") {
    const badge = document.createElement("span");
    badge.className = "rounded bg-amber-100 px-1 py-0.5 text-[9px] text-amber-700";
    badge.textContent = member.employmentStatus;
    metaRow.append(badge);
  }
  if (member?.joinedAt) {
    const joined = document.createElement("span");
    joined.className = "text-[10px] text-zinc-400";
    joined.textContent = `입사 ${member.joinedAt}`;
    metaRow.append(joined);
  }

  body.append(name, roleRow);
  if (deptRow.textContent) body.append(deptRow);
  body.append(email);
  if (metaRow.childNodes.length > 0) body.append(metaRow);
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
const MentionNode = Mention.extend({
  addNodeView() {
    return ReactNodeViewRenderer(MentionNodeView);
  },
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
    // 멘션 클릭 처리:
    //  - 멤버 멘션 → 프로필 팝업, DB 멘션 → 안내 토스트 (mousedown 에서 처리)
    //  - 페이지 멘션 이동(현재 탭/새 탭(Ctrl·Cmd)/사이드 피크)은 mousedown 에서 press 정보를
    //    캡처하고 mouseup 에서 수행한다. (과거에는 App.tsx document 캡처 click 핸들러가 담당했으나,
    //    멘션 삽입 직후 React NodeView 재렌더로 mousedown/mouseup 타깃이 달라져 click 이 아예
    //    발생하지 않아 "신규 멘션만 이동 안 됨" 회귀가 났다. mouseup 은 노드 재마운트와 무관하게
    //    발생하므로 신뢰성 있다. 단일 경로라 Ctrl+클릭 새 탭 2개 열림도 없다.)
    let pagePress:
      | { x: number; y: number; id: string; inPeek: boolean }
      | null = null;

    const handleMentionMouseDown = (event: MouseEvent): boolean => {
      pagePress = null;
      const target = event.target as HTMLElement;
      const el = target.closest<HTMLElement>('[data-type="mention"][data-id]');
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

      // 멤버 멘션 — 프로필 팝업만 표시
      if (kindAttr === "member" || rawId.startsWith("m:")) {
        event.preventDefault();
        showMemberProfilePopup(
          rawId.startsWith("m:") ? rawId.slice(2) : rawId,
          el,
        );
        return true;
      }

      // 데이터베이스 멘션 — 안내 토스트
      if (kindAttr === "database" || rawId.startsWith("d:")) {
        event.preventDefault();
        useUiStore.getState().showToast(
          "데이터베이스는 왼쪽 사이드바 하단「데이터베이스 관리」에서 열 수 있습니다.",
          { kind: "info" },
        );
        return true;
      }

      // 페이지 멘션 — atom 선택을 막고, 이동에 필요한 정보를 mouseup 용으로 캡처한다.
      event.preventDefault();
      const pageId = rawId.startsWith("p:") ? rawId.slice(2) : rawId;
      if (event.button === 0 && pageId) {
        pagePress = {
          x: event.clientX,
          y: event.clientY,
          id: pageId,
          inPeek: !!el.closest("[data-qn-peek-editor='true']"),
        };
      }
      return true;
    };

    const handleMentionMouseUp = (event: MouseEvent): boolean => {
      const press = pagePress;
      pagePress = null;
      if (!press || event.button !== 0) return false;
      // 드래그(텍스트 선택)로 끝난 경우엔 이동하지 않는다.
      if (Math.abs(event.clientX - press.x) > 4 || Math.abs(event.clientY - press.y) > 4) {
        return false;
      }
      event.preventDefault();
      // Ctrl/Cmd+클릭 → 새 탭
      if (shouldOpenInternalLinkInNewTab(event)) {
        openPageInNewTab(press.id);
        return true;
      }
      if (press.inPeek && useUiStore.getState().peekPageId) {
        useUiStore.getState().peekNavigate(press.id);
      } else {
        // 이동 전 현재 페이지를 뒤로가기 스택에 기록.
        const fromId = usePageStore.getState().activePageId;
        if (fromId && fromId !== press.id) {
          useNavigationHistoryStore.getState().pushBack(fromId, press.id);
        }
        openPageInCurrentTab(press.id);
      }
      return true;
    };

    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            mousedown(_view, event) {
              return handleMentionMouseDown(event);
            },
            mouseup(_view, event) {
              return handleMentionMouseUp(event);
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
    const pageIcon =
      isPage && rawId.startsWith("p:")
        ? (usePageStore.getState().pages[rawId.slice(2)]?.icon ?? "")
        : "";
    return [
      "span",
      mergeAttributes(
        {
          "data-type": "mention",
          class: isPage
            ? "page-mention"
            : "member-mention inline-flex max-w-full cursor-pointer items-center gap-0.5 rounded bg-blue-50 px-1 py-0.5 align-middle text-base text-blue-800 hover:bg-blue-100 dark:bg-blue-950/60 dark:text-blue-100 dark:hover:bg-blue-900/70",
        },
        HTMLAttributes,
      ),
      kind === "member" && !rawId.startsWith("p:") && !rawId.startsWith("d:")
        ? [
            "span",
            {
              class:
                "select-none text-[11px] font-semibold text-blue-500 dark:text-blue-300",
              "aria-hidden": "true",
            },
            "@",
          ]
        : "",
      isPage && isPlainEmojiIcon(pageIcon)
        ? ["span", { class: "page-mention-icon select-none" }, pageIcon]
        : "",
      isDatabase ? ["span", { class: "select-none text-xs" }, "DB"] : "",
      ["span", { class: "truncate" }, label],
    ];
  },
  renderText({ node }) {
    const kind = (node.attrs.mentionKind as string | undefined) ?? "member";
    const rawId = (node.attrs.id as string | undefined) ?? "";
    const label = (node.attrs.label as string) ?? "";
    if (kind === "page" || rawId.startsWith("p:")) {
      const pageId = rawId.startsWith("p:") ? rawId.slice(2) : rawId;
      const page = usePageStore.getState().pages[pageId];
      const title = page?.title ?? label ?? "페이지";
      return isPlainEmojiIcon(page?.icon) ? `${page.icon} ${title}` : title;
    }
    return `@${label}`;
  },
});

/** 인라인 @ 제안 미등록 — 클릭 네비만 사용. @ 삽입은 MentionSearchModal 로 처리 */
export const MentionExtension = MentionNode.configure({});
