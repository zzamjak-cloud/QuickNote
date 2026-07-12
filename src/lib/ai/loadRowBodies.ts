// AI 컨텍스트용 행 본문 일괄 프리페치 — lazy 로딩된 행 페이지 본문을 제한 동시성으로 로드.
import { ensurePageContentLoaded } from "../sync/pageContentLoad";

const CONCURRENCY = 6;

/** 여러 페이지 본문을 동시성 제한으로 로드. 개별 실패는 무시(부분 성공 허용). */
export async function loadPageBodies(pageIds: string[]): Promise<void> {
  const queue = [...pageIds];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const pageId = queue.shift();
      if (!pageId) return;
      try {
        await ensurePageContentLoaded({ pageId, source: "ai-context" });
      } catch {
        // 개별 행 실패는 무시 — 컨텍스트에 "미로드 N행" 으로 고지됨
      }
    }
  });
  await Promise.all(workers);
}
