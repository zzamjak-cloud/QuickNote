import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { FlowchartBlockView } from "../../components/flowchart/FlowchartBlockView";
import {
  emptyFlowchart,
  serializeFlowchart,
  FLOWCHART_SCHEMA_VERSION,
} from "../../types/flowchart";

export type FlowchartBlockAttrs = {
  /** FlowchartData 를 JSON 문자열로 1회 인코딩해 보관 (Yjs 통짜 교체 안전) */
  data: string;
  /** 블록 단위 스키마 버전 */
  version: number;
  /** 블록 헤더에 표시할 제목 */
  title: string;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    flowchartBlock: {
      /** 빈 플로우차트 블록을 현재 위치에 삽입 */
      insertFlowchartBlock: () => ReturnType;
    };
  }
}

export const FlowchartBlock = Node.create({
  name: "flowchartBlock",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      data: {
        default: serializeFlowchart(emptyFlowchart()),
      },
      version: {
        default: FLOWCHART_SCHEMA_VERSION,
      },
      title: {
        default: "",
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-flowchart-block="true"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-flowchart-block": "true" }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FlowchartBlockView);
  },

  addCommands() {
    return {
      insertFlowchartBlock:
        () =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: {
              data: serializeFlowchart(emptyFlowchart()),
              version: FLOWCHART_SCHEMA_VERSION,
            },
          }),
    };
  },
});
