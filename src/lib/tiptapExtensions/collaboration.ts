// Yjs 공동 편집을 TipTap 에 연결하는 확장.
// - ySyncPlugin: Y.XmlFragment 와 PM 문서를 양방향 바인딩(본문 권위 소스 = Y.Doc).
// - yUndoPlugin: 협업 환경용 undo/redo(native history 대체).
// - yCursorPlugin: awareness 기반 원격 커서·선택 영역 렌더링.
// 사용 시 StarterKit 의 history/undoRedo 를 반드시 꺼야 한다.
import { Extension } from "@tiptap/core";
import { NodeSelection, Plugin, Selection, TextSelection } from "@tiptap/pm/state";
import {
  ySyncPlugin,
  ySyncPluginKey,
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
          // TextSelection 만 보정 대상 — CellSelection(표 셀)·NodeSelection 은
          // 끝점 부모가 inlineContent 가 아닌 것이 정상이므로 보존해야 한다.
          // (이를 보정하면 표 셀 선택이 생성 즉시 TextSelection 으로 되돌아가 무력화됨)
          if (!(sel instanceof TextSelection)) return null;
          if (sel.$from.parent.inlineContent && sel.$to.parent.inlineContent) return null;
          const near = Selection.near(
            state.doc.resolve(Math.min(sel.from, state.doc.content.size)),
            1,
          );
          return near.eq(sel) ? null : state.tr.setSelection(near);
        },
      }),
    );
    // NodeSelection 복원 가드: y-prosemirror 는 원격 update 후 selection 을 relative position
    // 기반 TextSelection 으로만 복원한다. 이미지/파일 블록을 선택 중일 때 원격 편집이 도착하면
    // NodeSelection 이 붕괴 → 버블 툴바(와 그 안의 아웃라인 팝업)가 닫히는 간헐 증상의 원인.
    // 원격(ySync) 트랜잭션으로만 selection 이 붕괴했고 매핑 위치에 같은 타입 노드가 살아있으면 되살린다.
    plugins.push(
      new Plugin({
        appendTransaction: (trs, oldState, state) => {
          const oldSel = oldState.selection;
          if (!(oldSel instanceof NodeSelection)) return null;
          const typeName = oldSel.node.type.name;
          if (typeName !== "image" && typeName !== "fileBlock") return null;
          if (state.selection instanceof NodeSelection) return null;
          // 원격 ySync 트랜잭션이 포함된 경우만 복원 — 로컬 클릭/입력의 의도적 변경은 존중.
          if (!trs.some((tr) => tr.getMeta(ySyncPluginKey))) return null;
          if (trs.some((tr) => tr.selectionSet && !tr.getMeta(ySyncPluginKey))) {
            return null;
          }
          let pos = oldSel.from;
          for (const tr of trs) pos = tr.mapping.map(pos);
          if (pos < 0 || pos >= state.doc.content.size) return null;
          const node = state.doc.nodeAt(pos);
          // 원격에서 해당 노드가 삭제/변형됐으면 복원하지 않는다.
          if (!node || node.type.name !== typeName) return null;
          return state.tr.setSelection(NodeSelection.create(state.doc, pos));
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
