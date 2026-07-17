import { useCallback, useMemo } from "react";
import type { MutableRefObject } from "react";
import type { Editor } from "@tiptap/react";
import type { EditorView as PmEditorView } from "@tiptap/pm/view";
import { extractClipboardFiles } from "../../lib/editor/clipboardFiles";
import { isGifFile } from "../../lib/files/videoCompress";
import { insertFileFromFile } from "../../lib/editor/insertFileFromFile";
import {
  createEditorHandleDragOver,
  createEditorHandleDrop,
  type BlockDropIndicatorRect,
  type ColumnDropState,
} from "../../lib/editor/editorHandleDrop";
import {
  parseQuickNoteLink,
  quickNoteLinkLabel,
  type QuickNoteLinkTarget,
} from "../../lib/navigation/quicknoteLinks";
import { fetchPageById } from "../../lib/sync/bootstrap";
import { usePageStore } from "../../store/pageStore";
import { sanitizeWebLinkHref } from "../../lib/safeUrl";
import {
  PASTE_URL_MENU_HEIGHT,
  PASTE_URL_MENU_WIDTH,
  clampFloatingPanelPosition,
  suppressScrollToSelectionForTableInteraction,
} from "./editorHelpers";
import type { insertImageFromFile } from "../../lib/editor/insertImageFromFile";
import { TextSelection } from "@tiptap/pm/state";
import { pasteMarkdownAsDocContent } from "../../lib/editor/pasteMarkdownAsDoc";
import { isLikelyVerticalScrollbarInput } from "../../lib/navigation/pageScrollMemory";


type UseEditorPropsParams = {
  bodyOnly: boolean;
  columnDropRef: MutableRefObject<ColumnDropState | null>;
  clearColumnDropUi: () => void;
  clearBlockDropIndicator: () => void;
  setBlockDropIndicator: (rect: BlockDropIndicatorRect | null) => void;
  handleEditorInsertImage: typeof insertImageFromFile;
  handleAtOpenMention: (view: PmEditorView, event: KeyboardEvent) => boolean;
  setPasteUrlChoice: (choice: {
    url: string;
    range: { from: number; to: number };
    top: number;
    left: number;
  } | null) => void;
  editorScrollHostRef: MutableRefObject<HTMLDivElement | null>;
  editorRef: MutableRefObject<Editor | null>;
};

// 붙여넣은 타 워크스페이스 페이지 링크 버튼의 라벨을 실제 페이지 제목으로 비동기 갱신한다.
// 붙여넣기 시점엔 로컬 store 에 페이지가 없어 제목을 모르므로, 링크의 ws 로 메타를 조회해 라벨만 교체한다.
async function applyCrossWorkspaceButtonLabel(
  view: PmEditorView,
  href: string,
  target: QuickNoteLinkTarget,
): Promise<void> {
  if (!target.workspaceId) return;
  const placeholderLabel = quickNoteLinkLabel(undefined, target);
  let title: string | undefined;
  try {
    const page = await fetchPageById(target.workspaceId, target.pageId);
    title = page?.title || undefined;
  } catch {
    return;
  }
  if (!title) return;
  const nextLabel = quickNoteLinkLabel(title, target);
  if (nextLabel === placeholderLabel) return;
  // 붙여넣은 버튼 노드를 href + 플레이스홀더 라벨로 찾아 라벨만 갱신(사용자가 이미 수정한 버튼은 건드리지 않음).
  const positions: number[] = [];
  view.state.doc.descendants((node, pos) => {
    if (
      node.type.name === "buttonBlock" &&
      node.attrs.href === href &&
      node.attrs.label === placeholderLabel
    ) {
      positions.push(pos);
    }
    return true;
  });
  if (positions.length === 0) return;
  try {
    let tr = view.state.tr;
    for (const pos of positions) {
      const node = tr.doc.nodeAt(pos);
      if (node) tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, label: nextLabel });
    }
    view.dispatch(tr);
  } catch {
    /* 에디터가 그 사이 사라졌으면 무시 */
  }
}

const TEXT_SELECTION_DRAG_THRESHOLD_SQ = 16; // 4px — 클릭과 드래그 구분
const TEXT_SELECTION_SCROLL_EDGE_PX = 56;
const TEXT_SELECTION_SCROLL_MAX_STEP_PX = 28;

function armTextSelectionScrollDampener(
  view: PmEditorView,
  event: MouseEvent,
  scrollHost: HTMLElement | null,
): void {
  if (event.button !== 0 || !scrollHost) return;
  if (isLikelyVerticalScrollbarInput(event, scrollHost)) return;
  const target = event.target;
  if (!(target instanceof Element) || !view.dom.contains(target)) return;
  if (
    target.closest(
      [
        "[data-qn-editor-chrome]",
        "[role='menu']",
        "[role='dialog']",
        ".tippy-box",
        "button",
        "input",
        "textarea",
        "select",
        "label",
        "[contenteditable='false']",
      ].join(", "),
    )
  ) {
    return;
  }

  const startX = event.clientX;
  const startY = event.clientY;
  let pointerX = event.clientX;
  let pointerY = event.clientY;
  let lastScrollTop = scrollHost.scrollTop;
  let dragging = false;
  let restoring = false;
  let restoringTo: number | null = null;
  let restoreRaf: number | null = null;

  const releaseRestoreGuardSoon = () => {
    if (restoreRaf != null) return;
    restoreRaf = window.requestAnimationFrame(() => {
      restoreRaf = null;
      restoring = false;
      restoringTo = null;
      lastScrollTop = scrollHost.scrollTop;
    });
  };

  const onMove = (ev: MouseEvent) => {
    pointerX = ev.clientX;
    pointerY = ev.clientY;
    if (dragging) return;
    const dist = (ev.clientX - startX) ** 2 + (ev.clientY - startY) ** 2;
    if (dist >= TEXT_SELECTION_DRAG_THRESHOLD_SQ) dragging = true;
  };

  const onScroll = () => {
    const current = scrollHost.scrollTop;
    if (restoring) {
      if (restoringTo != null && current !== restoringTo) {
        scrollHost.scrollTop = restoringTo;
        return;
      }
      lastScrollTop = current;
      return;
    }
    if (!dragging) {
      lastScrollTop = current;
      return;
    }
    if (isLikelyVerticalScrollbarInput({ clientX: pointerX, clientY: pointerY }, scrollHost)) {
      cleanup();
      return;
    }

    const rect = scrollHost.getBoundingClientRect();
    const nearTop = pointerY <= rect.top + TEXT_SELECTION_SCROLL_EDGE_PX;
    const nearBottom = pointerY >= rect.bottom - TEXT_SELECTION_SCROLL_EDGE_PX;
    const delta = current - lastScrollTop;
    let next = current;

    if (!nearTop && !nearBottom) {
      next = lastScrollTop;
    } else if (Math.abs(delta) > TEXT_SELECTION_SCROLL_MAX_STEP_PX) {
      next = lastScrollTop + Math.sign(delta) * TEXT_SELECTION_SCROLL_MAX_STEP_PX;
    }

    if (next !== current) {
      restoring = true;
      restoringTo = Math.max(0, next);
      scrollHost.scrollTop = restoringTo;
      releaseRestoreGuardSoon();
    } else {
      lastScrollTop = current;
    }
  };

  const cleanup = () => {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("mouseup", cleanup, true);
    window.removeEventListener("blur", cleanup, true);
    scrollHost.removeEventListener("scroll", onScroll);
    scrollHost.removeEventListener("wheel", cleanup);
    scrollHost.removeEventListener("touchmove", cleanup);
    if (restoreRaf != null) window.cancelAnimationFrame(restoreRaf);
  };

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("mouseup", cleanup, true);
  window.addEventListener("blur", cleanup, true);
  scrollHost.addEventListener("scroll", onScroll, { passive: true });
  // 텍스트 drag 중이라도 wheel/trackpad/touch 입력은 사용자의 명시적 스크롤 의도다.
  scrollHost.addEventListener("wheel", cleanup, { passive: true });
  scrollHost.addEventListener("touchmove", cleanup, { passive: true });
}

/**
 * TipTap useEditor 에 전달할 editorProps 객체를 생성하는 훅.
 * paste·drag·drop·keyboard·scroll 처리를 담당한다.
 */
export function useEditorProps({
  bodyOnly,
  columnDropRef,
  clearColumnDropUi,
  clearBlockDropIndicator,
  setBlockDropIndicator,
  handleEditorInsertImage,
  handleAtOpenMention,
  setPasteUrlChoice,
  editorScrollHostRef,
  editorRef,
}: UseEditorPropsParams) {
  const handleBackspaceOnEmptyTaskItem = useCallback((view: PmEditorView, event: KeyboardEvent): boolean => {
    if (event.key !== "Backspace" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
      return false;
    }
    const { state } = view;
    const { selection, schema } = state;
    if (!selection.empty) return false;

    const paragraphType = schema.nodes.paragraph;
    if (!paragraphType) return false;

    const { $from } = selection;
    let taskItemDepth = -1;
    for (let depth = $from.depth; depth >= 1; depth--) {
      if ($from.node(depth).type.name === "taskItem") {
        taskItemDepth = depth;
        break;
      }
    }
    if (taskItemDepth < 0) return false;

    const taskItemNode = $from.node(taskItemDepth);
    if (taskItemNode.textContent.trim().length > 0) return false;

    const taskListDepth = taskItemDepth - 1;
    if (taskListDepth < 1 || $from.node(taskListDepth).type.name !== "taskList") return false;
    const taskListNode = $from.node(taskListDepth);
    const taskListPos = $from.before(taskListDepth);
    const taskListEnd = taskListPos + taskListNode.nodeSize;
    const itemPos = $from.before(taskItemDepth);
    const itemEnd = itemPos + taskItemNode.nodeSize;

    event.preventDefault();
    let tr = state.tr;
    if (taskListNode.childCount <= 1) {
      tr = tr.replaceWith(taskListPos, taskListEnd, paragraphType.create());
      tr = tr.setSelection(TextSelection.near(tr.doc.resolve(taskListPos + 1), 1));
    } else {
      tr = tr.replaceWith(itemPos, itemEnd, paragraphType.create());
      tr = tr.setSelection(TextSelection.near(tr.doc.resolve(itemPos + 1), 1));
    }
    view.dispatch(tr.scrollIntoView());
    return true;
  }, []);

  const editorProps = useMemo(
    () => ({
      attributes: {
        class: `prose prose-zinc dark:prose-invert max-w-none focus:outline-none ${
          bodyOnly
            ? "md:px-12 py-4"
            : "md:px-12 py-8 min-h-[min(85vh,900px)]"
        } qn-prose-marquee-host`,
      },
      handlePaste: (view: import("@tiptap/pm/view").EditorView, event: ClipboardEvent) => {
        // image 는 image 노드, 그 외 file 항목은 fileBlock 노드로 삽입.
        // string item(text/html 등) 은 PM 기본 paste 흐름에 위임.
        const fileItems = extractClipboardFiles(event.clipboardData);
        if (fileItems.length > 0) {
          event.preventDefault();
          for (const item of fileItems) {
            const { file } = item;
            if (item.isImage && !isGifFile(file)) {
              void handleEditorInsertImage(file, (attrs) => {
                view.dispatch(
                  view.state.tr.replaceSelectionWith(
                    view.state.schema.nodes.image!.create(attrs),
                  ),
                );
              });
            } else {
              void insertFileFromFile(file, (attrs) => {
                const fileNode = view.state.schema.nodes.fileBlock?.create(attrs);
                if (!fileNode) return;
                view.dispatch(
                  view.state.tr.replaceSelectionWith(fileNode).scrollIntoView(),
                );
              });
            }
          }
          return true;
        }

        const text = event.clipboardData?.getData("text/plain")?.trim() ?? "";
        if (!text || /\s/.test(text)) return false;

        const internalTarget = parseQuickNoteLink(text);
        if (internalTarget) {
          event.preventDefault();
          const localTitle = usePageStore.getState().pages[internalTarget.pageId]?.title;
          const buttonType = view.state.schema.nodes.buttonBlock;
          if (!buttonType) return true;
          view.dispatch(
            view.state.tr.replaceSelectionWith(
              buttonType.create({
                label: quickNoteLinkLabel(localTitle, internalTarget),
                href: text,
              }),
            ),
          );
          // 로컬에 제목이 없는 타 워크스페이스 페이지면 제목을 비동기로 가져와 버튼 라벨을 갱신한다.
          if (!localTitle && internalTarget.workspaceId) {
            void applyCrossWorkspaceButtonLabel(view, text, internalTarget);
          }
          return true;
        }

        const normalizedUrl = sanitizeWebLinkHref(text);
        if (!normalizedUrl) return false;
        event.preventDefault();
        const coords = view.coordsAtPos(view.state.selection.from);
        const pos = clampFloatingPanelPosition(coords, {
          width: PASTE_URL_MENU_WIDTH,
          height: PASTE_URL_MENU_HEIGHT,
        });
        setPasteUrlChoice({
          url: normalizedUrl,
          range: { from: view.state.selection.from, to: view.state.selection.to },
          top: pos.top,
          left: pos.left,
        });
        return true;
      },
      handleDrop: createEditorHandleDrop({
        columnDropRef,
        clearColumnDropUi,
        clearBlockDropIndicator,
        insertImageFromFile: handleEditorInsertImage,
      }),
      handleDOMEvents: {
        mousedown: (view: PmEditorView, event: MouseEvent) => {
          armTextSelectionScrollDampener(view, event, editorScrollHostRef.current);
          return false;
        },
        dragover: createEditorHandleDragOver({
          showBlockDropIndicator: setBlockDropIndicator,
          clearBlockDropIndicator,
        }),
        dragleave: (view: PmEditorView, event: DragEvent) => {
          const next = event.relatedTarget;
          if (!(next instanceof Node) || !view.dom.contains(next)) {
            clearBlockDropIndicator();
          }
          return false;
        },
      },
      handleKeyDown(view: PmEditorView, event: KeyboardEvent) {
        if (handleBackspaceOnEmptyTaskItem(view, event)) return true;
        if (handleAtOpenMention(view, event)) return true;
        if (
          (event.ctrlKey || event.metaKey) &&
          event.shiftKey &&
          event.key.toLowerCase() === "v"
        ) {
          event.preventDefault();
          const ed = editorRef.current;
          if (ed && !ed.isDestroyed) {
            void pasteMarkdownAsDocContent(ed);
          }
          return true;
        }
        return false;
      },
      handleScrollToSelection: (view: PmEditorView) => {
        void view;
        void suppressScrollToSelectionForTableInteraction;
        void editorScrollHostRef;
        // PM/Tiptap 기본 selection follow-scroll을 전면 차단.
        return true;
      },
    }),
    [
      clearColumnDropUi,
      setBlockDropIndicator,
      clearBlockDropIndicator,
      handleEditorInsertImage,
      handleAtOpenMention,
      handleBackspaceOnEmptyTaskItem,
      setPasteUrlChoice,
      bodyOnly,
      columnDropRef,
      editorScrollHostRef,
      editorRef,
    ],
  );

  return editorProps;
}
