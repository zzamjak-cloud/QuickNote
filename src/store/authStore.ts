import { create } from "zustand";
import type { User } from "oidc-client-ts";
import { getOidcClient, getOidcManager } from "../lib/auth/oidcClient";
import { buildAuthConfig } from "../lib/auth/config";
import { openAuthUrl } from "../lib/auth/openAuthWindow";
import {
  clearStoredTokens,
  isExpiringSoon,
  readStoredTokens,
  writeStoredTokens,
  type StoredTokens,
} from "../lib/auth/tokenStore";

export type AuthUser = {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
};

export type AnonymousReason =
  | "initial"
  | "expired"
  | "denied"
  | "signedOut"
  | "callbackError";

export type AuthState =
  | { status: "loading" }
  | { status: "anonymous"; reason: AnonymousReason; errorMessage?: string }
  | { status: "authenticated"; user: AuthUser; tokens: StoredTokens };

type Internals = {
  state: AuthState;
};

type AuthActions = {
  signIn: () => Promise<void>;
  handleCallback: (url: string) => Promise<void>;
  signOut: () => Promise<void>;
  restoreSession: () => Promise<void>;
};

export type AuthStore = Internals & AuthActions;

function userToAuthUser(user: User): AuthUser {
  const profile = user.profile ?? {};
  return {
    sub: profile.sub ?? "",
    email: typeof profile.email === "string" ? profile.email : "",
    name:
      typeof profile.name === "string"
        ? profile.name
        : typeof profile.given_name === "string"
          ? profile.given_name
          : undefined,
    picture: typeof profile.picture === "string" ? profile.picture : undefined,
  };
}

function userToTokens(user: User): StoredTokens {
  return {
    idToken: user.id_token ?? "",
    accessToken: user.access_token,
    refreshToken: user.refresh_token ?? "",
    expiresAt: user.expires_at ?? 0,
  };
}

export const useAuthStore = create<AuthStore>((set) => ({
  state: { status: "loading" },

  async signIn() {
    // OidcClient 로 authorize URL 만 만들고, 웹/데스크톱 분기에 따라 외부에서 연다.
    // (UserManager.signinRedirect 는 항상 현재 창을 갈아끼우므로 Tauri 에선 사용 불가.)
    // request_type="si:r" 을 명시해 UserManager.signinCallback 이 redirect 흐름으로 인식하게 한다.
    const client = getOidcClient();
    const cfg = buildAuthConfig();
    const request = await client.createSigninRequest({
      redirect_uri: cfg.redirectUri,
      response_type: "code",
      scope: cfg.scope,
      request_type: "si:r",
      extraQueryParams: { identity_provider: cfg.identityProvider },
    });
    await openAuthUrl(request.url);
  },

  async handleCallback(url: string) {
    const manager = getOidcManager();
    try {
      const user = await manager.signinCallback(url);
      if (!user) throw new Error("oidc: signinCallback 가 user 를 반환하지 않았습니다.");
      const tokens = userToTokens(user);
      await writeStoredTokens(tokens);
      set({
        state: {
          status: "authenticated",
          user: userToAuthUser(user),
          tokens,
        },
      });
    } catch (err) {
      // 실패 원인을 콘솔에 남겨 디버깅을 돕는다 (state 머신은 errorMessage 만 노출).
      console.error("[auth] handleCallback failed:", err);
      const message = err instanceof Error ? err.message : String(err);
      const reason: AnonymousReason = /UNAUTHORIZED|access_denied|denied/i.test(message)
        ? "denied"
        : "callbackError";
      await clearStoredTokens();
      set({ state: { status: "anonymous", reason, errorMessage: message } });
    }
  },

  async signOut() {
    const manager = getOidcManager();
    try {
      await manager.removeUser();
    } catch {
      // 이미 비어 있을 수 있다.
    }
    await clearStoredTokens();
    set({ state: { status: "anonymous", reason: "signedOut" } });
  },

  async restoreSession() {
    const manager = getOidcManager();
    const cached = await readStoredTokens();

    if (!cached) {
      set({ state: { status: "anonymous", reason: "initial" } });
      return;
    }

    if (isExpiringSoon(cached)) {
      try {
        const refreshed = await manager.signinSilent();
        if (refreshed) {
          const tokens = userToTokens(refreshed);
          await writeStoredTokens(tokens);
          set({
            state: {
              status: "authenticated",
              user: userToAuthUser(refreshed),
              tokens,
            },
          });
          return;
        }
      } catch {
        // refresh 실패 → 만료 상태로 강등.
      }
      await clearStoredTokens();
      set({ state: { status: "anonymous", reason: "expired" } });
      return;
    }

    const user = await manager.getUser();
    if (user && !user.expired) {
      set({
        state: {
          status: "authenticated",
          user: userToAuthUser(user),
          tokens: cached,
        },
      });
      return;
    }

    // 캐시는 유효 범위지만 oidc userStore 가 비어 있는 비정상 상태.
    await clearStoredTokens();
    set({ state: { status: "anonymous", reason: "expired" } });
  },
}));
