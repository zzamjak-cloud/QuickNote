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
  | "callbackError"
  /** 로그인 복구 단계 타임아웃(저장소·silent renew 등) — 데스크톱 WebView에서 자주 걸린다 */
  | "restoreTimeout";

const STORAGE_READ_MS = 15_000;
const SIGNIN_SILENT_MS = 12_000;
const GET_USER_MS = 12_000;

async function promiseWithTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        t = setTimeout(
          () => reject(new Error(`auth timeout: ${label} (${ms}ms)`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (t !== undefined) clearTimeout(t);
  }
}

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
  /** 아직 loading 이면 로그인 화면으로 전환(복구 루틴이 안 풀릴 때 안전망) */
  bailIfStuckLoading: () => void;
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

let restoreSessionInFlight: Promise<void> | null = null;

export const useAuthStore = create<AuthStore>((set) => ({
  state: { status: "loading" },

  bailIfStuckLoading() {
    set((s) =>
      s.state.status === "loading"
        ? {
            state: {
              status: "anonymous",
              reason: "restoreTimeout",
              errorMessage:
                "로그인 상태 확인이 예상보다 오래 걸려 로그인 화면으로 전환했습니다. 다시 로그인해 주세요.",
            },
          }
        : s,
    );
  },

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
    if (restoreSessionInFlight) {
      return restoreSessionInFlight;
    }
    restoreSessionInFlight = (async () => {
      try {
        let cached: StoredTokens | null;
        try {
          cached = await promiseWithTimeout(
            readStoredTokens(),
            STORAGE_READ_MS,
            "readStoredTokens",
          );
        } catch (err) {
          console.error("[auth] restoreSession: token read failed", err);
          await clearStoredTokens();
          const message = err instanceof Error ? err.message : String(err);
          const reason: AnonymousReason = /timeout/i.test(message)
            ? "restoreTimeout"
            : "initial";
          set({
            state:
              reason === "restoreTimeout"
                ? { status: "anonymous", reason, errorMessage: message }
                : { status: "anonymous", reason: "initial" },
          });
          return;
        }

        if (!cached) {
          set({ state: { status: "anonymous", reason: "initial" } });
          return;
        }

        let manager;
        try {
          manager = getOidcManager();
        } catch (err) {
          console.error("[auth] restoreSession: OIDC 설정 오류", err);
          await clearStoredTokens();
          const message = err instanceof Error ? err.message : String(err);
          set({
            state: {
              status: "anonymous",
              reason: "callbackError",
              errorMessage: message,
            },
          });
          return;
        }

        if (isExpiringSoon(cached)) {
          try {
            const refreshed = await promiseWithTimeout(
              manager.signinSilent(),
              SIGNIN_SILENT_MS,
              "signinSilent",
            );
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
            // refresh 실패 또는 타임아웃 → 만료 상태로 강등.
          }
          await clearStoredTokens();
          set({ state: { status: "anonymous", reason: "expired" } });
          return;
        }

        let user;
        try {
          user = await promiseWithTimeout(
            manager.getUser(),
            GET_USER_MS,
            "getUser",
          );
        } catch {
          await clearStoredTokens();
          set({ state: { status: "anonymous", reason: "restoreTimeout" } });
          return;
        }

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

        await clearStoredTokens();
        set({ state: { status: "anonymous", reason: "expired" } });
      } catch (err) {
        console.error("[auth] restoreSession: unexpected failure", err);
        try {
          await clearStoredTokens();
        } catch {
          // 무시
        }
        const message = err instanceof Error ? err.message : String(err);
        set({
          state: {
            status: "anonymous",
            reason: "callbackError",
            errorMessage: message,
          },
        });
      } finally {
        restoreSessionInFlight = null;
      }
    })();
    return restoreSessionInFlight;
  },
}));
