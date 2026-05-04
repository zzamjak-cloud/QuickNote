import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import {
  DatabaseBlockView,
} from "../../components/database/DatabaseBlockView";
import type { DatabaseLayout, ViewKind } from "../../types/database";
import { emptyPanelState } from "../../types/database";
import { forEachDocDirectBlock } from "../pm/topLevelBlocks";

export const databaseBlockDeletionLockPluginKey = new PluginKey(
  "databaseBlockDeletionLock",
);

function collectLockedDatabasePositions(doc: import("@tiptap/pm/model").Node) {
  const out: { pos: number; databaseId: string }[] = [];
  forEachDocDirectBlock(doc, (node, pos) => {
    if (node.type.name === "databaseBlock" && node.attrs.deletionLocked) {
      out.push({
        pos,
        databaseId: String(node.attrs.databaseId ?? ""),
      });
    }
  });
  return out;
}

export type DatabaseBlockAttrs = {
  databaseId: string;
  layout: DatabaseLayout;
  view: ViewKind;
  panelState: string;
  /** 인라인에서 "다른 DB 연결"으로 바꾼 경우 등 — 블록 안에서 제목 편집 금지 */
  readOnlyTitle?: boolean;
  /** 인라인 DB — 문서에서 블록 삭제(키보드·박스 선택 등) 방지 */
  deletionLocked?: boolean;
};

export const DatabaseBlock = Node.create({
  name: "databaseBlock",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      databaseId: {
        default: "",
      },
      layout: {
        default: "inline" satisfies DatabaseLayout,
      },
      view: {
        default: "table" satisfies ViewKind,
      },
      panelState: {
        default: JSON.stringify(emptyPanelState()),
      },
      readOnlyTitle: {
        default: false,
      },
      deletionLocked: {
        default: false,
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-database-block="true"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-database-block": "true" }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DatabaseBlockView);
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: databaseBlockDeletionLockPluginKey,
        filterTransaction(tr, oldState) {
          if (!tr.docChanged) return true;
          const lockedBefore = collectLockedDatabasePositions(oldState.doc);
          if (lockedBefore.length === 0) return true;
          for (const { pos, databaseId } of lockedBefore) {
            const oldNode = oldState.doc.nodeAt(pos);
            if (
              !oldNode ||
              oldNode.type.name !== "databaseBlock" ||
              !oldNode.attrs.deletionLocked
            ) {
              continue;
            }
            const inner = pos + 1;
            const mapRes = tr.mapping.mapResult(inner);
            if (mapRes.deleted) return false;
            const mappedStart = tr.mapping.map(pos, -1);
            const newNode = tr.doc.nodeAt(mappedStart);
            if (
              !newNode ||
              newNode.type.name !== "databaseBlock" ||
              String(newNode.attrs.databaseId ?? "") !== databaseId
            ) {
              return false;
            }
          }
          return true;
        },
      }),
    ];
  },
});
