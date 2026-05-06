import { isTauri } from "./config";
import { ensureOauthListener } from "./deepLink";

// Hosted UI URL 을 어디서 열지: 웹은 동일 탭 리다이렉트, 데스크톱은 시스템 기본 브라우저.
// Tauri 의 경우 외부 브라우저로 보내기 직전에 127.0.0.1:14735 콜백 서버를 기동한다.
export async function openAuthUrl(url: string): Promise<void> {
  if (isTauri) {
    await ensureOauthListener();
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
    return;
  }
  window.location.assign(url);
}
