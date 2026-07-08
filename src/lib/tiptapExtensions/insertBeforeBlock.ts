import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { ResolvedPos } from "@tiptap/pm/model";

/**
 * Alt+Enter 삽입 기준 위치. 컬럼 안에 있으면 "컬럼 내부의 현재 최상위 블럭" 앞,
 * 아니면 doc 최상위 블럭 앞. (컬럼 내부 이미지에서 Alt+Enter 시 컬럼 전체 바깥이 아니라
 * 컬럼 안 이미지 앞에 빈 문단이 생기도록 — before(1) 은 항상 columnLayout 밖을 가리킴)
 */
function insertBeforePos($pos: ResolvedPos): number {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.name === "column") {
      return $pos.posAtIndex($pos.index(depth), depth);
    }
  }
  return $pos.before(1);
}

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
 * 토글·제목 토글 헤더(toggleHeader) 포함. (예전 Shift+Enter 동작)
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
              blockStart = insertBeforePos(state.doc.resolve(minPos));
            } else {
              blockStart = insertBeforePos(state.selection.$from);
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
