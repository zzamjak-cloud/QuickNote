import { useState } from "react";
import App from "./App";
import { AuthCallback } from "./components/auth/AuthCallback";

// 웹 환경에서 /auth/callback 으로 리다이렉트되면 code 교환을 처리한 뒤 / 로 전환한다.
export function Bootstrap() {
  const [path, setPath] = useState(window.location.pathname);
  if (path === "/auth/callback") {
    return <AuthCallback onDone={() => setPath("/")} />;
  }
  return <App />;
}
