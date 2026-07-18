import type { Editor } from "@tiptap/core";
import { enqueuePageUpsertForSync, usePageStore } from "../../store/pageStore";

export function flushSharedBlockHostPageDoc(editor: Editor): void {
  const pageContext = editor.storage.pageContext as { pageId?: string | null } | undefined;
  const pageId = pageContext?.pageId ?? null;
  if (!pageId || editor.isDestroyed) return;
  const flush = () => {
    if (editor.isDestroyed) return;
    const store = usePageStore.getState();
    store.updateDoc(pageId, editor.getJSON(), { deferSync: true });
    const latest = usePageStore.getState().pages[pageId];
    if (latest) enqueuePageUpsertForSync(latest);
  };
  queueMicrotask(flush);
}
