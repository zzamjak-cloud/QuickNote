// PWA 디스플레이 모드·플랫폼 감지 유틸 (웹 전용).

// 설치된 PWA(독립 창)로 실행 중인지 — standalone / fullscreen / minimal-ui / iOS navigator.standalone.
export function isStandalonePwa(): boolean {
  if (typeof window === "undefined") return false;
  const mql = window.matchMedia?.("(display-mode: standalone)").matches;
  const iosStandalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return Boolean(mql) || iosStandalone;
}

// iOS(아이폰/아이패드) Safari 여부 — beforeinstallprompt 미지원이라 수동 설치 안내가 필요.
export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iOSDevice = /iphone|ipad|ipod/i.test(ua);
  // iPadOS 13+ 는 데스크톱 UA 로 위장 — 터치 지원 Mac 으로 보정.
  const iPadOS =
    navigator.platform === "MacIntel" &&
    (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints != null &&
    ((navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints ?? 0) > 1;
  return iOSDevice || iPadOS;
}
