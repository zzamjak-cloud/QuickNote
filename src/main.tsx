import { createRoot } from "react-dom/client";
import "prosemirror-view/style/prosemirror.css";
import "./index.css";
// hljs 테마 CSS 는 Editor 의 lowlight lazy 로드와 함께 동적 import 한다(eager 번들에서 분리).
import { reportNonFatal } from "./lib/reportNonFatal";
import { Bootstrap } from "./Bootstrap";
import { RootErrorBoundary } from "./components/RootErrorBoundary";
import {
  purgeLegacyLocalStorage,
  purgeLegacyTauriData,
} from "./lib/sync/legacyCleanup";
import { registerDevTools } from "./lib/devtools/snapshot";
import { attemptChunkReload } from "./lib/chunkReload";
import { initPwa } from "./lib/pwa/swController";
import { initInstallPrompt } from "./lib/pwa/installPrompt";

// v4 첫 부팅 시 v1~v3 잔여 데이터 폐기 (사용자 합의 — 기존은 개발 테스트 데이터).
purgeLegacyLocalStorage();
void purgeLegacyTauriData();
registerDevTools();

// PWA Service Worker 등록(웹 전용) — auth 게이트와 무관하게 부팅 시 등록해 로그인 전에도 설치 가능.
initPwa();
// beforeinstallprompt 는 로드 직후 발생하므로 부팅 시점에 리스너를 건다.
initInstallPrompt();

// 새 배포 후 옛 청크(해시 파일명) 로드 실패 → 자동 1회 새로고침으로 복구.
window.addEventListener("vite:preloadError", (ev) => {
  ev.preventDefault();
  attemptChunkReload();
});
window.addEventListener("error", (ev) => {
  if ((ev.error as Error | null)?.message?.includes("[tiptap error]")) return;
  reportNonFatal(ev.error ?? ev.message, "window.error");
});
window.addEventListener("unhandledrejection", (ev) => {
  reportNonFatal(ev.reason, "unhandledrejection");
});

createRoot(document.getElementById("root")!, {
  onUncaughtError(error) {
    if ((error as Error).message?.includes("[tiptap error]")) return;
    reportNonFatal(error, "react.uncaughtError");
  },
}).render(
  <RootErrorBoundary>
    <Bootstrap />
  </RootErrorBoundary>,
);
