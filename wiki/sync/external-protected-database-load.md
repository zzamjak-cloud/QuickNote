# 외부/보호 DB 행 배치 로드 + scope 필터링

LC 스케줄러 워크스페이스에 속한 보호 DB(작업·마일스톤·피처)의 행(row)을 배치 + 페이지네이션으로 지연 로드하고, **조직/팀/프로젝트/구성원 scope로 서버 필터링**하는 메커니즘.

> **scope A안 적용 (2026-06)**: `DatabaseRowLoadContext` 타입 도입 + 인라인 DB 전역 scope 오염 버그 수정 + 스케줄러 피처 "inline" 로드 분리.

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

## DatabaseRowLoadContext — 로드 컨텍스트 타입

```typescript
export type DatabaseRowLoadContext = "scheduler" | "inline";
```

모든 공개 함수(`resolveDatabaseRowRemoteKey`, `ensureExternalProtectedDatabaseLoaded`, `ensureDatabaseRowsLoaded`, `loadMoreDatabaseRows`, `loadMoreExternalProtectedDatabaseRows`)가 `loadContext` 인자(기본 `"inline"`)를 수용한다.

`resolveDatabaseRowLoadTarget` 내부에서 보호 DB 분기 시:
- `"scheduler"` → `resolveCurrentDatabaseRowScope()` 반환값을 scope 로 적용 (org/team/project/멤버 필터)
- `"inline"` → `scope: {}` (필터 없음, 전체 로드)

**핵심 불변식**: 읽기 키(`resolveDatabaseRowRemoteKey`)와 쓰기 키(`ensureDatabaseRowsLoaded` 내 `compositeKey`)는 반드시 **동일한 `loadContext`** 를 사용해야 캐시 hit 가 일치한다. 컨텍스트가 다르면 서로 다른 `loadKey` 로 분기되어 무한로드 또는 빈 뷰가 발생한다.

**기본값 설계 의도**: 기본 `"inline"`(scope 없음 = 전체)으로 두어 `under-fetch`가 아닌 `over-fetch`를 안전한 실패 모드로 삼는다. 스케줄러 경로만 명시적으로 `"scheduler"` opt-in.

### 인라인 DB 오염 버그 수정 (2026-06)

기존에는 `loadContext` 인자가 없어 보호 DB가 항상 `resolveCurrentDatabaseRowScope()`를 적용했다. 인라인 DB 블록·풀페이지·피크 뷰에서 보호 DB 행을 로드할 때 스케줄러의 전역 org/team/project scope가 그대로 적용되어 마일스톤·피처·작업 전체 행이 표시되지 않았다. `loadContext = "inline"` 기본값 도입으로 수정됨.

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
3. scope 미지정 + row 캐시 완성 + nextToken 없음 → skip
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
- 인라인 DB 가 `itemLimit=10`처럼 표시 개수만 충족해도 nextToken 이 남아 있으면 완료로 보지 않는다. 첫 인덱스 페이지 진입 시에도 연결된 원본 DB 의 남은 row index 를 백그라운드 warm-up 해야 날짜 정렬/필터/검색 후보군이 최신화된다.
- 상세: [../database/row-index-cache.md](../database/row-index-cache.md)

### Schema 미지원 서버 fallback
`getDatabase`/`listDatabaseRows` 필드 없을 때 → `loadLegacyFullProtectedDatabaseSnapshot()` 전체 로드(하위호환).

## 스케줄러 모달/타임라인 loadContext 규칙

### LCSchedulerModal (`src/components/scheduler/LCSchedulerModal.tsx`)

세 보호 DB(`schedulerDatabaseId`, `milestoneDatabaseId`, `featureDatabaseId`)를 일괄 `ensureDatabaseRowsLoaded` 호출:

```typescript
loadContext: databaseId === featureDatabaseId ? "inline" : "scheduler"
```

- **작업(scheduler) · 마일스톤(milestone)**: `"scheduler"` → 서버 scope(org/team/project/멤버) 적용
- **피처(feature)**: `"inline"` → scope 없이 전체 로드

**피처를 "inline"으로 로드하는 이유**: 피처 row의 `dbCells`에는 org/team/project scope 컬럼이 없다. scope 정보는 연결된 마일스톤에만 미러되므로 서버 scoped 쿼리로 피처를 조회하면 결과가 누락된다. 또한 피처 수는 마일스톤 단위라 유계(bounded)이므로 전체 로드가 가능하다.

### SchedulerDatabaseTimeline (`src/components/scheduler/SchedulerDatabaseTimeline.tsx`)

```typescript
// 읽기 키(rowIndexKey): 피처 모드는 "inline", 나머지는 "scheduler"
const rowIndexKey = resolveDatabaseRowRemoteKey(
  databaseId,
  workspaceId,
  mode === "feature" ? "inline" : "scheduler",
);
const milestoneRowIndexKey = resolveDatabaseRowRemoteKey(milestoneDatabaseId, workspaceId, "scheduler");
```

타임라인이 로드 키와 동일한 `loadContext`를 사용해야 `LCSchedulerModal`에서 적재한 캐시를 hit할 수 있다.

### 클라이언트 scope 필터 (피처 뷰)

피처 행은 전체 로드 후 클라이언트에서 마일스톤 scope 기준으로 필터한다:

1. `getScopedMilestoneIds(milestoneRowPageOrder, schedulerPages, selectedProjectId)` — 현재 선택 scope에 속한 마일스톤 ID Set 산출
2. `matchesSchedulerScope(page, mode, selectedProjectId, schedulerPages)` — 각 행이 scope에 맞는지 검사
3. 피처 모드에서 마일스톤 연결 필터: `schedulerPageLinkIncludes(page.dbCells?.[LC_FEATURE_COLUMN_IDS.milestone], milestoneFilterSet)`

## CRITICAL 주의사항

- `protectedDatabaseRowsAreCached()` 는 페이지 존재뿐 아니라 **콘텐츠 적재(`contentLoaded !== false`)까지** 요구한다. 메타 baseline 은 row 를 dbCells 없이(`contentLoaded=false`) 적재하므로, 존재만으로 "완료"로 보면 셀이 빈 row 가 표시된다.
- `databaseRowsAreCached()` 가 true 여도 `databaseRowRemoteStore.nextTokenByDatabaseId[indexKey]` 가 남아 있으면 전체 row 후보군은 미완성이다. 부분 캐시가 표시 설정 수량을 채웠다는 이유로 `ensureDatabaseRowsLoaded()` 를 skip 하지 않는다.
- `loadContext`가 다르면 `compositeKey`도 달라진다. 로드 측과 읽기 측의 `loadContext`가 불일치하면 캐시 miss → 무한로드 또는 빈 뷰. 피처 타임라인에서 `rowIndexKey` 산출 시 반드시 `"inline"` 사용.
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
