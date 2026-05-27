import { useEffect, type ReactNode } from "react";
import pkg from "../../../package.json";
import { useAuthStore, hasHadSessionHint } from "../../store/authStore";
import { LoginScreen } from "./LoginScreen";
import { setupDeepLinkListener } from "../../lib/auth/deepLink";

/** read + silent + getUser 연속 시 상한을 넘기면 복구 안전망 발동 */
const STUCK_LOADING_BAIL_MS = 45_000;

function isSigninCallbackUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.pathname.endsWith("/auth/callback");
  } catch {
    return url.includes("/auth/callback");
  }
}

type Props = { children: ReactNode };

// 앱 진입 직전 게이트. 부팅 시 restoreSession + Tauri 딥링크 리스너 설치.
export function AuthGate({ children }: Props) {
  const state = useAuthStore((s) => s.state);
  const restoreSession = useAuthStore((s) => s.restoreSession);
  const handleCallback = useAuthStore((s) => s.handleCallback);
  const bailIfStuckLoading = useAuthStore((s) => s.bailIfStuckLoading);

  useEffect(() => {
    // /auth/callback 흐름에서 이미 handleCallback 이 상태를 세팅한 경우엔
    // 이를 덮어쓰지 않는다. status==="loading" 일 때만 부팅 복원을 시도한다.
    if (useAuthStore.getState().state.status === "loading") {
      void restoreSession();
    }
  }, [restoreSession]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      bailIfStuckLoading();
    }, STUCK_LOADING_BAIL_MS);
    return () => window.clearTimeout(id);
  }, [bailIfStuckLoading]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void (async () => {
      unlisten = await setupDeepLinkListener((url) => {
        if (!isSigninCallbackUrl(url)) return;
        void handleCallback(url);
      });
    })();
    return () => {
      unlisten?.();
    };
  }, [handleCallback]);

  if (state.status === "loading") {
    // 직전 세션이 있었으면 토큰 복원(최대 수십 초)을 기다리지 않고 캐시된 앱 셸을 먼저 그린다.
    // 동기화(useSyncBootstrap)는 authenticated 일 때만 동작하므로, 복원 완료 전에는
    // 네트워크 호출 없이 persist 캐시만 표시된다. 복원 실패 시 아래 anonymous 분기로 전환.
    if (hasHadSessionHint()) {
      return <>{children}</>;
    }
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-white text-sm text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
        <span>로그인 상태 확인 중…</span>
        <span className="text-xs tabular-nums text-zinc-400 dark:text-zinc-500">
          v{pkg.version}
        </span>
      </div>
    );
  }

  if (state.status === "anonymous") {
    return <LoginScreen />;
  }

  return <>{children}</>;
}
