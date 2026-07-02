// Notion 가져오기 진단 로그 — 개발 빌드에서만 출력한다.
// 프로덕션 콘솔 노이즈를 없애되(coding-style: console.log 금지),
// 대용량 import 디버깅에 유용한 진단은 dev 에서 보존한다.
export function notionImportDebug(...args: unknown[]): void {
  if (import.meta.env.DEV) {
     
    console.log(...args);
  }
}
