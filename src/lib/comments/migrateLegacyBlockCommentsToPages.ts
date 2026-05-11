import { zustandStorage } from "../storage/index";
import type { BlockCommentMsg } from "../../types/blockComment";
import { enqueuePageUpsertForSync, usePageStore } from "../../store/pageStore";
import { useBlockCommentStore } from "../../store/blockCommentStore";
import { migrateBlockCommentMsg, migrateThreadVisitedAt } from "./blockCommentSnapshot";

const LEGACY_STORAGE_KEY = "quicknote.blockComments.v1";
const SESSION_FLAG = "qn-legacy-block-comments-migrated-v1";

type LegacyPersistShape = {
  state?: { messages?: unknown[]; threadVisitedAt?: unknown };
  messages?: unknown[];
  threadVisitedAt?: unknown;
};

function parseLegacy(raw: string): {
  messages: BlockCommentMsg[];
  threadVisitedAt: Record<string, number>;
} {
  const o = JSON.parse(raw) as LegacyPersistShape;
  const messagesRaw = o.state?.messages ?? o.messages ?? [];
  const messages = messagesRaw
    .map(migrateBlockCommentMsg)
    .filter((m): m is BlockCommentMsg => m != null);
  const threadVisitedAt = migrateThreadVisitedAt(
    o.state?.threadVisitedAt ?? o.threadVisitedAt,
  );
  return { messages, threadVisitedAt };
}

/**
 * 구버전 `quicknote.blockComments.v1` 전용 스토어를 페이지 `blockComments` 로 옮긴 뒤 삭제한다.
 * 워크스페이스 부트스트랩·원격 페치 전에 한 번 호출한다.
 */
export async function migrateLegacyBlockCommentsToPagesOnce(): Promise<void> {
  if (typeof window === "undefined") return;
  if (sessionStorage.getItem(SESSION_FLAG)) return;
  const raw = await Promise.resolve(zustandStorage.getItem(LEGACY_STORAGE_KEY));
  if (!raw) {
    sessionStorage.setItem(SESSION_FLAG, "1");
    return;
  }
  let parsed: ReturnType<typeof parseLegacy>;
  try {
    parsed = parseLegacy(raw);
  } catch {
    sessionStorage.setItem(SESSION_FLAG, "1");
    await Promise.resolve(zustandStorage.removeItem(LEGACY_STORAGE_KEY));
    return;
  }
  if (parsed.messages.length === 0 && Object.keys(parsed.threadVisitedAt).length === 0) {
    sessionStorage.setItem(SESSION_FLAG, "1");
    await Promise.resolve(zustandStorage.removeItem(LEGACY_STORAGE_KEY));
    return;
  }

  const touched = new Set<string>();

  usePageStore.setState((s) => {
    let pages = { ...s.pages };
    for (const m of parsed.messages) {
      const p = pages[m.pageId];
      if (!p) continue;
      const bc = p.blockComments ?? { messages: [], threadVisitedAt: {} };
      if (bc.messages.some((x) => x.id === m.id)) continue;
      touched.add(m.pageId);
      pages = {
        ...pages,
        [m.pageId]: {
          ...p,
          updatedAt: Date.now(),
          blockComments: {
            messages: [...bc.messages, m],
            threadVisitedAt: { ...bc.threadVisitedAt },
          },
        },
      };
    }
    for (const [key, t] of Object.entries(parsed.threadVisitedAt)) {
      const idx = key.indexOf(":");
      if (idx < 0) continue;
      const pageId = key.slice(0, idx);
      const blockId = key.slice(idx + 1);
      const p = pages[pageId];
      if (!p) continue;
      const bc = p.blockComments ?? { messages: [], threadVisitedAt: {} };
      const prevV = bc.threadVisitedAt[blockId] ?? 0;
      touched.add(pageId);
      pages = {
        ...pages,
        [pageId]: {
          ...p,
          updatedAt: Date.now(),
          blockComments: {
            ...bc,
            threadVisitedAt: {
              ...bc.threadVisitedAt,
              [blockId]: Math.max(prevV, t),
            },
          },
        },
      };
    }
    return { pages };
  });

  for (const pageId of touched) {
    const p = usePageStore.getState().pages[pageId];
    if (p) enqueuePageUpsertForSync(p);
  }

  useBlockCommentStore.getState().resyncFromPages();
  await Promise.resolve(zustandStorage.removeItem(LEGACY_STORAGE_KEY));
  sessionStorage.setItem(SESSION_FLAG, "1");
}
