import { describe, it, expect, beforeEach, vi } from "vitest";

// oidcClient 모듈은 Tauri/storage 의존성이 있어 테스트에선 통째로 mock.
const signinCallback = vi.fn();
const signinSilent = vi.fn();
const getUser = vi.fn();
const removeUser = vi.fn();
const createSigninRequest = vi.fn();

vi.mock("../lib/auth/oidcClient", () => ({
  getOidcManager: () => ({
    signinCallback,
    signinSilent,
    getUser,
    removeUser,
    createSigninRequest,
  }),
  resetOidcManager: () => undefined,
}));

vi.mock("../lib/auth/openAuthWindow", () => ({
  openAuthUrl: vi.fn(async () => undefined),
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
    expect(await readStoredTokens()).toBeNull();
    const s = useAuthStore.getState().state;
    expect(s.status).toBe("anonymous");
    if (s.status === "anonymous") expect(s.reason).toBe("signedOut");
  });
});
