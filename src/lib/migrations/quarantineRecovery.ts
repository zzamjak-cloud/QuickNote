// migrationQuarantine 에 보존된 원본 값을 현재 마이그레이션 파이프라인으로 재시도한다.
// 복구 성공 시 스토어에 병합 후 quarantine 에서 제거; 실패 시 console.error 경고만 남긴다.

import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";
import { migratePageStore, PAGE_STORE_DATA_KEYS } from "../../store/pageStore/migrations";
import { migrateDatabaseStore, DATABASE_STORE_DATA_KEYS } from "../../store/databaseStore/migrations";
import { mergePersistedSubset } from "./persistedStore";
import type { PersistedQuarantine } from "./persistedStore";

function isRecovered(result: Record<string, unknown>): boolean {
  const q = result.migrationQuarantine;
  return !Array.isArray(q) || q.length === 0;
}

function tryRecoverPageItems(items: PersistedQuarantine[]): PersistedQuarantine[] {
  const failed: PersistedQuarantine[] = [];
  for (const item of items) {
    try {
      const result = migratePageStore(item.value, item.fromVersion);
      if (!isRecovered(result)) {
        failed.push(item);
        continue;
      }
      const currentState = usePageStore.getState();
      const merged = mergePersistedSubset(result, currentState, PAGE_STORE_DATA_KEYS);
      usePageStore.setState({ ...merged, migrationQuarantine: [] });
      console.info("[qn] 페이지 quarantine 복구 성공 (fromVersion:", item.fromVersion, ")");
    } catch (err) {
      failed.push(item);
      console.error("[qn] 페이지 quarantine 복구 실패 (fromVersion:", item.fromVersion, ")", err);
    }
  }
  return failed;
}

function tryRecoverDatabaseItems(items: PersistedQuarantine[]): PersistedQuarantine[] {
  const failed: PersistedQuarantine[] = [];
  for (const item of items) {
    try {
      const result = migrateDatabaseStore(item.value, item.fromVersion);
      if (!isRecovered(result)) {
        failed.push(item);
        continue;
      }
      const currentState = useDatabaseStore.getState();
      const merged = mergePersistedSubset(result, currentState, DATABASE_STORE_DATA_KEYS);
      useDatabaseStore.setState({ ...merged, migrationQuarantine: [] });
      console.info("[qn] DB quarantine 복구 성공 (fromVersion:", item.fromVersion, ")");
    } catch (err) {
      failed.push(item);
      console.error("[qn] DB quarantine 복구 실패 (fromVersion:", item.fromVersion, ")", err);
    }
  }
  return failed;
}

export function tryRecoverQuarantine(): void {
  const pageItems = usePageStore.getState().migrationQuarantine ?? [];
  const dbItems = useDatabaseStore.getState().migrationQuarantine ?? [];

  if (pageItems.length === 0 && dbItems.length === 0) return;

  console.warn(
    `[qn] migrationQuarantine 발견: 페이지 ${pageItems.length}건, DB ${dbItems.length}건. 자동 복구 시도 중...`,
  );

  const pageRemaining = tryRecoverPageItems(pageItems);
  const dbRemaining = tryRecoverDatabaseItems(dbItems);

  if (pageRemaining.length > 0) {
    usePageStore.setState({ migrationQuarantine: pageRemaining });
    console.error(
      `[qn] 페이지 quarantine ${pageRemaining.length}건 복구 불가. window.__qn.quarantine() 로 확인하세요.`,
    );
  }
  if (dbRemaining.length > 0) {
    useDatabaseStore.setState({ migrationQuarantine: dbRemaining });
    console.error(
      `[qn] DB quarantine ${dbRemaining.length}건 복구 불가. window.__qn.quarantine() 로 확인하세요.`,
    );
  }
}
