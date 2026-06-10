// 페이지별 실시간 협업 세션 훅. Editor 에서 호출한다.
// flag OFF → enabled:false (현행 비협업 경로 유지).
// flag ON  → Y.Doc + QnWsProvider 생성, 서버 sync 완료 후 ydoc 바인딩 허용,
//            Y.Doc 변경을 디바운스로 Pages.doc(JSON) 에 materialize.
import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { isCollabEnabledForPage, buildCollabWsUrl } from "./collabConfig";
import { QnWsProvider } from "./QnWsProvider";
import { yDocToJson } from "./yjsDoc";
import { readStoredTokens } from "../auth/tokenStore";
import { usePageStore } from "../../store/pageStore";

const MATERIALIZE_DEBOUNCE_MS = 1800;

export type CollabSession =
  | { enabled: false }
  | {
      enabled: true;
      doc: Y.Doc;
      /** 서버 초기 sync 완료 여부. true 가 되기 전에는 에디터를 read-only 로 둔다. */
      synced: boolean;
    };

/**
 * @param pageId 현재 편집 페이지 id
 */
export function useCollabSession(
  pageId: string | null | undefined,
): CollabSession {
  const enabled = isCollabEnabledForPage(pageId);
  const [synced, setSynced] = useState(false);
  const docRef = useRef<Y.Doc | null>(null);

  // pageId 별로 새 Y.Doc 을 만든다. enabled 가 false 면 아무것도 만들지 않는다.
  if (enabled && pageId && !docRef.current) {
    docRef.current = new Y.Doc();
  }

  useEffect(() => {
    if (!enabled || !pageId) return undefined;
    const doc = docRef.current ?? new Y.Doc();
    docRef.current = doc;
    setSynced(false);

    let cancelled = false;
    let provider: QnWsProvider | null = null;
    let materializeTimer: number | null = null;

    // Y.Doc 변경 → 디바운스 materialize → Pages.doc(JSON)
    const scheduleMaterialize = () => {
      if (materializeTimer !== null) window.clearTimeout(materializeTimer);
      materializeTimer = window.setTimeout(() => {
        materializeTimer = null;
        try {
          const json = yDocToJson(doc);
          // 단방향(Y→JSON). deferSync 로 기존 sync 큐에 실어 보낸다.
          usePageStore.getState().updateDoc(pageId, json, { deferSync: true });
        } catch {
          /* 변환 실패 시 다음 변경에서 재시도 */
        }
      }, MATERIALIZE_DEBOUNCE_MS);
    };
    doc.on("update", scheduleMaterialize);

    void (async () => {
      const tokens = await readStoredTokens();
      if (cancelled || !tokens) return;
      provider = new QnWsProvider({
        doc,
        url: buildCollabWsUrl(pageId, tokens.idToken),
      });
      provider.on("synced", () => {
        if (!cancelled) setSynced(true);
      });
      provider.connect();
    })();

    return () => {
      cancelled = true;
      doc.off("update", scheduleMaterialize);
      if (materializeTimer !== null) window.clearTimeout(materializeTimer);
      provider?.destroy();
      // 페이지 전환 시 Y.Doc 폐기(다음 페이지는 새 doc).
      doc.destroy();
      docRef.current = null;
    };
  }, [enabled, pageId]);

  if (!enabled || !pageId || !docRef.current) return { enabled: false };
  return { enabled: true, doc: docRef.current, synced };
}
