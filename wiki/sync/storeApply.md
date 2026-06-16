# storeApply.ts

## 역할
AppSync(GraphQL)에서 내려온 원격 변경을 LWW(Last-Write-Wins) 규칙으로 Zustand 스토어에 적용한다.

## 위치
`src/lib/sync/storeApply.ts`

## 주요 exports
| 이름 | 종류 | 설명 |
|------|------|------|
| `applyRemotePageToStore` | function | GqlPage를 pageStore에 LWW 적용 |
| `applyRemoteDatabaseToStore` | function | GqlDatabase를 databaseStore에 LWW 적용 |
| `shouldApplyRemoteSnapshot` | function | 워크스페이스 가드. `storeApply/commentApply.ts` 와 공유하기 위해 export(무순환) |

> **댓글 reducer 분리(Phase 5.6)**: 원격 Comment LWW 적용(`applyRemoteCommentToStore`/`applyRemoteCommentsToStore`)은 `src/lib/sync/storeApply/commentApply.ts` 로 verbatim 이동했다(behavior-preserving). 워크스페이스 가드는 `storeApply` 의 `shouldApplyRemoteSnapshot` 를 import 해 공유한다. 호출처(`Bootstrap.tsx`·`workspaceSnapshotBootstrap.ts`)는 import 경로만 바뀌었다. 고정용 특성화 테스트: `src/lib/sync/__tests__/commentApply.characterization.test.ts`.

## 주요 함수
| 함수명 | 파라미터 | 반환값 | 설명 |
|--------|---------|--------|------|
| `applyRemotePageToStore` | `remotePage: GqlPage \| null \| undefined` | `void` | 원격 페이지를 로컬 스토어에 적용 (삭제·LWW 처리 포함) |
| `applyRemoteDatabaseToStore` | `remoteDb: GqlDatabase \| null \| undefined` | `void` | 원격 DB를 로컬 스토어에 적용 |
| `applyRemoteCommentToStore` | `remoteComment: GqlComment \| null \| undefined` | `void` | 원격 댓글을 로컬 스토어에 적용 |
| `shouldApplyRemoteSnapshot` | `remoteWorkspaceId` | `boolean` | 현재 워크스페이스와 다른 원격 데이터 필터링 |
| `collectRowPageIdsForDatabase` | `databaseId` | `string[]` | DB에 속한 페이지 id 목록 (템플릿 제외, order 정렬) |
| `reconcileDatabaseRowOrders` | `databaseIds: Set<string>` | `void` | 여러 DB의 rowPageOrder를 페이지 스토어 기준으로 재동기화 |
| `reconcileLCSchedulerRemoteSnapshot` | `{ pages, databases }` | `{ prunedPageIds: [] }` | LC 스케줄러 증분 스냅샷 **적용 전용**. 아래 주의 참고 |

## reconcileLCSchedulerRemoteSnapshot — prune 금지 (CRITICAL)

이 함수는 `applyRemoteDatabasesToStore` + `applyRemotePagesToStore` **적용만** 한다. 과거엔 "전체 살아있는 목록에 없는 로컬 작업 행"을 prune 했으나, 호출자(`schedulerStore.reconcileSchedulerWorkspaceFromServer`)가 **증분(delta) fetch** 를 넘기므로 "delta 에 없다"는 이유로 멀쩩한 행이 삭제되는 회귀가 있었다(+ 톰스톤까지 남겨 영구 억제). scoped/부분 로딩과 absence prune 은 양립 불가 → **prune 제거**. 삭제는 `deletedAt` 전파·구독·scoped 조회로만 반영. `prunedPageIds` 는 항상 `[]`.

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

## AWSJSON 경계 shape 검증 (회귀 가드)

`storeApply/helpers.ts` 의 `parseAwsJson<T>(v, fallback, schema?)` 는 선택적 zod 스키마를 받아 파싱 결과의 **shape** 를 검증한다(Phase 4.2). 깨진 모양이면 기존 JSON.parse 실패와 동일하게 조용히 `fallback` 으로 떨군다(side-effect 없는 순수 함수).

- `doc` ← `DocEnvelopeSchema`(`schemas/index.ts`): 최상위 `type` 문자열만 강제, 나머지 키는 passthrough.
- `dbCells` ← `DbCellsSchema`: 문자열 키 객체 맵임만 강제(배열/스칼라 거부). 값은 미검증.

깊은 구조는 검증하지 않고 "올바른 컨테이너 모양"만 강제해 garbage(문자열/배열/스칼라) 유입을 차단한다. 내부 데이터는 passthrough/unknown 으로 한 글자도 버리지 않는다 — PageMeta 소실류 사고와 동일 부류의 경계 방어. 회귀 테스트: `src/lib/sync/__tests__/parseAwsJsonGuard.test.ts`.

## 댓글 배치 no-op 단축 (성능)

`applyRemoteCommentsToStore` 는 `useBlockCommentStore.setState` 안에서 실제 변경 여부(삭제 대상 존재 여부, upsert 가 기존 참조와 다른지)를 먼저 판정해, 변경이 없으면 `Map` 왕복·배열 재구성을 건너뛰고 기존 state 를 그대로 반환한다(Phase 1.5, `storeApply.ts:611` 부근). 갱신 시점·결과는 동일.

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
