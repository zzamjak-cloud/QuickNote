import { ReactRenderer, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import Mention from "@tiptap/extension-mention";
import { mergeAttributes } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import { usePageStore } from "../../store/pageStore";
import { useUiStore } from "../../store/uiStore";
import {
  openPageInCurrentTab,
  openPageInNewTab,
  shouldOpenInternalLinkInNewTab,
} from "../navigation/internalNavigation";

type Item = { id: string; title: string; icon: string | null };

type SuggestionProps = {
  items: Item[];
  command: (item: { id: string; label: string }) => void;
  clientRect?: (() => DOMRect | null) | null;
  query: string;
};

type RefHandle = {
  onKeyDown: (e: KeyboardEvent) => boolean;
};

const MentionList = forwardRef<RefHandle, SuggestionProps>(
  ({ items, command }, ref) => {
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
          if (it) command({ id: it.id, label: it.title });
          return true;
        }
        return false;
      },
    }));
    if (items.length === 0)
      return (
        <div className="rounded-xl border border-zinc-200 bg-white p-2 text-xs text-zinc-600 shadow-xl ring-1 ring-black/5 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-white/10">
          페이지가 없습니다.
        </div>
      );
    return (
      <div className="max-h-64 w-56 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1 text-zinc-900 shadow-xl ring-1 ring-black/5 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-white/10">
        {items.map((it, idx) => (
          <button
            key={it.id}
            type="button"
            onMouseEnter={() => setSelected(idx)}
            onClick={() => command({ id: it.id, label: it.title })}
            className={[
              "flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-sm text-zinc-900 dark:text-zinc-100",
              idx === selected
                ? "bg-zinc-100 dark:bg-zinc-800"
                : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60",
            ].join(" ")}
          >
            <span className="w-5 shrink-0 text-center text-base leading-none">
              {it.icon ?? "📄"}
            </span>
            <span className="truncate">{it.title || "제목 없음"}</span>
          </button>
        ))}
      </div>
    );
  },
);
MentionList.displayName = "MentionList";

/** 페이지 멘션 노드뷰 — 스토어를 구독하므로 페이지 제목 변경 시 즉시 반영 */
function PageMentionView({ node, editor }: NodeViewProps) {
  const rawId = node.attrs.id as string;
  // 페이지 멘션 id 는 "p:<pageId>" 규약 — pageStore lookup 및 navigation 에는 prefix 제거 필요.
  const id = rawId.startsWith("p:") ? rawId.slice(2) : rawId;
  const label = (node.attrs.label as string) ?? "";
  const page = usePageStore((s) => s.pages[id]);
  const peekPageId = useUiStore((s) => s.peekPageId);
  const peekNavigate = useUiStore((s) => s.peekNavigate);
  const icon = page?.icon ?? "📄";
  const displayTitle = page?.title ?? label ?? "페이지";

  return (
    <NodeViewWrapper as="span" contentEditable={false}>
      <button
        type="button"
        // PM 의 atom 노드 선택(mousedown 으로 NodeSelection)이 click 이벤트와 경쟁해
        // 멘션 클릭이 무시되는 경우가 있어 mousedown 단계에서 propagation 차단.
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          // 페이지 존재성 가드는 두지 않는다 — 가드가 클릭을 통째로 막아 회귀가 반복되던 문제를 제거.
          // 사이드 피크 내부에서 클릭됐는지 판별:
          // DatabaseRowPeek 의 콘텐츠 영역에 data-qn-peek-editor="true" 속성을 부여하므로 그것으로 검사.
          const isInPeek = !!(e.currentTarget.closest("[data-qn-peek-editor='true']"));
          if (shouldOpenInternalLinkInNewTab(e)) {
            try {
              editor?.commands.blur();
            } catch {
              /* noop */
            }
            openPageInNewTab(id);
            return;
          }
          if (isInPeek && peekPageId) {
            peekNavigate(id);
            return;
          }
          // 메인 에디터에서 클릭 — 활성 페이지/탭 갱신.
          // 에디터가 포커스 상태로 남아있으면 Editor.tsx 의 본문 sync useEffect 가
          // blur 이벤트를 기다리며 setContent 를 지연 → 페이지 본문이 갱신되지 않는 문제 방지.
          try {
            editor?.commands.blur();
          } catch {
            /* noop */
          }
          openPageInCurrentTab(id);
        }}
        className="page-mention"
        data-type="mention"
        data-id={id}
      >
        <span className="page-mention-at select-none" aria-hidden="true">
          @
        </span>
        <span className="page-mention-icon">{icon}</span>
        {" "}
        <span className="truncate">{displayTitle}</span>
        <span className="page-mention-chevron" aria-hidden="true">
          {">"}
        </span>
      </button>
    </NodeViewWrapper>
  );
}

const PageMentionNode = Mention.extend({
  addNodeView() {
    return ReactNodeViewRenderer(PageMentionView);
  },

  // PM 레벨 클릭 인터셉터 — ProseMirror 의 NodeSelection 처리와 React onClick 간 경쟁으로
  // 클릭이 삼켜지는 케이스가 있어 mousedown/click 시점에서 직접 페이지 멘션 클릭을 가로채 navigate.
  // 중요: this.parent?.() 를 호출해 Mention 본체의 suggestion 플러그인(@ 메뉴) 을 보존해야 한다.
  addProseMirrorPlugins() {
    const parentPlugins = this.parent?.() ?? [];
    const editorRef = this.editor;
    const clickInterceptor = new Plugin({
      props: {
        handleDOMEvents: {
          mousedown: (_view, event) => {
            const target = event.target as HTMLElement | null;
            if (!target) return false;
            const btn = target.closest<HTMLElement>(".page-mention[data-id]");
            if (!btn) return false;
            const rawId = btn.getAttribute("data-id") ?? "";
            const id = rawId.startsWith("p:") ? rawId.slice(2) : rawId;
            if (!id) return false;
            event.preventDefault();
            event.stopPropagation();
            // 현재 에디터 본문 sync 가 blur 이벤트 대기 중이면 navigation 직후 본문이 갱신되지 않을 수 있다.
            // 명시적으로 blur 를 호출해 setContent 지연을 풀어준다.
            try { editorRef?.commands.blur(); } catch { /* noop */ }
            if (shouldOpenInternalLinkInNewTab(event)) {
              openPageInNewTab(id);
              return true;
            }
            const isInPeek = !!btn.closest("[data-qn-peek-editor='true']");
            const peekId = useUiStore.getState().peekPageId;
            if (isInPeek && peekId) {
              useUiStore.getState().peekNavigate(id);
            } else {
              openPageInCurrentTab(id);
            }
            return true;
          },
        },
      },
    });
    return [...parentPlugins, clickInterceptor];
  },

  renderHTML({ node, HTMLAttributes }) {
    const rawId = node.attrs.id as string;
    const id = rawId.startsWith("p:") ? rawId.slice(2) : rawId;
    const label = (node.attrs.label as string) ?? "";
    const page = usePageStore.getState().pages[id];
    const icon = page?.icon ?? "📄";
    const displayTitle = page?.title ?? label ?? "페이지";
    return [
      "span",
      mergeAttributes(
        {
          "data-type": "mention",
          class: "page-mention",
        },
        HTMLAttributes,
        { "data-id": id },
      ),
      [
        "span",
        {
          class: "page-mention-at select-none",
          "aria-hidden": "true",
        },
        "@",
      ],
      ["span", { class: "page-mention-icon" }, icon],
      " ",
      ["span", { class: "truncate" }, displayTitle],
      ["span", { class: "page-mention-chevron", "aria-hidden": "true" }, ">"],
    ];
  },
  renderText({ node }) {
    const rawId = node.attrs.id as string;
    const id = rawId.startsWith("p:") ? rawId.slice(2) : rawId;
    const page = usePageStore.getState().pages[id];
    const icon = page?.icon ?? "📄";
    const displayTitle =
      page?.title ?? (node.attrs.label as string) ?? "페이지";
    return `@${icon} ${displayTitle}`;
  },
});

export const PageMention = PageMentionNode.configure({
  suggestion: {
    char: "@",
    items: ({ query }) => {
      const pages = Object.values(usePageStore.getState().pages);
      const q = query.trim().toLowerCase();
      return pages
        .filter((p) => !q || p.title.toLowerCase().includes(q))
        .slice(0, 8)
        .map((p) => ({ id: p.id, title: p.title, icon: p.icon }));
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
            getReferenceClientRect: () =>
              props.clientRect?.() ?? new DOMRect(0, 0, 0, 0),
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
            getReferenceClientRect: () =>
              props.clientRect?.() ?? new DOMRect(0, 0, 0, 0),
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
