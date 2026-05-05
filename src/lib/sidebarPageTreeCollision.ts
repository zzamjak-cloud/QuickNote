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
 *
 * 첫 행보다 위 / 마지막 행보다 아래 영역에서도 드롭 가능하도록 — rect 안 hit 가 없을 때
 * 동일 X 범위 안의 가장 가까운 행을 폴백으로 반환한다(노션처럼 끝으로 자연스러운 이동).
 */
export const sidebarPageTreeCollision: CollisionDetection = ({
  droppableContainers,
  pointerCoordinates,
}) => {
  if (!pointerCoordinates) return [];

  const { x, y } = pointerCoordinates;
  type Hit = { container: DroppableContainer; depth: number };
  type Row = { container: DroppableContainer; rect: DOMRect; depth: number };
  const hits: Hit[] = [];
  const rows: Row[] = [];

  for (const container of droppableContainers) {
    const id = String(container.id);
    const el = document.querySelector(`[${ROW_ATTR}="${CSS.escape(id)}"]`);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    rows.push({ container, rect, depth: readDepth(el) });
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
    hits.push({ container, depth: readDepth(el) });
  }

  if (hits.length > 0) {
    hits.sort((a, b) => b.depth - a.depth);
    return [{ id: hits[0]!.container.id as UniqueIdentifier }];
  }

  // 폴백: pointer 가 어떤 행 rect 안에도 없을 때 — 동일 X 범위 안의 행 중 Y 가 가장 가까운 행.
  // 첫 행 위(맨 위로 이동)·마지막 행 아래(맨 아래로 이동) 의 광역 드롭존 역할.
  let best: Row | null = null;
  let bestDist = Infinity;
  for (const r of rows) {
    if (x < r.rect.left || x > r.rect.right) continue;
    const cy = (r.rect.top + r.rect.bottom) / 2;
    const dist = Math.abs(y - cy);
    if (dist < bestDist) {
      bestDist = dist;
      best = r;
    }
  }
  if (best) return [{ id: best.container.id as UniqueIdentifier }];
  return [];
};

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
  clientY: number;
  prev: SidebarDropHint | null;
  /** activeId 자기 자신·자손인지 판정 (movePage 차단 사유와 동일하게 미리 차단) */
  isBlocked: (overId: string) => boolean;
  /** 펼친 행 위 "after" 드롭은 자동으로 "child-first"(첫 자식)로 해석 */
  isExpanded: (overId: string) => boolean;
};

/**
 * 노션 스타일 — 가로 좌표는 사용하지 않는다.
 *   1) over === active 또는 active 자손 → disabled
 *   2) yRatio < 0.5 → before(같은 부모 안 형제, over 앞)
 *   3) yRatio ≥ 0.5 → after
 *      - over 가 펼쳐져 있으면(자식이 화면에 노출됨) "after" 가 시각적으로 첫 자식 위치를
 *        가리키므로 자동 "child-first"(첫 자식) 로 변환
 *      - 그 외엔 over 의 형제 다음으로
 * 히스테리시스는 같은 overId 일 때만 적용해 0.5 근처 흔들림 방지.
 */
export function resolveSidebarDrop(args: ResolveDropArgs): SidebarDropHint {
  const { overId, activeId, clientY, prev, isBlocked, isExpanded } = args;

  if (overId === activeId || isBlocked(overId)) {
    return { overId, mode: "disabled" };
  }

  const r = rowRect(overId);
  if (!r) return { overId, mode: "disabled" };

  const yRatio = (clientY - r.top) / Math.max(r.height, 1);
  const sameTarget = prev?.overId === overId;

  let beforeHalf: boolean;
  if (sameTarget && prev?.mode === "before") {
    beforeHalf = yRatio < SIBLING_Y_THRESHOLD + HYST;
  } else if (
    sameTarget &&
    (prev?.mode === "after" || prev?.mode === "child-first")
  ) {
    beforeHalf = yRatio < SIBLING_Y_THRESHOLD - HYST;
  } else {
    beforeHalf = yRatio < SIBLING_Y_THRESHOLD;
  }

  if (beforeHalf) return { overId, mode: "before" };
  if (isExpanded(overId)) return { overId, mode: "child-first" };
  return { overId, mode: "after" };
}
