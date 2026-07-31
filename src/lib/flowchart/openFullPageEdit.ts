// 피크(항목 미리보기) 안의 플로우차트를 "전체 페이지 전환 → 편집 모달"로 여는 브릿지.
// 전체 페이지 전환 로직은 DatabaseRowPeek 내부(openFullPage)에 있으므로 이벤트로 전환을
// 요청하고, 전환 후 전체 페이지에서 마운트되는 블록이 pending 편집 예약을 소비해 모달을 연다.

export const FLOWCHART_OPEN_FULL_PAGE_EVENT = "quicknote:flowchart-open-full-page";

// 전환 직후 마운트되는 블록만 소비하도록 짧은 유효기간을 둔다.
const PENDING_TTL_MS = 15_000;

let pending: { flowchartId: string; at: number } | null = null;

/** 피크 내부에서 호출 — 전체 페이지 전환을 요청하고 편집 대상 플로우차트를 예약한다. */
export function requestFlowchartEditOnFullPage(flowchartId: string): void {
  pending = { flowchartId, at: Date.now() };
  window.dispatchEvent(new Event(FLOWCHART_OPEN_FULL_PAGE_EVENT));
}

/** 전체 페이지에서 마운트된 블록이 호출 — 자신의 편집 예약이면 소비하고 true 를 돌려준다. */
export function consumePendingFlowchartEdit(flowchartId: string): boolean {
  if (!pending) return false;
  if (Date.now() - pending.at >= PENDING_TTL_MS) {
    pending = null;
    return false;
  }
  if (pending.flowchartId !== flowchartId) return false;
  pending = null;
  return true;
}
