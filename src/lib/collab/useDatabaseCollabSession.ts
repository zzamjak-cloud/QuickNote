// 데이터베이스 구조 실시간 협업 세션 훅. DB 호스트 컴포넌트에서 호출.
// flag OFF → enabled:false. ON → Y.Doc + QnWsProvider(room db:<id>) + IndexedDB,
// 서버/로컬 로드 후 구조 변경 허용, Y.Doc 변경을 디바운스로 materialize(onMaterialize 콜백).
import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { isCollabEnabledForDatabase, buildDbCollabWsUrl, collabRoomEpoch } from "./collabConfig";
import { QnWsProvider } from "./QnWsProvider";
import { readDbStructure, type DbStructure } from "./dbBundleYjs";
import { registerDbCollab, unregisterDbCollab } from "./dbCollabRegistry";
import { readStoredTokens } from "../auth/tokenStore";
import { useCollabConnectionStore } from "../../store/collabConnectionStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { toBadgeStatus, type ProviderStatus } from "./collabConnectionStatus";

const MATERIALIZE_DEBOUNCE_MS = 1500;
const EMPTY_STRUCTURE: DbStructure = { columns: [], presets: [], panelState: {}, rowPageOrder: [], rows: {}, rowMembers: [] };

export type DbCollabSession =
  | { enabled: false }
  | { enabled: true; doc: Y.Doc; synced: boolean; idbLoaded: boolean };

export function useDatabaseCollabSession(
  databaseId: string | null | undefined,
  onMaterialize: (structure: DbStructure) => void,
  onSynced?: () => void,
): DbCollabSession {
  const flagEnabled = isCollabEnabledForDatabase(databaseId);
  const databaseWorkspaceId = useDatabaseStore(
    (s) => (databaseId ? s.databases[databaseId]?.meta.workspaceId ?? null : null),
  );
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  // 타 워크스페이스 DB(예: 페이지 멘션으로 연 다른 워크스페이스의 인라인 DB)도 협업 룸에 합류한다.
  // 서버 $connect 인가는 DB 홈 워크스페이스 멤버십 기준이라(현재 워크스페이스 무관), 멤버이면 연결되어
  // 셀 편집이 실시간 양방향 동기화된다. 비멤버는 connect 401 → QnWsProvider 가 3회 재시도 후 중단(폴백).
  const crossWorkspace = !!databaseWorkspaceId && databaseWorkspaceId !== currentWorkspaceId;
  const enabled = flagEnabled;
  // 시드(로컬→룸) 차단 게이트. 타 워크스페이스 클라의 로컬 DB 데이터는 부분(row-index/일부 행)일 수
  // 있어, 룸에 시드하면 권위 룸을 손상시킨다. materialize(룸→로컬, 가드 내장)는 허용한다.
  const crossWorkspaceRef = useRef(crossWorkspace);
  crossWorkspaceRef.current = crossWorkspace;
  const [synced, setSynced] = useState(false);
  const [idbLoaded, setIdbLoaded] = useState(false);
  const docRef = useRef<Y.Doc | null>(null);
  const setConnStatus = useCollabConnectionStore((s) => s.setStatus);
  const onMaterializeRef = useRef(onMaterialize);
  onMaterializeRef.current = onMaterialize;
  const onSyncedRef = useRef(onSynced);
  onSyncedRef.current = onSynced;

  // enabled 가 true 이고 databaseId 가 있을 때 Y.Doc 을 미리 생성해 둔다.
  if (enabled && databaseId && !docRef.current) docRef.current = new Y.Doc();

  useEffect(() => {
    if (!enabled || !databaseId) return undefined;
    const doc = docRef.current ?? new Y.Doc();
    docRef.current = doc;
    setSynced(false);
    setIdbLoaded(false);
    setConnStatus("reconnecting");

    let cancelled = false;
    let provider: QnWsProvider | null = null;
    let timer: number | null = null;
    let serverSynced = false;

    // Y.Doc 변경 → 디바운스 materialize → onMaterialize 콜백
    const scheduleMaterialize = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        // 서버 sync 전(IndexedDB 단독 로드 등)의 로컬 Y 구조는 stale 일 수 있다 —
        // 서버 룸과 병합되기 전에 materialize 하면 최신 구조·행 순서를 과거로 되돌린다.
        if (!serverSynced) return;
        try { onMaterializeRef.current(readDbStructure(doc)); } catch { /* 다음 변경에서 재시도 */ }
      }, MATERIALIZE_DEBOUNCE_MS);
    };
    doc.on("update", scheduleMaterialize);

    // 레지스트리 등록 → databaseStore.enqueueUpsertDatabase 가 이 DB 구조 변경을 Y.Doc 으로 라우팅.
    registerDbCollab(databaseId, { doc, baseline: { ...EMPTY_STRUCTURE } });

    // 로컬 영속(IndexedDB). synced 시 로컬 로드 완료 표시.
    // 키에 epoch 솔트 포함 — 협업 재활성화 시 과거 세대 잔재가 로드되지 않는다.
    const idb = new IndexeddbPersistence(`qn-collab-db:${collabRoomEpoch()}:${databaseId}`, doc);
    idb.on("synced", () => { if (!cancelled) setIdbLoaded(true); });

    // WS provider 비동기 초기화(토큰 획득 후).
    void (async () => {
      const tokens = await readStoredTokens();
      if (cancelled || !tokens) return;
      provider = new QnWsProvider({ doc, url: buildDbCollabWsUrl(databaseId, tokens.idToken) });
      provider.on("status", (s) => { if (!cancelled) setConnStatus(toBadgeStatus(s as ProviderStatus, provider!.isSynced)); });
      provider.on("synced", () => {
        if (!cancelled) {
          serverSynced = true;
          setSynced(true);
          setConnStatus(toBadgeStatus("connected", true));
          // 타 워크스페이스 클라는 룸에 시드하지 않는다(부분 로컬 데이터로 권위 룸 손상 방지).
          if (!crossWorkspaceRef.current) {
            try { onSyncedRef.current?.(); } catch { /* 시드 폴백 실패는 무시 */ }
          }
        }
      });
      provider.connect();
    })();

    return () => {
      cancelled = true;
      doc.off("update", scheduleMaterialize);
      if (timer !== null) window.clearTimeout(timer);
      provider?.destroy();
      idb.destroy();
      unregisterDbCollab(databaseId);
      // DB 전환 시 Y.Doc 폐기(다음 DB 는 새 doc).
      doc.destroy();
      docRef.current = null;
      setConnStatus("idle");
    };
  }, [enabled, databaseId, setConnStatus]);

  if (!enabled || !databaseId || !docRef.current) return { enabled: false };
  return { enabled: true, doc: docRef.current, synced, idbLoaded };
}
