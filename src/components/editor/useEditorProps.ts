import { useMemo } from "react";
import type { MutableRefObject } from "react";
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

type InsertImageFn = Parameters<typeof insertImageFromFile>[1];

type UseEditorPropsParams = {
  bodyOnly: boolean;
  columnDropRef: MutableRefObject<ColumnDropState | null>;
  clearColumnDropUi: () => void;
  clearBlockDropIndicator: () => void;
  setBlockDropIndicator: (rect: BlockDropIndicatorRect | null) => void;
  handleEditorInsertImage: (file: File, insert: InsertImageFn) => void;
  handleAtOpenMention: (view: PmEditorView, event: KeyboardEvent) => boolean;
  setPasteUrlChoice: (choice: {
    url: string;
    range: { from: number; to: number };
    top: number;
    left: number;
  } | null) => void;
  editorScrollHostRef: MutableRefObject<HTMLDivElement | null>;
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
}: UseEditorPropsParams) {
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
        if (handleAtOpenMention(view, event)) return true;
        return false;
      },
      handleScrollToSelection: (view: PmEditorView) => {
        if (suppressScrollToSelectionForTableInteraction(view)) return true;
        const host = editorScrollHostRef.current;
        if (!host) return false;
        const { from } = view.state.selection;
        try {
          const coords = view.coordsAtPos(from);
          const rect = host.getBoundingClientRect();
          // 커서가 이미 뷰포트 안에 있으면 PM의 자동 스크롤 억제
          if (coords.top >= rect.top && coords.bottom <= rect.bottom) return true;
        } catch {
          // coordsAtPos가 실패하면 기본 동작에 위임
        }
        return false;
      },
    }),
    [
      clearColumnDropUi,
      setBlockDropIndicator,
      clearBlockDropIndicator,
      handleEditorInsertImage,
      handleAtOpenMention,
      setPasteUrlChoice,
      bodyOnly,
      columnDropRef,
      editorScrollHostRef,
    ],
  );

  return editorProps;
}
