# schedulerStore

## 역할
LC 스케줄러(일정 캘린더)의 일정 데이터를 관리하는 스토어. persist로 로컬 캐시를 유지하여 초기 로딩 시 빈 화면을 방지한다.

## 위치
`src/store/schedulerStore.ts`

## State 타입

| 필드 | 타입 | 설명 |
|------|------|------|
| `schedules` | `Schedule[]` | 전체 일정 목록 |
| `loading` | `boolean` | 데이터 로딩 중 여부 |
| `cachedWorkspaceId` | `string \| null` | 마지막 캐시된 워크스페이스 ID (전환 시 캐시 무효화용) |
| `visibleRangeFrom` | `string \| null` | 마지막 렌더 범위 시작일 (캐시 재투영 기준) |
| `visibleRangeTo` | `string \| null` | 마지막 렌더 범위 종료일 |
| `cachedScopeKey` | `string \| null` | 마지막 캐시된 scope(`selectedProjectId`). cache-hit 판정에 포함 |

**`Schedule`** 주요 필드: `id`, `workspaceId`, `title`, `comment`, `link`, `projectId`, `startAt`, `endAt`, `assigneeId`, `color`, `colorScope`, `textColor`, `rowIndex`

## 액션 목록

| 액션명 | 파라미터 | 설명 |
|--------|---------|------|
| `fetchSchedules` | `workspaceId, from, to` | 지정 범위+scope의 일정 페치. cache-hit 시 API 생략 |
| `createSchedule` | `input: CreateScheduleInput` | 일정 생성 및 AppSync 뮤테이션 |
| `updateSchedule` | `input: UpdateScheduleInput` | 일정 수정 및 AppSync 뮤테이션 |
| `deleteSchedule` | `id, workspaceId` | 일정 삭제 및 AppSync 뮤테이션 |

## Persist

- storage: `deferredStorage` (커스텀 deferred 스토리지)
- 캐시 무효화 조건: `cachedWorkspaceId`가 현재 워크스페이스와 다를 때 캐시 버림
- version: 별도 마이그레이션 없음

## 의존 관계

- `src/lib/scheduler/scope.ts` — `LC_SCHEDULER_WORKSPACE_ID`, `parseScheduleInstanceId`
- AppSync Lambda — `createLCSchedulerSchedule`, `deleteLCSchedulerSchedule` 등 뮤테이션
- `workspaceStore` — 워크스페이스 전환 감지

## 보조 스케줄러 스토어의 GraphQL 호출 분리 (`*Api`)

`schedulerHolidaysStore`/`schedulerProjectsStore`/`schedulerMmStore` 가 `appsyncClient().graphql` 을 직접 호출하던 코드는 각각 **`src/lib/sync/schedulerHolidaysApi.ts`·`schedulerProjectsApi.ts`·`schedulerMmApi.ts`** 로 추출됐다(Phase 5.1, 다른 store 의 `*Api` 패턴 준수, behavior-preserving).

- 호출 형태·요청 shaping(`bucketToInput` 등)·응답 정규화·캐시 로직 모두 보존.
- 이 스케줄러 보조 데이터는 **outbox 를 경유하지 않는 직접 graphql 호출**이다(읽기·즉시 쓰기). 이 점도 추출 전후 동일 — outbox 경로로 바꾸지 말 것.

## 데이터 흐름 (fetchSchedules)

1. cache-hit 판정: `cachedWorkspaceId`+`visibleRange`+`cachedScopeKey` 일치 **AND `schedules.length > 0`** 이면 재계산 생략.
2. `reconcileSchedulerWorkspaceFromServer` — 증분(delta) 적용. **absence prune 제거됨**(아래 회귀 주의).
3. `localProjected` = `projectLCSchedulerSchedules`(page store → taskAdapter, period 있는 row만, 톰스톤 제외).
4. `remoteProjected` = `fetchScheduleRange`(서버 `listSchedules` 인덱스, org/팀/프로젝트/assignee scope FilterExpression).
5. `schedules` = remoteProjected 가 비어있지 않거나 localProjected 도 빔 → remoteProjected(+pending) merge, 아니면 localProjected 폴백.

## DB 참조값 해석

- `taskAdapter`는 작업 DB의 프로젝트/조직/팀/마일스톤/피처 값을 raw `dbCells`만 보지 않고 `resolveEffectiveCellValueById`로 읽는다.
- LC Scheduler/Feature의 참조 컬럼은 `sourceFromDb`/`itemFetch` 실효값으로 표시·필터·진행률 계산에 참여한다.

## CRITICAL 회귀 주의

- **빈 schedules 캐시의 cache-hit 금지**: cache-hit 조건에 `schedules.length > 0` 가 반드시 포함되어야 한다. 과거 망가진 시점에 `schedules: []` 가 persist 되면, page store 에 행이 있어도 빈 배열로 early-return 해 카드가 영구히 안 보였다. "데이터는 있는데 뷰만 빔" 증상은 이 cache 단락을 1순위로 의심.
- **reconcileLCSchedulerRemoteSnapshot 은 prune 하지 않는다**: 증분(delta) fetch 로 "없는 것을 삭제"하면 최근 변경 안 된 멀쩩한 작업 행이 지워진다(scoped 로딩과 양립 불가). 삭제는 deletedAt 전파·구독·scoped 조회로만 반영. → [../sync/storeApply.md](../sync/storeApply.md)

## 사용처 (주요 컴포넌트)

- `src/components/scheduler/LCSchedulerModal.tsx` — 모달 진입 시 `fetchSchedules` 호출(useEffect). 작업 탭: `ScheduleGrid`(연)/`ScheduleRangeView`(주·월). 마일스톤/피처 탭: `SchedulerDatabaseTimeline`.
- 작업 탭 그리드는 `schedulerStore.schedules` + `useVisibleMembers()`(멤버 행)를 읽는다.

## LC 스케줄러 range index 계약

LC 스케줄러 작업 탭의 source of truth는 작업 DB page다. `Schedules` DynamoDB 테이블은 빠른 range 조회를 위한 read index일 뿐이며, 타임라인에서 수정, 삭제, 드래그 가능한 작업 카드로 투영하려면 반드시 작업 DB page와 연결되어야 한다.

`fetchScheduleRange` 응답을 `schedulerStore.schedules`에 넣을 때 다음 조건을 만족하는 record만 허용한다.

- `id`가 `pageId::assigneeId` 또는 `pageId::__global__` 형식으로 `parseScheduleInstanceId`에 의해 파싱된다.
- `sourcePageId`가 존재하고, 파싱된 `pageId`와 일치한다.
- `sourcePage` snapshot이 응답에 포함되어 있고, `sourcePage.id`가 `sourcePageId`와 일치한다.
- `sourcePage.deletedAt`이 없다.

`sch_...` 형태의 standalone schedule record는 작업 DB page가 아니므로 작업 탭 타임라인에 투영하면 안 된다. 이 record가 화면에 들어오면 `updateLCSchedulerSchedule`, `deleteLCSchedulerSchedule`, picker open, drag update가 모두 작업 DB row를 찾지 못해 삭제되지 않고 이동도 안 되는 유령 일정 카드가 된다.

## 2026-06-12 유령 일정 카드 회귀

증상:

- 개발 빌드에서 실제 작업 DB에는 없는 `테스트 2` 일정 카드가 여러 개 표시됐다.
- 카드 삭제와 드래그 이동이 동작하지 않았다.
- 카드가 일정 타임라인에만 존재하고 picker/edit 동작은 작업 DB row와 연결되지 않았다.

원인:

- 조직/팀/프로젝트 scope 선택 시 구성원 중심의 모든 일정을 가져오도록 `fetchSchedules`를 넓히면서, 서버 `Schedules` 테이블의 standalone/stale record까지 range 응답에 포함됐다.
- 해당 record는 `sch_...` id를 사용하거나 `sourcePage`가 없는 record였고, 작업 DB page 기반 index row가 아니었다.
- 기존 캐시 키가 유지되면 이미 persist된 유령 카드가 cache-hit으로 남을 수 있었다.

재발 방지 규칙:

- 작업 탭 타임라인에는 page-backed LC schedule index record만 투영한다.
- `sourcePage` 없는 range 응답은 stale index 또는 standalone schedule로 보고 제외한다.
- range projection 규칙을 바꾸면 `cachedScopeKey`에 projection version을 포함해 기존 persist cache를 강제로 갱신한다.
- 회귀 테스트는 `src/store/__tests__/schedulerStore.scopeFetch.test.ts`에 추가한다. 최소 검증 항목은 standalone `sch_...` record 제외와 과거 cache key 무효화다.
