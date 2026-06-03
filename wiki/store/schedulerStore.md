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

**`Schedule`** 주요 필드: `id`, `workspaceId`, `title`, `comment`, `link`, `projectId`, `startAt`, `endAt`, `assigneeId`, `color`, `colorScope`, `textColor`, `rowIndex`

## 액션 목록

| 액션명 | 파라미터 | 설명 |
|--------|---------|------|
| `fetchSchedules` | `workspaceId, from, to` | 지정 범위의 일정 페치. 캐시 히트 시 API 생략 |
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

## 사용처 (주요 컴포넌트)

- `src/components/scheduler/SchedulerView.tsx` (또는 유사 컴포넌트) — 캘린더 렌더링 및 일정 CRUD
- `src/Bootstrap.tsx` — 스케줄러 워크스페이스 진입 시 초기 페치
