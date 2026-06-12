// 페이지별 실시간 협업 세션 훅. Editor 에서 호출한다.
// flag OFF → enabled:false (현행 비협업 경로 유지).
// flag ON  → Y.Doc + QnWsProvider 생성, 서버 sync 완료 후 ydoc 바인딩 허용,
//            Y.Doc 변경을 디바운스로 Pages.doc(JSON) 에 materialize.
import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { IndexeddbPersistence } from "y-indexeddb";
import { isCollabEnabledForPage, buildCollabWsUrl, collabRoomEpoch } from "./collabConfig";
import { QnWsProvider, QN_WS_REMOTE_ORIGIN } from "./QnWsProvider";
import {
  yDocToJson,
  YJS_XML_FRAGMENT,
  isCollabDocBodyEmpty,
  isPlaceholderBodyJson,
} from "./yjsDoc";
import { readStoredTokens } from "../auth/tokenStore";
import { usePageStore, enqueuePageUpsertForSync } from "../../store/pageStore";
import { collabColor } from "./collabColor";
import { useMemberStore } from "../../store/memberStore";
import { useCollabConnectionStore } from "../../store/collabConnectionStore";
import { toBadgeStatus, type ProviderStatus } from "./collabConnectionStatus";

const MATERIALIZE_DEBOUNCE_MS = 1800;
// 로컬 편집분의 서버 Pages.doc 영속 주기. updateDoc(deferSync) 는 sync enqueue 를 생략하므로
// (DB 협업의 skipCollab 서버 영속과 동일한 역할을) 이 주기 업서트가 담당한다.
// 서버 page.doc 이 stale 하면 버전 히스토리가 안 쌓이고, epoch bump 시드 소스도 과거로 밀린다.
const SERVER_DOC_SYNC_INTERVAL_MS = 8000;

export type CollabSession =
  | { enabled: false }
  | {
      enabled: true;
      doc: Y.Doc;
      awareness: Awareness;
      /** 서버 초기 sync 완료 여부. true 가 되기 전에는 에디터를 read-only 로 둔다. */
      synced: boolean;
      /** 로컬 IndexedDB 로드 완료 여부. */
      idbLoaded: boolean;
      /** 로컬 로드 시점 doc 에 콘텐츠가 있었는지(빈 doc 오편집 방지 게이팅용). */
      docNotEmpty: boolean;
    };

/**
 * @param pageId 현재 편집 페이지 id
 */
export function useCollabSession(
  pageId: string | null | undefined,
): CollabSession {
  const enabled = isCollabEnabledForPage(pageId);
  const [synced, setSynced] = useState(false);
  const [idbLoaded, setIdbLoaded] = useState(false);
  const [docNotEmpty, setDocNotEmpty] = useState(false);
  const docRef = useRef<Y.Doc | null>(null);
  const awarenessRef = useRef<Awareness | null>(null);
  const idbRef = useRef<IndexeddbPersistence | null>(null);
  const me = useMemberStore((s) => s.me);
  const setConnStatus = useCollabConnectionStore((s) => s.setStatus);

  // pageId 별로 새 Y.Doc 을 만든다. enabled 가 false 면 아무것도 만들지 않는다.
  if (enabled && pageId && !docRef.current) {
    docRef.current = new Y.Doc();
  }

  // doc 이 생성된 직후 awareness 도 생성한다.
  if (enabled && pageId && docRef.current && !awarenessRef.current) {
    awarenessRef.current = new Awareness(docRef.current);
  }

  // me 변경 시, 그리고 pageId 전환으로 새 awareness 가 만들어진 직후 local user 필드를 갱신한다.
  // (pageId 를 deps 에서 빼면 새 페이지의 새 Awareness 에 user 가 안 실려 피어가 이름·색을 못 본다.)
  useEffect(() => {
    const awareness = awarenessRef.current;
    if (!enabled || !awareness || !me) return;
    awareness.setLocalStateField("user", {
      memberId: me.memberId,
      name: me.name,
      color: collabColor(me.memberId),
      avatarUrl: me.avatarUrl ?? null,
    });
  }, [enabled, pageId, me]);

  useEffect(() => {
    if (!enabled || !pageId) return undefined;
    const doc = docRef.current ?? new Y.Doc();
    docRef.current = doc;
    setSynced(false);
    setIdbLoaded(false);
    setDocNotEmpty(false);
    setConnStatus("reconnecting");

    let cancelled = false;
    let provider: QnWsProvider | null = null;
    let materializeTimer: number | null = null;
    let serverSynced = false;
    // 이 클라이언트에서 발생한 Y 편집이 있는지(원격 수신·IDB 로드 적용분 제외).
    // 편집한 클라이언트만 서버 Pages.doc 업서트를 책임진다(view-only 는 업서트 안 함).
    let localEdited = false;
    let serverDocSyncTimer: number | null = null;

    // 로컬 편집분을 주기적으로 서버에 영속. idle-reset 디바운스가 아니라 고정 주기 —
    // 연속 타이핑 중에도 8초마다 한 번은 업서트돼 히스토리(세션 머지)가 끊기지 않는다.
    const scheduleServerDocSync = () => {
      if (serverDocSyncTimer !== null) return;
      serverDocSyncTimer = window.setTimeout(() => {
        serverDocSyncTimer = null;
        if (cancelled || !localEdited) return;
        const latest = usePageStore.getState().pages[pageId];
        if (!latest) return;
        localEdited = false;
        enqueuePageUpsertForSync(latest);
      }, SERVER_DOC_SYNC_INTERVAL_MS);
    };

    // Y.Doc 변경 → 디바운스 materialize → Pages.doc(JSON)
    const scheduleMaterialize = () => {
      if (materializeTimer !== null) window.clearTimeout(materializeTimer);
      materializeTimer = window.setTimeout(() => {
        materializeTimer = null;
        // 서버 sync 전(IndexedDB 단독 로드 등)의 로컬 Y 상태는 stale 일 수 있다 —
        // 서버 룸과 병합되기 전에 materialize 하면 최신 본문을 과거로 되돌린다. sync 후에만 저장.
        if (!serverSynced) return;
        // 시드·sync 전 빈 Y.Doc 을 page.doc 으로 materialize 하면 기존 본문을 덮어쓴다(데이터 유실).
        // 미시드(빈 본문)면 저장 생략. 의도적 비우기는 빈 문단(length≥1)이라 통과한다.
        if (isCollabDocBodyEmpty(doc)) return;
        try {
          const json = yDocToJson(doc);
          // 빈 문단뿐인 Y 상태(과거 오염 룸·시드 누락)가 의미 있는 기존 본문을 덮지 못하게 차단.
          // 서버 placeholder 보존 가드(preserveExistingDocForPlaceholderInput)와 동일 의미의 클라 방어선.
          const current = usePageStore.getState().pages[pageId];
          if (current?.doc && isPlaceholderBodyJson(json) && !isPlaceholderBodyJson(current.doc)) {
            console.warn("[collab] placeholder Y 상태 materialize 차단", { pageId });
            return;
          }
          // 단방향(Y→JSON) store 반영. deferSync 는 sync enqueue 를 생략하므로
          // 서버 영속은 아래 scheduleServerDocSync(주기 업서트)가 담당한다.
          usePageStore.getState().updateDoc(pageId, json, { deferSync: true });
          scheduleServerDocSync();
        } catch {
          /* 변환 실패 시 다음 변경에서 재시도 */
        }
      }, MATERIALIZE_DEBOUNCE_MS);
    };
    const onDocUpdate = (_update: Uint8Array, origin: unknown) => {
      // 원격 수신(QN_WS_REMOTE_ORIGIN)·IndexedDB 로드 적용분은 로컬 편집이 아니다.
      if (origin !== QN_WS_REMOTE_ORIGIN && origin !== idbRef.current) {
        localEdited = true;
      }
      scheduleMaterialize();
    };
    doc.on("update", onDocUpdate);

    // 로컬 영속(IndexedDB). synced 시 로컬 로드 완료 + 콘텐츠 유무 기록.
    // 키에 epoch 솔트 포함 — 협업 재활성화 시 과거 세대 잔재가 로드되지 않는다.
    const idb = new IndexeddbPersistence(`qn-collab:${collabRoomEpoch()}:${pageId}`, doc);
    idbRef.current = idb;
    idb.on("synced", () => {
      if (cancelled) return;
      setIdbLoaded(true);
      setDocNotEmpty(doc.getXmlFragment(YJS_XML_FRAGMENT).length > 0);
    });

    void (async () => {
      const tokens = await readStoredTokens();
      if (cancelled || !tokens) return;
      provider = new QnWsProvider({
        doc,
        url: buildCollabWsUrl(pageId, tokens.idToken),
        awareness: awarenessRef.current ?? undefined,
      });
      provider.on("status", (s) => {
        if (cancelled) return;
        setConnStatus(toBadgeStatus(s as ProviderStatus, provider!.isSynced));
      });
      provider.on("synced", () => {
        if (!cancelled) {
          serverSynced = true;
          setSynced(true);
          setConnStatus(toBadgeStatus("connected", true));
        }
      });
      provider.connect();
    })();

    return () => {
      cancelled = true;
      doc.off("update", onDocUpdate);
      if (materializeTimer !== null) window.clearTimeout(materializeTimer);
      if (serverDocSyncTimer !== null) window.clearTimeout(serverDocSyncTimer);
      // 페이지 이탈 시 미전송 로컬 편집분 최종 영속(남은 1.8s 미만 delta 는 Y 룸·IDB 에 안전).
      if (localEdited) {
        const latest = usePageStore.getState().pages[pageId];
        if (latest) enqueuePageUpsertForSync(latest);
      }
      provider?.destroy();
      // 페이지 전환 시 Y.Doc 폐기(다음 페이지는 새 doc).
      doc.destroy();
      docRef.current = null;
      awarenessRef.current?.destroy();
      awarenessRef.current = null;
      idbRef.current?.destroy();
      idbRef.current = null;
      setConnStatus("idle");
    };
  }, [enabled, pageId, setConnStatus]);

  if (!enabled || !pageId || !docRef.current || !awarenessRef.current) return { enabled: false };
  return {
    enabled: true,
    doc: docRef.current,
    awareness: awarenessRef.current,
    synced,
    idbLoaded,
    docNotEmpty,
  };
}
