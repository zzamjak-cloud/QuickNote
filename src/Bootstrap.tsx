import { useEffect, useRef, useState } from "react";
import App from "./App";
import { AuthCallback } from "./components/auth/AuthCallback";
import { useAuthStore } from "./store/authStore";
import {
  fetchAllPages,
  fetchAllDatabases,
  fetchAllContacts,
  startSubscriptions,
} from "./lib/sync";
import { getSyncEngine } from "./lib/sync/runtime";
import {
  applyRemotePageToStore,
  applyRemoteDatabaseToStore,
  applyRemoteContactToStore,
} from "./lib/sync/storeApply";

// 인증 상태가 authenticated 로 전환될 때 1) 전체 페이지/DB/연락처를 페치해 LWW 적용,
// 2) 변경 푸시 구독 시작, 3) outbox flush. cleanup 시 구독 해제.
function useSyncBootstrap() {
  const authStatus = useAuthStore((s) => s.state.status);
  const authSub = useAuthStore((s) =>
    s.state.status === "authenticated" ? s.state.user.sub : null,
  );
  // 한 사용자 세션 내에서 중복 부트스트랩 방지.
  const startedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (authStatus !== "authenticated" || !authSub) {
      startedForRef.current = null;
      return;
    }
    if (startedForRef.current === authSub) return;
    startedForRef.current = authSub;

    let unsub: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        const [pages, dbs, contacts] = await Promise.all([
          fetchAllPages(),
          fetchAllDatabases(),
          fetchAllContacts(),
        ]);
        if (cancelled) return;
        for (const p of pages) applyRemotePageToStore(p);
        for (const d of dbs) applyRemoteDatabaseToStore(d);
        for (const c of contacts) applyRemoteContactToStore(c);

        if (cancelled) return;
        unsub = startSubscriptions(authSub, {
          onPage: applyRemotePageToStore,
          onDatabase: applyRemoteDatabaseToStore,
          onContact: applyRemoteContactToStore,
        });

        const engine = await getSyncEngine();
        await engine.flush();
      } catch (err) {
        console.error("[sync] bootstrap failed", err);
      }
    })();

    return () => {
      cancelled = true;
      try {
        unsub?.();
      } catch (err) {
        console.error("[sync] unsubscribe failed", err);
      }
    };
  }, [authStatus, authSub]);
}

// 웹 환경에서 /auth/callback 으로 리다이렉트되면 code 교환을 처리한 뒤 / 로 전환한다.
export function Bootstrap() {
  const [path, setPath] = useState(window.location.pathname);
  useSyncBootstrap();
  if (path === "/auth/callback") {
    return <AuthCallback onDone={() => setPath("/")} />;
  }
  return <App />;
}
