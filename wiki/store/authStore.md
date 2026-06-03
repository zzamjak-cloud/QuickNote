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

- **persist 미들웨어 미사용** — 토큰은 `src/lib/auth/tokenStorage.ts`의 `readStoredTokens` / `writeStoredTokens` / `clearStoredTokens`로 별도 관리
- 세션 복원은 앱 마운트 시 `restoreSession()` 호출로 수행

## 의존 관계

- `src/lib/auth/oidcManager.ts` — `getOidcManager`, `resetOidcManager` (oidc-client-ts 래퍼)
- `src/lib/auth/tokenStorage.ts` — `readStoredTokens`, `writeStoredTokens`, `clearStoredTokens`
- `src/lib/sync/engine.ts` — `shutdownSyncEngine` (로그아웃 시 outbox 정리)
- keepalive 타이머: `TOKEN_KEEPALIVE_INTERVAL_MS` 주기로 만료 임박 토큰 자동 갱신

## 사용처 (주요 컴포넌트)

- `src/Bootstrap.tsx` — 앱 초기화 시 `restoreSession()` 호출
- `src/components/LoginPage.tsx` / `src/components/AuthCallback.tsx` — `signIn`, `handleCallback`
- `src/lib/sync/engine.ts` — 인증 토큰을 AppSync 요청 헤더에 주입
- 전역 가드 — `state.status` 로 인증 여부 확인
