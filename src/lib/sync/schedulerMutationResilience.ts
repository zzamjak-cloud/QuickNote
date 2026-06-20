// 스케줄러 mutation 견고화 — outbox(fire-and-forget) 와 달리 호출처가 서버 반환값에
// 동기 의존하므로 여기서 처리한다(5.1 에서 직접 호출을 의도적으로 유지).
//  (1) 실패 관측: 최종 실패 시 reportNonFatal 로 보고 후 호출처로 재던짐(fail-closed 계약 유지).
//  (2) 제한적 재시도: 멱등 안전한 op(update/delete/upsert — id 주소지정)에 한해
//      일시적 네트워크 오류 시 짧은 백오프로 재시도. create/lock/unlock/review 류는
//      중복 생성·이중 적용 위험이 있어 재시도하지 않는다(관측만).
// 성공 경로는 기존과 바이트 동일 — 반환값을 그대로 전달한다.

import { reportNonFatal } from "../reportNonFatal";

function errorMessage(error: unknown): string {
  const errors = (error as { errors?: Array<{ message?: string }> } | null)?.errors;
  const first = Array.isArray(errors) ? errors[0]?.message : undefined;
  return String(first ?? (error instanceof Error ? error.message : error));
}

// engine 의 transient 분류와 동일 기준(네트워크 단절·타임아웃). engine 의 분류기는
// private 이라 여기서 동일 규칙을 둔다 — 둘 다 바뀌면 함께 갱신.
function isTransientNetworkError(error: unknown): boolean {
  const m = errorMessage(error).toLowerCase();
  return (
    m.includes("timed_out")
    || m.includes("timeout")
    || m.includes("failed to fetch")
    || m.includes("networkerror")
    || m.includes("network request failed")
  );
}

const MAX_RETRY_ATTEMPTS = 2; // 최초 1회 + 재시도 2회
const DEFAULT_RETRY_DELAY_MS = 400;

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runSchedulerMutation<T>(
  fn: () => Promise<T>,
  opts: { context: string; retryable: boolean; retryDelayMs?: number },
): Promise<T> {
  const baseDelay = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (opts.retryable && isTransientNetworkError(err) && attempt < MAX_RETRY_ATTEMPTS) {
        attempt += 1;
        await delay(baseDelay * 2 ** (attempt - 1));
        continue;
      }
      reportNonFatal(err, opts.context);
      throw err;
    }
  }
}
