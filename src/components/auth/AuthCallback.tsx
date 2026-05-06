import { useEffect } from "react";
import { useAuthStore } from "../../store/authStore";

// /auth/callback 라우트(웹)에서 마운트되어 code 를 토큰으로 교환한다.
// 처리 후 history 를 / 로 교체하고 onDone 을 호출하면 메인 앱이 마운트된다.
// handleCallback 자체가 try/catch 로 모든 에러를 anonymous(callbackError) 상태로
// 흡수하므로 여기서는 에러 분기 없이 onDone 만 호출하면 된다 — anonymous 상태가
// 떨어지면 LoginScreen 이 errorMessage 를 표시한다.
export function AuthCallback({ onDone }: { onDone: () => void }) {
  const handleCallback = useAuthStore((s) => s.handleCallback);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await handleCallback(window.location.href);
      if (cancelled) return;
      window.history.replaceState({}, "", "/");
      onDone();
    })();
    return () => {
      cancelled = true;
    };
  }, [handleCallback, onDone]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-white text-sm text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
      로그인 처리 중…
    </div>
  );
}
