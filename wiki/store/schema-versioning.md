# Zustand Persist 스키마 버전 관리

## 버전 bump 필요 조건

| 변경 종류 | bump 필요 |
|---------|:---------:|
| 필수 필드 추가 | ✅ |
| 필드 이름 변경 | ✅ |
| 필드 삭제 | ✅ |
| 선택적 필드 추가 (`?`) | ❌ |
| 로직만 변경 | ❌ |

## 패턴 (`pageStore.ts` / `databaseStore.ts`)

```ts
version: 2,
migrate: (persisted: unknown, fromVersion: number) => {
  if (fromVersion < 1) return { pages: {}, activePageId: null };
  if (fromVersion < 2) {
    const data = persisted as { pages: Record<string, unknown> };
    for (const page of Object.values(data.pages)) {
      (page as Record<string, unknown>).newField ??= defaultValue;
    }
    return data;
  }
  return persisted;
},
```

## localStorage 직접 확인 (디버깅)
```js
JSON.parse(localStorage.getItem('quicknote.pages.v1') ?? '{}')
JSON.parse(localStorage.getItem('quicknote.databases.v1') ?? '{}')
```

## 최근 databaseStore 변경

### v5
- `pageLinkAutoFill`, `pageLinkAutoReverse`, `pageLinkReverseColumnName` legacy config 제거.
- LC Scheduler/Feature 보호 DB의 기존 참조 컬럼을 `sourceFromDb`/`itemFetch` 구조로 보정.
- pageLink 값 복사·역방향 쓰기 제거 후에도 화면/필터/스케줄러는 실효 셀값 해석으로 기존 참조 표시를 유지.

## 초기화 (최후 수단)
```js
["quicknote.pages.v1","quicknote.databases.v1","quicknote.settings.v1"]
  .forEach(k => localStorage.removeItem(k));
location.reload();
// Bootstrap 이 AppSync 에서 전체 재페치함
```

## 워크스페이스 스냅샷 키 (zustand persist 와 별개)

`src/lib/sync/workspaceSwitch.ts` 의 `WORKSPACE_SNAPSHOT_KEY_PREFIX` 는 zustand persist 가 아닌
**커스텀 IndexedDB 키**(`quicknote.workspace.snapshot.v{N}:{workspaceId}`)다. 빠른 첫 페인트용 캐시.

- 손상된 스냅샷을 전 사용자에게서 일괄 무효화하려면 prefix 의 버전을 올린다(예: `v2:`→`v3:`).
- 키가 바뀌면 부팅 시 복원할 캐시가 없어 `structureCacheAvailable=false` → `resolveWorkspaceRemoteFetchMode`
  가 **full(no-cache)** 을 강제 → 서버 권위 데이터로 자기복구된다. migrate 함수 불필요.
- 실제 사례: 구버전 `clearWorkspaceScopedStores` 버그로 LC 스케줄러 루트/일정 페이지가 빠진 채
  persist 된 스냅샷이 delta 경로에서 영영 복구되지 않던 문제를 `v2→v3` bump 으로 해결.
- 구 `v2:` 잔여 키는 IDB LRU prune 으로 자연 정리됨.
