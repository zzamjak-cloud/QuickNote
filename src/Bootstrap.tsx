import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import App from "./App";
import { AuthCallback } from "./components/auth/AuthCallback";
import { useAuthStore } from "./store/authStore";
import {
  startSubscriptions,
} from "./lib/sync";
import type { GqlProject } from "./lib/sync/graphql/operations";
import { getSyncEngine, shutdownSyncEngine } from "./lib/sync/runtime";
import {
  applyRemotePageMetasToStore,
  applyRemoteDatabaseToStore,
} from "./lib/sync/storeApply";
import { applyRemoteCommentToStore } from "./lib/sync/storeApply/commentApply";
import {
  applyWorkspaceSwitch,
  cacheBelongsToWorkspace,
  preloadWorkspaceSnapshots,
  workspaceHasStructureCache,
  workspaceHasPageContentCache,
} from "./lib/sync/workspaceSwitch";
import { workspaceCacheNeedsPrepaintClear } from "./lib/sync/workspaceSwitch";
import { reconcileWorkspaceCacheAfterFlush } from "./lib/sync/reconcileWorkspaceCacheAfterFlush";
import {
  fetchApplyWorkspaceRemoteMetaSnapshot,
  fetchApplyWorkspaceRemoteSnapshot,
} from "./lib/sync/workspaceSnapshotBootstrap";
import { resolveWorkspaceRemoteFetchMode } from "./lib/sync/workspaceFetchMode";
import { useWorkspaceStore } from "./store/workspaceStore";
import { useCustomIconStore } from "./store/customIconStore";
import { useSyncWatermarkStore } from "./store/syncWatermarkStore";
import { useSchedulerViewStore } from "./store/schedulerViewStore";
import { usePageStore } from "./store/pageStore";
import { useMemberStore } from "./store/memberStore";
import { useWorkspaceOptionsStore } from "./store/workspaceOptionsStore";
import { fetchMeWithClientPrefs } from "./lib/sync/memberApi";
import { listMyWorkspacesApi } from "./lib/sync/workspaceApi";
import {
  applyRemoteClientPrefs,
  ensureSettingsPersistHydrated,
  ensureWorkspacePersistHydrated,
  flushClientPrefsToServerNow,
} from "./lib/sync/clientPrefsSync";
import { useTeamStore } from "./store/teamStore";
import { useOrganizationStore } from "./store/organizationStore";
import { useUiStore } from "./store/uiStore";
import { migrateLegacyBlockCommentsToPagesOnce } from "./lib/comments/migrateLegacyBlockCommentsToPages";
import { migratePageBlockCommentsToServerOnce } from "./lib/comments/migratePageBlockCommentsToServer";
import { useNotificationStore } from "./store/notificationStore";
import { LC_SCHEDULER_WORKSPACE_ID } from "./lib/scheduler/scope";
import {
  isLCSchedulerDatabaseId,
} from "./lib/scheduler/database";
import { useSchedulerStore } from "./store/schedulerStore";
import { useSchedulerProjectsStore } from "./store/schedulerProjectsStore";
import { resetWorkspaceLocalCaches } from "./lib/sync/resetWorkspaceLocalCaches";
import { consumeOfflineGapMs, reconnectStrategyForGap } from "./lib/sync/offlineGap";
import { refreshWorkspaceMeta } from "./lib/sync/workspaceMetaCache";
import { tryRecoverQuarantine } from "./lib/migrations/quarantineRecovery";
import { createLCSchedulerRootPageRepairGate } from "./lib/sync/lcSchedulerWorkspaceRepair";

// 2026-06-11: PageMeta 스키마 필드 누락으로 listPageMetas 가 전량 실패하던 빌드에서
// 워터마크만 전진해 페이지 누락이 고착된 캐시를 일괄 재기준선한다.
const WORKSPACE_CACHE_REPAIR_REVISION = "2026-06-11-pagemeta-lasteditedby-schema-repair";
const workspaceCacheRepairKey = (workspaceId: string): string =>
  `quicknote.workspace.cacheRepair.${WORKSPACE_CACHE_REPAIR_REVISION}:${workspaceId}`;
const lcSchedulerRootPageRepairGate = createLCSchedulerRootPageRepairGate();

function needsWorkspaceCacheRepair(workspaceId: string): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(workspaceCacheRepairKey(workspaceId)) !== "1";
}

function markWorkspaceCacheRepaired(workspaceId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(workspaceCacheRepairKey(workspaceId), "1");
}

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
  const clearMembers = useMemberStore((s) => s.clear);
  const clearTeams = useTeamStore((s) => s.clear);
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

        await refreshWorkspaceMeta(LC_SCHEDULER_WORKSPACE_ID).catch((error) => {
          console.warn("[sync] LC 워크스페이스 메타 동기화 실패", error);
        });
        if (cancelled) return;

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
  }, [authStatus, authSub, setMe, setWorkspaces, clearWorkspaces, clearMembers, clearTeams, clearOrganizations]);

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
    let cancelled = false;
    let workspaceLoadingTimer: number | null = null;
    const setWorkspaceLoading = useUiStore.getState().setWorkspaceLoading;
    const startWorkspaceLoadingTimer = (force = false, delayMs = 160) => {
      if (!force && (!prevWorkspaceId || prevWorkspaceId === currentWorkspaceId)) return;
      if (workspaceLoadingTimer !== null) return;
      workspaceLoadingTimer = window.setTimeout(() => {
        const workspaceName =
          useWorkspaceStore
            .getState()
            .workspaces.find((w) => w.workspaceId === currentWorkspaceId)?.name ??
          "";
        setWorkspaceLoading({ workspaceId: currentWorkspaceId, workspaceName });
      }, delayMs);
    };

    (async () => {
      // 부트스트랩 진행 중에는 복원된 풀페이지 DB 탭으로 홈을 재생성하지 않도록 막는다.
      useUiStore.getState().setWorkspaceBootstrapping(true);
      try {
        const switchResult = await applyWorkspaceSwitch(
          prevWorkspaceId,
          currentWorkspaceId,
        );
        const isInitialWorkspaceBootstrap = prevWorkspaceId === null;
        const cacheBelongsToCurrentWorkspace = cacheBelongsToWorkspace(currentWorkspaceId);
        const structureCacheAvailable =
          workspaceHasStructureCache(currentWorkspaceId);
        const cacheAvailableForWorkspace =
          cacheBelongsToCurrentWorkspace && structureCacheAvailable;
        const fetchMode = resolveWorkspaceRemoteFetchMode({
          cacheAvailable: cacheAvailableForWorkspace,
          switchCleared: switchResult.cleared,
          switchReason: switchResult.reason,
          watermark: useSyncWatermarkStore
            .getState()
            .getWatermark(currentWorkspaceId),
        });
        const needsInitialWorkspaceLoading =
          isInitialWorkspaceBootstrap && !cacheAvailableForWorkspace;
        const needsBlockingWorkspaceLoading =
          !cacheAvailableForWorkspace ||
          switchResult.reason === "deferred-switch" ||
          switchResult.reason === "pending-outbox" ||
          switchResult.cleared;
        if (needsInitialWorkspaceLoading || needsBlockingWorkspaceLoading) {
          startWorkspaceLoadingTimer(
            isInitialWorkspaceBootstrap || needsInitialWorkspaceLoading,
            isInitialWorkspaceBootstrap ? 0 : 160,
          );
        }
        const fetchApply = async (
          options: { forceFull?: boolean; forceMetaBaseline?: boolean } = {},
        ): Promise<void> => {
          const { forceFull = false, forceMetaBaseline = false } = options;
          const updatedAfter = forceFull || forceMetaBaseline
            ? undefined
            : fetchMode.updatedAfter;
          const useMetaBaseline =
            forceMetaBaseline ||
            (
              !forceFull &&
              !updatedAfter &&
              fetchMode.kind === "full" &&
              fetchMode.reason === "no-cache"
            );
          await migrateLegacyBlockCommentsToPagesOnce();
          const applyRemote = async (
            nextUpdatedAfter: string | undefined,
            logPrefix: string,
          ) => {
            const fetcher = useMetaBaseline
              ? fetchApplyWorkspaceRemoteMetaSnapshot
              : fetchApplyWorkspaceRemoteSnapshot;
            await fetcher({
              workspaceId: currentWorkspaceId,
              cancelled: () => cancelled,
              clearWorkspaceBeforeApply:
                !nextUpdatedAfter && switchResult.reason === "deferred-switch",
              clearBlockCommentsBeforeApply: true,
              applyLandingAfterApply: true,
              // 워크스페이스 진입(전환·새로고침·강제 새로고침)에서 활성 탭이 DB 탭/풀페이지 DB 홈이면
              // ensureFullPagePageForDatabase 가 메타 상태에서 홈을 재생성해 유령 페이지가 생기므로
              // 첫 인덱스로 대체한다. 안전한 일반 페이지는 그대로 복원한다(applyWorkspaceLanding 참고).
              landingForceFirstRoot: true,
              refreshSnapshotAfterApply: true,
              useBatchedUpdates: true,
              updatedAfter: nextUpdatedAfter,
              logPrefix,
            });
          };
          await applyRemote(
            updatedAfter,
            updatedAfter
              ? "워크스페이스 전환(증분)"
              : useMetaBaseline
                ? "워크스페이스 전환(메타)"
                : "워크스페이스 전환(전체)",
          );
          if (
            updatedAfter &&
            !cancelled &&
            (!workspaceHasStructureCache(currentWorkspaceId) ||
              // 구조 캐시(nextToken=null)는 있으나 실제 보이는 페이지 본문이 0개인 경우 —
              // persist 된 빈 캐시가 cache-hit 으로 처리되어 증분 fetch 만 돌면 사이드바가
              // 영구히 빈 상태로 굳는다(데스크톱 SQLite persist 재발). 전체 fetch 로 강제 복구.
              !workspaceHasPageContentCache(currentWorkspaceId))
          ) {
            await applyRemote(undefined, "워크스페이스 전환(증분 후 캐시·본문 비어 있음 → 전체)");
          }
          if (
            useMetaBaseline &&
            !cancelled &&
            !cacheBelongsToWorkspace(currentWorkspaceId)
          ) {
            await fetchApplyWorkspaceRemoteSnapshot({
              workspaceId: currentWorkspaceId,
              cancelled: () => cancelled,
              clearWorkspaceBeforeApply: false,
              clearBlockCommentsBeforeApply: true,
              applyLandingAfterApply: true,
              landingForceFirstRoot: true,
              refreshSnapshotAfterApply: true,
              useBatchedUpdates: true,
              logPrefix: "워크스페이스 전환(메타 캐시 비어 있음 → 전체)",
            });
          }
          if (cancelled) return;
          migratePageBlockCommentsToServerOnce(currentWorkspaceId);
        };
        const fetchApplyFull = async (): Promise<void> => fetchApply({ forceFull: true });
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
              fetchApply: fetchApplyFull,
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
        const oneTimeWorkspaceCacheRepair = needsWorkspaceCacheRepair(currentWorkspaceId);
        const rootPageCacheRepair = lcSchedulerRootPageRepairGate.shouldAttempt(
          currentWorkspaceId,
          usePageStore.getState().pages,
        );
        const repairWorkspaceCache = oneTimeWorkspaceCacheRepair || rootPageCacheRepair;
        if (repairWorkspaceCache) {
          // 캐시 비움 + 워터마크 리셋은 항상 짝 — 단일 헬퍼로 강제(누락 시 데이터 유실).
          resetWorkspaceLocalCaches(currentWorkspaceId);
        }
        await fetchApply({ forceMetaBaseline: repairWorkspaceCache });
        if (!cancelled && oneTimeWorkspaceCacheRepair) {
          markWorkspaceCacheRepaired(currentWorkspaceId);
        }
        // LC 스케줄러 워크스페이스 데이터는 CAT 등 다른 워크스페이스 진입 시 미리 끌어오지 않는다.
        // 외부 DB/row page 는 사용자가 실제로 열 때 캐시 결손만 보정해야 한다.

        if (cancelled) return;
        const refreshSchedulerPage = (pageId: string) => {
          useSchedulerStore
            .getState()
            .refreshSchedulePageFromLocal(pageId, LC_SCHEDULER_WORKSPACE_ID);
        };
        const applySchedulerProject = (project: GqlProject) => {
          if (project.workspaceId === LC_SCHEDULER_WORKSPACE_ID) {
            useSchedulerProjectsStore.getState().applyRemote(project);
          }
        };
        unsub = startSubscriptions(currentWorkspaceId, {
          onPage: (p) => {
            const isSchedulerPage = isLCSchedulerDatabaseId(
              p.databaseId ?? usePageStore.getState().pages[p.id]?.databaseId ?? null,
            );
            applyRemotePageMetasToStore([p]);
            if (isSchedulerPage) {
              refreshSchedulerPage(p.id);
            }
          },
          onDatabase: (d) => {
            applyRemoteDatabaseToStore(d);
          },
          onComment: applyRemoteCommentToStore,
          ...(currentWorkspaceId === LC_SCHEDULER_WORKSPACE_ID
            ? {
                onProject: applySchedulerProject,
              }
            : {}),
          onWorkspace: () => {
            // 접근권한 변경 신호 → 본인 기준 워크스페이스 목록/권한 재페치(회수 시 setWorkspaces 가 자동 전환).
            void listMyWorkspacesApi()
              .then((workspaces) => {
                if (!cancelled) {
                  setWorkspaces(workspaces as Parameters<typeof setWorkspaces>[0]);
                }
              })
              .catch((error) => {
                console.warn("[sync] 워크스페이스 접근권한 갱신 실패", error);
              });
          },
        });
        // LC 스케줄러 구독은 스케줄러 팝업이 열려 있을 때만 유지한다(#8 — 아래 별도 effect).
        // 닫혀 있는 동안의 변경분은 모달 진입 시 fetchSchedules/refreshWorkspaceMeta(증분)로 보정된다.

        const engine = await getSyncEngine();
        await engine.flush();

        if (!cancelled) {
          await reconcileWorkspaceCacheAfterFlush({
            currentWorkspaceId,
            sessionPrevWorkspaceId: prevWorkspaceId,
            fetchApply: fetchApplyFull,
            cancelled: () => cancelled,
          });
        }
      } catch (err) {
        console.error("[sync] bootstrap failed", err);
      } finally {
        useUiStore.getState().setWorkspaceBootstrapping(false);
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
      } catch (err) {
        console.error("[sync] unsubscribe failed", err);
      }
    };
  }, [authStatus, authSub, currentWorkspaceId, setWorkspaces]);

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

  // 워크스페이스 공유 커스텀 아이콘 구독 — 다른 사용자의 추가/삭제를 실시간 반영.
  // 최초 1회만 list 를 페치하고, 이후 변경은 구독 페이로드를 직접 캐시에 반영한다(#9).
  // (이전: 이벤트마다 list 전체 재페치 → AppSync 쿼리 + Lambda 호출 반복)
  useEffect(() => {
    if (authStatus !== "authenticated" || !authSub || !currentWorkspaceId) return;
    const wsId = currentWorkspaceId;
    void useCustomIconStore.getState().fetch(wsId);
    let sub: { unsubscribe: () => void } | null = null;
    void (async () => {
      const { subscribeCustomIcons } = await import("./lib/sync/customIconApi");
      sub = subscribeCustomIcons(
        wsId,
        (icon) => {
          // deletedAt tombstone 이 있으면 삭제, 없으면 추가/갱신 — 페이로드만으로 동기화.
          useCustomIconStore.getState().applyServerEvent(icon, Boolean(icon.deletedAt));
        },
        () => {
          /* error 는 console.warn 만 — 재시도는 다음 fetch 트리거에서. */
        },
      );
    })();
    return () => {
      try {
        sub?.unsubscribe();
      } catch {
        /* noop */
      }
    };
  }, [authStatus, authSub, currentWorkspaceId]);

  // LC 스케줄러 구독은 스케줄러 팝업이 열려 있을 때만 유지한다(#8).
  // 공용 워크스페이스라 상시 구독하면 미사용 세션에서도 AppSync WebSocket 연결 시간이 과금된다.
  // 닫혀 있는 동안의 변경분은 모달 진입 시 fetchSchedules·refreshWorkspaceMeta(증분)로 보정된다.
  const schedulerOpen = useSchedulerViewStore((s) => s.schedulerOpen);
  useEffect(() => {
    if (authStatus !== "authenticated" || !authSub || !currentWorkspaceId) return;
    if (!schedulerOpen) return;
    // 현재 워크스페이스가 이미 LC 스케줄러면 메인 구독이 커버하므로 중복 구독하지 않는다.
    if (currentWorkspaceId === LC_SCHEDULER_WORKSPACE_ID) return;
    const refreshSchedulerPage = (pageId: string) => {
      useSchedulerStore
        .getState()
        .refreshSchedulePageFromLocal(pageId, LC_SCHEDULER_WORKSPACE_ID);
    };
    const applySchedulerProject = (project: GqlProject) => {
      if (project.workspaceId === LC_SCHEDULER_WORKSPACE_ID) {
        useSchedulerProjectsStore.getState().applyRemote(project);
      }
    };
    const unsubLc = startSubscriptions(LC_SCHEDULER_WORKSPACE_ID, {
      onPage: (p) => {
        const isSchedulerPage = isLCSchedulerDatabaseId(
          p.databaseId ?? usePageStore.getState().pages[p.id]?.databaseId ?? null,
        );
        applyRemotePageMetasToStore([p]);
        if (isSchedulerPage) refreshSchedulerPage(p.id);
      },
      onDatabase: (d) => {
        applyRemoteDatabaseToStore(d);
      },
      onComment: applyRemoteCommentToStore,
      onProject: applySchedulerProject,
    });
    return () => {
      try {
        unsubLc();
      } catch (err) {
        console.error("[sync] LC scheduler unsubscribe failed", err);
      }
    };
  }, [authStatus, authSub, currentWorkspaceId, schedulerOpen]);

  // 온라인 복귀 시 원격 데이터 재페치 + outbox flush.
  // 오프라인 동안 다른 클라이언트가 만든 변경을 즉시 반영하고
  // 로컬에서 쌓인 pending mutations 를 전송함.
  useEffect(() => {
    if (authStatus !== "authenticated" || !authSub || !currentWorkspaceId) return;
    const wsId = currentWorkspaceId;
    const MAX_RECONNECT_ATTEMPTS = 5;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const reconnect = async (attempt: number, gapMs: number): Promise<void> => {
      // 1. 핸드셰이크: navigator.onLine=true 라도 실제 AppSync 도달 가능한지 경량 authed 호출로 확인.
      //    캡티브 포털 등 거짓 online 이면 flush 가 어차피 실패하므로, 다음 online 이벤트를
      //    기다리지 않고 backoff 재시도한다.
      let clientPrefs;
      try {
        ({ clientPrefs } = await fetchMeWithClientPrefs());
      } catch {
        if (attempt < MAX_RECONNECT_ATTEMPTS && navigator.onLine) {
          const delay = Math.min(30_000, 1_000 * 2 ** attempt);
          reconnectTimer = setTimeout(() => void reconnect(attempt + 1, gapMs), delay);
        }
        return;
      }
      try {
        applyRemoteClientPrefs(clientPrefs);
      } catch {
        /* ignore */
      }
      // 2. 오프라인 갭 기반 fetch 전략 escalation(T1=10분→기준선, T2=24h→전체).
      try {
        // reconcile 에 넘기는 fetchApply 는 캐시 클리어 후 재호출될 수 있으므로 반드시 "전체 모드".
        const fetchApplyFull = async (): Promise<void> => {
          await fetchApplyWorkspaceRemoteSnapshot({
            workspaceId: wsId,
            logPrefix: "온라인 복귀",
          });
        };
        const strategy = reconnectStrategyForGap(gapMs);
        if (strategy === "meta-baseline") {
          // 갭이 길면 메타 기준선 재확보로 누락 항목 자가치유(prune 없이).
          await fetchApplyWorkspaceRemoteMetaSnapshot({
            workspaceId: wsId,
            logPrefix: "온라인 복귀(기준선)",
          });
        } else if (strategy === "full") {
          // 갭이 매우 길면 전체 페치(updatedAfter 없음 → prune 포함).
          await fetchApplyWorkspaceRemoteSnapshot({
            workspaceId: wsId,
            logPrefix: "온라인 복귀(전체)",
          });
        } else {
          // 짧은 갭: 증분 모드 — 워터마크 이후 변경분만. 워터마크 없으면 자동 전체+prune.
          const watermark = useSyncWatermarkStore.getState().getWatermark(wsId);
          await fetchApplyWorkspaceRemoteSnapshot({
            workspaceId: wsId,
            updatedAfter: watermark,
            logPrefix: watermark ? "온라인 복귀(증분)" : "온라인 복귀",
          });
        }
        const engine = await getSyncEngine();
        await engine.flush();
        await reconcileWorkspaceCacheAfterFlush({
          currentWorkspaceId: wsId,
          fetchApply: fetchApplyFull,
        });
      } catch (err) {
        console.error("[sync] online refetch failed", err);
      }
    };

    const onOnline = () => {
      const gapMs = consumeOfflineGapMs();
      void reconnect(0, gapMs);
    };
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
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
