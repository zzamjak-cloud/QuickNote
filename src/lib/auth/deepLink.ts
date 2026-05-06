import { isTauri } from "./config";

export const DESKTOP_OAUTH_PORT = 14735;

// Tauri 데스크톱 OAuth 콜백 처리:
// 1) Rust 측 start_oauth_listener 명령으로 127.0.0.1:14735 에 1회용 HTTP 서버 기동
// 2) Cognito 가 redirect_uri 로 그 주소를 호출하면 Rust 가 "auth-callback" 이벤트를 emit
// 3) 이 리스너가 이벤트 받아서 onCallback(url) 호출
// 함수명은 기존 deep-link 호환을 위해 유지하지만 실체는 loopback 방식이다.
export async function setupDeepLinkListener(
  onCallback: (url: string) => void,
): Promise<() => void> {
  if (!isTauri) return () => undefined;

  const { listen } = await import("@tauri-apps/api/event");

  const unlisten = await listen<string>("auth-callback", (event) => {
    onCallback(event.payload);
  });

  // 서버는 1회 요청 후 종료되므로 매 signIn 직전에 다시 띄우지 않으면 두 번째 로그인이 실패한다.
  // openAuthWindow 가 그 직전에 ensureOauthListener() 를 호출하도록 한다.
  return unlisten;
}

let _listenerStarting: Promise<void> | null = null;

export async function ensureOauthListener(): Promise<void> {
  if (!isTauri) return;
  if (_listenerStarting) {
    await _listenerStarting;
    _listenerStarting = null;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  _listenerStarting = invoke<void>("start_oauth_listener", { port: DESKTOP_OAUTH_PORT });
  await _listenerStarting;
  _listenerStarting = null;
}
