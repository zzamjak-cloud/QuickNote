import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "prosemirror-view/style/prosemirror.css";
import "./index.css";
import "highlight.js/styles/github-dark.css";
import { reportNonFatal } from "./lib/reportNonFatal";
import App from "./App.tsx";

window.addEventListener("error", (ev) => {
  reportNonFatal(ev.error ?? ev.message, "window.error");
});
window.addEventListener("unhandledrejection", (ev) => {
  reportNonFatal(ev.reason, "unhandledrejection");
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
