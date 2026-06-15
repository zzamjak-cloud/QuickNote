import { describe, it, expect, beforeEach, vi } from "vitest";

// oidcClient 모듈은 Tauri/storage 의존성이 있어 테스트에선 통째로 mock.
const signinCallback = vi.fn();
const signinSilent = vi.fn();
const getUser = vi.fn();
const removeUser = vi.fn();
const createSigninRequest = vi.fn();
const shutdownSyncEngine = vi.fn();

vi.mock("../lib/auth/oidcClient", () => ({
  getOidcManager: () => ({
    signinCallback,
    signinSilent,
    getUser,
    removeUser,
    createSigninRequest,
  }),
  resetOidcManager: () => undefined,
  clearOidcStorage: vi.fn(async () => undefined),
}));

vi.mock("../lib/auth/openAuthWindow", () => ({
  openAuthUrl: vi.fn(async () => undefined),
}));

vi.mock("../lib/sync/runtime", () => ({
  shutdownSyncEngine,
}));

// 메모리 KV 로 zustandStorage 를 대체.
const memory = new Map<string, string>();
vi.mock("../lib/storage/index", () => ({
  zustandStorage: {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => {
      memory.set(k, v);
    },
    removeItem: (k: string) => {
      memory.delete(k);
    },
  },
}));

// import 는 mock 이후에 와야 한다.
const { useAuthStore } = await import("../store/authStore");
const { writeStoredTokens, readStoredTokens } = await import("../lib/auth/tokenStore");

function resetAuthEnv() {
  const env = import.meta.env as Record<string, unknown>;
  delete env.VITE_COGNITO_REGION;
  delete env.VITE_COGNITO_USER_POOL_ID;
  delete env.VITE_COGNITO_WEB_CLIENT_ID;
  delete env.VITE_COGNITO_DESKTOP_CLIENT_ID;
}

function encodeJwtPayload(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8")
    .toString("base64url");
  return `header.${encoded}.signature`;
}

function fakeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    profile: { sub: "sub-1", email: "alice@example.com", name: "Alice" },
    id_token: "id",
    access_token: "access",
    refresh_token: "refresh",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expired: false,
    ...overrides,
  };
}

describe("authStore", () => {
  beforeEach(() => {
    memory.clear();
    vi.clearAllMocks();
    resetAuthEnv();
    useAuthStore.setState({ state: { status: "loading" } });
  });

  it("토큰이 없으면 anonymous(initial) 로 떨어진다", async () => {
    await useAuthStore.getState().restoreSession();
    expect(useAuthStore.getState().state).toEqual({
      status: "anonymous",
      reason: "initial",
    });
  });

  it("만료된 토큰은 anonymous(expired) 로 떨어진다", async () => {
    await writeStoredTokens({
      idToken: "i",
      accessToken: "a",
      refreshToken: "r",
      expiresAt: Math.floor(Date.now() / 1000) - 100, // 이미 만료
    });
    signinSilent.mockRejectedValueOnce(new Error("refresh failed"));

    await useAuthStore.getState().restoreSession();

    const s = useAuthStore.getState().state;
    expect(s.status).toBe("anonymous");
    if (s.status === "anonymous") expect(s.reason).toBe("expired");
    expect(await readStoredTokens()).toBeNull();
  });

  it("handleCallback 성공 시 authenticated 로 전이한다", async () => {
    signinCallback.mockResolvedValueOnce(fakeUser());

    await useAuthStore
      .getState()
      .handleCallback("https://app/callback?code=abc&state=xyz");

    const s = useAuthStore.getState().state;
    expect(s.status).toBe("authenticated");
    if (s.status === "authenticated") {
      expect(s.user.email).toBe("alice@example.com");
    }
    expect(await readStoredTokens()).not.toBeNull();
  });

  it("handleCallback 실패가 access_denied 면 reason=denied", async () => {
    signinCallback.mockRejectedValueOnce(new Error("access_denied: blocked"));

    await useAuthStore.getState().handleCallback("https://app/callback?error=access_denied");

    const s = useAuthStore.getState().state;
    expect(s.status).toBe("anonymous");
    if (s.status === "anonymous") expect(s.reason).toBe("denied");
  });

  it("signOut 은 토큰을 지우고 anonymous(signedOut) 로 둔다", async () => {
    await writeStoredTokens({
      idToken: "i",
      accessToken: "a",
      refreshToken: "r",
      expiresAt: Math.floor(Date.now() / 1000) + 1000,
    });

    await useAuthStore.getState().signOut();

    expect(removeUser).toHaveBeenCalled();
    expect(shutdownSyncEngine).toHaveBeenCalled();
    expect(await readStoredTokens()).toBeNull();
    const s = useAuthStore.getState().state;
    expect(s.status).toBe("anonymous");
    if (s.status === "anonymous") expect(s.reason).toBe("signedOut");
  });

  it("현재 Cognito 환경과 다른 legacy 토큰은 복구하지 않는다", async () => {
    Object.assign(import.meta.env as Record<string, unknown>, {
      VITE_COGNITO_REGION: "ap-northeast-2",
      VITE_COGNITO_USER_POOL_ID: "live_pool",
      VITE_COGNITO_WEB_CLIENT_ID: "live_web",
    });
    memory.set(
      "quicknote.auth.tokens.v1",
      JSON.stringify({
        idToken: encodeJwtPayload({
          iss: "https://cognito-idp.ap-northeast-2.amazonaws.com/dev_pool",
          aud: "dev_web",
        }),
        accessToken: "a",
        refreshToken: "r",
        expiresAt: Math.floor(Date.now() / 1000) + 1000,
      }),
    );

    expect(await readStoredTokens()).toBeNull();
    expect(memory.has("quicknote.auth.tokens.v1")).toBe(false);
  });
});
