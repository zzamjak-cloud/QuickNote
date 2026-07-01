// 2단계(mark-and-confirm) 고아 판정 — 순수 로직.
//
// 협업(Yjs) 지연·부분 스캔 실패 같은 "일시적으로 참조가 안 보이는" 상황에서
// 즉시 삭제하면 사용 중 자산이 지워진다(2026-07 사고). 그래서:
//   1) 처음 고아로 보이면 orphanSince 마킹만 하고,
//   2) ORPHAN_CONFIRM_DAYS 동안 연속으로 고아일 때만 삭제 대상으로 확정한다.
//   3) 그 사이 참조가 다시 보이면 마킹을 해제(reclaim)한다.

export const ORPHAN_CONFIRM_DAYS = 7;

export type AssetRow = {
  id: string;
  key?: string;
  orphanSince?: string;
};

export type OrphanPlan = {
  /** 이번 런에 orphanSince 를 새로 마킹할 자산 */
  toMark: AssetRow[];
  /** 확정 기간을 채워 삭제할 자산 */
  toDelete: AssetRow[];
  /** 다시 참조가 보여 orphanSince 를 해제할 자산 */
  toReclaim: AssetRow[];
};

export function planOrphans(
  rows: AssetRow[],
  reachable: Set<string>,
  nowMs: number,
  confirmDays: number = ORPHAN_CONFIRM_DAYS,
): OrphanPlan {
  const confirmCutoff = nowMs - confirmDays * 24 * 60 * 60 * 1000;
  const plan: OrphanPlan = { toMark: [], toDelete: [], toReclaim: [] };
  for (const row of rows) {
    if (reachable.has(row.id)) {
      if (row.orphanSince) plan.toReclaim.push(row);
      continue;
    }
    if (!row.orphanSince) {
      plan.toMark.push(row);
      continue;
    }
    const since = Date.parse(row.orphanSince);
    // 파싱 불가한 orphanSince 는 삭제하지 않고 재마킹 대상으로 취급(안전 우선).
    if (Number.isNaN(since)) {
      plan.toMark.push(row);
      continue;
    }
    if (since < confirmCutoff) plan.toDelete.push(row);
    // 확정 기간 미달이면 아무것도 안 함(마킹 유지, 다음 런에서 재평가).
  }
  return plan;
}
