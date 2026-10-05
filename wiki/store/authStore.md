# authStore

## 역할
OIDC 기반 인증 상태(로딩·익명·인증됨)와 토큰 생명주기(자동 갱신, keepalive)를 관리하는 스토어.

## 위치
`src/store/authStore.ts`

## State 타입

`AuthState`는 discriminated union으로 세 가지 상태를 가진다.

| 상태 `status` | 추가 필드 | 설명 |
|--------------|---------|------|
| `"loading"` | 없음 | 세션 복원 중 |
| `"anonymous"` | `reason: AnonymousReason`, `errorMessage?: string` | 미인증 |
| `"authenticated"` | `user: AuthUser`, `tokens: StoredTokens` | 인증 완료 |

**`AnonymousReason`** 값: `"initial"` \| `"expired"` \| `"signedOut"` \| `"callbackError"` \| `"denied"` \| `"restoreTimeout"`

**`AuthUser`** 필드: `sub`, `email`, `name` 등 OIDC 표준 클레임

**`StoredTokens`** 필드: `idToken`, `accessToken`, `refreshToken`, `expiresAt`

스토어 내부(`Internals`) 필드:

| 필드 | 타입 | 설명 |
|------|------|------|
| `state` | `AuthState` | 현재 인증 상태 |

## 액션 목록

| 액션명 | 파라미터 | 설명 |
|--------|---------|------|
| `bailIfStuckLoading` | 없음 | `loading` 상태가 너무 길면 `anonymous`로 강제 전환 |
| `signIn` | `opts?` | OIDC 로그인 URL 열기 (Cognito Hosted UI) |
| `handleCallback` | `url` | OAuth 콜백 처리, 토큰 저장 및 keepalive 시작 |
| `signOut` | 없음 | 토큰 제거, sync 엔진 종료, hosted logout URL 열기 |
| `restoreSession` | 없음 | 앱 초기화 시 저장된 토큰으로 세션 복원. 만료 시 silent refresh 시도 |

## Persist

- **persist 미들웨어 미사용** — 토큰은 `src/lib/auth/tokenStore.ts`의 `readStoredTokens` / `writeStoredTokens` / `clearStoredTokens`로 별도 관리
- 세션 복원은 앱 마운트 시 `restoreSession()` 호출로 수행
- 데스크톱 dev/live Tauri 는 같은 bundle id 와 SQLite 저장소를 공유할 수 있다. `tokenStore` 와
  `oidcClient` 의 StateStore prefix 는 Cognito user pool + client id 로 스코프를 나눠야 하며,
  legacy 공용 키의 토큰은 현재 빌드의 issuer/audience 와 다르면 복구하지 않는다.

## Cognito managed login(v2) — prompt 동작

- Cognito 도메인(`quicknote-auth`·`quicknote-auth-dev`)은 **managed login(v2)** 이다(`infra/lib/cognito-stack.ts` `ManagedLoginVersion.NEWER_MANAGED_LOGIN`). 버전 변경은 CFN "No interruption"(도메인·풀·클라이언트 교체 없음)이지만, 전환 시 Cognito 세션 쿠키는 유지되지 않고 새 버전 페이지 반영까지 최대 4분 걸린다. 앱 토큰(refresh 포함)은 쿠키와 무관.
- v2 에서는 CFN/SDK 로 만든 앱 클라이언트마다 스타일이 있어야 한다 → 웹·데스크톱(CognitoStack)·MCP 파사드(SyncStack) 클라이언트에 Cognito 기본 스타일(`CfnManagedLoginBranding`, `useCognitoProvidedValues: true`). 도메인은 웹·데스크톱 스타일 뒤에 갱신된다(DependsOn).
- `prompt` 는 v2 에서만 동작한다(classic 은 무시). 따라서 `signIn` 의 `prompt=select_account`(로그아웃 후 `login select_account` + `max_age=0`)는 **v2 전환 후 실제로 Google 계정 선택 화면을 띄운다** — 이전(classic)에는 Google 리다이렉트에서 빠져 효과가 없었다(dev 실측).
- `identity_provider=Google` 은 계속 필수(sub 고정, 위 `signIn` 주석). 로그아웃(`/logout`)·콜백 URL 은 변경 없음.

## 의존 관계

- `src/lib/auth/oidcClient.ts` — `getOidcManager`, `resetOidcManager` (oidc-client-ts 래퍼)
- `src/lib/auth/tokenStore.ts` — `readStoredTokens`, `writeStoredTokens`, `clearStoredTokens`
- `src/lib/auth/storageScope.ts` — Cognito 환경별 auth 저장소 scope 와 토큰 issuer/audience 검증
- `src/lib/sync/engine.ts` — `shutdownSyncEngine` (로그아웃 시 outbox 정리)
- keepalive 타이머: `TOKEN_KEEPALIVE_INTERVAL_MS` 주기로 만료 임박 토큰 자동 갱신

## 사용처 (주요 컴포넌트)

- `src/Bootstrap.tsx` — 앱 초기화 시 `restoreSession()` 호출
- `src/components/LoginPage.tsx` / `src/components/AuthCallback.tsx` — `signIn`, `handleCallback`
- `src/lib/sync/engine.ts` — 인증 토큰을 AppSync 요청 헤더에 주입
- 전역 가드 — `state.status` 로 인증 여부 확인
