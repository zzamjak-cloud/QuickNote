import { useDatabaseStore } from "../../store/databaseStore";

/**
 * 원격 DB 스냅샷 적용 전에 로컬 DB persist 복원을 끝낸다.
 * 늦게 끝난 hydrate가 방금 복원한 templates 배열을 오래된 캐시로 덮는 레이스를 막는다.
 */
export async function ensureDatabasePersistHydrated(): Promise<void> {
  if (useDatabaseStore.persist.hasHydrated()) return;
  await Promise.resolve(useDatabaseStore.persist.rehydrate());
}
