import type {
  CollisionDetection,
  DroppableContainer,
  UniqueIdentifier,
} from "@dnd-kit/core";

const ROW_ATTR = "data-sidebar-page-row";

function readDepth(el: Element): number {
  const v = el.getAttribute("data-sidebar-depth");
  if (v == null) return 0;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 사이드바 트리 충돌 감지: 정렬 가능 노드의 setNodeRef는 펼친 하위 목록을 포함할 수 있어
 * 기본 rect 충돌이 어긋난다. 실제 행(한 줄)인 [data-sidebar-page-row]만 사용하고,
 * 포인터가 여러 행과 겹치면 더 깊은(depth 큰) 행을 선택한다.
 */
export const sidebarPageTreeCollision: CollisionDetection = ({
  droppableContainers,
  pointerCoordinates,
}) => {
  if (!pointerCoordinates) return [];

  const { x, y } = pointerCoordinates;
  type Hit = { container: DroppableContainer; depth: number };
  const hits: Hit[] = [];

  for (const container of droppableContainers) {
    const id = String(container.id);
    const el = document.querySelector(`[${ROW_ATTR}="${CSS.escape(id)}"]`);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
    hits.push({ container, depth: readDepth(el) });
  }

  if (hits.length === 0) return [];

  hits.sort((a, b) => b.depth - a.depth);
  const best = hits[0]!;
  return [{ id: best.container.id as UniqueIdentifier }];
};

/** 행 우측 이 비율 이상이면 child(자식으로) 영역 */
export const CHILD_X_THRESHOLD = 0.42;
/** sibling 모드에서 위/아래 분할 경계 */
export const SIBLING_Y_THRESHOLD = 0.5;

/** 미세 흔들림 방지용 히스테리시스 (이전 모드 유지폭 — 8%) */
const HYST = 0.08;

export type SidebarDropMode =
  | "before"
  | "after"
  | "child-first"
  | "child-last"
  | "disabled";

export type SidebarDropHint = { overId: string; mode: SidebarDropMode };

function rowRect(overId: string): DOMRect | null {
  const el = document.querySelector(
    `[${ROW_ATTR}="${CSS.escape(overId)}"]`,
  ) as Element | null;
  if (!el) return null;
  return el.getBoundingClientRect();
}

export type ResolveDropArgs = {
  overId: string;
  activeId: string;
  clientX: number;
  clientY: number;
  prev: SidebarDropHint | null;
  /** activeId 자기 자신·자손인지 판정 (movePage 차단 사유와 동일하게 미리 차단) */
  isBlocked: (overId: string) => boolean;
  /** child 모드일 때 first/last 분할에 yRatio 사용. 펼쳐진 노드는 last로 단순화. */
  isExpanded: (overId: string) => boolean;
};

/**
 * UI 표시·드롭 확정 모두 동일한 함수에서 모드를 산출 → UI/확정 어긋남 제거.
 * 영역 분할:
 *   1) over === active 또는 active 자손 → disabled
 *   2) xRatio >= 0.42 → child 영역 → 펼침=child-last, 접힘=yRatio<0.5?first:last
 *   3) xRatio <  0.42 → sibling 영역 → yRatio<0.5?before:after
 * 히스테리시스는 같은 overId일 때 이전 모드의 같은 영역 안에서만 적용.
 */
export function resolveSidebarDrop(args: ResolveDropArgs): SidebarDropHint {
  const { overId, activeId, clientX, clientY, prev, isBlocked, isExpanded } =
    args;

  if (overId === activeId || isBlocked(overId)) {
    return { overId, mode: "disabled" };
  }

  const r = rowRect(overId);
  if (!r) return { overId, mode: "disabled" };

  const xRatio = (clientX - r.left) / Math.max(r.width, 1);
  const yRatio = (clientY - r.top) / Math.max(r.height, 1);
  const sameTarget = prev?.overId === overId;

  // 1) child 영역 판정 (X축, 히스테리시스)
  let inChildArea: boolean;
  if (
    sameTarget &&
    (prev?.mode === "child-first" || prev?.mode === "child-last")
  ) {
    // child 유지: 0.42-HYST(=0.34) 이상이면 유지
    inChildArea = xRatio >= CHILD_X_THRESHOLD - HYST;
  } else if (sameTarget && (prev?.mode === "before" || prev?.mode === "after")) {
    // sibling 유지: 0.42+HYST(=0.50) 이상이어야 child로 진입
    inChildArea = xRatio >= CHILD_X_THRESHOLD + HYST;
  } else {
    inChildArea = xRatio >= CHILD_X_THRESHOLD;
  }

  if (inChildArea) {
    if (isExpanded(overId)) return { overId, mode: "child-last" };
    // 접힘: y 분할 — 가운데 영역에서 미세흔들림 방지 히스테리시스
    let firstHalf: boolean;
    if (sameTarget && prev?.mode === "child-first") {
      firstHalf = yRatio < SIBLING_Y_THRESHOLD + HYST;
    } else if (sameTarget && prev?.mode === "child-last") {
      firstHalf = yRatio < SIBLING_Y_THRESHOLD - HYST;
    } else {
      firstHalf = yRatio < SIBLING_Y_THRESHOLD;
    }
    return { overId, mode: firstHalf ? "child-first" : "child-last" };
  }

  // 2) sibling 영역
  let beforeHalf: boolean;
  if (sameTarget && prev?.mode === "before") {
    beforeHalf = yRatio < SIBLING_Y_THRESHOLD + HYST;
  } else if (sameTarget && prev?.mode === "after") {
    beforeHalf = yRatio < SIBLING_Y_THRESHOLD - HYST;
  } else {
    beforeHalf = yRatio < SIBLING_Y_THRESHOLD;
  }
  return { overId, mode: beforeHalf ? "before" : "after" };
}
