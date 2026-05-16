import { useCallback, useEffect, useRef, useState } from "react";
import App from "./App";
import { AuthCallback } from "./components/auth/AuthCallback";
import { useAuthStore } from "./store/authStore";
import {
  fetchPagesByWorkspace,
  fetchDatabasesByWorkspace,
  fetchCommentsByWorkspace,
  startSubscriptions,
} from "./lib/sync";
import { getSyncEngine } from "./lib/sync/runtime";
import {
  applyRemotePageToStore,
  applyRemoteDatabaseToStore,
  applyRemoteCommentToStore,
} from "./lib/sync/storeApply";
import { applyWorkspaceSwitch } from "./lib/sync/workspaceSwitch";
import { workspaceCacheNeedsPrepaintClear } from "./lib/sync/workspaceSwitch";
import { applyWorkspaceLanding } from "./lib/sync/workspaceLanding";
import { reconcileWorkspaceCacheAfterFlush } from "./lib/sync/reconcileWorkspaceCacheAfterFlush";
import { useWorkspaceStore } from "./store/workspaceStore";
import { usePageStore } from "./store/pageStore";
import { useDatabaseStore } from "./store/databaseStore";
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
import { ensureLCSchedulerDatabase } from "./lib/scheduler/database";

// 인증 상태가 authenticated 로 전환될 때 1) 전체 페이지/DB/연락처를 페치해 LWW 적용,
// 2) 변경 푸시 구독 시작, 3) outbox flush. cleanup 시 구독 해제.
function useSyncBootstrap(): boolean {
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
  const pageCacheWorkspaceId = usePageStore((s) => s.cacheWorkspaceId);
  const pageCacheCount = usePageStore((s) => Object.keys(s.pages).length);
  const databaseCacheWorkspaceId = useDatabaseStore((s) => s.cacheWorkspaceId);
  const databaseCacheCount = useDatabaseStore(
    (s) => Object.keys(s.databases).length,
  );
  const cacheNeedsClear = Boolean(
    currentWorkspaceId &&
      ((pageCacheCount > 0 && pageCacheWorkspaceId !== currentWorkspaceId) ||
        (databaseCacheCount > 0 &&
          databaseCacheWorkspaceId !== currentWorkspaceId)),
  );
  const [workspaceCacheReady, setWorkspaceCacheReady] = useState(() =>
    !workspaceCacheNeedsPrepaintClear(
      useWorkspaceStore.getState().currentWorkspaceId,
    ),
  );
  // 한 사용자 세션 내에서 중복 부트스트랩 방지.
  const startedForRef = useRef<string | null>(null);

  useEffect(() => {
    // loading 동안 워크스페이스를 비우면 persist 로 복원된 currentWorkspaceId 가 날아가고,
    // 이후 setWorkspaces 가 null 을 "목록에 없음"으로 보아 첫 WS 로 고정한다(새로고침·세션 중 리셋).
    if (authStatus === "loading") return;
    if (authStatus !== "authenticated" || !authSub) {
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
        applyRemoteClientPrefs(clientPrefs);
        setMe(me);
        // WorkspaceSummary[]로 캐스트 (options는 스토어 밖에서만 사용)
        setWorkspaces(workspaces as Parameters<typeof setWorkspaces>[0]);

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

  useEffect(() => {
    if (authStatus !== "authenticated" || !authSub || !currentWorkspaceId) {
      startedForRef.current = null;
      setWorkspaceCacheReady(true);
      return;
    }
    const startedKey = `${authSub}:${currentWorkspaceId}`;
    if (startedForRef.current === startedKey) return;
    // 워크스페이스가 실제로 바뀐 경우에만 stale 캐시 제거.
    // 초기 마운트(startedForRef.current === null)에서는 persist 로 복원된
    // 첫 페인트 캐시를 유지하여 fetch 동안 빈 화면을 보여주지 않는다.
    const prevWorkspaceId = startedForRef.current
      ? startedForRef.current.split(":").slice(1).join(":")
      : null;
    startedForRef.current = startedKey;

    let unsub: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        setWorkspaceCacheReady(
          !workspaceCacheNeedsPrepaintClear(currentWorkspaceId),
        );
        const switchResult = await applyWorkspaceSwitch(
          prevWorkspaceId,
          currentWorkspaceId,
        );
        useBlockCommentStore.getState().clearMessages();
        const fetchApply = async (): Promise<void> => {
          await migrateLegacyBlockCommentsToPagesOnce();
          const [pages, dbs, comments] = await Promise.all([
            fetchPagesByWorkspace(currentWorkspaceId),
            fetchDatabasesByWorkspace(currentWorkspaceId),
            fetchCommentsByWorkspace(currentWorkspaceId),
          ]);
          if (cancelled) return;
          for (const p of pages)
            applyRemotePageToStore(p);
          for (const d of dbs) applyRemoteDatabaseToStore(d);
          await ensureLCSchedulerDatabase(currentWorkspaceId);
          if (cancelled) return;
          for (const c of comments) applyRemoteCommentToStore(c);
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
        setWorkspaceCacheReady(true);

        await fetchApply();

        if (cancelled) return;
        applyWorkspaceLanding(currentWorkspaceId);

        if (cancelled) return;
        unsub = startSubscriptions(currentWorkspaceId, {
          onPage: applyRemotePageToStore,
          onDatabase: applyRemoteDatabaseToStore,
          onComment: applyRemoteCommentToStore,
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
      } catch (err) {
        console.error("[sync] bootstrap failed", err);
        setWorkspaceCacheReady(true);
      }
    })();

    return () => {
      cancelled = true;
      // 동일 키로 effect 가 다시 돌 때(React Strict Mode 등) startedForRef 가 남으면
      // 조기 return 으로 구독이 영구히 생기지 않을 수 있어 정리 시 초기화한다.
      if (startedForRef.current === startedKey) {
        startedForRef.current = null;
      }
      try {
        unsub?.();
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
            const [pages, dbs, comments] = await Promise.all([
              fetchPagesByWorkspace(wsId),
              fetchDatabasesByWorkspace(wsId),
              fetchCommentsByWorkspace(wsId),
            ]);
            for (const p of pages) applyRemotePageToStore(p);
            for (const d of dbs) applyRemoteDatabaseToStore(d);
            await ensureLCSchedulerDatabase(wsId);
            for (const c of comments) applyRemoteCommentToStore(c);
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
  return (
    workspaceCacheReady &&
    !(authStatus === "authenticated" && cacheNeedsClear)
  );
}

// 웹 환경에서 /auth/callback 으로 리다이렉트되면 code 교환을 처리한 뒤 / 로 전환한다.
export function Bootstrap() {
  const [path, setPath] = useState(window.location.pathname);
  const workspaceCacheReady = useSyncBootstrap();
  // onDone 을 useCallback 으로 안정화. 인라인 함수면 매 렌더마다 새 참조가 되어
  // AuthCallback 의 useEffect 가 재실행되고 handleCallback 이 두 번 호출된다.
  // 두 번째 호출은 이미 consume 된 state 를 다시 읽어 "No matching state found" 발생.
  const goHome = useCallback(() => setPath("/"), []);
  if (path === "/auth/callback") {
    return <AuthCallback onDone={goHome} />;
  }
  if (!workspaceCacheReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white text-sm text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
        워크스페이스 캐시 확인 중…
      </div>
    );
  }
  return <App />;
}
