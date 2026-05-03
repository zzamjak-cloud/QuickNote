import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import {
  DatabaseBlockView,
} from "../../components/database/DatabaseBlockView";
import type { DatabaseLayout, ViewKind } from "../../types/database";
import { emptyPanelState } from "../../types/database";

export type DatabaseBlockAttrs = {
  databaseId: string;
  layout: DatabaseLayout;
  view: ViewKind;
  panelState: string;
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
