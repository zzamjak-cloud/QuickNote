import { createRoot } from "react-dom/client";
import "prosemirror-view/style/prosemirror.css";
import "./index.css";
import "highlight.js/styles/github-dark.css";
import { reportNonFatal } from "./lib/reportNonFatal";
import { Bootstrap } from "./Bootstrap";
import {
  purgeLegacyLocalStorage,
  purgeLegacyTauriData,
} from "./lib/sync/legacyCleanup";

// v4 첫 부팅 시 v1~v3 잔여 데이터 폐기 (사용자 합의 — 기존은 개발 테스트 데이터).
purgeLegacyLocalStorage();
void purgeLegacyTauriData();

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
}).render(<Bootstrap />);
