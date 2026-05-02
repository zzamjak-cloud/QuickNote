import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { PageNode } from "../../store/pageStore";
import { PageListItem } from "./PageListItem";

type Props = {
  nodes: PageNode[];
  depth: number;
  draggable: boolean;
};

// 같은 부모를 공유하는 형제들의 SortableContext.
// 형제 정렬은 dnd-kit이 처리한다. 부모 변경은 우클릭 메뉴 또는 루트 이동 액션으로.
export function PageListGroup({ nodes, depth, draggable }: Props) {
  return (
    <SortableContext
      items={nodes.map((n) => n.id)}
      strategy={verticalListSortingStrategy}
    >
      <div className="flex flex-col gap-0.5">
        {nodes.map((node) => (
          <PageListItem
            key={node.id}
            node={node}
            depth={depth}
            draggable={draggable}
          />
        ))}
      </div>
    </SortableContext>
  );
}
