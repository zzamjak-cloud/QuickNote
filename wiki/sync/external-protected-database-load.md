# 외부/보호 DB 행 배치 로드 + scope 필터링

LC 스케줄러 워크스페이스에 속한 보호 DB(작업·마일스톤·피처)의 행(row)을 배치 + 페이지네이션으로 지연 로드하고, **조직/팀/프로젝트/구성원 scope로 서버 필터링**하는 메커니즘.

## 핵심 파일

| 파일 | 역할 |
|------|------|
| `src/lib/sync/externalProtectedDatabaseLoad.ts` | `ensureExternalProtectedDatabaseLoaded`, `loadMoreExternalProtectedDatabaseRows`, row index warm-up, scope 변환 유틸 |
| `src/store/databaseRowRemoteStore.ts` | nextToken·로딩 상태. persist 키 `quicknote.database-row-remote.v1` |
| `src/store/databaseRowIndexStore.ts` | DB별 row index snapshot + 로컬 캐시 |
| `src/lib/database/databaseRowIndexCache.ts` | row index entry 정규화와 캐시 저장 |
| `src/lib/sync/bootstrap.ts` | `fetchDatabaseRowsBatch(...)`, `fetchDatabaseRowIndexBatch(...)` |
| `infra/.../handlers/pageDatabase.ts` | `listDatabaseRows` 서버 핸들러 (scope 라우팅) |
| `infra/.../handlers/lcDatabaseRowMemberIndex.ts` | 구성원 색인 sync/remove (작업 DB 전용) |

## scope 필터링 (서버)

`listDatabaseRows` 인자: `organizationId? / teamId? / projectId? / assigneeId?`. 라우팅 우선순위 **assigneeId > project > team > org > 없음**.

| scope | 메커니즘 | 키 |
|-------|---------|-----|
| 조직/팀/프로젝트 (단일값) | Pages **sparse GSI** `byDbScopeOrg/Team/Project` | `dbScopeOrg/Team/Project = ${databaseId}#${scopeId}` |
| 구성원 assignee (배열·다중) | 전용 테이블 `quicknote-database-row-members` | PK `${databaseId}#${assigneeId}`, SK `pageId` |
| 없음 | 기존 `byDatabaseAndOrder` | `databaseId` |

- **org/팀/프로젝트**: 단일값이라 GSI 가능. `upsertPage`가 작업 DB(`lc-scheduler-db:`) row 저장 시 dbCells 의 scope 셀을 top-level `dbScope*` 키로 비정규화(값 없으면 미기록 → sparse). 세 보호 DB 모두 대상(`LC_PROTECTED_DB_SCOPE_COLUMN_IDS` 매핑).
- **구성원**: assignees 가 배열이라 GSI 키 불가 → per-assignee 전용 인덱스 테이블. `upsertPage`가 before/after diff 로 BatchWrite(`lcScheduleIndex.ts` 패턴), `softDeletePage`가 제거. **기간(period) 조건 없이 모든 작업 row 색인**(작업 DB 전용; 마일스톤/피처 제외).
- 구성원 조회 경로: member 인덱스 Query → pageId → Pages **BatchGet(100청크)** → 미삭제 + (o/t/p 동시 지정 시) post-filter → order 정렬.
- scope 출처(클라이언트): `schedulerViewStore.selectedProjectId`("org:"/"team:"/"proj:"/projectId) + `selectedMemberId`. `resolveCurrentDatabaseRowScope()` 가 변환.

## Store 구조

```typescript
nextTokenByDatabaseId: Record<string, string | null>  // 키는 ${resolvedDatabaseId}|${scopeKey} 복합 (scope별 분리)
loadingByDatabaseId:   Record<string, boolean>
```

`compositeKey(resolvedDatabaseId, scope)` 로 scope 별 로드 상태를 분리한다(scope 바뀌면 다른 키 → 재로드).

## 동작 흐름

### 첫 로드 (`ensureExternalProtectedDatabaseLoaded`)
```
1. resolveExternalProtectedDatabaseId → null이면 skip
2. currentWorkspaceId 없으면 skip (홈 워크스페이스 내부에서도 로드함 — 메타 baseline 은 dbCells 를 안 줌)
3. scope 미지정 + protectedDatabaseRowsAreCached() 완전 → skip
   (scope 지정 시엔 "1회 로드" 세션 가드로 단순화, 무한로드 방지)
4. fetchDatabaseById + fetchDatabaseRowsBatch({ ...scope, limit: 100 })
5. applyRemotePagesToStore / applyRemoteDatabasesToStore / setNextToken(복합키)
6. nextToken 이 있으면 fetchDatabaseRowIndexBatch 로 남은 row index 를 백그라운드 순차 로드
7. useDatabaseRowIndexStore.upsertRows 로 로컬 row index 캐시 갱신
```

### Row index 캐시

첫 화면에는 row 본문 100개만 적용하되, 필터·정렬·검색 후보군은 row index 전체를 기준으로 계산한다. row index는 `id/workspaceId/title/icon/order/databaseId/dbCells/updatedAt` 수준의 가벼운 데이터만 저장한다.

- 캐시 키: `quicknote.database-row-index.cache.${encodeURIComponent(indexKey)}.v1`
- `indexKey`: `resolveDatabaseRowRemoteKey(databaseId, currentWorkspaceId)`
- 소비 지점: `useProcessedRows()` + `databaseRowSources.ts`
- 상세: [../database/row-index-cache.md](../database/row-index-cache.md)

### Schema 미지원 서버 fallback
`getDatabase`/`listDatabaseRows` 필드 없을 때 → `loadLegacyFullProtectedDatabaseSnapshot()` 전체 로드(하위호환).

## CRITICAL 주의사항

- `protectedDatabaseRowsAreCached()` 는 페이지 존재뿐 아니라 **콘텐츠 적재(`contentLoaded !== false`)까지** 요구한다. 메타 baseline 은 row 를 dbCells 없이(`contentLoaded=false`) 적재하므로, 존재만으로 "완료"로 보면 셀이 빈 row 가 표시된다.
- 홈 워크스페이스(LC 스케줄러) 내부에서도 로드한다(과거엔 skip 했음). 메타 baseline 이 row 콘텐츠를 안 내려주기 때문.
- scope 하 "더 보기" 페이지네이션은 `DatabaseBlockView` 가 databaseId 키로만 nextToken 을 읽어 제한적 — scope 지정 시 1회 로드로 단순화. (후속 개선 여지)
- toolbar 에 서버 데이터 강제 refresh 버튼을 두지 않는다. row index 전체 캐시 이후에는 실수로 전체 row를 다시 받는 UI가 비용·성능 리스크가 된다.
- cached-only row 를 열 때는 `useOpenDatabaseRow`/`useEnsureDatabaseRowContent`가 `ensurePageContentLoaded`를 먼저 호출해야 한다. 실패 시 placeholder row가 있어도 피커뷰를 열지 않는다.

## 인프라 배포 (GSI 단계 추가 필수)

DynamoDB 는 **한 번의 업데이트에 GSI 하나만** 생성 가능. `sync-stack.ts` `pageTableGsiDeployStage` 누적 단계로 하나씩 배포:
```
meta → all(byDatabaseAndOrder) → scope-org → scope-team → scope-project
cdk deploy -c pageTableGsiDeployStage=scope-org    # + member 테이블 + resolver + schema
cdk deploy -c pageTableGsiDeployStage=scope-team
cdk deploy -c pageTableGsiDeployStage=scope-project # (기본값)
```
기존 테이블에 신규 3개를 한꺼번에 추가하면 "Cannot perform more than one GSI creation" 실패.

배포 후 백필: `infra/scripts/backfill-database-row-scope.ts --apply` — 기존 작업 row 에 `dbScope*` SET + member 인덱스 엔트리 Put(멱등, dry-run 기본).

## 관련 위키
- [architecture.md](architecture.md) — 분할 로드 전략 전체 그림
- [storeApply.md](storeApply.md) — reconcileLCSchedulerRemoteSnapshot
- [../database/row-index-cache.md](../database/row-index-cache.md) — row index 로컬 캐시와 클릭 안전장치
- [../store/schedulerStore.md](../store/schedulerStore.md) — 스케줄러 데이터/캐시
