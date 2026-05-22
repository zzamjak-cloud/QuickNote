// 리팩토링 phase 간 회귀를 빠르게 비교하기 위한 store 스냅샷 헬퍼.
// 프로덕션 빌드에서는 no-op 으로 동작한다.
import { useDatabaseStore } from "../../store/databaseStore";
import { usePageStore } from "../../store/pageStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import type { PersistedQuarantine } from "../migrations/persistedStore";

export interface StoreSnapshot {
  pages: number;
  databases: number;
  workspaces: number;
  activePageId: string | null;
  ts: number;
}

export interface SnapshotDiffEntry {
  key: keyof StoreSnapshot;
  before: StoreSnapshot[keyof StoreSnapshot];
  after: StoreSnapshot[keyof StoreSnapshot];
}

function isDev(): boolean {
  // Vite 환경: import.meta.env.DEV / Node·테스트 환경: NODE_ENV
  const viteDev =
    typeof import.meta !== "undefined" &&
    typeof (import.meta as { env?: { DEV?: boolean } }).env !== "undefined"
      ? (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true
      : false;
  const nodeEnv =
    typeof process !== "undefined" && process.env
      ? process.env.NODE_ENV
      : undefined;
  return viteDev || (nodeEnv !== undefined && nodeEnv !== "production");
}

const EMPTY_SNAPSHOT: StoreSnapshot = {
  pages: 0,
  databases: 0,
  workspaces: 0,
  activePageId: null,
  ts: 0,
};

export function captureStoreSnapshot(): StoreSnapshot {
  if (!isDev()) return EMPTY_SNAPSHOT;
  const pageState = usePageStore.getState();
  const dbState = useDatabaseStore.getState();
  const wsState = useWorkspaceStore.getState();
  return {
    pages: Object.keys(pageState.pages ?? {}).length,
    databases: Object.keys(dbState.databases ?? {}).length,
    workspaces: Array.isArray(wsState.workspaces) ? wsState.workspaces.length : 0,
    activePageId: pageState.activePageId ?? null,
    ts: Date.now(),
  };
}

export function diffSnapshots(
  a: StoreSnapshot,
  b: StoreSnapshot,
): SnapshotDiffEntry[] {
  // ts 는 캡처 시각이라 항상 달라지므로 의미 있는 상태 변경만 비교한다
  const keys: Array<keyof StoreSnapshot> = [
    "pages",
    "databases",
    "workspaces",
    "activePageId",
  ];
  const out: SnapshotDiffEntry[] = [];
  for (const key of keys) {
    if (a[key] !== b[key]) {
      out.push({ key, before: a[key], after: b[key] });
    }
  }
  return out;
}

export function logSnapshot(label: string): StoreSnapshot {
  const snap = captureStoreSnapshot();
  if (!isDev()) return snap;

  console.groupCollapsed(`[qn-snapshot] ${label}`);

  console.table(snap);

  console.groupEnd();
  return snap;
}

export type QuarantineReport = {
  pages: PersistedQuarantine[];
  databases: PersistedQuarantine[];
  total: number;
};

export function quarantineReport(): QuarantineReport {
  const pages = usePageStore.getState().migrationQuarantine ?? [];
  const databases = useDatabaseStore.getState().migrationQuarantine ?? [];
  return { pages, databases, total: pages.length + databases.length };
}

/** 개발 환경에서 window.__qn 에 devtools 헬퍼를 등록한다. */
export function registerDevTools(): void {
  if (!isDev()) return;
  const qn = {
    snapshot: captureStoreSnapshot,
    quarantine: () => {
      const report = quarantineReport();
      if (report.total === 0) {
        console.info("[qn] migrationQuarantine: 항목 없음 ✅");
      } else {
        console.warn(`[qn] migrationQuarantine: 총 ${report.total}건`, report);
      }
      return report;
    },
  };
  (globalThis as Record<string, unknown>).__qn = qn;
}
