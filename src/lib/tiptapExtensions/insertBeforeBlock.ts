import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";

export function syncInsertBeforeBlockSelection(
  editor: Editor,
  boxSelectedStarts: readonly number[],
): void {
  const storage = (editor.storage as { insertBeforeBlock?: { boxSelectedStarts?: number[] } })
    .insertBeforeBlock as
    | { boxSelectedStarts?: number[] }
    | undefined;
  if (!storage) return;
  storage.boxSelectedStarts = [...boxSelectedStarts];
}

/**
 * Alt+Enter: 현재 커서가 있는 doc 최상위 블럭의 위에 빈 paragraph를 삽입하고 커서를 이동.
 * 박스 드래그 선택 후에도 선택된 블럭 중 가장 앞 블럭 기준으로 동작.
 * ProseMirror 플러그인으로 구현해 macOS IME(한자 변환) 이벤트보다 먼저 preventDefault 처리.
 */
export const InsertBeforeBlock = Extension.create({
  name: "insertBeforeBlock",

  addStorage() {
    return {
      boxSelectedStarts: [] as number[],
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("insertBeforeBlock"),
        props: {
          handleKeyDown: (view, event) => {
            if (!event.altKey || event.key !== "Enter") return false;

            const { state } = view;
            const storage = (view.state as unknown as { plugins: unknown[] }) && this.storage;
            const boxSelectedStarts: number[] = storage?.boxSelectedStarts ?? [];

            let blockStart: number;
            if (boxSelectedStarts.length > 0) {
              const minPos = Math.min(...boxSelectedStarts);
              const $pos = state.doc.resolve(minPos);
              blockStart = $pos.before(1);
            } else {
              const { $from } = state.selection;
              blockStart = $from.before(1);
            }

            const paragraphType = state.schema.nodes.paragraph;
            if (!paragraphType) return false;

            // macOS IME 한자 변환 팝업 방지
            event.preventDefault();
            event.stopPropagation();

            const paragraphNode = paragraphType.create();
            const tr = state.tr.insert(blockStart, paragraphNode);
            const resolvedPos = tr.doc.resolve(blockStart + 1);
            tr.setSelection(TextSelection.near(resolvedPos));
            view.dispatch(tr);
            return true;
          },
        },
      }),
    ];
  },
});
