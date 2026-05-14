import { appsyncClient } from "./graphql/client";
import {
  ON_PAGE_CHANGED,
  ON_DATABASE_CHANGED,
  type GqlPage,
  type GqlDatabase,
} from "./graphql/operations";
import { ON_COMMENT_CHANGED, type GqlComment } from "./queries/comment";
import { ensureFreshTokensForAppSync } from "../auth/apiTokens";
import { getSyncEngine } from "./runtime";
import {
  GqlCommentSchema,
  GqlDatabaseSchema,
  GqlPageSchema,
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
};

type Subscribable = {
  subscribe: (h: {
    next: (msg: { data: Record<string, unknown> }) => void;
    error: (e: unknown) => void;
  }) => { unsubscribe: () => void };
};

const MAX_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_ATTEMPTS = 12;

export function startSubscriptions(
  workspaceId: string,
  handlers: SubscribeHandlers,
): () => void {
  let stopped = false;
  let pageSub: { unsubscribe: () => void } | null = null;
  let dbSub: { unsubscribe: () => void } | null = null;
  let commentSub: { unsubscribe: () => void } | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryAttempts = 0;

  const clearSubs = () => {
    try { pageSub?.unsubscribe(); } catch { /* noop */ }
    try { dbSub?.unsubscribe(); } catch { /* noop */ }
    try { commentSub?.unsubscribe(); } catch { /* noop */ }
    pageSub = null;
    dbSub = null;
    commentSub = null;
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
      console.error("[sub:page]", e);
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
        console.error("[sub:page]", e);
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
      console.error("[sub:database]", e);
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
        console.error("[sub:database]", e);
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
      console.error("[sub:comment]", e);
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
        console.error("[sub:comment]", e);
        scheduleRetry();
      },
    });

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
