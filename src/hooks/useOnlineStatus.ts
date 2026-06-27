import { useSyncExternalStore } from "react";

// navigator.onLine 구독 훅. online/offline 이벤트로 갱신.
function subscribe(callback: () => void): () => void {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getSnapshot(): boolean {
  return navigator.onLine;
}

// 서버 렌더 대비 — 항상 온라인으로 가정(클라이언트에서 즉시 보정).
function getServerSnapshot(): boolean {
  return true;
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
