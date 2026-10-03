// 페이지 본문 소스 결정 — 협업 ON 환경은 Y.Doc 이 권위(wiki/collab/overview.md)라 룸 상태를 우선한다.
// Pages.doc 은 클라 8초 주기 업서트 스냅샷이라 최신 편집이 늦게 반영될 수 있다.
import { stateToDocJson } from "../_shared/collabContent";
import { loadPageState } from "../realtime/yjsStore";
import { hasMeaningfulPageDocContent } from "../v5-resolvers/handlers/pageDatabase";
import type { DocNode } from "../../../src/lib/docModel/types";
import { parseDocJson } from "./text";

export type PageBody = { doc: DocNode | null; source: "collab" | "pages" };

/** 서버 룸 키 — 클라 collabConfig 의 `${epoch}:${pageId}` 와 바이트 동일해야 한다. */
export function pageRoomKey(epoch: string, pageId: string): string {
  return `${epoch}:${pageId}`;
}

async function loadCollabDoc(epoch: string, pageId: string): Promise<DocNode | null> {
  try {
    const json = stateToDocJson(await loadPageState(pageRoomKey(epoch, pageId))) as DocNode;
    return json.content && json.content.length > 0 ? json : null;
  } catch (err) {
    // 룸 조회 실패는 Pages.doc 스냅샷으로 폴백한다(읽기 전용 경로라 가용성 우선).
    console.error("mcp collab 룸 상태 로드 실패", err);
    return null;
  }
}

/**
 * 룸 상태가 있고 의미 있는 본문이면 룸을, 룸이 비었거나 빈 문단뿐인데 Pages.doc 에 본문이 있으면
 * Pages.doc 을 쓴다(오염·미시드 룸이 실제 본문을 가리지 않게 — 클라 placeholder 가드와 같은 의미).
 */
export async function loadPageBody(epoch: string, page: Record<string, unknown>): Promise<PageBody> {
  const pageId = String(page.id ?? "");
  const stored = parseDocJson(page.doc);
  const collab = pageId ? await loadCollabDoc(epoch, pageId) : null;
  if (collab && (hasMeaningfulPageDocContent(collab) || !hasMeaningfulPageDocContent(stored))) {
    return { doc: collab, source: "collab" };
  }
  return { doc: stored, source: "pages" };
}
