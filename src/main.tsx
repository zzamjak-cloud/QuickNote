import { createRoot } from "react-dom/client";
import "prosemirror-view/style/prosemirror.css";
import "./index.css";
import "highlight.js/styles/github-dark.css";
import { reportNonFatal } from "./lib/reportNonFatal";
import { Bootstrap } from "./Bootstrap";

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
