// Yjs 공동 편집을 TipTap 에 연결하는 확장.
// - ySyncPlugin: Y.XmlFragment 와 PM 문서를 양방향 바인딩(본문 권위 소스 = Y.Doc).
// - yUndoPlugin: 협업 환경용 undo/redo(native history 대체).
// 사용 시 StarterKit 의 history/undoRedo 를 반드시 꺼야 한다.
import { Extension } from "@tiptap/core";
import {
  ySyncPlugin,
  yUndoPlugin,
  undo,
  redo,
} from "y-prosemirror";
import type * as Y from "yjs";
import { YJS_XML_FRAGMENT } from "../collab/yjsDoc";

export type CollaborationOptions = {
  doc: Y.Doc | null;
};

export const Collaboration = Extension.create<CollaborationOptions>({
  name: "qnCollaboration",

  addOptions() {
    return { doc: null };
  },

  addProseMirrorPlugins() {
    const doc = this.options.doc;
    if (!doc) return [];
    const fragment = doc.getXmlFragment(YJS_XML_FRAGMENT);
    return [ySyncPlugin(fragment), yUndoPlugin()];
  },

  addKeyboardShortcuts() {
    if (!this.options.doc) return {};
    return {
      "Mod-z": () => undo(this.editor.state),
      "Mod-y": () => redo(this.editor.state),
      "Mod-Shift-z": () => redo(this.editor.state),
    };
  },
});
