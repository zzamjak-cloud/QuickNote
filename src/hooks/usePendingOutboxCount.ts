import { useEffect, useState } from "react";
import { getSyncEngine } from "../lib/sync/runtime";
import { useOnlineStatus } from "./useOnlineStatus";

// 대기 중 outbox 항목 수를 구독한다(가시성 배지용).
// 이벤트 시스템이 없으므로, 오프라인이거나 적체가 남아 있는 동안만 경량 폴링한다
// (온라인+0건이면 폴링 중단 → online 상태 변화 시 재개).
const POLL_MS = 5_000;

export function usePendingOutboxCount(): number {
  const online = useOnlineStatus();
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const engine = await getSyncEngine();
        const n = await engine.pendingCount();
        if (cancelled) return;
        setCount(n);
        // 오프라인이거나 적체가 남아 있으면 계속 폴링.
        if (!navigator.onLine || n > 0) {
          timer = setTimeout(() => void tick(), POLL_MS);
        }
      } catch {
        if (!cancelled) setCount(0);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [online]);

  return count;
}
