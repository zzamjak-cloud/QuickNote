# storeApply — 모듈 구조 및 동작

## 역할
AppSync(GraphQL)에서 내려온 원격 변경을 LWW(Last-Write-Wins) 규칙으로 Zustand 스토어에 적용한다.

## 파일 구조 (엔티티별 모듈 분할, behavior-preserving)

```
src/lib/sync/
├── storeApply.ts          # orchestrator + 배럴 re-export (151줄)
└── storeApply/
    ├── applyShared.ts     # 공유 sink: 워크스페이스 가드·캐시 해석
    ├── rowOrder.ts        # 공유 sink: DB 행순서 정합 헬퍼
    ├── helpers.ts         # 공유 sink: 변환·LWW 판정 유틸
    ├── pageApply.ts       # page 도메인 reducer
    ├── databaseApply.ts   # database 도메인 reducer
    └── commentApply.ts    # comment 도메인 reducer
```

### 무순환 의존 규칙
- `pageApply` ↔ `databaseApply` 직접 호출 없음. 공유는 `rowOrder` / `applyShared` / `helpers` 경유.
- 서브모듈은 `storeApply.ts`(main)를 import하지 않음.
- sink 3종(`helpers`, `rowOrder`, `applyShared`)은 서로만 의존 가능.

---

## 공개 API (배럴 re-export — 16개 importer 무수정)

`storeApply.ts`가 서브모듈 함수를 re-export해 외부 호출처 경로는 변경 없다.

| 이름 | 출처 모듈 | 설명 |
|------|----------|------|
| `shouldApplyRemoteSnapshot` | `applyShared` | 워크스페이스 가드 |
| `applyRemotePageToStoreCrossWorkspaceAware` | `pageApply` | cross-workspace 인식 단건 적용 |
| `applyRemotePageToStore` | `pageApply` | GqlPage → pageStore LWW 적용 |
| `applyRemotePagesToStore` | `pageApply` | 배치 적용 |
| `applyRemotePageMetasToStore` | `pageApply` | PageMeta 배치 적용 |
| `applyRemoteDatabaseToStore` | `databaseApply` | GqlDatabase → databaseStore LWW 적용 |
| `applyRemoteDatabasesToStore` | `databaseApply` | 배치 적용 |
| `reconcileLCSchedulerRemoteSnapshot` | `storeApply.ts` | LC 스케줄러 증분 스냅샷 적용 전용 |
| `reconcileWorkspacePagesFullSnapshot` | `storeApply.ts` | 페이지 set-reconciliation(좀비 청소) — 전체 페이지 목록 필요 |
| `reconcileWorkspaceDatabasesFullSnapshot` | `storeApply.ts` | DB set-reconciliation(좀비 청소) — DB 는 항상 전체 조회라 증분에서도 호출 |

`applyRemoteCommentToStore` / `applyRemoteCommentsToStore` 는 `storeApply/commentApply.ts`에서 직접 export(배럴 경유 안 함 — 호출처가 commentApply 경로로 import).

---

## 서브모듈별 주요 함수

### applyShared.ts
| 함수 | 설명 |
|------|------|
| `shouldApplyRemoteSnapshot(remoteWorkspaceId)` | 현재 워크스페이스와 다른 원격 데이터 필터링. LC_SCHEDULER_WORKSPACE_ID 예외 처리 포함 |
| `resolveNextCacheWorkspaceId(...)` | 캐시 워크스페이스 id 결정 헬퍼 |

### rowOrder.ts
| 함수 | 설명 |
|------|------|
| `collectRowPageIdsForDatabase(databaseId)` | DB에 속한 페이지 id 목록 (템플릿 제외, order 정렬) |
| `collectRowPageIdsForDatabases(databaseIds)` | 배치 버전 → `Map<string, string[]>` |
| `reconcileDatabaseRowOrders(databaseIds)` | 여러 DB의 rowPageOrder를 pageStore 기준으로 재동기화 |
| `removePageIdFromDatabaseRowOrder(databaseId, pageId)` | 삭제 시 rowPageOrder에서 제거 |
| `ensurePageInDatabaseRowOrder(databaseId, pageId)` | 구독 순서 레이스 대비 — 템플릿 제외 후 rowPageOrder에 추가 |

### pageApply.ts (4 exports)
`applyRemotePageToStoreCrossWorkspaceAware` / `applyRemotePageToStore` / `applyRemotePagesToStore` / `applyRemotePageMetasToStore`

### databaseApply.ts (2 exports)
`applyRemoteDatabaseToStore` / `applyRemoteDatabasesToStore`

---

## orchestrator 2종 (storeApply.ts 직접 정의)

### reconcileLCSchedulerRemoteSnapshot — prune 금지 (CRITICAL)

```ts
reconcileLCSchedulerRemoteSnapshot({ pages, databases }): { prunedPageIds: [] }
```

`applyRemoteDatabasesToStore` + `applyRemotePagesToStore` **적용만** 수행한다. 과거엔 "전체 살아있는 목록에 없는 로컬 행"을 prune 했으나, 호출자(`schedulerStore.reconcileSchedulerWorkspaceFromServer`)가 **증분(delta) fetch** 를 넘기므로 "delta에 없다"는 이유로 멀쩡한 행이 삭제되는 회귀가 있었다. scoped/부분 로딩과 absence prune은 양립 불가 → **prune 제거**. 삭제는 `deletedAt` 전파·구독·scoped 조회로만 반영. `prunedPageIds`는 항상 `[]`.

### reconcileWorkspacePagesFullSnapshot / reconcileWorkspaceDatabasesFullSnapshot

```ts
reconcileWorkspacePagesFullSnapshot({ workspaceId, remotePageIds, pendingUpsertPageIds })
  : { removedPageIds: string[] }
reconcileWorkspaceDatabasesFullSnapshot({ workspaceId, remoteDatabaseIds, pendingUpsertDatabaseIds })
  : { removedDatabaseIds: string[]; removedRowPageIds: string[] }
```

서버에서 영구 삭제된 page/database가 로컬 캐시에 좀비로 남는 현상을 청소한다.

- **페이지**: 전체 페이지 목록이 권위 있을 때만(전체 스냅샷 경로) 호출. 메타 페이지네이션 등 부분 목록으로 호출하면 멀쩡한 페이지를 지운다.
- **DB**: DB 는 워크스페이스당 소수라 항상 전체 조회하므로(`fetchDatabasesByWorkspace(workspaceId)`) **delta·meta 경로에서도** 호출해 좀비 DB 를 정리한다. 제거 시 그 DB 의 행 페이지(`removedRowPageIds`)도 함께 정리. 자세한 배경: [incremental-sync.md](./incremental-sync.md).

**공통 규칙**:
1. `remoteIds`에 있는 id → 이미 `applyRemote*`가 처리, 건드리지 않음.
2. `pendingUpsertIds`에 있는 id(outbox 대기 중) → 보호.
3. 위 둘 모두 해당 없고 같은 워크스페이스 소속 → 좀비로 판정, 로컬 제거.
4. LC 스케줄러(`isProtectedDatabaseId`) / 다른 워크스페이스 / 로컬 전용 id → 건드리지 않음.

---

## 동작 흐름

### applyRemotePageToStore
1. `normalizeLCSchedulerPageWorkspace` — 구 스케줄러 databaseId면 soft-delete 처리
2. `shouldApplyRemoteSnapshot` — 현재 워크스페이스와 다른 데이터면 무시
3. `shouldIgnoreRemoteAfterLocalDelete` — 로컬에서 이미 삭제한 페이지면 무시 (localDeleteGuards)
4. `deletedAt != null` — tombstone이면 pageStore에서 해당 id 제거, activePageId 초기화
5. `shouldApplyRemotePageOverwrite(local, remote)` — 로컬이 더 최신이면 무시 (LWW)
6. `gqlPageToLocalPage(p)` — GqlPage → 로컬 Page 타입 변환 (ISO ms → epoch ms 포함)
7. pageStore 업데이트 + `ensurePageInDatabaseRowOrder` 호출

### LWW 판정
- GraphQL은 ISO 문자열, 로컬은 epoch ms — 경계에서 `isoToMs` 변환
- `isRemoteNewer(local.updatedAt, remote.updatedAt)` 가 false이면 원격 덮어쓰기 거부

---

## AWSJSON 경계 shape 검증 (회귀 가드)

`storeApply/helpers.ts` 의 `parseAwsJson<T>(v, fallback, schema?)` 는 선택적 zod 스키마를 받아 파싱 결과의 **shape** 를 검증한다(Phase 4.2). 깨진 모양이면 기존 JSON.parse 실패와 동일하게 조용히 `fallback` 으로 떨군다(side-effect 없는 순수 함수).

- `doc` ← `DocEnvelopeSchema`(`schemas/index.ts`): 최상위 `type` 문자열만 강제, 나머지 키는 passthrough.
- `dbCells` ← `DbCellsSchema`: 문자열 키 객체 맵임만 강제(배열/스칼라 거부). 값은 미검증.

깊은 구조는 검증하지 않고 "올바른 컨테이너 모양"만 강제해 garbage 유입을 차단한다. 회귀 테스트: `src/lib/sync/__tests__/parseAwsJsonGuard.test.ts`.

## 댓글 배치 no-op 단축 (성능)

`applyRemoteCommentsToStore`(`storeApply/commentApply.ts`)는 `useBlockCommentStore.setState` 안에서 실제 변경 여부를 먼저 판정해, 변경이 없으면 `Map` 왕복·배열 재구성을 건너뛰고 기존 state를 그대로 반환한다(Phase 1.5). 갱신 시점·결과는 동일.

## 외부 의존
- `usePageStore`, `useDatabaseStore`, `useBlockCommentStore` (Zustand 스토어)
- `useWorkspaceStore` (현재 워크스페이스 id 조회)
- `localDeleteGuards` (로컬 삭제 후 원격 재적용 차단)
- `storeApply/helpers` (isoToMs, gqlPageToLocalPage, isRemoteNewer 등)
- `repairDbHistoryBaselineIfNeeded` (historyStore 베이스라인 보정)

## 주의사항
- `LC_SCHEDULER_WORKSPACE_ID`는 현재 선택 워크스페이스와 무관하게 항상 적용 (`shouldApplyRemoteSnapshot` 예외 처리)
- 구독 레이스로 다른 워크스페이스 스냅샷이 내려올 경우 로컬 캐시 오염 방지를 위해 workspaceId 검증 필수
- `_qn_isTemplate` 마커가 있는 페이지는 DB rowPageOrder 집계에서 제외
- `rowPageOrder`는 AppSync Database 모델에 없으므로 pageStore에서 역추산(`collectRowPageIdsForDatabase`)
