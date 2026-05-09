import { usePageStore } from "../../store/pageStore";
import { useWorkspaceStore } from "../../store/workspaceStore";

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * 알림·딥링크 등에서 워크스페이스 전환 또는 fetch 후 대상 페이지가 스토어에 올라올 때까지 대기한다.
 * workspaceId 가 주어지면 현재 선택 워크스페이스가 일치할 때까지도 함께 본다.
 */
export function waitForPageDeepLink(opts: {
  pageId: string;
  workspaceId?: string | null;
  timeoutMs?: number;
}): Promise<boolean> {
  const { pageId, workspaceId, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;

  const ready = (): boolean => {
    const curWs = useWorkspaceStore.getState().currentWorkspaceId;
    if (workspaceId != null && workspaceId !== "" && curWs !== workspaceId) {
      return false;
    }
    return Boolean(usePageStore.getState().pages[pageId]);
  };

  if (ready()) return Promise.resolve(true);

  return new Promise((resolve) => {
    let finished = false;
    const cleanup = (): void => {
      unsubPage();
      unsubWs();
      clearTimeout(timer);
    };
    const done = (ok: boolean): void => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve(ok);
    };

    const timer = setTimeout(() => done(ready()), timeoutMs);

    const unsubPage = usePageStore.subscribe(() => {
      if (ready()) done(true);
    });
    const unsubWs = useWorkspaceStore.subscribe(() => {
      if (ready()) done(true);
    });
  });
}
