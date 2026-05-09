export type PersistedObject = Record<string, unknown>;

/** persist 헤더에 둘 수 있는 공통 메타(스토어별 state 와 함께 저장). 선택 필드만 사용한다. */
export type PersistedStoreMeta = {
  /** zustand persist `version` 과 동일한 값을 두어 외부 점검 시 대응 가능하게 한다 */
  schemaVersion?: number;
  /** 페이지/DB 캐시의 `cacheWorkspaceId` 과 동일(디스크 상 캐시 소속 디버깅용) */
  persistedWorkspaceId?: string | null;
  /** 마이그레이션이 실행된 시각(저장별 갱신이 아니라 버전 업 시점에만 기록 권장) */
  migratedAt?: string;
};

/** rehydrate merge 시 스토어 액션/비저장 필드 오염을 막기 위해 제거해야 하는 공통 메타 키 */
export const PERSIST_STORE_META_KEYS = [
  "schemaVersion",
  "persistedWorkspaceId",
  "migratedAt",
] as const satisfies readonly (keyof PersistedStoreMeta)[];

export function omitPersistStoreMeta(slice: PersistedObject): PersistedObject {
  const next = { ...slice };
  for (const key of PERSIST_STORE_META_KEYS) {
    delete next[key];
  }
  return next;
}

/**
 * localStorage 등에서 읽은 persist 조각과 런타임 전체 state를 합친다.
 * - 공통 메타 키는 런타임에 들어가지 않도록 제거한다.
 * - `dataKeys`에 없는 저장 필드가 있어도 무시한다(예상 밖 확장키 방지).
 */
export function mergePersistedSubset<T extends object>(
  persisted: unknown,
  fullState: T,
  dataKeys: readonly string[],
): T {
  if (!persisted || typeof persisted !== "object" || Array.isArray(persisted)) {
    return fullState;
  }
  const cleaned = omitPersistStoreMeta(persisted as PersistedObject);
  const next = { ...fullState } as Record<string, unknown>;
  for (const key of dataKeys) {
    if (
      Object.prototype.hasOwnProperty.call(cleaned, key) &&
      cleaned[key] !== undefined
    ) {
      next[key] = cleaned[key];
    }
  }
  return next as T;
}

export function attachPersistedMeta(
  state: PersistedObject,
  meta: Partial<PersistedStoreMeta>,
): PersistedObject {
  return { ...state, ...meta };
}

export type PersistedStoreMigration = {
  /** 이 마이그레이션이 적용된 뒤의 persist version */
  version: number;
  migrate: (state: PersistedObject) => PersistedObject;
};

function toPersistedObject(value: unknown, fallback: PersistedObject): PersistedObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }
  return value as PersistedObject;
}

export function migratePersistedStore(
  persisted: unknown,
  fromVersion: number,
  migrations: PersistedStoreMigration[],
  fallback: PersistedObject,
): PersistedObject {
  let state = toPersistedObject(persisted, fallback);
  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  for (const migration of sorted) {
    if (fromVersion < migration.version) {
      state = migration.migrate(state);
    }
  }
  return state;
}
