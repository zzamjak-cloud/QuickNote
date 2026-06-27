import { useCallback, useSyncExternalStore } from "react";
import {
  getInstallState,
  promptInstall,
  subscribeInstall,
} from "../lib/pwa/installPrompt";
import { isIos, isStandalonePwa } from "../lib/pwa/displayMode";

// PWA 설치 상태 훅 — 웹 전용. 리스너는 main.tsx 의 initInstallPrompt() 가 부팅 시 건다.
export function useInstallPrompt() {
  const state = useSyncExternalStore(
    subscribeInstall,
    getInstallState,
    getInstallState,
  );

  const install = useCallback(async () => {
    return promptInstall();
  }, []);

  return {
    isSupported: state.isSupported,
    canInstall: state.canInstall,
    installed: state.installed || isStandalonePwa(),
    isIos: isIos(),
    install,
  };
}
