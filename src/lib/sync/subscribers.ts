import { appsyncClient } from "./graphql/client";
import {
  ON_PAGE_CHANGED,
  ON_DATABASE_CHANGED,
  ON_PROJECT_CHANGED,
  type GqlPageMeta,
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
  GqlPageMetaSchema,
  GqlProjectSchema,
  parseGqlOne,
} from "./schemas";

// 자기 workspaceId 의 변경 푸시를 수신해 LWW 적용 콜백을 호출.
// 구독 에러 및 네트워크 단절 시 지수 백오프(최대 30초)로 자동 재연결.
// window 'online' 이벤트 수신 시 즉시 재연결.
// 반환된 함수를 호출하면 모든 구독과 재연결 타이머를 해제.

export type SubscribeHandlers = {
  onPage: (item: GqlPageMeta) => void;
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
  let subs: Array<{ unsubscribe: () => void }> = [];
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryAttempts = 0;
  const lastErrorByChannel = new Map<string, { message: string; at: number }>();

  const clearSubs = () => {
    for (const sub of subs) {
      try { sub.unsubscribe(); } catch { /* noop */ }
    }
    subs = [];
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
    // Amplify 의 authToken 옵션이 아니라 additionalHeaders 경로로 직접 토큰을 주입해야 한다.
    // authToken 은 query/mutation 에서는 Authorization 으로 변환되지만,
    // subscription WebSocket handshake 에서는 additionalCustomHeaders 만 사용된다.
    const tokens = await ensureFreshTokensForAppSync();
    const authToken = tokens?.idToken;
    const additionalHeaders = authToken ? { Authorization: authToken } : undefined;

    const c = appsyncClient();

    // 채널별 구독 배선을 단일 디스크립터 테이블로 모은다.
    // 새 동기화 엔티티 구독 추가 시 이 배열에 한 항목만 더하면 된다.
    // enabled=false 인 채널은 건너뛴다(해당 핸들러 미제공 시).
    const channels: Array<{
      key: "page" | "database" | "comment" | "project" | "workspace";
      query: string;
      enabled: boolean;
      onNext: (data: Record<string, unknown>) => void;
    }> = [
      {
        key: "page",
        query: ON_PAGE_CHANGED,
        enabled: true,
        onNext: (data) => {
          const parsed = parseGqlOne(data.onPageChanged, GqlPageMetaSchema, "onPageChanged");
          if (parsed) handlers.onPage(parsed as unknown as GqlPageMeta);
        },
      },
      {
        key: "database",
        query: ON_DATABASE_CHANGED,
        enabled: true,
        onNext: (data) => {
          const parsed = parseGqlOne(data.onDatabaseChanged, GqlDatabaseSchema, "onDatabaseChanged");
          if (parsed) handlers.onDatabase(parsed as unknown as GqlDatabase);
        },
      },
      {
        key: "comment",
        query: ON_COMMENT_CHANGED,
        enabled: true,
        onNext: (data) => {
          const parsed = parseGqlOne(data.onCommentChanged, GqlCommentSchema, "onCommentChanged");
          if (parsed) handlers.onComment(parsed as unknown as GqlComment);
        },
      },
      {
        // 워크스페이스 접근권한 변경 구독(트리거). onProject 핸들러가 있을 때만.
        key: "project",
        query: ON_PROJECT_CHANGED,
        enabled: !!handlers.onProject,
        onNext: (data) => {
          const parsed = parseGqlOne(data.onProjectChanged, GqlProjectSchema, "onProjectChanged");
          if (parsed) handlers.onProject?.(parsed as unknown as GqlProject);
        },
      },
      {
        key: "workspace",
        query: ON_WORKSPACE_CHANGED,
        enabled: !!handlers.onWorkspace,
        onNext: (data) => {
          const changed = (data.onWorkspaceChanged as { workspaceId?: string } | null)?.workspaceId;
          if (changed) handlers.onWorkspace?.(changed);
        },
      },
    ];

    for (const channel of channels) {
      if (!channel.enabled) continue;
      let obs: Subscribable;
      try {
        obs = c.graphql({
          query: channel.query,
          variables: { workspaceId },
          authMode: "none",
        }, additionalHeaders) as unknown as Subscribable;
      } catch (e) {
        logSubError(channel.key, e);
        if (isUnauthorizedError(e)) {
          await ensureFreshTokensForAppSync();
        }
        scheduleRetry();
        return;
      }
      const sub = obs.subscribe({
        next: ({ data }) => {
          retryAttempts = 0;
          try {
            channel.onNext(data);
          } catch (e) {
            logSubError(channel.key, e);
          }
        },
        error: (e) => {
          logSubError(channel.key, e);
          if (isUnauthorizedError(e)) {
            void ensureFreshTokensForAppSync();
          }
          scheduleRetry();
        },
      });
      subs.push(sub);
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
