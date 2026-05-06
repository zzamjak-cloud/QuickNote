import { zustandStorage } from "../storage/index";

// authStore 가 부팅 시점에 빠르게 토큰 존재 여부를 알 수 있도록 별도 키에 캐시한다.
// 실제 토큰 교환/갱신은 oidc-client-ts 가 자체 userStore 에 보관하지만,
// 이 캐시는 UI 가 "loading" → "anonymous" 전이를 빠르게 결정하기 위한 보조 인덱스이다.
const TOKEN_KEY = "quicknote.auth.tokens.v1";

export type StoredTokens = {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch seconds
};

export async function readStoredTokens(): Promise<StoredTokens | null> {
  const raw = await zustandStorage.getItem(TOKEN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredTokens;
    if (
      typeof parsed.idToken === "string" &&
      typeof parsed.accessToken === "string" &&
      typeof parsed.refreshToken === "string" &&
      typeof parsed.expiresAt === "number"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export async function writeStoredTokens(tokens: StoredTokens): Promise<void> {
  await zustandStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
}

export async function clearStoredTokens(): Promise<void> {
  await zustandStorage.removeItem(TOKEN_KEY);
}

// 만료 60초 전부터 갱신 대상으로 본다.
export function isExpiringSoon(tokens: StoredTokens, nowSec = Math.floor(Date.now() / 1000)): boolean {
  return tokens.expiresAt - nowSec <= 60;
}
