# 외부 보호 DB 행 배치 로드

LC 스케줄러 워크스페이스에 속한 보호 DB(스케줄러·마일스톤·피처)의 행(row)을 배치 + 페이지네이션으로 지연 로드하는 메커니즘.

## 핵심 파일

| 파일 | 역할 |
|------|------|
| `src/lib/sync/externalProtectedDatabaseLoad.ts` | `ensureExternalProtectedDatabaseLoaded`, `loadMoreExternalProtectedDatabaseRows` |
| `src/store/databaseRowRemoteStore.ts` | nextToken·로딩 상태. persist 키 `quicknote.database-row-remote.v1` |

## Store 구조

```typescript
// databaseRowRemoteStore
nextTokenByDatabaseId: Record<string, string | null>  // 페이지네이션 커서 (persist)
loadingByDatabaseId:   Record<string, boolean>         // 로드 진행 중 (비persist)
```

## 보호 DB 식별

`resolveExternalProtectedDatabaseId(databaseId)` 가 null이면 비보호 DB → 처리 생략.

대상: `LC_SCHEDULER_DATABASE_ID`, `LC_MILESTONE_DATABASE_ID`, `LC_FEATURE_DATABASE_ID` 및 기타 `isProtectedDatabaseId()` 통과 ID.

## 동작 흐름

### 첫 로드 (`ensureExternalProtectedDatabaseLoaded`)
```
1. resolveExternalProtectedDatabaseId → null이면 skip
2. currentWorkspaceId === LC_SCHEDULER_WORKSPACE_ID 이면 skip (스케줄러 내부 접근)
3. protectedDatabaseRowsAreCached() → 로컬 캐시 완전 → skip
4. completedLoadDatabaseIds 세션 완료 + 빈 bundle → skip
5. inFlightByDatabaseId 중복 방지
6. Promise.all([fetchDatabaseById, fetchDatabaseRowsBatch({ limit: 100 })])
7. applyRemotePagesToStore(rows.items)
   applyRemoteDatabasesToStore([database])
   databaseRowRemoteStore.setNextToken(resolvedId, rows.nextToken)
   refreshWorkspaceSnapshot(LC_SCHEDULER_WORKSPACE_ID)
8. completedLoadDatabaseIds.add(resolvedId)
```

### 추가 로드 (`loadMoreExternalProtectedDatabaseRows`)
```
1. nextTokenByDatabaseId[resolvedId] 없으면 skip
2. inFlightMoreByDatabaseId 중복 방지
3. fetchDatabaseRowsBatch({ nextToken, limit: 100 })
4. applyRemotePagesToStore(rows.items)
   databaseRowRemoteStore.setNextToken(resolvedId, rows.nextToken)
   refreshWorkspaceSnapshot(LC_SCHEDULER_WORKSPACE_ID)
```

### Schema 미지원 서버 fallback
`getDatabase` 또는 `listDatabaseRows` 필드가 schema에 없을 때 (`isSchemaUnavailableError`):
- `loadLegacyFullProtectedDatabaseSnapshot()` 호출
- `fetchPagesByWorkspace(LC_SCHEDULER_WORKSPACE_ID)` + `fetchDatabasesByWorkspace(...)` 전체 로드
- 구형 서버와의 하위 호환성 유지

## CRITICAL 주의사항

- `protectedDatabaseRowsAreCached()` 검사는 `rowPageOrder`의 모든 pageId가 `pageStore`에 있는지 확인. 한 개라도 없으면 false → 재로드.
- `completedLoadDatabaseIds`는 **세션 메모리**에만 있다(persist 없음). 페이지 새로고침 시 초기화 → `databaseRowRemoteStore.nextToken`이 null이면 첫 배치부터 다시 로드.
- 테스트에서는 `__resetExternalProtectedDatabaseLoadForTests()` 호출로 세션 상태 초기화.

## 관련 위키
- [architecture.md](architecture.md) — 분할 로드 전략 전체 그림
