import { create } from "zustand";
import type { User } from "oidc-client-ts";
import { clearOidcStorage, getOidcClient, getOidcManager, resetOidcManager } from "../lib/auth/oidcClient";
import { buildAuthConfig } from "../lib/auth/config";
import { openAuthUrl } from "../lib/auth/openAuthWindow";
import { shutdownSyncEngine } from "../lib/sync/runtime";
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
const TOKEN_KEEPALIVE_INTERVAL_MS = 30_000;
const TOKEN_KEEPALIVE_THRESHOLD_SEC = 180;

// 직전에 인증된 세션이 있었는지 동기적으로 알려주는 마커.
// 새로고침 시 AuthGate 가 토큰 복원(read 15s + getUser 12s 등)을 기다리지 않고
// 캐시된 앱 셸을 먼저 그릴지 판단하는 데 쓴다.
const HAD_SESSION_KEY = "quicknote.auth.hadSession";
const FORCE_ACCOUNT_SELECTION_KEY = "quicknote.auth.forceAccountSelection";

function markHadSession(): void {
  try {
    globalThis.localStorage?.setItem(HAD_SESSION_KEY, "1");
  } catch {
    // localStorage 비가용 환경은 낙관적 셸을 포기(기본 로딩 화면).
  }
}

function clearHadSession(): void {
  try {
    globalThis.localStorage?.removeItem(HAD_SESSION_KEY);
  } catch {
    // 무시
  }
}

function markForceAccountSelection(): void {
  try {
    globalThis.localStorage?.setItem(FORCE_ACCOUNT_SELECTION_KEY, "1");
  } catch {
    // 무시
  }
}

function clearForceAccountSelection(): void {
  try {
    globalThis.localStorage?.removeItem(FORCE_ACCOUNT_SELECTION_KEY);
  } catch {
    // 무시
  }
}

function shouldForceAccountSelection(): boolean {
  try {
    return globalThis.localStorage?.getItem(FORCE_ACCOUNT_SELECTION_KEY) === "1";
  } catch {
    return false;
  }
}

/** 직전 세션 존재 힌트(동기). 토큰 검증과 무관한 빠른 첫 페인트 판단용. */
export function hasHadSessionHint(): boolean {
  try {
    return globalThis.localStorage?.getItem(HAD_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

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

function tryBuildHostedLogoutUrl(idTokenHint?: string): string | null {
  try {
    const cfg = buildAuthConfig();
    const url = new URL(`https://${cfg.hostedUiDomain}/logout`);
    url.searchParams.set("client_id", cfg.clientId);
    url.searchParams.set("logout_uri", cfg.postLogoutRedirectUri);
    if (idTokenHint) {
      url.searchParams.set("id_token_hint", idTokenHint);
    }
    return url.toString();
  } catch (error) {
    console.warn("[auth] hosted logout url 생성 실패", error);
    return null;
  }
}

let restoreSessionInFlight: Promise<void> | null = null;
let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
let keepAliveRefreshInFlight: Promise<void> | null = null;

function stopTokenKeepAlive(): void {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

function startTokenKeepAlive(getState: () => AuthState, setState: (next: AuthState) => void): void {
  stopTokenKeepAlive();
  keepAliveTimer = setInterval(() => {
    const current = getState();
    if (current.status !== "authenticated") return;
    const nowSec = Math.floor(Date.now() / 1000);
    if (!isExpiringSoon(current.tokens, nowSec + TOKEN_KEEPALIVE_THRESHOLD_SEC)) return;
    if (keepAliveRefreshInFlight) return;
    keepAliveRefreshInFlight = (async () => {
      try {
        const manager = getOidcManager();
        const refreshed = await promiseWithTimeout(
          manager.signinSilent(),
          SIGNIN_SILENT_MS,
          "signinSilent(keepalive)",
        );
        if (!refreshed?.id_token) return;
        const tokens = userToTokens(refreshed);
        await writeStoredTokens(tokens);
        setState({
          status: "authenticated",
          user: userToAuthUser(refreshed),
          tokens,
        });
        markHadSession();
      } catch (err) {
        console.warn("[auth] keepalive silent renew 실패", err);
      }
    })().finally(() => {
      keepAliveRefreshInFlight = null;
    });
  }, TOKEN_KEEPALIVE_INTERVAL_MS);
}

export const useAuthStore = create<AuthStore>((set, get) => ({
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
    // 릴리스 번들에 VITE_* 가 비어 있으면 여기서 throw → UI 에 메시지로 노출한다.
    try {
      const client = getOidcClient();
      const cfg = buildAuthConfig();
      const forceAccountSelection = shouldForceAccountSelection();
      const prompt = forceAccountSelection ? "login select_account" : "select_account";
      const request = await client.createSigninRequest({
        redirect_uri: cfg.redirectUri,
        response_type: "code",
        scope: cfg.scope,
        request_type: "si:r",
        // 동일 브라우저 세션에서 다른 Google 계정으로 전환할 수 있도록 계정 선택을 강제한다.
        // identity_provider 는 항상 포함한다: 동일 Google 계정이 늘 같은 federation 경로로
        // 로그인되어 동일 sub 가 보장된다. (생략 시 Hosted UI 경유로 같은 이메일이라도 다른 sub 가
        // 발급돼 기존 페이지/DB/이미지가 "다른 사용자"로 보여 사라지는 사고가 난다.)
        extraQueryParams: {
          identity_provider: cfg.identityProvider,
          prompt,
          ...(forceAccountSelection ? { max_age: "0" } : {}),
        },
      });
      await openAuthUrl(request.url);
    } catch (err) {
      console.error("[auth] signIn failed:", err);
      const message = err instanceof Error ? err.message : String(err);
      set({
        state: {
          status: "anonymous",
          reason: "callbackError",
          errorMessage: message,
        },
      });
    }
  },

  async handleCallback(url: string) {
    const manager = getOidcManager();
    try {
      const user = await manager.signinCallback(url);
      if (!user) throw new Error("oidc: signinCallback 가 user 를 반환하지 않았습니다.");
      const tokens = userToTokens(user);
      await writeStoredTokens(tokens);
      clearForceAccountSelection();
      set({
        state: {
          status: "authenticated",
          user: userToAuthUser(user),
          tokens,
        },
      });
      markHadSession();
      startTokenKeepAlive(
        () => get().state,
        (state) => set({ state }),
      );
    } catch (err) {
      // 실패 원인을 콘솔에 남겨 디버깅을 돕는다 (state 머신은 errorMessage 만 노출).
      console.error("[auth] handleCallback failed:", err);
      const message = err instanceof Error ? err.message : String(err);
      const reason: AnonymousReason = /UNAUTHORIZED|access_denied|denied/i.test(message)
        ? "denied"
        : "callbackError";
      await clearStoredTokens();
      stopTokenKeepAlive();
      set({ state: { status: "anonymous", reason, errorMessage: message } });
    }
  },

  async signOut() {
    const manager = getOidcManager();
    const current = get().state;
    const cachedTokens = current.status === "authenticated"
      ? current.tokens
      : await readStoredTokens();
    const logoutUrl = tryBuildHostedLogoutUrl(cachedTokens?.idToken);
    await shutdownSyncEngine({ clearOutbox: true });
    try {
      await manager.removeUser();
    } catch {
      // 이미 비어 있을 수 있다.
    }
    resetOidcManager();
    await clearOidcStorage();
    await clearStoredTokens();
    stopTokenKeepAlive();
    clearHadSession();
    markForceAccountSelection();
    set({ state: { status: "anonymous", reason: "signedOut" } });
    if (logoutUrl) {
      void openAuthUrl(logoutUrl).catch((error) => {
        console.warn("[auth] hosted logout 호출 실패", error);
      });
    }
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
          clearHadSession();
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
              startTokenKeepAlive(
                () => get().state,
                (state) => set({ state }),
              );
              return;
            }
          } catch {
            // refresh 실패 또는 타임아웃 → 만료 상태로 강등.
          }
          await clearStoredTokens();
          clearHadSession();
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
          startTokenKeepAlive(
            () => get().state,
            (state) => set({ state }),
          );
          return;
        }

        await clearStoredTokens();
        clearHadSession();
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
