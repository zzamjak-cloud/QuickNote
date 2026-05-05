import { createRoot } from "react-dom/client";
import "prosemirror-view/style/prosemirror.css";
import "./index.css";
import "highlight.js/styles/github-dark.css";
import { reportNonFatal } from "./lib/reportNonFatal";
import App from "./App.tsx";

window.addEventListener("error", (ev) => {
  if ((ev.error as Error | null)?.message?.includes("[tiptap error]")) return;
  reportNonFatal(ev.error ?? ev.message, "window.error");
});
window.addEventListener("unhandledrejection", (ev) => {
  reportNonFatal(ev.reason, "unhandledrejection");
});

createRoot(document.getElementById("root")!, {
  onUncaughtError(error) {
    // TipTap 3 내부 layout effect가 에디터 전환 시 일시적으로 view에 접근하는 알려진 버그
    if ((error as Error).message?.includes("[tiptap error]")) return;
    reportNonFatal(error, "react.uncaughtError");
  },
}).render(<App />);
