// 휴지통 페이지 / DB 영구삭제 등 N건의 per-id 삭제를 청크 단위 병렬로 실행하고
// 실시간 진행률을 콜백으로 흘려준다. UI 측에서 toast·라벨·tombstone 처리는 자유롭게.
//
// 사용처:
// - TrashDialog: 휴지통 페이지 일괄 영구삭제
// - DatabaseManagerDialog: 선택한 삭제된 DB 일괄 영구삭제
//
// 새 도메인이 추가되어도 deleteRemote / onItemSuccess 만 갈아끼우면 됨.

export type ChunkedDeleteItem = {
  id: string;
  workspaceId: string;
};

export type ChunkedDeleteOpts = {
  /** 서버에 단건 영구삭제 요청 — 404/이미 사라짐은 호출 측에서 성공으로 처리 */
  deleteRemote: (id: string, workspaceId: string) => Promise<unknown>;
  /** 성공 직후 로컬 정리(스토어 캐시 제거, tombstone, 즐겨찾기 등) */
  onItemSuccess?: (item: ChunkedDeleteItem) => void;
  /** 실패 발생 시 로깅·통계 등 */
  onItemFailure?: (item: ChunkedDeleteItem, err: unknown) => void;
  /** 진행률 콜백 — done/total. UI 가 "N/M개 삭제중" 표시할 때 사용 */
  onProgress?: (done: number, total: number) => void;
  /** 병렬 워커 수 (기본 4) — 서버 부하·QPS 와 트레이드오프 */
  concurrency?: number;
};

export type ChunkedDeleteResult = {
  deletedCount: number;
  failedCount: number;
};

/**
 * items 배열을 동시 concurrency 개 워커로 영구삭제하고 결과 통계를 반환.
 * 워커는 첫 cursor 단어를 가져가며 race 없이 순차 소비한다.
 */
export async function runChunkedPermanentDelete(
  items: readonly ChunkedDeleteItem[],
  opts: ChunkedDeleteOpts,
): Promise<ChunkedDeleteResult> {
  const total = items.length;
  if (total === 0) return { deletedCount: 0, failedCount: 0 };

  const { deleteRemote, onItemSuccess, onItemFailure, onProgress, concurrency = 4 } = opts;

  let deletedCount = 0;
  let failedCount = 0;
  let cursorIdx = 0;
  const nextItem = (): ChunkedDeleteItem | null =>
    cursorIdx < total ? items[cursorIdx++]! : null;

  const worker = async (): Promise<void> => {
    while (true) {
      const item = nextItem();
      if (!item) return;
      try {
        await deleteRemote(item.id, item.workspaceId);
        onItemSuccess?.(item);
        deletedCount += 1;
      } catch (err) {
        console.error("[chunkedPermanentDelete] 실패", item, err);
        onItemFailure?.(item, err);
        failedCount += 1;
      } finally {
        onProgress?.(deletedCount + failedCount, total);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, total)) }, () => worker()),
  );
  return { deletedCount, failedCount };
}
