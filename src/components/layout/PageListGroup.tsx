import type { SidebarDropMode } from "../../lib/sidebarPageTreeCollision";
import type { PageNode } from "../../store/pageStore";
import { PageListItem } from "./PageListItem";

type Props = {
  nodes: PageNode[];
  depth: number;
  draggable: boolean;
  onMove: (id: string) => void;
  dropTarget: { id: string; mode: SidebarDropMode } | null;
};

export function PageListGroup({
  nodes,
  depth,
  draggable,
  onMove,
  dropTarget,
}: Props) {
  return (
    <div className="flex flex-col gap-0.5">
      {nodes.map((node) => (
        <PageListItem
          key={node.id}
          node={node}
          depth={depth}
          draggable={draggable}
          onMove={onMove}
          dropTarget={dropTarget}
        />
      ))}
    </div>
  );
}
