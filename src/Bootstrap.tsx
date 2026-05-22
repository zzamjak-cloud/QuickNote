import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { unstable_batchedUpdates } from "react-dom";
import App from "./App";
import { AuthCallback } from "./components/auth/AuthCallback";
import { useAuthStore } from "./store/authStore";
import {
  fetchPagesByWorkspace,
  fetchDatabasesByWorkspace,
  fetchCommentsByWorkspace,
  startSubscriptions,
} from "./lib/sync";
import { getSyncEngine, shutdownSyncEngine } from "./lib/sync/runtime";
import {
  applyRemotePageToStore,
  applyRemoteDatabaseToStore,
  applyRemoteCommentToStore,
  applyRemotePagesToStore,
  applyRemoteDatabasesToStore,
  applyRemoteCommentsToStore,
  reconcileWorkspaceFullSnapshot,
} from "./lib/sync/storeApply";
import {
  applyWorkspaceSwitch,
  clearWorkspaceScopedStores,
  preloadWorkspaceSnapshots,
  refreshWorkspaceSnapshot,
} from "./lib/sync/workspaceSwitch";
import { workspaceCacheNeedsPrepaintClear } from "./lib/sync/workspaceSwitch";
import { applyWorkspaceLanding } from "./lib/sync/workspaceLanding";
import { reconcileWorkspaceCacheAfterFlush } from "./lib/sync/reconcileWorkspaceCacheAfterFlush";
import { useWorkspaceStore } from "./store/workspaceStore";
import { usePageStore } from "./store/pageStore";
import { useMemberStore } from "./store/memberStore";
import { useWorkspaceOptionsStore } from "./store/workspaceOptionsStore";
import { listMembersApi, fetchMeWithClientPrefs } from "./lib/sync/memberApi";
import { listMyWorkspacesApi } from "./lib/sync/workspaceApi";
import {
  applyRemoteClientPrefs,
  ensureSettingsPersistHydrated,
  ensureWorkspacePersistHydrated,
  flushClientPrefsToServerNow,
} from "./lib/sync/clientPrefsSync";
import { listTeamsApi } from "./lib/sync/teamApi";
import { useTeamStore } from "./store/teamStore";
import { listOrganizationsApi } from "./lib/sync/organizationApi";
import { useOrganizationStore } from "./store/organizationStore";
import { useUiStore } from "./store/uiStore";
import { migrateLegacyBlockCommentsToPagesOnce } from "./lib/comments/migrateLegacyBlockCommentsToPages";
import { useBlockCommentStore } from "./store/blockCommentStore";
import { migratePageBlockCommentsToServerOnce } from "./lib/comments/migratePageBlockCommentsToServer";
import { useNotificationStore } from "./store/notificationStore";
import { LC_SCHEDULER_WORKSPACE_ID } from "./lib/scheduler/scope";
import {
  isLCSchedulerDatabaseId,
} from "./lib/scheduler/database";
import { useSchedulerStore } from "./store/schedulerStore";
import { tryRecoverQuarantine } from "./lib/migrations/quarantineRecovery";

// 인증 상태가 authenticated 로 전환될 때 1) 전체 페이지/DB/연락처를 페치해 LWW 적용,
// 2) 변경 푸시 구독 시작, 3) outbox flush. cleanup 시 구독 해제.
function useSyncBootstrap(): void {
  const authStatus = useAuthStore((s) => s.state.status);
  const authSub = useAuthStore((s) =>
    s.state.status === "authenticated" ? s.state.user.sub : null,
  );
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const setWorkspaces = useWorkspaceStore((s) => s.setWorkspaces);
  const clearWorkspaces = useWorkspaceStore((s) => s.clear);
  const setMe = useMemberStore((s) => s.setMe);
  const setMembers = useMemberStore((s) => s.setMembers);
  const clearMembers = useMemberStore((s) => s.clear);
  const setTeams = useTeamStore((s) => s.setTeams);
  const clearTeams = useTeamStore((s) => s.clear);
  const setOrganizations = useOrganizationStore((s) => s.setOrganizations);
  const clearOrganizations = useOrganizationStore((s) => s.clear);
  // 한 사용자 세션 내에서 중복 부트스트랩 방지.
  const startedForRef = useRef<string | null>(null);

  useEffect(() => {
    // loading 동안 워크스페이스를 비우면 persist 로 복원된 currentWorkspaceId 가 날아가고,
    // 이후 setWorkspaces 가 null 을 "목록에 없음"으로 보아 첫 WS 로 고정한다(새로고침·세션 중 리셋).
    if (authStatus === "loading") return;
    if (authStatus !== "authenticated" || !authSub) {
      void shutdownSyncEngine();
      setMe(null);
      clearWorkspaces();
      useWorkspaceOptionsStore.getState().clear();
      clearMembers();
      clearTeams();
      clearOrganizations();
      useNotificationStore.getState().setNotifications([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [{ member: me, clientPrefs }, workspaces] = await Promise.all([
          fetchMeWithClientPrefs(),
          listMyWorkspacesApi(),
        ]);
        if (cancelled) return;
        // 원격 병합·flush 전에 로컬 스토리지 복원 필수(미복원 시 flush 가 빈 목록으로 서버 덮어씀)
        await ensureSettingsPersistHydrated();
        // 워크스페이스 ID도 동일 — 비동기 storage 복원 전 setWorkspaces 시 currentWorkspaceId 가 null 로 간주되어 첫 WS로 바뀜
        await ensureWorkspacePersistHydrated();
        if (cancelled) return;
        // persist 복원 직후 quarantine 항목 자동 복구 시도 (1회).
        tryRecoverQuarantine();
        applyRemoteClientPrefs(clientPrefs);
        setMe(me);
        // WorkspaceSummary[]로 캐스트 (options는 스토어 밖에서만 사용)
        setWorkspaces(workspaces as Parameters<typeof setWorkspaces>[0]);
        preloadWorkspaceSnapshots([
          ...workspaces.map((workspace) => workspace.workspaceId),
          LC_SCHEDULER_WORKSPACE_ID,
        ]);

        // 현재 워크스페이스의 options를 WorkspaceOptionsStore에 동기화
        const currentWs =
          workspaces.find(
            (w) => w.workspaceId === useWorkspaceStore.getState().currentWorkspaceId,
          ) ?? workspaces[0];
        if (currentWs?.options) {
          useWorkspaceOptionsStore.getState().setOptions(currentWs.options);
        }

        // memberId 확정 직후 즐겨찾기를 서버로 올리고 flush(워크스페이스 부트와 무관)
        await flushClientPrefsToServerNow();

        const [members, teams, organizations] = await Promise.all([
          listMembersApi(),
          listTeamsApi(),
          listOrganizationsApi(),
        ]);
        if (cancelled) return;
        setMembers(members, LC_SCHEDULER_WORKSPACE_ID);
        setTeams(teams, LC_SCHEDULER_WORKSPACE_ID);
        setOrganizations(organizations, LC_SCHEDULER_WORKSPACE_ID);

        // 알림 초기 로드는 스케줄러 첫 화면과 무관하므로 뒤에서 갱신한다.
        void import("./lib/sync/notificationApi")
          .then(({ fetchMyNotificationsApi }) => fetchMyNotificationsApi())
          .then((notifications) => {
            if (!cancelled) useNotificationStore.getState().setNotifications(notifications);
          })
          .catch(() => { /* 알림 로드 실패는 무시 */ });
      } catch (err) {
        console.error("[sync] auth bootstrap failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authStatus, authSub, setMe, setMembers, setTeams, setOrganizations, setWorkspaces, clearWorkspaces, clearMembers, clearTeams, clearOrganizations]);

  useLayoutEffect(() => {
    if (authStatus !== "authenticated" || !authSub || !currentWorkspaceId) {
      startedForRef.current = null;
      return;
    }
    const startedKey = `${authSub}:${currentWorkspaceId}`;
    // 워크스페이스가 실제로 바뀐 경우에만 stale 캐시 제거.
    // 초기 마운트(startedForRef.current === null)에서는 persist 로 복원된
    // 첫 페인트 캐시를 유지하여 fetch 동안 빈 화면을 보여주지 않는다.
    const prevWorkspaceId = startedForRef.current
      ? startedForRef.current.split(":").slice(1).join(":")
      : null;
    startedForRef.current = startedKey;

    let unsub: (() => void) | undefined;
    let unsubLcScheduler: (() => void) | undefined;
    let cancelled = false;
    let workspaceLoadingTimer: number | null = null;
    const setWorkspaceLoading = useUiStore.getState().setWorkspaceLoading;
    const startWorkspaceLoadingTimer = () => {
      if (!prevWorkspaceId || prevWorkspaceId === currentWorkspaceId) return;
      if (workspaceLoadingTimer !== null) return;
      workspaceLoadingTimer = window.setTimeout(() => {
        const workspaceName =
          useWorkspaceStore
            .getState()
            .workspaces.find((w) => w.workspaceId === currentWorkspaceId)?.name ??
          "";
        setWorkspaceLoading({ workspaceId: currentWorkspaceId, workspaceName });
      }, 160);
    };

    (async () => {
      try {
        const switchResult = await applyWorkspaceSwitch(
          prevWorkspaceId,
          currentWorkspaceId,
        );
        if (
          switchResult.reason === "deferred-switch" ||
          switchResult.reason === "pending-outbox" ||
          switchResult.cleared
        ) {
          startWorkspaceLoadingTimer();
        }
        const fetchApply = async (): Promise<void> => {
          await migrateLegacyBlockCommentsToPagesOnce();
          const engine = await getSyncEngine();
          const [[pagesResult, dbsResult, commentsResult], pendingIds] = await Promise.all([
            Promise.allSettled([
              fetchPagesByWorkspace(currentWorkspaceId),
              fetchDatabasesByWorkspace(currentWorkspaceId),
              fetchCommentsByWorkspace(currentWorkspaceId),
            ]),
            engine.getPendingUpsertEntityIds(),
          ]);
          if (cancelled) return;

          const pages = pagesResult.status === "fulfilled" ? pagesResult.value : null;
          const dbs = dbsResult.status === "fulfilled" ? dbsResult.value : null;
          const comments = commentsResult.status === "fulfilled" ? commentsResult.value : null;

          const failedDomains: string[] = [];
          if (pagesResult.status === "rejected") {
            failedDomains.push("pages");
            console.error("[sync] 페이지 페치 실패, 기존 캐시 유지", pagesResult.reason);
          }
          if (dbsResult.status === "rejected") {
            failedDomains.push("databases");
            console.error("[sync] DB 페치 실패, 기존 캐시 유지", dbsResult.reason);
          }
          if (commentsResult.status === "rejected") {
            failedDomains.push("comments");
            console.error("[sync] 댓글 페치 실패, 기존 캐시 유지", commentsResult.reason);
          }
          useUiStore.getState().setSyncPartialFetchFailed(failedDomains.length > 0 ? failedDomains : null);

          // 서버 응답에 포함된 id 집합 — 좀비 정리 시 보호 대상.
          const remotePageIds = new Set<string>();
          if (pages) for (const p of pages) if (p?.id) remotePageIds.add(p.id);
          const remoteDatabaseIds = new Set<string>();
          if (dbs) for (const d of dbs) if (d?.id) remoteDatabaseIds.add(d.id);

          unstable_batchedUpdates(() => {
            if (switchResult.reason === "deferred-switch") {
              clearWorkspaceScopedStores(currentWorkspaceId);
            }
            useBlockCommentStore.getState().clearMessages();
            if (pages) applyRemotePagesToStore(pages);
            if (dbs) applyRemoteDatabasesToStore(dbs);
            if (comments) applyRemoteCommentsToStore(comments);
            // pages + dbs 모두 성공한 경우에만 좀비 정리 실행.
            // 부분 실패 시 빈 집합을 전달하면 유효 캐시까지 삭제되므로 건너뜀.
            if (pages && dbs) {
              reconcileWorkspaceFullSnapshot({
                workspaceId: currentWorkspaceId,
                remotePageIds,
                remoteDatabaseIds,
                pendingUpsertPageIds: pendingIds.pages,
                pendingUpsertDatabaseIds: pendingIds.databases,
              });
            }
            applyWorkspaceLanding(currentWorkspaceId);
            refreshWorkspaceSnapshot(currentWorkspaceId);
          });
          if (cancelled) return;
          migratePageBlockCommentsToServerOnce(currentWorkspaceId);
        };
        const setHold = useUiStore.getState().setOutboxWorkspaceSwitchHold;
        if (switchResult.reason === "pending-outbox") {
          setHold({
            pending: switchResult.pending,
            targetWorkspaceId: currentWorkspaceId,
            sourceWorkspaceId:
              prevWorkspaceId ??
              usePageStore.getState().cacheWorkspaceId ??
              null,
          });
          const engine = await getSyncEngine();
          await engine.flush();
          if (!cancelled) {
            await reconcileWorkspaceCacheAfterFlush({
              currentWorkspaceId,
              sessionPrevWorkspaceId: prevWorkspaceId,
              fetchApply,
              cancelled: () => cancelled,
            });
          }
          if (
            cancelled ||
            workspaceCacheNeedsPrepaintClear(currentWorkspaceId)
          ) {
            return;
          }
        } else {
          setHold(null);
        }
        await fetchApply();

        if (cancelled) return;
        const refreshSchedulerPage = (pageId: string) => {
          useSchedulerStore
            .getState()
            .refreshSchedulePageFromLocal(pageId, LC_SCHEDULER_WORKSPACE_ID);
        };
        unsub = startSubscriptions(currentWorkspaceId, {
          onPage: (p) => {
            const isSchedulerPage = isLCSchedulerDatabaseId(
              p.databaseId ?? usePageStore.getState().pages[p.id]?.databaseId ?? null,
            );
            applyRemotePageToStore(p);
            if (isSchedulerPage) {
              refreshSchedulerPage(p.id);
            }
          },
          onDatabase: (d) => {
            applyRemoteDatabaseToStore(d);
          },
          onComment: applyRemoteCommentToStore,
        });
        // LC 스케줄러는 공용 워크스페이스이므로 항상 별도 구독을 유지한다.
        if (currentWorkspaceId !== LC_SCHEDULER_WORKSPACE_ID) {
          unsubLcScheduler = startSubscriptions(LC_SCHEDULER_WORKSPACE_ID, {
            onPage: (p) => {
              const isSchedulerPage = isLCSchedulerDatabaseId(
                p.databaseId ?? usePageStore.getState().pages[p.id]?.databaseId ?? null,
              );
              applyRemotePageToStore(p);
              if (isSchedulerPage) {
                refreshSchedulerPage(p.id);
              }
            },
            onDatabase: (d) => {
              applyRemoteDatabaseToStore(d);
            },
            onComment: applyRemoteCommentToStore,
          });
        }

        const engine = await getSyncEngine();
        await engine.flush();

        if (!cancelled) {
          await reconcileWorkspaceCacheAfterFlush({
            currentWorkspaceId,
            sessionPrevWorkspaceId: prevWorkspaceId,
            fetchApply,
            cancelled: () => cancelled,
          });
        }
      } catch (err) {
        console.error("[sync] bootstrap failed", err);
      } finally {
        if (workspaceLoadingTimer !== null) {
          window.clearTimeout(workspaceLoadingTimer);
          workspaceLoadingTimer = null;
        }
        const loading = useUiStore.getState().workspaceLoading;
        if (loading?.workspaceId === currentWorkspaceId) {
          setWorkspaceLoading(null);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (workspaceLoadingTimer !== null) {
        window.clearTimeout(workspaceLoadingTimer);
      }
      const loading = useUiStore.getState().workspaceLoading;
      if (loading?.workspaceId === currentWorkspaceId) {
        setWorkspaceLoading(null);
      }
      try {
        unsub?.();
        unsubLcScheduler?.();
      } catch (err) {
        console.error("[sync] unsubscribe failed", err);
      }
    };
  }, [authStatus, authSub, currentWorkspaceId]);

  // 탭 복귀 시 즐겨찾기(clientPrefs)만 가볍게 재동기화.
  useEffect(() => {
    if (authStatus !== "authenticated" || !authSub) return;
    const pullPrefs = () => {
      void (async () => {
        try {
          const { clientPrefs } = await fetchMeWithClientPrefs();
          applyRemoteClientPrefs(clientPrefs);
        } catch {
          /* 탭 전환 중 일시 네트워크 오류는 무시 */
        }
      })();
    };
    const onVis = () => {
      if (document.visibilityState === "visible") pullPrefs();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [authStatus, authSub]);

  // 온라인 복귀 시 원격 데이터 재페치 + outbox flush.
  // 오프라인 동안 다른 클라이언트가 만든 변경을 즉시 반영하고
  // 로컬에서 쌓인 pending mutations 를 전송함.
  useEffect(() => {
    if (authStatus !== "authenticated" || !authSub || !currentWorkspaceId) return;
    const wsId = currentWorkspaceId;
    const onOnline = () => {
      void (async () => {
        try {
          const { clientPrefs } = await fetchMeWithClientPrefs();
          applyRemoteClientPrefs(clientPrefs);
        } catch {
          /* ignore */
        }
        try {
          const fetchApply = async (): Promise<void> => {
            const engine2 = await getSyncEngine();
            const [[pagesResult, dbsResult, commentsResult], pendingIds] = await Promise.all([
              Promise.allSettled([
                fetchPagesByWorkspace(wsId),
                fetchDatabasesByWorkspace(wsId),
                fetchCommentsByWorkspace(wsId),
              ]),
              engine2.getPendingUpsertEntityIds(),
            ]);

            const pages = pagesResult.status === "fulfilled" ? pagesResult.value : null;
            const dbs = dbsResult.status === "fulfilled" ? dbsResult.value : null;
            const comments = commentsResult.status === "fulfilled" ? commentsResult.value : null;

            const failedDomains: string[] = [];
            if (pagesResult.status === "rejected") {
              failedDomains.push("pages");
              console.error("[sync] 온라인 복귀 — 페이지 페치 실패, 기존 캐시 유지", pagesResult.reason);
            }
            if (dbsResult.status === "rejected") {
              failedDomains.push("databases");
              console.error("[sync] 온라인 복귀 — DB 페치 실패, 기존 캐시 유지", dbsResult.reason);
            }
            if (commentsResult.status === "rejected") {
              failedDomains.push("comments");
              console.error("[sync] 온라인 복귀 — 댓글 페치 실패, 기존 캐시 유지", commentsResult.reason);
            }
            useUiStore.getState().setSyncPartialFetchFailed(failedDomains.length > 0 ? failedDomains : null);

            const remotePageIds = new Set<string>();
            if (pages) for (const p of pages) if (p?.id) remotePageIds.add(p.id);
            const remoteDatabaseIds = new Set<string>();
            if (dbs) for (const d of dbs) if (d?.id) remoteDatabaseIds.add(d.id);

            if (pages) applyRemotePagesToStore(pages);
            if (dbs) applyRemoteDatabasesToStore(dbs);
            if (comments) applyRemoteCommentsToStore(comments);
            if (pages && dbs) {
              reconcileWorkspaceFullSnapshot({
                workspaceId: wsId,
                remotePageIds,
                remoteDatabaseIds,
                pendingUpsertPageIds: pendingIds.pages,
                pendingUpsertDatabaseIds: pendingIds.databases,
              });
            }
          };
          await fetchApply();
          const engine = await getSyncEngine();
          await engine.flush();
          await reconcileWorkspaceCacheAfterFlush({
            currentWorkspaceId: wsId,
            fetchApply,
          });
        } catch (err) {
          console.error("[sync] online refetch failed", err);
        }
      })();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [authStatus, authSub, currentWorkspaceId]);
}

// 웹 환경에서 /auth/callback 으로 리다이렉트되면 code 교환을 처리한 뒤 / 로 전환한다.
export function Bootstrap() {
  const [path, setPath] = useState(window.location.pathname);
  useSyncBootstrap();
  // onDone 을 useCallback 으로 안정화. 인라인 함수면 매 렌더마다 새 참조가 되어
  // AuthCallback 의 useEffect 가 재실행되고 handleCallback 이 두 번 호출된다.
  // 두 번째 호출은 이미 consume 된 state 를 다시 읽어 "No matching state found" 발생.
  const goHome = useCallback(() => setPath("/"), []);
  if (path === "/auth/callback") {
    return <AuthCallback onDone={goHome} />;
  }
  return <App />;
}
