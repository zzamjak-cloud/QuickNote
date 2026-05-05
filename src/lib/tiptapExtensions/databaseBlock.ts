import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { DatabaseBlockView } from "../../components/database/DatabaseBlockView";
import type { DatabaseLayout, ViewKind } from "../../types/database";
import { emptyPanelState } from "../../types/database";

export type DatabaseBlockAttrs = {
  databaseId: string;
  layout: DatabaseLayout;
  view: ViewKind;
  panelState: string;
  /** 인라인에서 "다른 DB 연결"으로 바꾼 경우 등 — 블록 안에서 제목 편집 금지 */
  readOnlyTitle?: boolean;
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
});
