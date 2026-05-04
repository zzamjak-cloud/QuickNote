import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "prosemirror-view/style/prosemirror.css";
import "./index.css";
import "highlight.js/styles/github-dark.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
