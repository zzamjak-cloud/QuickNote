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
} from "../../lib/navigation/quicknoteLinks";
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
            ? "px-12 py-4"
            : "px-12 py-8 min-h-[min(85vh,900px)]"
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
          const title = usePageStore.getState().pages[internalTarget.pageId]?.title;
          const buttonType = view.state.schema.nodes.buttonBlock;
          if (!buttonType) return true;
          view.dispatch(
            view.state.tr.replaceSelectionWith(
              buttonType.create({
                label: quickNoteLinkLabel(title, internalTarget),
                href: text,
              }),
            ),
          );
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
