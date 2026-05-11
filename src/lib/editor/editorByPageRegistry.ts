import type { Editor } from "@tiptap/core";

/** pageId → 해당 본문을 편집 중인 TipTap 에디터(댓글 패널 등 전역 UI가 조회) */
const editorsByPageId = new Map<string, Editor>();

let registryVersion = 0;
const registryListeners = new Set<() => void>();

function bumpEditorRegistry(): void {
  registryVersion += 1;
  for (const cb of registryListeners) cb();
}

/** 전역 댓글 패널이 등록 직후 에디터를 다시 읽도록 구독 */
export function subscribeEditorRegistry(onStoreChange: () => void): () => void {
  registryListeners.add(onStoreChange);
  return () => {
    registryListeners.delete(onStoreChange);
  };
}

export function getEditorRegistryVersion(): number {
  return registryVersion;
}

/**
 * 현재 이 페이지를 담당하는 에디터를 등록한다.
 * 언마운트 시 같은 인스턴스일 때만 제거한다(빠른 페이지 전환 레이스 방지).
 */
export function registerEditorForPage(pageId: string, ed: Editor): () => void {
  editorsByPageId.set(pageId, ed);
  bumpEditorRegistry();
  return () => {
    if (editorsByPageId.get(pageId) === ed) {
      editorsByPageId.delete(pageId);
      bumpEditorRegistry();
    }
  };
}

export function getEditorForPage(pageId: string): Editor | null {
  const e = editorsByPageId.get(pageId);
  if (!e) return null;
  if (e.isDestroyed) {
    editorsByPageId.delete(pageId);
    return null;
  }
  return e;
}

/** 댓글만 바뀌고 doc 트랜잭션이 없을 때 PM 장식(노란 배경 등)을 다시 그린다. */
export function refreshBlockCommentDecorationsForPage(pageId: string): void {
  const ed = getEditorForPage(pageId);
  if (!ed || ed.isDestroyed) return;
  try {
    ed.view.dispatch(ed.state.tr);
  } catch {
    /* noop */
  }
}
