import { useCallback, useEffect, useRef, useState } from "react";
import App from "./App";
import { AuthCallback } from "./components/auth/AuthCallback";
import { useAuthStore } from "./store/authStore";
import {
  fetchPagesByWorkspace,
  fetchDatabasesByWorkspace,
  startSubscriptions,
} from "./lib/sync";
import { getSyncEngine } from "./lib/sync/runtime";
import {
  applyRemotePageToStore,
  applyRemoteDatabaseToStore,
} from "./lib/sync/storeApply";
import { applyWorkspaceSwitch } from "./lib/sync/workspaceSwitch";
import { useWorkspaceStore } from "./store/workspaceStore";
import { useMemberStore } from "./store/memberStore";
import { useWorkspaceOptionsStore } from "./store/workspaceOptionsStore";
import { listMembersApi, meApi } from "./lib/sync/memberApi";
import { listMyWorkspacesApi } from "./lib/sync/workspaceApi";
import { listTeamsApi } from "./lib/sync/teamApi";
import { useTeamStore } from "./store/teamStore";

// 인증 상태가 authenticated 로 전환될 때 1) 전체 페이지/DB/연락처를 페치해 LWW 적용,
// 2) 변경 푸시 구독 시작, 3) outbox flush. cleanup 시 구독 해제.
function useSyncBootstrap() {
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
  // 한 사용자 세션 내에서 중복 부트스트랩 방지.
  const startedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (authStatus !== "authenticated" || !authSub) {
      setMe(null);
      clearWorkspaces();
      useWorkspaceOptionsStore.getState().clear();
      clearMembers();
      clearTeams();
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [me, workspaces] = await Promise.all([meApi(), listMyWorkspacesApi()]);
        if (cancelled) return;
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

        const isAdmin = me.workspaceRole === "owner" || me.workspaceRole === "manager";
        if (!isAdmin) {
          setMembers([]);
          setTeams([]);
          return;
        }

        const [members, teams] = await Promise.all([listMembersApi(), listTeamsApi()]);
        if (cancelled) return;
        setMembers(members);
        setTeams(teams);
      } catch (err) {
        console.error("[sync] auth bootstrap failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authStatus, authSub, setMe, setMembers, setTeams, setWorkspaces, clearWorkspaces, clearMembers, clearTeams]);

  useEffect(() => {
    if (authStatus !== "authenticated" || !authSub || !currentWorkspaceId) {
      startedForRef.current = null;
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
    applyWorkspaceSwitch(prevWorkspaceId, currentWorkspaceId);
    startedForRef.current = startedKey;

    let unsub: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        const [pages, dbs] = await Promise.all([
          fetchPagesByWorkspace(currentWorkspaceId),
          fetchDatabasesByWorkspace(currentWorkspaceId),
        ]);
        if (cancelled) return;
        for (const p of pages) applyRemotePageToStore(p);
        for (const d of dbs) applyRemoteDatabaseToStore(d);

        if (cancelled) return;
        unsub = startSubscriptions(currentWorkspaceId, {
          onPage: applyRemotePageToStore,
          onDatabase: applyRemoteDatabaseToStore,
        });

        const engine = await getSyncEngine();
        await engine.flush();
      } catch (err) {
        console.error("[sync] bootstrap failed", err);
      }
    })();

    return () => {
      cancelled = true;
      try {
        unsub?.();
      } catch (err) {
        console.error("[sync] unsubscribe failed", err);
      }
    };
  }, [authStatus, authSub, currentWorkspaceId]);

  // 온라인 복귀 시 원격 데이터 재페치 + outbox flush.
  // 오프라인 동안 다른 클라이언트가 만든 변경을 즉시 반영하고
  // 로컬에서 쌓인 pending mutations 를 전송함.
  useEffect(() => {
    if (authStatus !== "authenticated" || !authSub || !currentWorkspaceId) return;
    const wsId = currentWorkspaceId;
    const onOnline = () => {
      void (async () => {
        try {
          const [pages, dbs] = await Promise.all([
            fetchPagesByWorkspace(wsId),
            fetchDatabasesByWorkspace(wsId),
          ]);
          for (const p of pages) applyRemotePageToStore(p);
          for (const d of dbs) applyRemoteDatabaseToStore(d);
          const engine = await getSyncEngine();
          await engine.flush();
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
