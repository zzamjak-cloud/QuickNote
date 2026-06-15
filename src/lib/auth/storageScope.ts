export type AuthTokenLike = {
  idToken: string;
};

type JwtClaims = {
  iss?: unknown;
  aud?: unknown;
};

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function sanitizeScopePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function expectedAuthContext(): { issuer: string; clientId: string } | null {
  const env = import.meta.env as Record<string, string | undefined>;
  const region = env.VITE_COGNITO_REGION ?? "ap-northeast-2";
  const userPoolId = env.VITE_COGNITO_USER_POOL_ID;
  const clientId = isTauriRuntime()
    ? env.VITE_COGNITO_DESKTOP_CLIENT_ID
    : env.VITE_COGNITO_WEB_CLIENT_ID;
  if (!userPoolId || !clientId) return null;
  return {
    issuer: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`,
    clientId,
  };
}

export function authStorageScopeSuffix(): string | null {
  const ctx = expectedAuthContext();
  if (!ctx) return null;
  const userPoolId = ctx.issuer.split("/").pop() ?? "unknown-pool";
  return `${sanitizeScopePart(userPoolId)}.${sanitizeScopePart(ctx.clientId)}`;
}

function decodeJwtClaims(token: string): JwtClaims | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded)) as JwtClaims;
  } catch {
    return null;
  }
}

export function isTokenCompatibleWithCurrentAuth(tokens: AuthTokenLike): boolean {
  const ctx = expectedAuthContext();
  if (!ctx) return true;
  const claims = decodeJwtClaims(tokens.idToken);
  if (!claims) return false;
  if (claims.iss !== ctx.issuer) return false;
  const aud = claims.aud;
  return Array.isArray(aud) ? aud.includes(ctx.clientId) : aud === ctx.clientId;
}
