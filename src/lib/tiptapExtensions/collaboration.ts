// Yjs 공동 편집을 TipTap 에 연결하는 확장.
// - ySyncPlugin: Y.XmlFragment 와 PM 문서를 양방향 바인딩(본문 권위 소스 = Y.Doc).
// - yUndoPlugin: 협업 환경용 undo/redo(native history 대체).
// - yCursorPlugin: awareness 기반 원격 커서·선택 영역 렌더링.
// 사용 시 StarterKit 의 history/undoRedo 를 반드시 꺼야 한다.
import { Extension } from "@tiptap/core";
import { Plugin, Selection } from "@tiptap/pm/state";
import {
  ySyncPlugin,
  yUndoPlugin,
  yCursorPlugin,
  undo,
  redo,
} from "y-prosemirror";
import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { YJS_XML_FRAGMENT } from "../collab/yjsDoc";

export type CollaborationOptions = {
  doc: Y.Doc | null;
  awareness: Awareness | null;
};

export const Collaboration = Extension.create<CollaborationOptions>({
  name: "qnCollaboration",

  addOptions() {
    return { doc: null, awareness: null };
  },

  addProseMirrorPlugins() {
    const doc = this.options.doc;
    if (!doc) return [];
    const fragment = doc.getXmlFragment(YJS_XML_FRAGMENT);
    // Plugin[] 로 명시하여 ySyncPlugin/yUndoPlugin/yCursorPlugin 제네릭 불일치 방지
    const plugins: Plugin[] = [ySyncPlugin(fragment), yUndoPlugin()];
    const awareness = this.options.awareness;
    if (awareness) {
      plugins.push(
        yCursorPlugin(awareness, {
          // user.color 는 collabColor 가 보장하는 #RRGGBB. 라벨에 이름 표시.
          cursorBuilder: (user: { name?: string; color?: string }) => {
            const cursor = document.createElement("span");
            cursor.classList.add("qn-collab-cursor");
            cursor.setAttribute("style", `border-color: ${user.color ?? "#2563eb"}`);
            const label = document.createElement("div");
            label.classList.add("qn-collab-cursor-label");
            label.setAttribute("style", `background-color: ${user.color ?? "#2563eb"}`);
            label.insertBefore(document.createTextNode(user.name ?? "?"), null);
            cursor.insertBefore(document.createTextNode("⁠"), null);
            cursor.insertBefore(label, null);
            cursor.insertBefore(document.createTextNode("⁠"), null);
            return cursor;
          },
          selectionBuilder: (user: { color?: string }) => ({
            style: `background-color: ${user.color ?? "#2563eb"}40`,
            class: "qn-collab-selection",
          }),
        }),
      );
    }
    // selection 가드: 첫 노드가 callout 등 inline content 없는 block 인 문서에서 ySyncPlugin 의
    // selection 복원이 비-textblock 에 endpoint 를 만들면 ProseMirror 보정이 폭주(콜스택 초과)한다.
    // apply 단계에서 1회 안전 위치로 보정해 끊는다(보정 후엔 textblock 이라 재트리거 없음).
    plugins.push(
      new Plugin({
        appendTransaction: (_trs, _oldState, state) => {
          const sel = state.selection;
          if (sel.$from.parent.inlineContent && sel.$to.parent.inlineContent) return null;
          const near = Selection.near(
            state.doc.resolve(Math.min(sel.from, state.doc.content.size)),
            1,
          );
          return near.eq(sel) ? null : state.tr.setSelection(near);
        },
      }),
    );
    return plugins;
  },

  addKeyboardShortcuts(): Record<string, () => boolean> {
    if (!this.options.doc) return {};
    return {
      "Mod-z": () => undo(this.editor.state),
      "Mod-y": () => redo(this.editor.state),
      "Mod-Shift-z": () => redo(this.editor.state),
    };
  },
});
