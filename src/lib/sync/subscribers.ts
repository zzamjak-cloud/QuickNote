import { appsyncClient } from "./graphql/client";
import {
  ON_PAGE_CHANGED,
  ON_DATABASE_CHANGED,
  ON_PROJECT_CHANGED,
  type GqlPage,
  type GqlDatabase,
  type GqlProject,
} from "./graphql/operations";
import { ON_COMMENT_CHANGED, type GqlComment } from "./queries/comment";
import { ON_WORKSPACE_CHANGED } from "./queries/workspace";
import { ensureFreshTokensForAppSync } from "../auth/apiTokens";
import { getSyncEngine } from "./runtime";
import {
  GqlCommentSchema,
  GqlDatabaseSchema,
  GqlPageSchema,
  GqlProjectSchema,
  parseGqlOne,
} from "./schemas";

// 자기 workspaceId 의 변경 푸시를 수신해 LWW 적용 콜백을 호출.
// 구독 에러 및 네트워크 단절 시 지수 백오프(최대 30초)로 자동 재연결.
// window 'online' 이벤트 수신 시 즉시 재연결.
// 반환된 함수를 호출하면 모든 구독과 재연결 타이머를 해제.

export type SubscribeHandlers = {
  onPage: (item: GqlPage) => void;
  onDatabase: (item: GqlDatabase) => void;
  onComment: (item: GqlComment) => void;
  onProject?: (item: GqlProject) => void;
  /** 워크스페이스 접근권한 변경 신호(트리거). 제공 시에만 구독한다. */
  onWorkspace?: (workspaceId: string) => void;
};

type Subscribable = {
  subscribe: (h: {
    next: (msg: { data: Record<string, unknown> }) => void;
    error: (e: unknown) => void;
  }) => { unsubscribe: () => void };
};

const MAX_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_ATTEMPTS = 12;
const SUB_ERROR_LOG_THROTTLE_MS = 10_000;

function getErrorMessage(error: unknown): string {
  const errors = (error as { errors?: unknown[] } | null)?.errors;
  const first = Array.isArray(errors) ? errors[0] : null;
  return String(
    (first as { message?: string } | null)?.message
      ?? (error instanceof Error ? error.message : error),
  );
}

function isUnauthorizedError(error: unknown): boolean {
  const m = getErrorMessage(error).toLowerCase();
  return (
    m.includes("unauthorized")
    || m.includes("not authorized")
    || m.includes("no valid auth token")
    || m.includes("401")
  );
}

export function startSubscriptions(
  workspaceId: string,
  handlers: SubscribeHandlers,
): () => void {
  let stopped = false;
  let pageSub: { unsubscribe: () => void } | null = null;
  let dbSub: { unsubscribe: () => void } | null = null;
  let commentSub: { unsubscribe: () => void } | null = null;
  let projectSub: { unsubscribe: () => void } | null = null;
  let workspaceSub: { unsubscribe: () => void } | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryAttempts = 0;
  const lastErrorByChannel = new Map<string, { message: string; at: number }>();

  const clearSubs = () => {
    try { pageSub?.unsubscribe(); } catch { /* noop */ }
    try { dbSub?.unsubscribe(); } catch { /* noop */ }
    try { commentSub?.unsubscribe(); } catch { /* noop */ }
    try { projectSub?.unsubscribe(); } catch { /* noop */ }
    try { workspaceSub?.unsubscribe(); } catch { /* noop */ }
    pageSub = null;
    dbSub = null;
    commentSub = null;
    projectSub = null;
    workspaceSub = null;
  };

  const scheduleRetry = () => {
    if (stopped || retryAttempts >= MAX_RETRY_ATTEMPTS) return;
    if (retryTimer) return;
    const delay = Math.min(MAX_RETRY_DELAY_MS, 1000 * 2 ** retryAttempts);
    retryAttempts++;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, delay);
  };

  const logSubError = (channel: "page" | "database" | "comment" | "project" | "workspace", error: unknown) => {
    const msg = getErrorMessage(error);
    const key = `sub:${channel}`;
    const prev = lastErrorByChannel.get(key);
    const now = Date.now();
    if (prev && prev.message === msg && now - prev.at < SUB_ERROR_LOG_THROTTLE_MS) return;
    lastErrorByChannel.set(key, { message: msg, at: now });
    console.error(`[sub:${channel}]`, error);
  };

  const connect = async () => {
    if (stopped) return;
    clearSubs();

    // AppSync USER_POOL 인증에서 subscription 의 connection_init 핸드셰이크에는
    // Amplify 의 headers 함수 대신 authToken 옵션으로 직접 토큰을 주입해야 한다.
    const tokens = await ensureFreshTokensForAppSync();
    const authToken = tokens?.idToken;

    const c = appsyncClient();

    let pageObs: Subscribable;
    try {
      pageObs = c.graphql({
        query: ON_PAGE_CHANGED,
        variables: { workspaceId },
        authToken,
      } as unknown as { query: string; variables: Record<string, unknown> }) as unknown as Subscribable;
    } catch (e) {
      logSubError("page", e);
      if (isUnauthorizedError(e)) {
        await ensureFreshTokensForAppSync();
      }
      scheduleRetry();
      return;
    }
    pageSub = pageObs.subscribe({
      next: ({ data }) => {
        retryAttempts = 0;
        const parsed = parseGqlOne(
          data.onPageChanged,
          GqlPageSchema,
          "onPageChanged",
        );
        if (parsed) handlers.onPage(parsed as unknown as GqlPage);
      },
      error: (e) => {
        logSubError("page", e);
        if (isUnauthorizedError(e)) {
          void ensureFreshTokensForAppSync();
        }
        scheduleRetry();
      },
    });

    let dbObs: Subscribable;
    try {
      dbObs = c.graphql({
        query: ON_DATABASE_CHANGED,
        variables: { workspaceId },
        authToken,
      } as unknown as { query: string; variables: Record<string, unknown> }) as unknown as Subscribable;
    } catch (e) {
      logSubError("database", e);
      if (isUnauthorizedError(e)) {
        await ensureFreshTokensForAppSync();
      }
      scheduleRetry();
      return;
    }
    dbSub = dbObs.subscribe({
      next: ({ data }) => {
        retryAttempts = 0;
        const parsed = parseGqlOne(
          data.onDatabaseChanged,
          GqlDatabaseSchema,
          "onDatabaseChanged",
        );
        if (parsed) handlers.onDatabase(parsed as unknown as GqlDatabase);
      },
      error: (e) => {
        logSubError("database", e);
        if (isUnauthorizedError(e)) {
          void ensureFreshTokensForAppSync();
        }
        scheduleRetry();
      },
    });

    let commentObs: Subscribable;
    try {
      commentObs = c.graphql({
        query: ON_COMMENT_CHANGED,
        variables: { workspaceId },
        authToken,
      } as unknown as { query: string; variables: Record<string, unknown> }) as unknown as Subscribable;
    } catch (e) {
      logSubError("comment", e);
      if (isUnauthorizedError(e)) {
        await ensureFreshTokensForAppSync();
      }
      scheduleRetry();
      return;
    }
    commentSub = commentObs.subscribe({
      next: ({ data }) => {
        retryAttempts = 0;
        const parsed = parseGqlOne(
          data.onCommentChanged,
          GqlCommentSchema,
          "onCommentChanged",
        );
        if (parsed) handlers.onComment(parsed as unknown as GqlComment);
      },
      error: (e) => {
        logSubError("comment", e);
        if (isUnauthorizedError(e)) {
          void ensureFreshTokensForAppSync();
        }
        scheduleRetry();
      },
    });

    // 워크스페이스 접근권한 변경 구독(트리거). onWorkspace 핸들러가 있을 때만.
    if (handlers.onProject) {
      let projectObs: Subscribable;
      try {
        projectObs = c.graphql({
          query: ON_PROJECT_CHANGED,
          variables: { workspaceId },
          authToken,
        } as unknown as { query: string; variables: Record<string, unknown> }) as unknown as Subscribable;
      } catch (e) {
        logSubError("project", e);
        if (isUnauthorizedError(e)) {
          await ensureFreshTokensForAppSync();
        }
        scheduleRetry();
        return;
      }
      projectSub = projectObs.subscribe({
        next: ({ data }) => {
          retryAttempts = 0;
          const parsed = parseGqlOne(
            data.onProjectChanged,
            GqlProjectSchema,
            "onProjectChanged",
          );
          if (parsed) handlers.onProject?.(parsed as unknown as GqlProject);
        },
        error: (e) => {
          logSubError("project", e);
          if (isUnauthorizedError(e)) {
            void ensureFreshTokensForAppSync();
          }
          scheduleRetry();
        },
      });
    }

    if (handlers.onWorkspace) {
      let workspaceObs: Subscribable;
      try {
        workspaceObs = c.graphql({
          query: ON_WORKSPACE_CHANGED,
          variables: { workspaceId },
          authToken,
        } as unknown as { query: string; variables: Record<string, unknown> }) as unknown as Subscribable;
      } catch (e) {
        logSubError("workspace", e);
        if (isUnauthorizedError(e)) {
          await ensureFreshTokensForAppSync();
        }
        scheduleRetry();
        return;
      }
      workspaceSub = workspaceObs.subscribe({
        next: ({ data }) => {
          retryAttempts = 0;
          const changed = (data.onWorkspaceChanged as { workspaceId?: string } | null)?.workspaceId;
          if (changed) handlers.onWorkspace?.(changed);
        },
        error: (e) => {
          logSubError("workspace", e);
          if (isUnauthorizedError(e)) {
            void ensureFreshTokensForAppSync();
          }
          scheduleRetry();
        },
      });
    }

    // 구독 연결 완료 후 오프라인 중 쌓인 outbox 즉시 flush
    void getSyncEngine().then((e) => e.scheduleFlush(0));
  };

  // 온라인 복귀 시 즉시 재연결 + outbox flush (재시도 카운트 초기화)
  const onOnline = () => {
    if (stopped) return;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    retryAttempts = 0;
    void connect();
    // 네트워크 복귀 즉시 오프라인 중 쌓인 outbox 전송
    void getSyncEngine().then((e) => e.scheduleFlush(0));
  };
  window.addEventListener("online", onOnline);

  void connect();

  return () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    window.removeEventListener("online", onOnline);
    clearSubs();
  };
}
