# LC스케줄러 MM 관리 성능 최적화 및 리팩토링 계획

## 목적

LC스케줄러와 MM 관리 기능이 커져도 사용자가 렉을 느끼지 않도록 데이터 경계, 렌더링 경계, 동기화 경계를 정리한다.

핵심 목표는 다음과 같다.

- 일정 생성, 수정, 삭제는 낙관적 업데이트로 즉시 화면에 반영한다.
- AppSync 동기화는 백그라운드에서 빠르게 처리하고, 현재 화면 범위만 재투영한다.
- 일정 카드, MM 제출 원본, 수정 이력, 집계 캐시는 서로 다른 책임으로 분리한다.
- 월간/연간 대시보드와 CSV는 제출된 MM 원본을 기준으로 만든다.
- 기능이 추가되어도 `ScheduleGrid`, `WeeklyMmPanel`, `MmDashboardTab`의 렌더 범위가 불필요하게 커지지 않게 한다.

## 유지해야 할 원칙

### 1. 원본 데이터와 파생 데이터를 섞지 않는다

- LC스케줄러 일정 카드: MM 자동 제안의 입력 데이터
- `MmWeekEntry`: 구성원이 제출한 주간 MM 원본
- `MmRevision`: 검토, 보정, 잠금, 잠금 해제 이력
- `MmAggregate`: 월간, 연간, 대시보드, CSV용 재계산 가능 캐시

일정 카드가 바뀌어도 이미 제출, 검토, 잠금된 MM 원본이 자동으로 바뀌면 안 된다. 변경된 일정은 새 제안값을 만드는 근거로만 사용한다.

### 2. 빠른 화면 반응과 저장 완료를 분리한다

일정 생성, 드래그, 리사이즈, MM 저장은 사용자가 먼저 결과를 보게 하고, 실제 저장과 동기화는 뒤에서 처리한다.

- 일정 생성: temp card 즉시 표시 → 저장 성공 시 real card로 교체 → 실패 시 temp card 제거
- 일정 수정: 화면 위치 먼저 반영 → 저장 실패 시 이전 값으로 복원
- MM 저장: entry optimistic upsert → 서버 응답으로 확정 값 교체 → lock/review 거부 시 원복
- 삭제: 화면에서 먼저 제거 → 실패 시 재삽입 또는 오류 표시

### 3. 전체 재조회보다 영향 범위 무효화를 우선한다

subscription이나 outbox flush 이후 전체 데이터를 다시 가져오지 않는다. 변경된 엔티티가 영향을 주는 범위만 다시 계산한다.

- schedule 변경: 해당 구성원, 해당 날짜 범위, affected week만 무효화
- MM entry 변경: 해당 member/week와 연결된 aggregate만 무효화
- 조직, 팀, 프로젝트 변경: label map과 권한 map만 무효화
- holiday 변경: 해당 week의 suggestion만 무효화

## 현재 주요 병목 후보

### Scheduler projection

`schedulerStore`는 현재 `projectLCSchedulerSchedules()`로 전체 schedule projection을 만들고 visible range를 필터링한다. 일정, 구성원, 프로젝트가 늘어나면 create/update/delete 후 재투영 비용이 커질 수 있다.

개선 방향:

- 내부 저장 구조를 `byId`, `idsByAssignee`, `idsByRangeBucket` 형태로 정규화한다.
- visible range projection은 selector/helper로 분리한다.
- create/update/delete 이후 전체 projection 대신 affected id만 갱신한다.
- optimistic schedule은 별도 pending map으로 관리하고 서버 응답과 reconcile한다.

### MM suggestion 계산

`WeeklyMmPanel`은 렌더 중 schedule source 변환과 `buildWeeklyMmSuggestion()` 계산을 수행한다. 주간 계산 자체는 작지만, 대시보드와 여러 구성원 주차 계산이 붙으면 반복 비용이 커진다.

개선 방향:

- `selectMmSuggestion(memberId, weekStart, scheduleVersion, holidayVersion)` selector를 둔다.
- `toMmScheduleSource` 결과를 schedule version 기준으로 캐시한다.
- suggestion cache key는 `memberId + weekStart + scheduleVersion + holidayVersion`로 둔다.
- schedule 변경 시 affected week만 invalidate한다.

### React 구독 범위

`WeeklyMmPanel`과 `MmDashboardTab`이 여러 store를 직접 구독하면 작은 변경에도 전체 패널이 다시 렌더될 수 있다.

개선 방향:

- container hook과 presenter component를 분리한다.
- 화면 컴포넌트는 primitive props와 memoized list만 받는다.
- `memberIdSet`, label map, leader permission map은 selector에서 캐시한다.
- `ScheduleCard`는 `React.memo`를 적용하고, 함수 props는 `useCallback`으로 안정화한다.
- `ScheduleGrid`는 visible members, visible schedules, row heights를 각각 분리된 selector로 받는다.

## 리팩토링 대상 모듈

### Store 계층

- `src/store/schedulerStore.ts`
  - schedule 원본 저장, optimistic/pending 상태, visible range metadata만 담당
  - projection과 MM suggestion 계산은 외부 selector/service로 이동

- `src/store/schedulerMmStore.ts`
  - MM entry/revision 원본 저장과 mutation만 담당
  - dashboard aggregate와 CSV 변환은 별도 service로 이동

- `src/store/schedulerViewStore.ts`
  - 선택 탭, 선택 구성원, 선택 범위, `mmWeekStart` 같은 UI 상태만 담당

### Selector/service 계층

추가 또는 분리할 후보:

- `src/lib/scheduler/selectors/scheduleSelectors.ts`
- `src/lib/scheduler/selectors/mmSuggestionSelectors.ts`
- `src/lib/scheduler/mm/mmAggregation.ts`
- `src/lib/scheduler/mm/mmExport.ts`
- `src/lib/scheduler/mm/mmInvalidation.ts`

### Component 계층

- `ScheduleGrid`
  - 연간 그리드 레이아웃, 마우스 인터랙션, row virtualization 후보만 담당

- `ScheduleCard`
  - 단일 카드 표시와 선택 상태만 담당

- `WeeklyMmPanel`
  - container hook으로 데이터 준비, presentational panel로 UI 분리

- `MmDashboardTab`
  - filter state, aggregate selector, export action을 분리

## 단계별 실행 계획

### 1단계: 성능 기준선 측정

측정 항목:

- LC스케줄러 열기: cold load, cache-first load
- 연간 그리드 스크롤 FPS
- drag create 후 temp card 표시 시간
- drop 후 real card 치환 시간
- subscription 수신 후 현재 화면 반영 시간
- 주간 MM 패널 열기와 주차 이동 시간
- MM dashboard filter 변경과 CSV 생성 시간

권장 기준:

- 클릭, 드래그, 입력 UI 반응: 100ms 이내
- subscription 화면 반영: 300ms 이내
- 대시보드 filter 변경: 500ms 이내
- CSV 생성: 일반 사용 범위에서 1초 이내

### 2단계: Scheduler projection 정리

- schedule overlap, range bucket, assignee index helper를 분리한다.
- `fetchSchedules()`는 visible range metadata와 source ensure만 담당하게 줄인다.
- `refreshVisibleRangeFromLocal()`은 현재 range만 재투영한다.
- create/update/delete는 affected id만 반영한 뒤, 필요한 range만 invalidate한다.
- optimistic id와 server id 매칭 규칙을 명시한다.

### 3단계: MM suggestion cache 도입

- schedule source 변환 결과를 memoize한다.
- 구성원별 주차 suggestion을 cache한다.
- holiday, schedule, label 변경 시 cache version을 올린다.
- 제출된 entry가 있으면 entry를 우선 표시하고, suggestion은 비교용 fallback으로만 사용한다.

### 4단계: Dashboard aggregate 분리

- weekly/monthly/yearly aggregate 계산을 순수 함수로 유지한다.
- aggregate cache는 원본이 아니라 재생성 가능한 파생 데이터로 취급한다.
- range별 cache key를 `rangeKind + rangeStart + rangeEnd + scope`로 둔다.
- MM entry 변경 시 관련 aggregate만 invalidate한다.

### 5단계: Component 구독 축소

- `WeeklyMmPanel`에서 직접 구독하는 store 수를 줄인다.
- `MmDashboardTab`의 filter state와 계산 state를 분리한다.
- label map, member map, permission map은 selector에서 만든다.
- 카드, 행, MM row는 memoized child component로 나눈다.

### 6단계: 동기화 경로 안정화

- outbox payload sanitizer를 공통화한다.
- `LC_SCHEDULER_WORKSPACE_ID` 우선 규칙을 scheduler DB/page/MM API boundary에서 확인한다.
- subscription apply 후 full refetch 대신 affected range invalidate를 호출한다.
- 실패한 optimistic update는 원복 경로를 테스트로 고정한다.

### 7단계: 큰 화면 최적화

필요할 때만 진행한다.

- 연간 grid row virtualization
- schedule card position 사전 계산
- scroll container paint 영역 축소
- 대시보드 표 pagination 또는 windowing
- CSV 생성 worker 분리

## 검증 계획

### 자동 검증

- `npm test -- --run src/lib/scheduler/mm/__tests__/mmCore.test.ts`
- `npm test -- --run src/__tests__/sync/engine.test.ts`
- `npm run typecheck`
- `npm run lint`
- `npm run build`

### 브라우저 QA

- LC스케줄러 popup이 즉시 열린다.
- drag create 시 점선 마커와 temp card가 즉시 보인다.
- drop 후 카드가 되돌아가지 않는다.
- 다른 탭에서 변경된 일정이 현재 visible range에 반영된다.
- 주간 MM 패널에서 저장, 갱신, 주차 이동이 지연 없이 동작한다.
- MM dashboard filter 변경 후 표와 CSV가 제출된 entry 기준으로 나온다.
- lock 상태 entry는 클라이언트와 서버 모두에서 수정이 거부된다.
- console error가 없다.

## 완료 기준

- 일정, MM entry, revision, aggregate의 책임이 코드상 분리되어 있다.
- visible range 기반 재투영이 유지된다.
- MM 월간/연간/CSV는 제출된 주간 entry를 기준으로 한다.
- 낙관적 업데이트 실패 시 원복 경로가 테스트로 보장된다.
- 사용자 액션 후 화면 반응이 즉시 체감된다.
