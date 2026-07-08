// Tauri(WKWebView) 문서 출처는 tauri://localhost(비 http 스킴)라 iframe 요청에 Referer 가
// 실리지 않고, 유튜브는 Referer 없는 임베드를 "오류 153(동영상 플레이어 구성 오류)" 으로
// 거부한다. 웹 도메인에 호스팅된 래퍼 페이지(public/yt-embed.html)를 한 겹 끼우면 내부
// 유튜브 iframe 요청에 https Referer 가 실려 정상 재생된다. 웹 런타임은 직접 임베드한다.
// 주의: 도메인 변경 시 src-tauri/tauri.conf.json 의 frame-src 화이트리스트도 함께 갱신할 것.

export const WEB_APP_ORIGIN =
  (import.meta.env.VITE_WEB_APP_ORIGIN as string | undefined) ??
  "https://quick-note-khaki.vercel.app";

/** 유튜브 embed URL 을 데스크톱용 https 래퍼 페이지 URL 로 감싼다. */
export function toDesktopYoutubeEmbedUrl(embedUrl: string): string {
  return `${WEB_APP_ORIGIN}/yt-embed.html?src=${encodeURIComponent(embedUrl)}`;
}
