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
