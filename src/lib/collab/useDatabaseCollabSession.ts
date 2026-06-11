// 데이터베이스 구조 실시간 협업 세션 훅. DB 호스트 컴포넌트에서 호출.
// flag OFF → enabled:false. ON → Y.Doc + QnWsProvider(room db:<id>) + IndexedDB,
// 서버/로컬 로드 후 구조 변경 허용, Y.Doc 변경을 디바운스로 materialize(onMaterialize 콜백).
import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { isCollabEnabledForDatabase, buildDbCollabWsUrl } from "./collabConfig";
import { QnWsProvider } from "./QnWsProvider";
import { readDbStructure, type DbStructure } from "./dbBundleYjs";
import { registerDbCollab, unregisterDbCollab } from "./dbCollabRegistry";
import { readStoredTokens } from "../auth/tokenStore";
import { useCollabConnectionStore } from "../../store/collabConnectionStore";
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
  const enabled = isCollabEnabledForDatabase(databaseId);
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

    // Y.Doc 변경 → 디바운스 materialize → onMaterialize 콜백
    const scheduleMaterialize = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        try { onMaterializeRef.current(readDbStructure(doc)); } catch { /* 다음 변경에서 재시도 */ }
      }, MATERIALIZE_DEBOUNCE_MS);
    };
    doc.on("update", scheduleMaterialize);

    // 레지스트리 등록 → databaseStore.enqueueUpsertDatabase 가 이 DB 구조 변경을 Y.Doc 으로 라우팅.
    registerDbCollab(databaseId, { doc, baseline: { ...EMPTY_STRUCTURE } });

    // 로컬 영속(IndexedDB). synced 시 로컬 로드 완료 표시.
    const idb = new IndexeddbPersistence("qn-collab-db:" + databaseId, doc);
    idb.on("synced", () => { if (!cancelled) setIdbLoaded(true); });

    // WS provider 비동기 초기화(토큰 획득 후).
    void (async () => {
      const tokens = await readStoredTokens();
      if (cancelled || !tokens) return;
      provider = new QnWsProvider({ doc, url: buildDbCollabWsUrl(databaseId, tokens.idToken) });
      provider.on("status", (s) => { if (!cancelled) setConnStatus(toBadgeStatus(s as ProviderStatus, provider!.isSynced)); });
      provider.on("synced", () => {
        if (!cancelled) {
          setSynced(true);
          setConnStatus(toBadgeStatus("connected", true));
          try { onSyncedRef.current?.(); } catch { /* 시드 폴백 실패는 무시 */ }
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
