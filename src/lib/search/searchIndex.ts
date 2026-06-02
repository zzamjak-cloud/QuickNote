import { usePageStore } from "../../store/pageStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { zustandStorage } from "../storage/index";
import { extractPageSearchRecord, type PageSearchRecord } from "./extractPageText";

/** 추출 로직/스키마가 바뀌면 +1 → 영속 캐시 무시하고 재빌드 */
export const SEARCH_INDEX_VERSION = 1;

/** 인메모리 인덱스 레코드 — 소문자 사본을 미리 만들어 매 검색마다 toLowerCase 비용 제거 */
type IndexedRecord = PageSearchRecord & {
  titleLower: string;
  /** 제목 + 모든 블록 텍스트를 합친 소문자 본문(빠른 substring 스캔용) */
  searchableLower: string;
};

type PersistShape = {
  v: number;
  workspaceId: string | null;
  records: PageSearchRecord[];
};

let currentWorkspaceId: string | null = null;
let records = new Map<string, IndexedRecord>();
let loadedWorkspaceId: string | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 800;

function persistKey(workspaceId: string | null): string {
  // ".cache." 세그먼트 포함 → quota 초과 시 LRU prune 대상(서버/메모리에서 재구성 가능)
  return `quicknote.search.cache.index.${workspaceId ?? "none"}.v${SEARCH_INDEX_VERSION}`;
}

function toIndexed(rec: PageSearchRecord): IndexedRecord {
  const bodyParts = [rec.title, ...rec.blocks.map((b) => b.text)];
  return {
    ...rec,
    titleLower: rec.title.toLowerCase(),
    searchableLower: bodyParts.join("\n").toLowerCase(),
  };
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const payload: PersistShape = {
      v: SEARCH_INDEX_VERSION,
      workspaceId: currentWorkspaceId,
      records: Array.from(records.values()).map((r) => ({
        pageId: r.pageId,
        workspaceId: r.workspaceId,
        kind: r.kind,
        databaseId: r.databaseId,
        title: r.title,
        blocks: r.blocks,
        updatedAt: r.updatedAt,
      })),
    };
    void zustandStorage.setItem(persistKey(currentWorkspaceId), JSON.stringify(payload));
  }, SAVE_DEBOUNCE_MS);
}

/** 영속 캐시 로드 → 인메모리 seed. 실패/버전 불일치 시 빈 상태로 둔다(reconcile 이 채움). */
async function loadPersisted(workspaceId: string | null): Promise<void> {
  if (loadedWorkspaceId === workspaceId) return;
  loadedWorkspaceId = workspaceId;
  records = new Map();
  currentWorkspaceId = workspaceId;
  try {
    const raw = await zustandStorage.getItem(persistKey(workspaceId));
    if (!raw) return;
    const parsed = JSON.parse(raw) as PersistShape;
    if (parsed.v !== SEARCH_INDEX_VERSION || parsed.workspaceId !== workspaceId) return;
    for (const rec of parsed.records) {
      records.set(rec.pageId, toIndexed(rec));
    }
  } catch {
    records = new Map();
  }
}

/**
 * 현재 store(pageStore) 기준으로 인덱스를 동기 reconcile 한다.
 * updatedAt 이 바뀐/신규 페이지만 재추출하고, 사라진 페이지는 제거한다.
 * @returns 변경이 있었으면 true
 */
function reconcileFromStore(workspaceId: string | null): boolean {
  const pages = usePageStore.getState().pages;
  let changed = false;
  const seen = new Set<string>();

  for (const page of Object.values(pages)) {
    // 워크스페이스 범위 제한(스토어가 이미 단일 WS 라도 방어적으로)
    if (workspaceId && page.workspaceId && page.workspaceId !== workspaceId) continue;
    seen.add(page.id);
    const existing = records.get(page.id);
    if (existing && existing.updatedAt === (page.updatedAt ?? 0)) continue;
    records.set(page.id, toIndexed(extractPageSearchRecord(page)));
    changed = true;
  }

  // 삭제된 페이지 정리
  for (const id of Array.from(records.keys())) {
    if (!seen.has(id)) {
      records.delete(id);
      changed = true;
    }
  }
  return changed;
}

/**
 * 인덱스를 사용 가능한 최신 상태로 보장한다.
 * - 워크스페이스가 바뀌면 영속 캐시를 로드해 seed,
 * - 이후 store 기준 증분 reconcile,
 * - 변경이 있으면 영속 저장 예약.
 * 호출 비용: 변경 없으면 Map 조회뿐이라 매우 저렴(매 검색마다 호출 가능).
 */
export async function ensureSearchIndex(): Promise<void> {
  const workspaceId = useWorkspaceStore.getState().currentWorkspaceId;
  if (workspaceId !== currentWorkspaceId || loadedWorkspaceId !== workspaceId) {
    await loadPersisted(workspaceId);
  }
  const changed = reconcileFromStore(workspaceId);
  if (changed) scheduleSave();
}

/** 동기 경로 — 이미 ensure 된 인덱스에서 레코드 목록을 반환 */
export function getIndexedRecords(): IndexedRecord[] {
  return Array.from(records.values());
}

/** 단건 레코드 조회(스니펫 지연 생성용) */
export function getIndexedRecord(pageId: string): IndexedRecord | undefined {
  return records.get(pageId);
}

export type { IndexedRecord };
