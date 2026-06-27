// Tauri 빌드 전용 스텁 — virtual:pwa-register 모듈이 없는 환경에서 빌드 해석을 막기 위함.
// usePwaUpdate 는 isTauri 가드로 실제 호출하지 않으므로 no-op 으로 충분하다.
type RegisterSWOptions = {
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
};

export function registerSW(_options?: RegisterSWOptions) {
  return async (_reload?: boolean) => {};
}
