# LC스케줄러 MM 관리 구현 계획

## 목적

LC스케줄러의 일정 카드를 기반으로 구성원별 주간, 월간, 연간 MM을 관리한다. 최종 목표는 구성원이 매주 자신의 업무 비율을 제출하고, 조직장/팀장/프로젝트장이 이를 검토, 보정, 취합, 내보낼 수 있는 관리 체계를 만드는 것이다.

핵심 원칙은 다음과 같다.

- 일정 카드는 MM 입력 후보를 만드는 근거 데이터다.
- 최종 MM 원본은 구성원이 제출한 주간 MM 레코드다.
- 월간/연간 MM은 제출된 주간 MM 레코드를 집계한 결과다.
- 조직장/팀장/프로젝트장 보정은 버전 이력으로 남긴다.
- 성과급, 기여도 산정에는 초안이 아니라 검토 완료 또는 잠금 처리된 MM만 사용한다.

## 권장 방향

### 1. 일정 데이터와 MM 확정 데이터를 분리한다

LC스케줄러 일정은 계속 수정될 수 있다. 과거 일정 카드를 뒤늦게 변경했다고 이미 제출/검토된 주간 MM이 자동으로 바뀌면 회계성 데이터로 쓰기 어렵다.

따라서 MM은 다음 두 계층으로 나눈다.

- 자동 제안값: 현재 LC스케줄러 카드, 연차, 공휴일, 빈 날짜를 기반으로 계산한 값
- 제출값: 구성원이 저장/갱신한 주간 MM 원본

권장 동작:

- 주간 MM UI를 열면 자동 제안값을 먼저 보여준다.
- 저장 전에는 제안값이다.
- 저장 또는 갱신 후에는 `submitted` 상태의 MM 레코드가 된다.
- 이후 스케줄러 카드가 바뀌면 UI에 "스케줄러 기준 제안값과 제출값이 다름" 상태를 표시한다.
- 사용자는 갱신 버튼으로 제출값을 다시 저장할 수 있다.
- 관리자는 제출값을 가져와 검토값으로 보정할 수 있다.

### 2. 주간 MM을 단일 소스로 둔다

월간/연간 MM을 따로 입력받지 않는다. 월간/연간은 주간 MM의 집계 결과로 계산한다.

장점:

- 구성원 입력 부담이 줄어든다.
- 월간/연간 합계가 주간 이력과 항상 맞는다.
- 특정 주차 수정 이력이 월간/연간에 자연스럽게 반영된다.
- 성과급 산정 시 근거 주차를 역추적할 수 있다.

### 3. 비율은 정수 basis point로 저장한다

퍼센트 소수점 오차를 피하기 위해 내부 저장은 `basis point` 정수로 한다.

- `10000` = 100%
- `8000` = 80%
- `1250` = 12.5%

UI에서는 `%`로 보여주고, 저장 시 정수로 변환한다. CSV 내보내기는 실질 데이터 분석에 바로 쓰기 위해 `%` 문자를 제거하고 decimal 값으로 출력한다.

CSV 비율 출력 규칙:

- `100%` -> `1`
- `80%` -> `0.8`
- `20%` -> `0.2`
- `12.5%` -> `0.125`

### 4. 기타는 자동 계산값으로 둔다

요구사항대로 `기타`는 구성원이 수정하지 못한다. 기타는 다음 사유의 합이다.

- 연차
- 공휴일
- 해당 근무일에 일정 카드가 없는 빈 날짜
- 스케줄러 카드만으로 업무 범위를 특정할 수 없는 날짜

기타 행에는 이유 보기 버튼을 둔다. 사용자는 이유를 확인하고, 필요하면 LC스케줄러 일정 카드를 직접 조정한다.

## 데이터 모델

### MmWeekEntry

구성원 1명의 특정 주차 MM 제출 단위다.

```ts
type MmWeekEntry = {
  id: string; // mm-week:{memberId}:{weekStart}
  workspaceId: string; // lc-scheduler-global
  memberId: string;
  weekStart: string; // YYYY-MM-DD, 월요일
  weekEnd: string; // YYYY-MM-DD, 금요일
  status: "draft" | "submitted" | "reviewed" | "locked";
  buckets: MmBucket[];
  autoOther: MmAutoOther;
  sourceSnapshot: MmSourceSnapshot;
  submittedByMemberId: string;
  submittedAt: string | null;
  reviewedByMemberId?: string | null;
  reviewedAt?: string | null;
  lockedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};
```

### MmBucket

조직, 팀, 프로젝트, 기타 중 하나의 MM 비율이다.

```ts
type MmBucket = {
  id: string;
  scopeType: "organization" | "team" | "project" | "other";
  scopeId: string | null;
  label: string;
  ratioBp: number;
  editable: boolean;
  source: "schedule" | "manual" | "auto";
  schedulePageIds: string[];
  note?: string | null;
};
```

### MmAutoOther

기타 자동 산정의 근거를 보관한다.

```ts
type MmAutoOther = {
  ratioBp: number;
  reasons: Array<{
    date: string;
    kind: "leave" | "holiday" | "empty" | "unclassified";
    label: string;
    ratioBp: number;
    schedulePageId?: string;
  }>;
};
```

### MmRevision

관리자 보정, 구성원 재제출, 잠금 해제 같은 변경 이력이다.

```ts
type MmRevision = {
  id: string;
  entryId: string;
  workspaceId: string;
  actorMemberId: string;
  action: "submit" | "resubmit" | "review" | "adjust" | "lock" | "unlock";
  before: MmWeekEntry | null;
  after: MmWeekEntry;
  reason?: string | null;
  createdAt: string;
};
```

### 집계 결과

월간/연간 집계는 별도 원본으로 저장하지 않는 것을 권장한다. 화면 성능을 위해 캐시 테이블 또는 IndexedDB 캐시는 둘 수 있지만, 재계산 가능한 파생 데이터로 본다.

```ts
type MmAggregate = {
  rangeKind: "week" | "month" | "year";
  rangeStart: string;
  rangeEnd: string;
  scopeType: "member" | "organization" | "team" | "project";
  scopeId: string;
  totalRatioBp: number;
  memberCount: number;
  buckets: MmBucket[];
};
```

## 자동 산정 규칙

### 주차 기준

- 주 시작: 월요일
- 주 종료: 금요일
- 기준 분모: 5일 = 100%
- 하루 비중: 20%
- 공휴일도 분모에는 포함하고, 해당 일자는 기타로 자동 배정한다.

이 기준은 사용자의 예시와 맞다.

- 프로젝트 4일 + 연차 1일: 프로젝트 80%, 기타 20%
- 프로젝트 2일 + 공휴일 3일: 프로젝트 40%, 기타 60%

### 일정 카드 분류 우선순위

일정 카드 1개가 여러 속성을 가질 수 있으므로 MM bucket은 다음 우선순위로 분류한다.

1. 프로젝트 값이 있으면 프로젝트 MM
2. 팀 값이 있으면 팀 MM
3. 조직 값이 있으면 조직 MM
4. 위 값이 없으면 기타

특이사항 카드는 작업자가 없는 카드이므로 구성원 MM에는 직접 포함하지 않는다. 다만 향후 조직/팀/프로젝트 MM 참고 지표로는 별도 활용할 수 있다.

### 연차 처리

연차 프리셋 또는 `meta.kind === "leave"` 카드는 구성원 MM에서 기타로 자동 반영한다.

- 작업자 지정 연차: 해당 구성원의 기타
- 작업자 없는 특이사항성 휴무 카드: 구성원 MM에는 직접 반영하지 않음
- 공휴일: 모든 구성원의 기타

### 같은 날짜에 여러 일정이 겹치는 경우

추천 방식은 날짜 단위로 겹침을 감지하고 사용자가 판단하게 하는 것이다.

- 같은 구성원, 같은 날짜에 프로젝트 A와 B 일정이 동시에 있으면 자동으로 10%/10%처럼 임의 분배하지 않는다.
- UI에는 두 후보를 모두 보여주고 기본값은 균등 분배 또는 카드 기간 가중치로 제안한다.
- 저장 시 사용자가 직접 조정한다.
- 합계 검증은 항상 `editable bucket 합계 + autoOther = 100%`로 처리한다.

### 빈 날짜 처리

근무일에 다음 조건을 모두 만족하면 빈 날짜로 보고 기타에 자동 반영한다.

- 공휴일이 아님
- 연차 카드가 없음
- 해당 구성원에게 연결된 일정 카드가 없음

## 주간 MM 입력 UI

### 위치

LC스케줄러 화면 우측 하단에 고정 플로팅 패널로 둔다.

- 접힘 상태: 파란 버튼, 흰색 텍스트, `주간 MM 열기`
- 열린 상태: 패널 우측 하단에 `주간 MM 접기`
- 접힘 상태는 사용자별 localStorage에 저장

### 기본 주차

항상 지난주를 기본값으로 연다.

예: 이번 주가 2026-05-18 월요일이라면 기본 주차는 2026-05-11 ~ 2026-05-15다.

### 헤더

헤더 구성:

- 왼쪽 화살표
- `N월 N주차`
- 오른쪽 화살표
- 서브 텍스트: 과거, 지난주, 이번주, 다음주, 미래

주차 이동은 월요일 기준으로 7일씩 이동한다.

### 본문

자동 생성되는 행:

- 조직 업무: `조직명` + 수치 입력 필드 + `%`
- 팀 업무: `팀명` + 수치 입력 필드 + `%`
- 프로젝트 업무: `프로젝트명` + 수치 입력 필드 + `%`
- 기타: 자동 수치 + 잠금 표시 + 이유 보기

입력 규칙:

- 기타는 수정 불가
- 0%로 저장하면 해당 bucket은 이번 주 업무에서 제외
- 합계가 100%가 아니면 저장 불가
- 자동 제안값과 제출값이 다르면 변경 상태 표시
- 저장 전 버튼 문구는 `저장`
- 기존 제출값이 있으면 버튼 문구는 `갱신`

### 기타 이유 보기

기타 행의 이유 보기에는 날짜별 근거를 표시한다.

예:

```text
5/13 공휴일 20%
5/15 연차 20%
5/16 일정 없음 20%
```

사용자가 기타 수치를 직접 수정하지 않고, 스케줄러 일정이나 연차 카드를 조정하도록 유도한다.

## MM 대시보드 UI

### 위치

LC스케줄러 설정 팝업에 `MM 대시보드` 탭을 추가한다.

설정 팝업은 현재보다 넓은 레이아웃이 필요하다.

- 권장 크기: `min(1180px, calc(100vw - 48px))`
- 높이: `min(820px, calc(100vh - 48px))`
- 내부는 탭별 독립 스크롤

### 구성원 탭

구성원이 직접 입력한 MM을 보는 화면이다.

필터:

- 주간 / 월간 / 연간
- 기간 이동
- 구성원 검색
- 조직 / 팀 / 프로젝트 필터
- 제출 상태: 미입력, 제출, 검토, 잠금

표시:

- 구성원별 제출 상태
- 주간 MM 제출을 누락한 구성원은 빨간색 강조 상태로 표시
- 제출을 완료한 구성원은 `제출완료` 라벨 표시
- 주차별 bucket 비율
- 기타 비율
- 합계 검증 상태
- 자동 제안값과 제출값 차이

### 조직장 탭

조직장, 팀장, 프로젝트장이 취합/보정하는 화면이다.

필터:

- 대상 타입: 조직 / 팀 / 프로젝트
- 검색 가능한 드롭다운
- 주간 / 월간 / 연간
- 기간
- 제출 상태

주요 기능:

- `구성원 입력 정보 가져오기`
- 구성원별 제출값 검토
- 관리자 보정
- 보정 사유 입력
- 버전 이력 보기
- CSV 내보내기
- 검토 완료 처리
- 잠금 처리

### CSV 내보내기

CSV는 최소 다음 컬럼을 포함한다.

```text
기간,구성원,조직,팀,프로젝트,분류,MM값,상태,제출일,검토자,검토일,비고
```

`MM값`은 `%` 문자열이 아니라 decimal number로 출력한다. 예를 들어 100%는 `1`, 20%는 `0.2`로 출력한다.

월간/연간 CSV는 주간 원본을 함께 추적할 수 있도록 `주차` 컬럼을 포함한 상세 모드도 제공한다.

## 권한 정책

### 구성원

- 자신의 주간 MM 입력 가능
- 자신의 제출 이력 조회 가능
- 잠금 전까지 재제출 가능
- 잠금 후에는 수정 요청만 가능
- 다른 구성원의 MM 정보는 조회 권한이 있더라도 직접 변경 불가

### 조직장/팀장/프로젝트장

- 자신이 담당하는 scope의 구성원 MM 조회 가능
- 구성원 제출값 가져오기 가능
- 검토값 보정 가능
- 보정 사유 입력 필수
- CSV 내보내기 가능

### 관리자

- 모든 MM 조회/보정/잠금 가능
- 잠금 해제 가능
- 누락 주차 조회 가능
- 권한/대상 leader 설정 가능
- 주간 MM 제출을 누락한 구성원의 주간 MM 입력창에 접근해 대신 입력 가능

관리자 대리 입력 정책:

- 관리자는 구성원별 주간 MM 입력 UI를 대상 구성원 컨텍스트로 열 수 있다.
- 대리 입력 시 `submittedByMemberId`는 실제 입력한 관리자 ID로 저장하고, 대상 구성원은 `memberId`로 별도 보관한다.
- 대리 입력/갱신은 revision에 남긴다.
- 일반 구성원은 다른 구성원의 주간 MM 입력창을 열더라도 편집 필드는 비활성화한다.
- 잠금 상태의 MM은 관리자라도 바로 수정하지 않고, 잠금 해제 revision을 먼저 남긴 뒤 수정한다.

### 리더 정보

조직, 팀, 프로젝트 설정에 리더 필드를 추가한다. 리더는 한 명으로 고정하지 않고 여러 명을 등록할 수 있어야 한다.

- 조직장: 조직의 실장, 부실장 등 복수 등록 가능
- 팀장: 팀장, 부팀장 등 복수 등록 가능
- 프로젝트장: 프로젝트 owner, project manager 등 복수 등록 가능

리더 등록 UI:

- 구성원 검색 필드 제공
- 이름, 직책, 소속 조직/팀 기준 검색
- 검색 결과에서 여러 구성원을 선택해 등록
- 등록된 리더 목록에서 개별 제거 가능
- 비활성 구성원은 기본 검색 결과에서 제외하되, 기존 등록자가 비활성화되면 경고 상태로 표시

기본값 세팅:

- 조직장 기본값은 구성원의 직책 정보에서 `실장`, `부실장`, 조직장 성격의 직책을 우선 탐색해 자동 세팅한다.
- 팀장 기본값은 구성원의 직책 정보에서 `팀장`, `부팀장`, 팀 리더 성격의 직책을 우선 탐색해 자동 세팅한다.
- 프로젝트장은 프로젝트 설정에 명시 등록된 값을 우선 사용한다. 값이 없으면 프로젝트 참여 구성원 중 직책/역할 정보에서 프로젝트 리더 성격의 구성원을 추천한다.
- 자동 세팅은 최초 생성 또는 리더 필드가 비어 있을 때만 적용한다.
- 사용자가 직접 수정한 리더 목록은 이후 직책 정보 변경만으로 자동 덮어쓰지 않는다.

권장 데이터 구조:

```ts
type SchedulerLeaderAssignment = {
  scopeType: "organization" | "team" | "project";
  scopeId: string;
  leaderMemberIds: string[];
  autoSeededFromRole: boolean;
  updatedAt: number;
};
```

이미 구성원 관리에 역할 정보가 있다면 기본값 추천에는 그 구조를 재사용한다. 다만 최종 권한 판단은 조직/팀/프로젝트별 리더 필드에 저장된 `leaderMemberIds`를 기준으로 한다.

## 기술 설계

### 프런트 모듈

권장 위치:

```text
src/lib/scheduler/mm/
src/store/schedulerMmStore.ts
src/components/scheduler/mm/
```

핵심 모듈:

- `weekUtils.ts`: 주차 계산, 월요일/금요일 산정
- `mmSuggestion.ts`: 스케줄러 카드 기반 자동 제안 계산
- `mmValidation.ts`: 합계, 잠금, 권한 검증
- `mmAggregation.ts`: 주간 레코드 기반 월간/연간 집계
- `schedulerMmStore.ts`: 조회, 저장, 갱신, 검토, 잠금
- `WeeklyMmPanel.tsx`: 우측 하단 플로팅 입력 UI
- `MmDashboardTab.tsx`: 설정 팝업 대시보드

### 백엔드/AppSync

MM 데이터는 동기화 안정성이 중요하므로 AppSync 원격 원본을 둔다.

권장 GraphQL:

```graphql
type MmWeekEntry {
  id: ID!
  workspaceId: ID!
  memberId: ID!
  weekStart: AWSDate!
  weekEnd: AWSDate!
  status: String!
  bucketsJson: AWSJSON!
  autoOtherJson: AWSJSON!
  sourceSnapshotJson: AWSJSON!
  submittedByMemberId: ID!
  submittedAt: AWSDateTime
  reviewedByMemberId: ID
  reviewedAt: AWSDateTime
  lockedAt: AWSDateTime
  createdAt: AWSDateTime!
  updatedAt: AWSDateTime!
}

type MmRevision {
  id: ID!
  entryId: ID!
  workspaceId: ID!
  actorMemberId: ID!
  action: String!
  beforeJson: AWSJSON
  afterJson: AWSJSON!
  reason: String
  createdAt: AWSDateTime!
}
```

권장 Mutation:

- `upsertMmWeekEntry`
- `reviewMmWeekEntry`
- `lockMmWeekEntry`
- `unlockMmWeekEntry`

권장 Query:

- `listMmWeekEntries(workspaceId, from, to, memberIds?)`
- `listMmRevisions(entryId)`
- `listMissingMmEntries(workspaceId, weekStart)`

권장 Subscription:

- `onMmWeekEntryChanged(workspaceId)`

### DynamoDB 키 설계

`MmWeekEntries` 테이블:

- PK: `workspaceId`
- SK: `weekStart#memberId`
- GSI1: `memberId#weekStart`
- GSI2: `status#weekStart`

`MmRevisions` 테이블:

- PK: `entryId`
- SK: `createdAt#revisionId`

이 구조는 주간 대시보드, 구성원별 조회, 누락 제출 조회에 모두 대응한다.

## 성능 전략

### 로딩 범위

주간 MM 패널:

- 기본 로드: 지난주 1개
- 주차 이동 시 해당 주만 추가 로드
- 인접 주차 1개 정도는 idle prefetch

대시보드:

- 주간 화면: 선택 기간의 주차 단위 batch fetch
- 월간 화면: 해당 월에 걸친 주차만 fetch
- 연간 화면: 월별 집계 캐시 우선, 필요 시 주간 원본 로드

### 캐시

- 구성원별 최근 8주 MM은 IndexedDB 또는 Zustand persist 캐시에 보관
- 대시보드 집계는 `workspaceId + rangeKind + rangeStart + scopeType + scopeId`로 캐시
- 구독 변경이 들어오면 해당 주차와 관련 집계 캐시만 무효화

### 정합성

- 제출/검토/잠금 mutation은 낙관적 업데이트 가능
- 실패 시 즉시 롤백하고 오류 표시
- 잠금된 entry는 로컬에서도 수정 UI 비활성화
- 서버에서도 잠금 상태 mutation 거부

## 구현 단계

### 1단계: 계산 엔진과 데이터 계약

목표:

- 주차 계산
- 일정 카드 기반 자동 MM 제안
- 기타 자동 산정
- 합계 검증
- 제출 누락/제출완료 상태 계산
- 관리자 대리 입력 권한 검증
- 타입과 테스트 작성

주요 파일:

- `src/lib/scheduler/mm/weekUtils.ts`
- `src/lib/scheduler/mm/mmSuggestion.ts`
- `src/lib/scheduler/mm/mmValidation.ts`
- `src/lib/scheduler/mm/mmPermissions.ts`
- `src/lib/scheduler/mm/mmTypes.ts`

검증:

- A프로젝트 4일 + 연차 1일 = A 80%, 기타 20%
- A프로젝트 4일 + 팀 업무 1일 = A 80%, 팀 20%
- A프로젝트 2일 + B프로젝트 3일 = A 40%, B 60%
- B프로젝트 2일 + 공휴일 3일 = B 40%, 기타 60%
- 주간 MM 제출 누락 구성원은 `누락`, 빨간색 강조 상태로 계산
- 제출 완료 구성원은 `제출완료` 상태로 계산
- 일반 구성원은 다른 구성원의 MM 편집 불가
- 관리자는 다른 구성원의 MM을 대리 입력 가능

### 2단계: 주간 MM 입력 UI

목표:

- LC스케줄러 우측 하단 플로팅 패널
- 지난주 기본 선택
- 주차 이동
- 자동 리스트 생성
- 기타 이유 보기
- 저장/갱신 버튼

주요 파일:

- `src/components/scheduler/mm/WeeklyMmPanel.tsx`
- `src/components/scheduler/mm/WeeklyMmRow.tsx`
- `src/components/scheduler/LCSchedulerModal.tsx`

### 3단계: 원격 저장과 실시간 동기화

목표:

- AppSync schema/resolver 추가
- `schedulerMmStore` 추가
- 제출/갱신 mutation
- subscription 반영
- outbox 또는 기존 sync runtime과 충돌하지 않도록 처리

주요 파일:

- `infra/graphql/schema.graphql`
- `infra/lambda/v5-resolvers/handlers/mm.ts`
- `src/store/schedulerMmStore.ts`
- `src/lib/sync/graphql/bridge.ts`

### 4단계: MM 대시보드 1차

목표:

- 설정 팝업에 `MM 대시보드` 탭 추가
- 구성원 탭
- 주간/월간/연간 필터
- 제출 상태 표시
- 누락 구성원 표시

주요 파일:

- `src/components/scheduler/SchedulerSettingsModal.tsx`
- `src/components/scheduler/mm/MmDashboardTab.tsx`
- `src/components/scheduler/mm/MemberMmDashboard.tsx`

### 5단계: 조직장 검토와 버전 관리

목표:

- 조직/팀/프로젝트 선택 드롭다운
- 구성원 입력 정보 가져오기
- 관리자 보정
- 보정 사유
- revision 저장
- 이력 보기

주요 파일:

- `src/components/scheduler/mm/LeaderMmDashboard.tsx`
- `src/components/scheduler/mm/MmRevisionDialog.tsx`
- `infra/lambda/v5-resolvers/handlers/mm.ts`

### 6단계: CSV 내보내기와 잠금

목표:

- CSV 내보내기
- 주간/월간/연간 export
- 검토 완료
- 잠금/잠금 해제
- 잠금 상태 서버 검증

## UX 세부 권장

### 주간 MM 패널

- 입력 필드는 0~100 범위만 허용
- 기본 step은 5%, 직접 입력은 1% 단위 허용
- 합계 상태를 막대와 숫자로 표시
- 기타는 회색 잠금 행으로 표시
- 자동 제안값과 사용자가 바꾼 값은 작은 변경 표시를 둔다
- 저장 성공 후 "저장됨" 상태를 2초 정도 표시

### 대시보드

- 숫자만 나열하지 말고 구성원 행 + 주차 열 형태의 밀도 높은 표를 기본으로 둔다.
- 상태는 색이 아니라 아이콘/라벨을 함께 사용한다.
- 월간/연간은 drill-down으로 주차 상세를 열 수 있어야 한다.
- CSV 내보내기는 현재 필터 상태를 그대로 반영한다.

## 리스크와 대응

### 일정 카드와 제출값 불일치

리스크:

- 사용자가 제출 후 스케줄러 일정을 수정하면 MM과 일정이 다르게 보일 수 있다.

대응:

- 제출 당시 source snapshot을 저장한다.
- 현재 제안값과 제출값 차이를 표시한다.
- 사용자가 갱신할 수 있게 한다.
- 검토/잠금 이후에는 자동 변경하지 않는다.

### 조직/팀/프로젝트 이름 변경

리스크:

- 과거 MM의 label이 현재 설정 이름과 달라질 수 있다.

대응:

- bucket에는 `scopeId`와 제출 당시 `label`을 함께 저장한다.
- 화면 기본 표시는 최신 이름을 쓰되, CSV에는 제출 당시 이름 옵션을 제공한다.

### 구성원 소속 변경

리스크:

- 과거 주차에는 A팀, 현재는 B팀일 수 있다.

대응:

- MM entry에 제출 당시 구성원 소속 snapshot을 저장한다.
- 대시보드 필터는 "현재 소속 기준"과 "당시 소속 기준"을 구분할 수 있게 설계한다.

### 성과급 산정 데이터 안정성

리스크:

- 보정 이력이 없거나 잠금이 없으면 최종 기여도 산정 근거가 흔들린다.

대응:

- 성과급/기여도 계산은 `reviewed` 또는 `locked` 상태만 사용한다.
- 관리자 보정에는 reason을 필수로 둔다.
- 잠금 이후 수정은 unlock revision을 남긴다.

## 추천 우선순위

1. 주간 MM 자동 제안 계산 엔진
2. 구성원 주간 입력 UI
3. 원격 저장과 제출 상태
4. 관리자 대시보드 조회
5. 조직장 보정/버전 관리
6. CSV export
7. 잠금/성과급 산정용 집계

초기 버전은 주간 입력과 제출값 저장에 집중하는 것이 좋다. 대시보드와 집계는 주간 원본이 안정된 뒤 확장해야 한다.

## 완료 기준

- 구성원은 지난주 MM을 1분 안에 입력/저장할 수 있다.
- 연차/공휴일/빈 날짜는 기타로 자동 반영된다.
- 주간 합계는 항상 100%로 검증된다.
- 월간/연간은 주간 제출값에서 재계산된다.
- 조직장/팀장/프로젝트장은 담당 범위의 MM을 조회하고 보정할 수 있다.
- 보정 이력은 모두 revision으로 남는다.
- CSV는 현재 필터 상태 그대로 내려받을 수 있다.
- 잠금된 MM은 프런트와 서버 양쪽에서 수정되지 않는다.
