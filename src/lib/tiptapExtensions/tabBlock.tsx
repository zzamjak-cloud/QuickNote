import { Node, mergeAttributes } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditorState,
} from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  memo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Copy,
  Edit3,
  ImagePlus,
  MoreHorizontal,
  PanelBottom,
  PanelLeft,
  PanelRight,
  PanelTop,
  Plus,
  Trash2,
} from "lucide-react";
import { IconPickerPanel } from "../../components/common/IconPicker";
import { PageIconDisplay } from "../../components/common/PageIconDisplay";
import { useUiStore } from "../../store/uiStore";
import { encodeLucidePageIcon } from "../pageIcon";
import { pickTabPanelShells } from "./tabPanelDom";

type TabPlacement = "top" | "bottom" | "left" | "right";

const BLOCK_MENU_WIDTH = 144;
const BLOCK_MENU_HEIGHT = 142;
const TAB_MENU_WIDTH = 176;
/** 초기 한 프레임 추정치 — 실제 높이는 useLayoutEffect 에서 재계산 */
const TAB_MENU_HEIGHT_ESTIMATE = 200;
const ICON_PICKER_WIDTH = 320;
const ICON_PICKER_HEIGHT = 420;
const MENU_MARGIN = 8;

function safePlacement(value: unknown): TabPlacement {
  return value === "bottom" || value === "left" || value === "right"
    ? value
    : "top";
}

function newTabId(): string {
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function getMenuPosition(
  button: HTMLElement,
  width = BLOCK_MENU_WIDTH,
  height = BLOCK_MENU_HEIGHT,
  align: "start" | "end" = "end",
): { top: number; left: number } {
  return getMenuPositionFromRect(button.getBoundingClientRect(), width, height, align);
}

function getMenuPositionFromRect(
  rect: DOMRect,
  width = BLOCK_MENU_WIDTH,
  height = BLOCK_MENU_HEIGHT,
  align: "start" | "end" = "end",
): { top: number; left: number } {
  const maxLeft = Math.max(
    MENU_MARGIN,
    window.innerWidth - width - MENU_MARGIN,
  );
  const maxTop = Math.max(
    MENU_MARGIN,
    window.innerHeight - height - MENU_MARGIN,
  );
  const rawLeft = align === "start" ? rect.left : rect.right - width;
  const left = Math.min(Math.max(rawLeft, MENU_MARGIN), maxLeft);
  const preferredTop = rect.bottom + 4;
  const top =
    preferredTop + height <= window.innerHeight - MENU_MARGIN
      ? preferredTop
      : rect.top - height - 4;
  return {
    left,
    top: Math.min(Math.max(top, MENU_MARGIN), maxTop),
  };
}

/** 탭 버튼 기준 플로팅 메뉴: 기본은 버튼 바로 위, 공간 없으면 아래로 */
function getTabFloatingMenuPosition(
  rect: DOMRect,
  width: number,
  height: number,
  align: "start" | "end",
): { top: number; left: number } {
  const GAP = 4;
  const maxLeft = Math.max(
    MENU_MARGIN,
    window.innerWidth - width - MENU_MARGIN,
  );
  const maxTop = Math.max(
    MENU_MARGIN,
    window.innerHeight - height - MENU_MARGIN,
  );
  const rawLeft = align === "start" ? rect.left : rect.right - width;
  const left = Math.min(Math.max(rawLeft, MENU_MARGIN), maxLeft);
  let top = rect.top - height - GAP;
  if (top < MENU_MARGIN) {
    const below = rect.bottom + GAP;
    if (below + height <= window.innerHeight - MENU_MARGIN) {
      top = below;
    }
  }
  return {
    left,
    top: Math.min(Math.max(top, MENU_MARGIN), maxTop),
  };
}

function tabPanelChromeChanged(prev: NodeViewProps, next: NodeViewProps): boolean {
  const prevNode = prev.node;
  const nextNode = next.node;
  if (prevNode.attrs.placement !== nextNode.attrs.placement) return true;
  if (prevNode.attrs.activeIndex !== nextNode.attrs.activeIndex) return true;
  if (prevNode.childCount !== nextNode.childCount) return true;
  for (let i = 0; i < prevNode.childCount; i++) {
    const prevPanel = prevNode.child(i);
    const nextPanel = nextNode.child(i);
    if (prevPanel.attrs.id !== nextPanel.attrs.id) return true;
    if (prevPanel.attrs.title !== nextPanel.attrs.title) return true;
    if (prevPanel.attrs.icon !== nextPanel.attrs.icon) return true;
  }
  return false;
}

function areTabBlockNodeViewsEqual(
  prev: NodeViewProps,
  next: NodeViewProps,
): boolean {
  return !tabPanelChromeChanged(prev, next);
}

const TabBlockView = memo(function TabBlockView({
  editor,
  getPos,
  node,
  updateAttributes,
}: NodeViewProps) {
  const placement = safePlacement(node.attrs.placement);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tabMenuIndex, setTabMenuIndex] = useState<number | null>(null);
  const [iconPickerIndex, setIconPickerIndex] = useState<number | null>(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [tabMenuPosition, setTabMenuPosition] = useState({ top: 0, left: 0 });
  const [iconPickerPosition, setIconPickerPosition] = useState({ top: 0, left: 0 });
  const menuRef = useRef<HTMLDivElement | null>(null);
  const tabMenuRef = useRef<HTMLDivElement | null>(null);
  const iconPickerRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const tabButtonRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  /** Editor 가 shouldRerenderOnTransaction: false 일 때도 트랜잭션마다 활성 탭을 문서에서 직접 구독 */
  const activeIndex = useEditorState({
    editor,
    selector: (snapshot) => {
      const ed = snapshot.editor;
      const pos = typeof getPos === "function" ? getPos() : null;
      if (typeof pos !== "number") {
        return Math.min(
          Math.max(Number(node.attrs.activeIndex ?? 0), 0),
          Math.max(0, node.childCount - 1),
        );
      }
      let block = ed.state.doc.nodeAt(pos);
      if (!block || block.type.name !== "tabBlock") {
        block = ed.state.doc.resolve(pos).nodeAfter ?? null;
      }
      if (!block || block.type.name !== "tabBlock") {
        return Math.min(
          Math.max(Number(node.attrs.activeIndex ?? 0), 0),
          Math.max(0, node.childCount - 1),
        );
      }
      const ai = Number(block.attrs.activeIndex ?? 0);
      const maxIdx = Math.max(0, block.childCount - 1);
      return Math.min(Math.max(ai, 0), maxIdx);
    },
    equalityFn: (a, b) => a === b,
  });
  const panelsShellRef = useRef<HTMLDivElement | null>(null);
  /** NodeView getPos — 트랜잭션 콜백에서도 최신 참조 */
  const getPosRef = useRef(getPos);
  getPosRef.current = getPos;

  /** useCallback 선언 전에 rAF 재시도에서 최신 함수를 호출하기 위한 ref */
  const applyPanelsVisibilityRef = useRef<(reason: string) => void>(() => {});

  /**
   * 패널 표시는 문서 attrs.activeIndex 가 진실의 원천.
   * 인라인 display 만으로는 PM DOM 갱신 직후 유실될 수 있어 !important + 트랜잭션/rAF 재동기화.
   */
  const applyPanelsVisibility = useCallback(
    (reason: string) => {
      // 한글 IME 조합 중 패널 display/hidden 을 바꾸면 조합이 끊겨 「ㅌㅔ」처럼 자모 분리된다.
      if (editor.view.composing) {
        requestAnimationFrame(() =>
          applyPanelsVisibilityRef.current(`${reason}|defer-composing`),
        );
        return;
      }

      const blockPos =
        typeof getPosRef.current === "function" ? getPosRef.current() : null;
      if (typeof blockPos !== "number") {
        return;
      }
      let tabBlockNode = editor.state.doc.nodeAt(blockPos);
      if (!tabBlockNode || tabBlockNode.type.name !== "tabBlock") {
        tabBlockNode = editor.state.doc.resolve(blockPos).nodeAfter ?? null;
      }
      if (!tabBlockNode || tabBlockNode.type.name !== "tabBlock") {
        return;
      }

      const maxIdx = Math.max(0, tabBlockNode.childCount - 1);
      const clampedActive = Math.min(
        Math.max(Number(tabBlockNode.attrs.activeIndex ?? 0), 0),
        maxIdx,
      );

      const shell = panelsShellRef.current;
      const root = shell?.querySelector(".qn-tab-panels") ?? null;
      const panels = pickTabPanelShells(
        editor.view,
        blockPos,
        tabBlockNode,
        root,
      );

      // 비활성 패널에 display:none + hidden 을 주면 크롬 계열 한글 IME 가
      // 탭별·첫 조합 단위로 자모가 분리된다. 비활성은 absolute + 미표시 로만 처리한다.
      // 활성 패널도 display 를 인라인으로 박아 둔다: index.css 가 모든 [data-tab-panel] 에
      // display:none !important 를 걸고, nth-of-type 백업은 첫 패널 DOM(래퍼 계층)과 안 맞을 수 있음.
      const inlinePanelKeys = [
        "display",
        "position",
        "left",
        "right",
        "top",
        "bottom",
        "opacity",
        "visibility",
        "pointer-events",
        "z-index",
        "user-select",
      ] satisfies string[];
      panels.forEach((el, i) => {
        const show = i === clampedActive;
        for (const key of inlinePanelKeys) el.style.removeProperty(key);
        el.removeAttribute("hidden");
        if (show) {
          el.style.setProperty("display", "block", "important");
          el.style.setProperty("position", "relative", "important");
          el.style.setProperty("z-index", "1", "important");
          el.setAttribute("aria-hidden", "false");
          return;
        }
        el.style.setProperty("position", "absolute", "important");
        el.style.setProperty("left", "0", "important");
        el.style.setProperty("right", "0", "important");
        el.style.setProperty("top", "0", "important");
        el.style.setProperty("display", "block", "important");
        el.style.setProperty("opacity", "0", "important");
        el.style.setProperty("visibility", "hidden", "important");
        el.style.setProperty("pointer-events", "none", "important");
        el.style.setProperty("z-index", "0", "important");
        el.style.setProperty("user-select", "none", "important");
        el.setAttribute("aria-hidden", "true");
      });

      // CSS 백업([data-active-index])은 React 노드뷰가 attrs 만 바뀔 때 래퍼 리렌더가 밀릴 수 있어 DOM 에 직접 반영
      const tabBlockEl = shell?.closest("[data-tab-block]");
      if (tabBlockEl instanceof HTMLElement) {
        tabBlockEl.setAttribute("data-active-index", String(clampedActive));
      }

      // nodeDOM 이 아직 없어 panelCount=0 인 첫 프레임 — 다음 페인트에서 재시도
      if (
        panels.length === 0 &&
        tabBlockNode.childCount > 0 &&
        !reason.includes("retry-rAF")
      ) {
        requestAnimationFrame(() =>
          applyPanelsVisibilityRef.current(`${reason}-retry-rAF`),
        );
      }
    },
    [editor],
  );
  applyPanelsVisibilityRef.current = applyPanelsVisibility;

  useLayoutEffect(() => {
    applyPanelsVisibility("layout");
    requestAnimationFrame(() => applyPanelsVisibility("layout+rAF"));
  }, [activeIndex, applyPanelsVisibility, node.childCount]);

  const tabs = Array.from({ length: node.childCount }, (_, index) => {
    const child = node.child(index);
    return {
      index,
      title:
        typeof child.attrs.title === "string" && child.attrs.title.trim()
          ? child.attrs.title
          : `탭${index + 1}`,
      icon: typeof child.attrs.icon === "string" ? child.attrs.icon : null,
      id: typeof child.attrs.id === "string" && child.attrs.id ? child.attrs.id : null,
    };
  });

  const panelPosAt = (index: number): number | null => {
    if (typeof getPos !== "function") return null;
    const blockPos = getPos();
    if (typeof blockPos !== "number") return null;
    let pos = blockPos + 1;
    for (let i = 0; i < index; i++) {
      const child = node.child(i);
      if (!child) return null;
      pos += child.nodeSize;
    }
    return pos;
  };

  const updateTabAttrs = (index: number, attrs: Record<string, unknown>) => {
    const panelPos = panelPosAt(index);
    const panel = node.child(index);
    if (panelPos == null || !panel) return;
    editor.view.dispatch(
      editor.state.tr
        .setNodeMarkup(panelPos, undefined, {
          ...panel.attrs,
          ...attrs,
        })
        .scrollIntoView(),
    );
    editor.view.focus();
  };

  const addTab = () => {
    if (typeof getPos !== "function") return;
    const tabPanelType = editor.schema.nodes.tabPanel;
    const paragraphType = editor.schema.nodes.paragraph;
    if (!tabPanelType || !paragraphType) return;
    const nextIndex = node.childCount;
    const panel = tabPanelType.create(
      {
        id: newTabId(),
        title: `탭${nextIndex + 1}`,
      },
      paragraphType.create(),
    );
    const pos = getPos();
    if (typeof pos !== "number") return;
    editor.view.dispatch(
      editor.state.tr
        .insert(pos + node.nodeSize - 1, panel)
        .setNodeMarkup(pos, undefined, {
          ...node.attrs,
          activeIndex: nextIndex,
        })
        .scrollIntoView(),
    );
    editor.view.focus();
  };

  // 포탈 메뉴 실제 높이 반영 + 탭 버튼 바로 위 정렬(첫 페인트 깜빡임 최소화)
  useLayoutEffect(() => {
    if (tabMenuIndex == null || !tabMenuRef.current) return;
    const btn = tabButtonRefs.current[tabMenuIndex];
    const menu = tabMenuRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    setTabMenuPosition(
      getTabFloatingMenuPosition(r, menu.offsetWidth, menu.offsetHeight, "start"),
    );
  }, [tabMenuIndex]);

  useLayoutEffect(() => {
    if (iconPickerIndex == null || !iconPickerRef.current) return;
    const btn = tabButtonRefs.current[iconPickerIndex];
    const panel = iconPickerRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    setIconPickerPosition(
      getTabFloatingMenuPosition(r, panel.offsetWidth, panel.offsetHeight, "start"),
    );
  }, [iconPickerIndex]);

  useEffect(() => {
    if (!menuOpen && tabMenuIndex == null && iconPickerIndex == null) return;
    const updateMenuPosition = () => {
      if (menuOpen && menuButtonRef.current) {
        setMenuPosition(getMenuPosition(menuButtonRef.current));
      }
      if (tabMenuIndex != null && tabButtonRefs.current[tabMenuIndex] && tabMenuRef.current) {
        const btn = tabButtonRefs.current[tabMenuIndex];
        const menu = tabMenuRef.current;
        const r = btn.getBoundingClientRect();
        setTabMenuPosition(
          getTabFloatingMenuPosition(r, menu.offsetWidth, menu.offsetHeight, "start"),
        );
      }
      if (
        iconPickerIndex != null &&
        tabButtonRefs.current[iconPickerIndex] &&
        iconPickerRef.current
      ) {
        const btn = tabButtonRefs.current[iconPickerIndex];
        const panel = iconPickerRef.current;
        const r = btn.getBoundingClientRect();
        setIconPickerPosition(
          getTabFloatingMenuPosition(r, panel.offsetWidth, panel.offsetHeight, "start"),
        );
      }
    };
    updateMenuPosition();
    const close = (event: MouseEvent) => {
      const target = event.target as globalThis.Node;
      if (
        !menuRef.current?.contains(target) &&
        !tabMenuRef.current?.contains(target) &&
        !iconPickerRef.current?.contains(target)
      ) {
        setMenuOpen(false);
        setTabMenuIndex(null);
        setIconPickerIndex(null);
      }
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("resize", updateMenuPosition, { passive: true });
    document.addEventListener("scroll", updateMenuPosition, {
      passive: true,
      capture: true,
    });
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("resize", updateMenuPosition);
      document.removeEventListener("scroll", updateMenuPosition, { capture: true });
    };
  }, [iconPickerIndex, menuOpen, tabMenuIndex]);

  const setPlacement = (next: TabPlacement) => {
    updateAttributes({ placement: next });
    setMenuOpen(false);
    editor.view.focus();
  };

  const placementItems: Array<{
    value: TabPlacement;
    label: string;
    icon: typeof PanelTop;
  }> = [
    { value: "top", label: "상단", icon: PanelTop },
    { value: "bottom", label: "하단", icon: PanelBottom },
    { value: "left", label: "좌측", icon: PanelLeft },
    { value: "right", label: "우측", icon: PanelRight },
  ];

  const openTabMenu = (index: number, button: HTMLElement) => {
    const rect = button.getBoundingClientRect();
    setTabMenuPosition(
      getTabFloatingMenuPosition(rect, TAB_MENU_WIDTH, TAB_MENU_HEIGHT_ESTIMATE, "start"),
    );
    setMenuOpen(false);
    setIconPickerIndex(null);
    setTabMenuIndex((current) => (current === index ? null : index));
  };

  const renameTab = async (index: number) => {
    const tab = tabs[index];
    if (!tab) return;
    setTabMenuIndex(null);
    const title = await useUiStore.getState().requestTextPrompt("탭 이름 변경", {
      placeholder: "탭 이름",
      initialValue: tab.title,
    });
    const nextTitle = title?.trim();
    if (!nextTitle) return;
    updateTabAttrs(index, { title: nextTitle });
  };

  const copyTabLink = (index: number) => {
    const tab = tabs[index];
    if (!tab) return;
    const id = tab.id ?? newTabId();
    if (!tab.id) updateTabAttrs(index, { id });
    const base = `${window.location.origin}${window.location.pathname}${window.location.search}`;
    void navigator.clipboard
      .writeText(`${base}#tab-${encodeURIComponent(id)}`)
      .then(() =>
        useUiStore.getState().showToast("탭 링크 복사 완료!", { kind: "success" }),
      )
      .catch(() =>
        useUiStore.getState().showToast("탭 링크 복사에 실패했습니다.", {
          kind: "error",
        }),
      );
    setTabMenuIndex(null);
  };

  const deleteTab = (index: number) => {
    if (node.childCount <= 1) {
      useUiStore.getState().showToast("마지막 탭은 삭제할 수 없습니다.", {
        kind: "info",
      });
      setTabMenuIndex(null);
      return;
    }
    const ok = window.confirm(
      "탭을 정말로 삭제하시겠습니까?\n탭의 컨텐츠 내용도 모두 함께 삭제됩니다.",
    );
    if (!ok || typeof getPos !== "function") return;
    const panelPos = panelPosAt(index);
    const panel = node.child(index);
    const blockPos = getPos();
    if (panelPos == null || !panel || typeof blockPos !== "number") return;
    const nextActiveIndex =
      activeIndex > index
        ? activeIndex - 1
        : Math.min(activeIndex, node.childCount - 2);
    editor.view.dispatch(
      editor.state.tr
        .delete(panelPos, panelPos + panel.nodeSize)
        .setNodeMarkup(blockPos, undefined, {
          ...node.attrs,
          activeIndex: nextActiveIndex,
        })
        .scrollIntoView(),
    );
    editor.view.focus();
    setTabMenuIndex(null);
  };

  const openIconPicker = (index: number) => {
    const button = tabButtonRefs.current[index];
    if (button) {
      const rect = button.getBoundingClientRect();
      setIconPickerPosition(
        getTabFloatingMenuPosition(rect, ICON_PICKER_WIDTH, ICON_PICKER_HEIGHT, "start"),
      );
    }
    setTabMenuIndex(null);
    setIconPickerIndex(index);
  };
  const portalRoot =
    typeof document !== "undefined" ? document.body : null;

  const tabList = (
    <div
      contentEditable={false}
      className="qn-tab-list flex min-w-0 items-center gap-1 rounded-md bg-zinc-100 p-1 dark:bg-zinc-800/70"
      data-tab-placement={placement}
    >
      <div className="qn-tab-items flex min-w-0 flex-1 items-center gap-1">
        {tabs.map((tab) => (
          <button
            ref={(el) => {
              tabButtonRefs.current[tab.index] = el;
            }}
            key={tab.index}
            type="button"
            onClick={(event) => {
              if (tab.index === activeIndex) {
                openTabMenu(tab.index, event.currentTarget);
                return;
              }
              setTabMenuIndex(null);
              setIconPickerIndex(null);
              updateAttributes({ activeIndex: tab.index });
            }}
            className={[
              "qn-tab-button min-w-0 shrink-0 rounded-md border px-2.5 py-1 text-left text-xs font-medium",
              "max-w-36 truncate transition-colors",
              tab.index === activeIndex
                ? "border-blue-400 bg-blue-50 text-blue-700 shadow-sm ring-1 ring-blue-200 dark:border-blue-500/70 dark:bg-blue-950/40 dark:text-blue-200 dark:ring-blue-500/30"
                : "border-transparent text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
            ].join(" ")}
            title={tab.title}
            aria-pressed={tab.index === activeIndex}
          >
            <span className="inline-flex min-w-0 items-center gap-1.5">
              {tab.icon ? <PageIconDisplay icon={tab.icon} size="sm" /> : null}
              <span className="min-w-0 truncate">{tab.title}</span>
            </span>
          </button>
        ))}
        {portalRoot && tabMenuIndex != null
          ? createPortal(
              <div
                ref={tabMenuRef}
                className="fixed z-[500] w-44 rounded-md border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
                style={{ top: tabMenuPosition.top, left: tabMenuPosition.left }}
              >
                <button
                  type="button"
                  onClick={() => renameTab(tabMenuIndex)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <Edit3 size={14} className="shrink-0" />
                  이름 변경
                </button>
                <button
                  type="button"
                  onClick={() => openIconPicker(tabMenuIndex)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <ImagePlus size={14} className="shrink-0" />
                  아이콘
                </button>
                {tabs[tabMenuIndex]?.icon ? (
                  <button
                    type="button"
                    onClick={() => {
                      updateTabAttrs(tabMenuIndex, { icon: null });
                      setTabMenuIndex(null);
                    }}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  >
                    <ImagePlus size={14} className="shrink-0" />
                    아이콘 제거
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => copyTabLink(tabMenuIndex)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <Copy size={14} className="shrink-0" />
                  링크 복사
                </button>
                <button
                  type="button"
                  onClick={() => deleteTab(tabMenuIndex)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
                >
                  <Trash2 size={14} className="shrink-0" />
                  삭제
                </button>
              </div>,
              portalRoot,
            )
          : null}
        {portalRoot && iconPickerIndex != null
          ? createPortal(
              <div
                ref={iconPickerRef}
                className="fixed z-[510]"
                style={{ top: iconPickerPosition.top, left: iconPickerPosition.left }}
              >
                <IconPickerPanel
                  title="탭 아이콘"
                  onPickEmoji={(emoji) => {
                    updateTabAttrs(iconPickerIndex, { icon: emoji });
                    setIconPickerIndex(null);
                  }}
                  onPickLucide={(name, color) => {
                    updateTabAttrs(iconPickerIndex, {
                      icon: encodeLucidePageIcon(name, color),
                    });
                    setIconPickerIndex(null);
                  }}
                />
              </div>,
              portalRoot,
            )
          : null}
      </div>
      <div ref={menuRef} className="qn-tab-actions relative ml-auto flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={addTab}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          title="탭 추가"
          aria-label="탭 추가"
        >
          <Plus size={14} />
        </button>
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => {
            if (menuButtonRef.current) {
              setMenuPosition(getMenuPosition(menuButtonRef.current));
            }
            setMenuOpen((value) => !value);
          }}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          title="탭 블럭 메뉴"
          aria-label="탭 블럭 메뉴"
          aria-expanded={menuOpen}
        >
          <MoreHorizontal size={15} />
        </button>
        {portalRoot && menuOpen
          ? createPortal(
              <div
                className="fixed z-[500] w-36 rounded-md border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
                style={{ top: menuPosition.top, left: menuPosition.left }}
              >
                <div className="px-2 py-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                  탭 위치
                </div>
                {placementItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setPlacement(item.value)}
                      className={[
                        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs",
                        placement === item.value
                          ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50",
                      ].join(" ")}
                    >
                      <Icon size={14} className="shrink-0" />
                      {item.label}
                    </button>
                  );
                })}
              </div>,
              portalRoot,
            )
          : null}
      </div>
    </div>
  );

  return (
    <NodeViewWrapper
      as="div"
      data-tab-block=""
      data-tab-placement={placement}
      data-active-index={activeIndex}
      className={[
        "qn-tab-block my-2 rounded-[10px] border border-zinc-300/40 bg-zinc-50/40",
        "p-2 dark:border-zinc-700/70 dark:bg-zinc-900/30",
        placement === "left" || placement === "right" ? "flex gap-2" : "block",
        placement === "right" ? "flex-row-reverse" : "",
      ].join(" ")}
    >
      {(placement === "top" || placement === "left" || placement === "right") && tabList}
      {/* display:contents — 레이아웃은 자식 .qn-tab-panels 만 참여, 패널 표시는 ref 로 동기화 */}
      <div ref={panelsShellRef} className="contents">
        <NodeViewContent
          as="div"
          className="qn-tab-panels relative min-w-0 flex-1 overflow-hidden rounded-md bg-white/70 p-2 dark:bg-zinc-950/30"
        />
      </div>
      {placement === "bottom" && tabList}
    </NodeViewWrapper>
  );
}, areTabBlockNodeViewsEqual);

export const TabPanel = Node.create({
  name: "tabPanel",
  group: "tabPanel",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-tab-id"),
        renderHTML: (attrs) =>
          attrs.id ? { "data-tab-id": String(attrs.id) } : {},
      },
      title: {
        default: "탭",
        parseHTML: (el) =>
          (el as HTMLElement).getAttribute("data-tab-title") ?? "탭",
        renderHTML: (attrs) => ({ "data-tab-title": String(attrs.title ?? "탭") }),
      },
      icon: {
        default: null as string | null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-tab-icon"),
        renderHTML: (attrs) =>
          attrs.icon ? { "data-tab-icon": String(attrs.icon) } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-tab-panel]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-tab-panel": "",
        class: "qn-tab-panel",
      }),
      0,
    ];
  },
});

/** 탭 블록 삽입 후 캐럿을 패널 밖(다음 블록 경계)으로 — 노드뷰 포커스 다음 프레임에 실행해야 안정적 */
function focusCaretAfterInsertedTabBlock(editor: Editor): void {
  if (editor.isDestroyed) return;
  const { state } = editor;
  let tabBlockDepth = -1;
  const $from = state.selection.$from;
  for (let d = $from.depth; d >= 1; d--) {
    if ($from.node(d).type.name === "tabBlock") {
      tabBlockDepth = d;
      break;
    }
  }
  if (tabBlockDepth === -1) return;

  const tabStart = $from.before(tabBlockDepth);
  const tabNode = $from.node(tabBlockDepth);
  const docSize = state.doc.content.size;
  const afterTabPos = Math.min(tabStart + tabNode.nodeSize, docSize);

  if (afterTabPos >= docSize) {
    editor
      .chain()
      .focus()
      .insertContentAt(afterTabPos, { type: "paragraph" })
      .scrollIntoView()
      .run();
    return;
  }
  editor.chain().focus().setTextSelection(afterTabPos).scrollIntoView().run();
}

export const TabBlock = Node.create({
  name: "tabBlock",
  group: "block",
  content: "tabPanel{1,}",
  isolating: true,
  defining: true,
  draggable: true,

  addAttributes() {
    return {
      placement: {
        default: "top",
        parseHTML: (el) =>
          safePlacement((el as HTMLElement).getAttribute("data-tab-placement")),
        renderHTML: (attrs) => ({
          "data-tab-placement": safePlacement(attrs.placement),
        }),
      },
      activeIndex: {
        default: 0,
        parseHTML: (el) =>
          Number.parseInt(
            (el as HTMLElement).getAttribute("data-active-index") ?? "0",
            10,
          ),
        renderHTML: (attrs) => ({
          "data-active-index": String(Number(attrs.activeIndex ?? 0)),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-tab-block]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-tab-block": "",
        class: "qn-tab-block",
      }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TabBlockView);
  },

  addCommands() {
    return {
      setTabBlock:
        (placement: TabPlacement = "top") =>
        ({ commands, editor }) => {
          const ok = commands.insertContent({
            type: this.name,
            attrs: {
              placement,
              activeIndex: 0,
            },
            content: [1, 2, 3].map((n) => ({
              type: "tabPanel",
              attrs: {
                id: newTabId(),
                title: `탭${n}`,
              },
              content: [{ type: "paragraph" }],
            })),
          });
          if (!ok) return false;

          // 패널 노드뷰가 같은 턴에 포커스를 잡는 경우가 있어, 레이아웃 이후 두 프레임 뒤에 캐럿 이동
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              focusCaretAfterInsertedTabBlock(editor);
            });
          });
          return true;
        },
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    tabBlock: {
      setTabBlock: (placement?: TabPlacement) => ReturnType;
    };
  }
}
