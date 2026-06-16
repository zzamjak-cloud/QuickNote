# 관측성 (reportNonFatal) · dev/live 격리

## reportNonFatal — 비치명 에러 보고

단일 출처: `src/lib/reportNonFatal.ts`. 빈 `catch` 대신 원인 추적용으로 호출한다.
시그니처: `reportNonFatal(err: unknown, context: string): void`.

호출 시 두 가지를 동시에 수행한다:

1. **메모리 ring buffer** — 최근 50건(`RING_CAPACITY`)을 `window.__QN_errors` 에 노출.
   DevTools 콘솔에서 `window.__QN_errors` 로 즉시 조회 가능. 항목: `{ time, context, message, stack }`.
2. **백엔드 beacon 전송** — `navigator.sendBeacon(VITE_ERROR_BEACON_URL, payload)`.
   payload: `{ context, message, stack, ts, version }` (version 은 `VITE_APP_VERSION`, 없으면 `"unknown"`).

### 동작 보장
- `VITE_ERROR_BEACON_URL` 미설정이면 beacon 은 **no-op** (URL 없으면 조용히 skip).
- `navigator.sendBeacon` 미지원 환경도 skip.
- beacon/ring 실패는 전부 swallow — 관측성 부가 기능이 본 흐름을 깨지 않는다.
- 기존 `console.warn("[QuickNote] {context}", e)` 출력은 유지(개발 편의).

### 과거 라이브 인시던트가 서버에 흔적 0이었던 이유와 해소
이전에는 `reportNonFatal` 이 콘솔 출력 + 메모리 ring 까지만 수행해서,
**라이브에서 발생한 비치명 에러가 사용자 브라우저를 벗어나 서버에 도달하는 경로가 없었다.**
그래서 인시던트 사후 조사 시 서버 측 흔적이 0이었다.

Phase 0(`a693b82e`)에서 `sendBeacon` 경로를 추가해, `VITE_ERROR_BEACON_URL` 이 설정된 빌드는
비치명 에러를 백엔드로 전송한다. **beacon URL 을 빌드 env 로 주입해야 실제 전송이 켜진다**
(웹은 Vercel env, 데스크톱 릴리스는 GitHub Secrets — [deploy.md](deploy.md) STEP 3.5 와 동일 원리).

---

## dev/live 캐시 격리 (Tauri 식별자 분리)

`5ba32820` 이전에는 dev 와 라이브 데스크톱 앱이 **동일 identifier** 라
같은 앱데이터 디렉토리의 `quicknote.db`(SQLite)를 공유했다 → dev 작업이 라이브 캐시를 오염.

해소:
- `src-tauri/tauri.dev.conf.json` 추가 — `identifier=com.loadcomplete.quicknote.dev`,
  `productName="QuickNote Dev"`.
- `npm run tauri:dev` 는 `tauri dev --config src-tauri/tauri.dev.conf.json` 로 머지 실행.
- 라이브 `npm run tauri:build` 는 기존 identifier 유지 → **릴리스 무영향**.

### 회귀 방지
- dev 빌드는 별도 identifier·productName 을 쓰므로 라이브 앱데이터와 절대 섞이지 않는다.
- dev conf 의 identifier 를 라이브와 같게 되돌리면 캐시 오염이 재발한다. 분리 유지할 것.
