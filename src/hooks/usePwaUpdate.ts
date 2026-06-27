import { useCallback, useSyncExternalStore } from "react";
import {
  applyPwaUpdate,
  dismissPwaUpdate,
  getPwaState,
  subscribePwa,
} from "../lib/pwa/swController";

// PWA 업데이트 훅 — 웹(Vercel) 전용. Tauri 는 useAutoUpdate 가 담당한다.
// SW 등록은 부팅 시 main.tsx 의 initPwa() 가 수행하며(auth 무관), 이 훅은 그 상태를 구독만 한다.
export function usePwaUpdate() {
  const state = useSyncExternalStore(subscribePwa, getPwaState, getPwaState);

  const applyUpdate = useCallback(async () => {
    await applyPwaUpdate();
  }, []);

  const dismiss = useCallback(() => {
    dismissPwaUpdate();
  }, []);

  return {
    isSupported: state.isSupported,
    needRefresh: state.needRefresh,
    offlineReady: state.offlineReady,
    applyUpdate,
    dismiss,
  };
}
