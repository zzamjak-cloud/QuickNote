import type { User } from "oidc-client-ts";
import {
  isExpiringSoon,
  readStoredTokens,
  writeStoredTokens,
  type StoredTokens,
} from "./tokenStore";
import { getOidcManager } from "./oidcClient";

// AppSync 쿼리/뮤테이션/구독 직전에 호출 — UserManager 는 automaticSilentRenew 가 꺼져 있어
// 장시간 탭을 켜 두면 id_token 만료로 동기화가 조용히 실패할 수 있다.

function userToTokens(user: User): StoredTokens {
  return {
    idToken: user.id_token ?? "",
    accessToken: user.access_token,
    refreshToken: user.refresh_token ?? "",
    expiresAt: user.expires_at ?? 0,
  };
}

let refreshInFlight: Promise<StoredTokens | null> | null = null;

/**
 * 저장된 Cognito 토큰을 반환. 만료 임박 시 signinSilent 로 갱신 후 tokenStore 에 기록.
 */
export async function ensureFreshTokensForAppSync(): Promise<StoredTokens | null> {
  const tokens = await readStoredTokens();
  if (!tokens) return null;
  if (!isExpiringSoon(tokens)) return tokens;

  if (!refreshInFlight) {
    refreshInFlight = (async (): Promise<StoredTokens | null> => {
      try {
        const mgr = getOidcManager();
        const user = await mgr.signinSilent();
        if (user?.id_token) {
          const next = userToTokens(user);
          await writeStoredTokens(next);
          return next;
        }
      } catch (e) {
        console.warn("[auth] AppSync용 토큰 갱신 실패 (signinSilent)", e);
      }
      return readStoredTokens();
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}
