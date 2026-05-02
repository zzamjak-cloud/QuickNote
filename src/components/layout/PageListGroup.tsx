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
  onMove: (id: string) => void;
};

export function PageListGroup({ nodes, depth, draggable, onMove }: Props) {
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
            onMove={onMove}
          />
        ))}
      </div>
    </SortableContext>
  );
}
