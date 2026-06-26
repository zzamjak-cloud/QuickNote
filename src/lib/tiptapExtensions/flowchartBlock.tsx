import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { FlowchartBlockView } from "../../components/flowchart/FlowchartBlockView";
import {
  emptyFlowchart,
  serializeFlowchart,
  FLOWCHART_SCHEMA_VERSION,
} from "../../types/flowchart";
import { newId } from "../id";

export type FlowchartBlockAttrs = {
  /**
   * 공유 자원 참조 id. 같은 id 를 쓰는 모든 블록(복제본 포함)이 flowchartStore/서버에서
   * 동일 데이터를 읽어 동기화된다. 빈 문자열이면 레거시(인라인 전용) 블록.
   */
  flowchartId: string;
  /** 인라인 스냅샷/오프라인 fallback. 공유 저장소가 비었을 때 시드로 쓴다. */
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
      flowchartId: {
        default: "",
      },
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
              flowchartId: newId(),
              data: serializeFlowchart(emptyFlowchart()),
              version: FLOWCHART_SCHEMA_VERSION,
            },
          }),
    };
  },
});
