# LC스케줄러 DB 통합 구현 계획

## 목적

LC스케줄러의 일정 카드를 QuickNote 데이터베이스 행 페이지로 전환한다. 최종 목표는 스케줄러가 별도 일정 저장소가 아니라 `LC스케줄러` 전용 데이터베이스를 시각화하는 화면이 되도록 만드는 것이다.

기존 등록 일정은 없으므로 구 일정 데이터 마이그레이션은 범위에서 제외한다.

## 권장 방향

### 1. 데이터베이스 행 페이지를 단일 소스로 둔다

일정 카드 자체를 별도 엔티티로 보관하지 않고, 데이터베이스 행 페이지 하나를 작업 하나로 본다.

- 데이터 원본: `DatabaseBundle` + `Page.databaseId` + `Page.dbCells`
- 스케줄러 카드: DB 행 페이지를 연간/주간 그리드에 투영한 결과
- 카드 더블 클릭 또는 Enter: 기존 `ScheduleEditPopup` 대신 DB 행 페이지 피커/사이드 패널을 연다
- 카드 생성: 스케줄러 Ctrl/Alt 드래그가 DB 행 페이지를 생성한다
- DB 행 생성: 데이터베이스에서 직접 행을 만들면 스케줄러에도 카드가 나타난다

이 방식이 가장 안전하다. 별도 `schedule` 테이블과 DB를 동시에 쓰면 양방향 동기화 충돌, 삭제 불일치, outbox 재시도 중 중복 생성 문제가 계속 생긴다.

### 2. 다중 작업자는 “행 1개, 카드 N개”로 처리한다

사람 속성에 여러 작업자가 들어가면 같은 행 페이지를 여러 구성원 행에 카드로 표시한다.

- 행 페이지는 1개만 유지
- 카드 인스턴스 키는 `pageId:memberId`
- 제목, 날짜, 프로젝트, 상태, 본문은 모든 카드가 공유
- 작업자별 표시 행 위치만 내부 메타데이터로 분리

물리적으로 행 페이지를 작업자 수만큼 복제하지 않는다. 복제하면 본문/댓글/상태가 분산되고, “하나의 작업 페이지”라는 목적과 어긋난다.

### 3. 속성은 기본 세트와 고급 세트로 나눈다

스케줄러 페이지의 속성이 복잡해지는 것을 막기 위해 기본 뷰에는 최소 속성만 노출한다.

기본 속성:
- `작업명`: title
- `작업자`: person
- `기간`: date
- `프로젝트`: select 또는 multiSelect
- `상태`: status

고급 속성:
- `조직`
- `팀`
- `마일스톤`
- `버전`
- `피쳐`
- `예상 MM`
- `실적 MM`
- `카드 색상`
- `스케줄러 메타`

`스케줄러 메타`는 사용자에게 기본 노출하지 않는 시스템 속성으로 둔다. 이번 통합에서는 DB 셀 타입에 `json`을 추가하고, 작업자별 rowIndex, 카드 표시 옵션, 자동 생성 메타 같은 내부 값을 JSON 셀에 저장하는 것을 추천한다.

### 4. JSON 셀 타입과 프리셋은 역할을 분리한다

JSON 셀 타입은 복잡한 구조 값을 저장하기 위한 범용 셀 타입이다. 프리셋은 새 행을 만들 때 어떤 컬럼과 기본값을 적용할지 정하는 생성 정책이다. 둘을 같은 기능으로 묶지 않는다.

JSON 셀 타입 용도:
- 스케줄러 내부 메타 저장
- 외부 API 연동 payload 저장
- 자동화 결과 저장
- 계산 전 원본 구조 데이터 보관
- 향후 relation/formula/rollup 구현 전 임시 구조 필드로 사용

프리셋 용도:
- 프로젝트/조직/팀별 일정 생성 기본값 저장
- 자주 쓰는 속성 묶음 적용
- 새 일정 페이지 생성 시 입력 부담 감소
- 필수 속성, 숨김 속성, 기본 표시 컬럼을 함께 적용

권장 UI:
- 일반 표 셀에서는 JSON을 짧은 요약 뱃지로 표시한다.
- 클릭 시 JSON 뷰어/에디터 모달을 연다.
- 시스템 JSON 컬럼은 기본 속성 패널에서 숨긴다.
- 잘못된 JSON은 저장하지 않고 즉시 오류를 보여준다.
- 프리셋 적용은 일정 생성 흐름에서 선택한다. 사용자가 JSON을 직접 작성하게 만들지 않는다.

### 5. 일정 생성 프리셋을 1차 기능으로 포함한다

속성이 많아질수록 사용자가 매번 모든 값을 입력하는 방식은 실패한다. `LC스케줄러`는 전용 프리셋 시스템을 가져야 한다.

프리셋 예시:
- `피쳐 개발`: 프로젝트, 피쳐, 상태, 예상 MM, 기본 기간, 기본 색상
- `버그 수정`: 상태, 우선순위, 버전, 담당 팀
- `릴리스 준비`: 마일스톤, 버전, 체크리스트 템플릿
- `연차`: 제목, 상태, 색상, 작업자, 기간

프리셋 데이터 구조 권장:

```ts
type DatabaseRowPreset = {
  id: string;
  databaseId: string;
  name: string;
  description?: string;
  scope: "workspace" | "organization" | "team" | "project";
  scopeId?: string;
  columnDefaults: Record<string, CellValue>;
  requiredColumnIds: string[];
  visibleColumnIds: string[];
  hiddenColumnIds: string[];
  schedulerDefaults?: {
    durationDays?: number;
    color?: string;
    titlePrefix?: string;
    assigneeIds?: string[];
  };
  createdAt: number;
  updatedAt: number;
};
```

저장 방식은 `dbTemplates`를 확장하는 방향이 좋다. 현재 템플릿은 로컬 전용 성격이 강하므로, LC스케줄러 통합에서는 프리셋을 동기화 대상 데이터로 승격해야 한다.

권장 동작:
- Ctrl 드래그 후 팝업/피커에서 최근 사용 프리셋을 기본 선택한다.
- 프로젝트를 선택하면 해당 프로젝트 기본 프리셋을 자동 적용한다.
- Alt 드래그는 `연차` 프리셋을 바로 적용한다.
- 프리셋 적용 후에도 사용자가 각 속성을 수정할 수 있다.
- 프리셋 삭제는 기존 일정 데이터에 영향을 주지 않는다.
- 프리셋 이름 변경은 다음 생성부터만 적용한다.

### 6. 연간 화면은 “전체 즉시 로드”가 아니라 “가시 구간 우선 로드”로 처리한다

LC스케줄러는 연 단위 화면이지만, 사용자가 실제로 자주 보는 구간은 현재월 전후와 가까운 미래 일정이다. 12월에 화면을 열 때 1월부터 12월까지 모든 구성원 일정을 한 번에 불러오면 데이터가 쌓일수록 초기 로딩이 느려진다.

권장 기본 로딩 범위:
- 최초 로드: 현재 날짜 기준 `-45일 ~ +180일`
- 현재월이 12월이면 다음 해 1~3월도 선로딩
- 사용자가 특정 월로 이동하면 해당 월 기준 `-30일 ~ +60일` 추가 로드
- 과거 월은 사용자가 스크롤/월 바로가기/검색으로 접근할 때 지연 로드

권장 캐시 정책:
- 최근/미래 일정 구간은 IndexedDB에 기간 캐시로 저장
- 캐시 키는 `workspaceId + databaseId + filterScope + rangeStart + rangeEnd + revision`
- 캐시 TTL은 최근 구간 10분, 과거 구간 24시간
- outbox에 로컬 변경이 있으면 해당 기간 캐시를 즉시 갱신하거나 무효화
- 구독으로 들어온 변경은 해당 카드가 포함되는 기간 캐시에만 반영

권장 UX:
- 최초 진입 시 현재월 근처는 즉시 표시
- 아직 로드하지 않은 과거 구간은 월 헤더/행 영역에 얇은 로딩 상태를 표시
- 과거 월로 이동하면 해당 구간을 로드하고, 완료 후 캐시에 저장
- 검색/필터가 과거 전체를 대상으로 할 때는 “전체 기간 검색” 모드로 명시 전환
- 오늘로 이동은 항상 캐시 우선, 누락 시 배경 보강 로드

핵심 원칙:
- 연간 그리드는 “연 전체 UI”를 보여주되, 데이터는 필요한 기간부터 점진 로드한다.
- 사용자가 과거 기록으로 접근할 수는 있어야 하지만, 초기 진입 비용을 과거 전체 데이터가 결정하게 만들지 않는다.
- 화면에 보이는 카드와 DB 원본의 정합성은 유지하되, 오래된 범위는 stale-while-revalidate 방식으로 갱신한다.

## 전용 데이터베이스 설계

### 식별자

워크스페이스별로 고정 ID를 사용한다.

- ID 형식: `lc-scheduler-db:{workspaceId}`
- 표시 이름: `LC스케줄러`
- 삭제 불가
- 데이터베이스 관리 팝업 최상단에 고정 표시

AppSync의 Database 키가 `id` 단일 키이므로 모든 워크스페이스가 같은 ID를 쓰면 충돌 위험이 있다. 반드시 workspaceId를 포함한 고정 ID를 사용한다.

### 부트스트랩

앱 시작 또는 워크스페이스 전환 시 `ensureLCSchedulerDatabase(workspaceId)`를 실행한다.

동작:
- 전용 DB가 없으면 생성
- 필수 컬럼이 없으면 추가
- 컬럼 이름은 사용자가 바꿀 수 있어도 시스템 컬럼 ID는 유지
- 삭제된 상태로 들어오면 복구하거나 재생성

### 접근 권한 강제

`LC스케줄러` 전용 워크스페이스/DB는 모든 구성원이 항상 편집 권한을 가진다. 이 권한은 사용자 설정으로 바꿀 수 없고, UI와 서버 양쪽에서 강제한다.

정책:
- 워크스페이스의 모든 active 구성원은 `LC스케줄러` DB와 해당 행 페이지에 `edit` 권한을 가진다.
- 권한 옵션 UI에서 `LC스케줄러` 접근 권한은 표시만 하거나 비활성화한다.
- 관리자도 이 권한을 `view` 또는 `none`으로 낮출 수 없다.
- 구성원이 워크스페이스에서 비활성화되면 그때만 접근 대상에서 제외한다.
- 서버 리졸버는 LC스케줄러 scope 요청에 대해 구성원 여부를 확인한 뒤 edit 권한을 허용한다.
- 프런트 권한 UI는 서버 강제 정책의 보조 표현일 뿐, 최종 권한 판단은 서버가 한다.

권장 구현:
- `isLCSchedulerScope(workspaceId, databaseId?)` 헬퍼를 만든다.
- `_auth.ts` 또는 권한 판정 계층에서 LC스케줄러 scope는 active member에게 edit을 반환한다.
- workspace access / database access 설정 저장 경로에서 LC스케줄러 권한 변경 payload를 거부한다.
- 권한 관리 UI는 해당 항목을 잠금 아이콘과 함께 “모든 구성원 편집 고정”으로 표시한다.

### 삭제 보호

다음 경로를 모두 막는다.

- 데이터베이스 관리 팝업 삭제 버튼
- DB 전체 페이지 삭제
- `databaseStore.deleteDatabase`
- 원격 soft delete 적용 경로

권장 구현은 `isLCSchedulerDatabaseId(databaseId)` 헬퍼를 만들고 UI/스토어/동기화 적용부에서 같은 규칙을 쓰는 것이다.

## 핵심 모듈 구조

### 새로 둘 모듈

- `src/lib/scheduler/database.ts`
  - 전용 DB ID 생성
  - 필수 컬럼 정의
  - system column ID 상수
  - DB bootstrap/repair helper
  - LC스케줄러 scope 판정 helper

- `src/lib/scheduler/taskAdapter.ts`
  - DB 행 페이지 → 스케줄러 카드 projection
  - 카드 projection → DB 셀 patch
  - 작업자별 카드 인스턴스 ID 처리

- `src/lib/scheduler/taskMeta.ts`
  - `json` 셀 기반 메타 encode/decode
  - 작업자별 rowIndex 저장
  - 카드 색상, 연차 여부 같은 표시 메타 정규화

- `src/lib/database/jsonCell.ts`
  - JSON 셀 값 정규화
  - JSON stringify/parse 안전 처리
  - 순환 참조·허용 불가 값 방어

- `src/lib/database/presets.ts`
  - DB 행 생성 프리셋 타입
  - 프리셋 적용 로직
  - scope별 기본 프리셋 선택 로직

- `src/lib/scheduler/rangeLoader.ts`
  - 현재 뷰포트/월/필터 기준 로드 범위 계산
  - 로드 완료 범위 병합
  - 과거 구간 지연 로드 트리거

- `src/lib/scheduler/rangeCache.ts`
  - IndexedDB 기반 일정 projection 캐시
  - TTL/무효화/구독 반영
  - outbox pending 변경과 캐시 병합

- `src/components/scheduler/SchedulerTaskPeek.tsx`
  - 카드 클릭 시 우측 사이드 피커
  - 내부는 기존 `DatabasePropertyPanel` + `Editor` 재사용

### 바꿀 모듈

- `ScheduleGrid.tsx`
  - `schedulerStore.schedules` 대신 DB row projection 사용
  - Ctrl/Alt 드래그 생성 시 DB 행 페이지 생성
  - 드래그/리사이즈/이관 시 DB 셀 업데이트
  - 현재 스크롤 위치와 월 바로가기에 따라 필요한 기간만 로드
  - 미로드 과거 구간 접근 시 지연 로딩 표시

- `ScheduleCard.tsx`
  - `Schedule` ID 기준에서 `pageId/memberId` 카드 인스턴스 기준으로 전환
  - 더블클릭/Enter/클릭 편집을 DB 피커로 연결

- `databaseStore.ts`
  - 보호 DB 삭제 차단
  - 전용 DB 생성 시 빈 seed row를 만들지 않는 경로 추가 권장
  - LC스케줄러 범위 쿼리에 필요한 projection/index 필드 저장 전략 추가

- AppSync/Lambda/CDK
  - LC스케줄러 DB 행을 기간 기준으로 조회하는 쿼리 추가
  - 기간 조회용 보조 엔티티 또는 GSI 추가
  - `updatedAt` 증분 동기화와 `dateRange` 조회를 분리

- 권한 리졸버와 권한 설정 UI
  - LC스케줄러 scope는 모든 active 구성원 edit 권한 고정
  - 권한 변경 요청은 서버에서 거부
  - UI에서는 변경 불가 상태로 표시

- `DatabaseBlockView.tsx` 및 DB 관리 팝업
  - `LC스케줄러` DB 최상단 고정
  - 삭제/이름 변경 제한 또는 경고
  - 인라인 연결 가능

- `DatabaseToolbarControls.tsx`
  - 필터/정렬/뷰 상태를 저장 가능한 “뷰 프리셋”으로 승격
  - 같은 DB를 여러 곳에 붙여도 필터 상태가 동기화되도록 처리

- `DatabaseCell.tsx`
  - `json` 타입 셀 표시/편집 UI 추가
  - 기본 표 셀에서는 요약 표시, 상세 편집은 모달/피커로 분리

- `DatabasePropertyPanel.tsx`
  - `json` 타입 추가
  - 시스템 JSON 컬럼은 기본 접힘 또는 숨김 처리

- `databaseStore.ts`
  - `ColumnType`에 `json` 추가
  - `CellValue`에 JSON 객체/배열 값 허용
  - 프리셋 저장/수정/삭제 액션을 동기화 가능한 구조로 승격

## 선행 기술 작업

### JSON 셀 타입 추가

작업:
- `ColumnType`에 `json` 추가
- `CellValue`에 `JsonValue` 타입 추가
- `defaultMinWidthForType("json")` 정의
- `defaultColumnForType("json")` 추가
- `DatabaseCell`에 JSON 셀 렌더러 추가
- `DatabasePropertyPanel` 컬럼 타입 목록에 JSON 추가
- sync zod schema에서 JSON 셀 값 통과 확인

JSON 값 타입 권장:

```ts
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
```

주의:
- `undefined`, 함수, Date 객체, 순환 참조는 허용하지 않는다.
- 저장 전 `JSON.stringify`/`JSON.parse` 왕복으로 정규화한다.
- 표 셀에서 큰 JSON을 직접 편집하지 않는다.

### 프리셋 저장소 승격

작업:
- 기존 `DatabaseTemplate`과 새 `DatabaseRowPreset`의 관계 정리
- 로컬 전용 템플릿과 동기화 프리셋을 분리하거나, 템플릿 자체를 동기화 대상으로 확장
- 프리셋 관리 UI 추가
- 프로젝트/팀/조직별 기본 프리셋 지정
- 최근 사용 프리셋 로컬 저장

권장:
- 1차는 `DatabaseRowPreset`을 DB 메타/설정에 저장하는 방식으로 시작한다.
- 프리셋 수가 많아지고 권한/감사 로그가 필요해지면 별도 AppSync 엔티티로 분리한다.

### 기간 기반 로딩 인덱스

DB 행 페이지의 날짜는 `Page.dbCells` 내부 JSON에 들어가므로 DynamoDB가 직접 기간 조건으로 효율 조회하기 어렵다. LC스케줄러 전용으로 조회 최적화 계층이 필요하다.

권장안:
- DB 행 페이지를 원본으로 유지한다.
- 저장 시 스케줄러 projection 보조 레코드를 함께 갱신한다.
- 보조 레코드는 기간 조회에 필요한 최소 필드만 가진다.
- 카드 클릭/편집 시에는 원본 페이지를 로드한다.

보조 레코드 예시:

```ts
type SchedulerTaskIndex = {
  id: string;             // `${pageId}:${memberId}`
  workspaceId: string;
  databaseId: string;
  pageId: string;
  memberId: string;
  projectId?: string | null;
  organizationId?: string | null;
  teamId?: string | null;
  startAt: string;
  endAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};
```

필요 인덱스:
- `workspaceId + startAt`
- `workspaceId + memberId + startAt`
- `workspaceId + projectId + startAt`
- `workspaceId + updatedAt`

주의:
- 보조 레코드는 원본이 아니다. 원본은 DB 행 페이지다.
- 보조 레코드 재생성 작업을 만들 수 있어야 한다.
- 보조 레코드가 누락되면 원본 DB 행에서 복구 가능해야 한다.

## 구현 단계

### Phase 1. JSON 셀과 프리셋 기반 준비

목표: LC스케줄러 전용 DB가 복잡한 메타와 생성 기본값을 안전하게 다룰 수 있게 한다.

작업:
- DB `json` 컬럼 타입 추가
- JSON 셀 뷰어/에디터 추가
- 시스템 JSON 컬럼 숨김 처리
- `DatabaseRowPreset` 설계 반영
- 프리셋 생성/수정/삭제 기본 액션 추가

검증:
- JSON 셀에 객체/배열 값 저장 후 새로고침해도 유지
- 잘못된 JSON은 저장 차단
- 프리셋을 저장하고 새 행 생성 시 기본값이 적용
- 프리셋 삭제 후 기존 행 데이터는 유지

### Phase 2. 전용 DB 부트스트랩

목표: QuickNote 안에 삭제 불가능한 `LC스케줄러` 데이터베이스가 항상 존재하게 한다.

작업:
- `LC_SCHEDULER_DATABASE_ID_PREFIX` 추가
- 필수 컬럼 ID/정의 추가
- `ensureLCSchedulerDatabase(workspaceId)` 구현
- 앱 부트스트랩/워크스페이스 전환 후 실행
- 모든 active 구성원 edit 권한 강제
- LC스케줄러 권한 옵션 변경 차단
- 데이터베이스 관리 팝업에서 최상단 고정
- 삭제 보호 처리

검증:
- 새 워크스페이스 진입 시 `LC스케줄러` DB 자동 생성
- 앱 새로고침 후 유지
- 모든 구성원이 LC스케줄러 DB 행을 생성/수정할 수 있음
- 권한 설정 화면에서 LC스케줄러 edit 권한을 낮출 수 없음
- 서버 API에 권한 변경 payload를 직접 보내도 거부됨
- 삭제 버튼이 보이지 않거나 비활성화
- 원격 재동기화 후에도 사라지지 않음

### Phase 3. DB 행을 스케줄러 카드로 렌더링

목표: 스케줄러가 DB 행 페이지를 카드로 보여준다.

작업:
- DB row projection 생성
- `작업자` person 셀의 멤버 수만큼 카드 인스턴스 생성
- `기간` date 셀을 카드 시작/종료일로 사용
- `카드 색상`, `rowIndexByMember`를 메타에서 읽기
- 기존 `schedulerStore.schedules` 의존 제거 또는 compatibility adapter로 축소
- 기간 기반 projection/index 레코드 생성
- 현재월 근처 우선 로드와 과거 구간 지연 로드 구현
- 로드 완료 범위와 캐시 상태를 뷰 상태로 관리

검증:
- DB에서 행을 추가하면 스케줄러 카드 표시
- 작업자 2명 이상이면 여러 구성원 행에 같은 작업 카드 표시
- 작업자 제거 시 해당 구성원 카드만 사라짐
- 현재월 근처 데이터만으로 초기 렌더링 가능
- 과거 월로 이동하면 해당 기간 데이터가 추가 로드됨
- 이미 로드한 최근 구간은 캐시로 빠르게 표시

### Phase 4. 스케줄러 조작을 DB 쓰기로 전환

목표: 스케줄러에서 만든 변경이 DB 행 페이지에 저장된다.

작업:
- Ctrl 드래그: 새 DB 행 페이지 생성
- Alt 드래그: `연차` 행 페이지 생성
- 카드 드래그: `기간` 셀과 작업자별 rowIndex 메타 업데이트
- 리사이즈: `기간` 셀 업데이트
- 색상 변경: 메타 또는 색상 컬럼 업데이트
- 삭제: DB 행 페이지 삭제 확인 후 삭제

검증:
- 스케줄러에서 생성한 카드가 DB에 행으로 보임
- DB 행 페이지 속성 변경이 스케줄러 카드에 반영
- 스케줄러 드래그 후 DB `기간` 값이 바뀜
- 삭제가 스케줄러와 DB 양쪽에서 사라짐

### Phase 5. 카드 편집을 DB 피커로 대체

목표: 기존 일정 편집 팝업을 DB 행 페이지 편집 경험으로 교체한다.

작업:
- 카드 클릭 시 우측 사이드 피커 열기
- 피커 안에 `DatabasePropertyPanel` 표시
- 본문은 기존 `Editor` 재사용
- Enter/더블클릭도 같은 피커 열기
- 기존 `ScheduleEditPopup`은 신규 구조에서 제거하거나 연차 빠른 생성 보조용으로만 남김

검증:
- 카드 클릭 시 속성 패널과 본문 편집 가능
- 사람 속성 변경 시 카드 표시 구성원이 즉시 바뀜
- 기간 속성 변경 시 카드 위치와 너비가 즉시 바뀜

### Phase 6. 필터/뷰 상태 동기화

목표: 같은 `LC스케줄러` DB를 인라인으로 여러 페이지에 붙여도 필터 상태를 의도대로 공유할 수 있게 한다.

권장안:
- DB 자체에는 “공유 뷰 프리셋”을 저장
- 각 인라인 블록에는 어떤 프리셋을 보고 있는지만 저장
- 개인별 임시 검색어/스크롤/열 너비는 로컬 prefs에 둔다

작업:
- `DatabasePanelState` 중 공유해야 할 값과 로컬이어야 할 값 분리
- 필터/정렬/뷰 종류/표시 컬럼/그룹 기준을 공유 프리셋으로 저장
- 인라인 DB는 프리셋 참조 또는 독립 뷰 복제 선택 가능하게 설계

검증:
- 한 곳에서 공유 프리셋 필터를 바꾸면 같은 프리셋을 쓰는 모든 DB 뷰에 반영
- 독립 뷰로 복제한 인라인 DB는 별도 필터 유지
- 검색어처럼 순간적인 UI 상태는 다른 위치에 전파되지 않음

### Phase 7. 분석 기반 준비

목표: 프로젝트별/구성원별 업무량 분석을 위한 데이터를 쌓기 시작한다.

작업:
- 예상 MM, 실적 MM 컬럼 추가
- 프로젝트/마일스톤/버전/피쳐 필터 표준화
- 주간/월간/연간 집계 selector 작성
- 구성원별 프로젝트 기여도 계산 함수 추가

검증:
- 구성원별 주간 MM 합계 계산
- 프로젝트별 월간 MM 계산
- 연간 업무량을 DB 필터와 스케줄러 필터 양쪽에서 같은 기준으로 조회

## 구현 시 피해야 할 방식

- 일정 테이블과 DB 행을 동시에 원본으로 두는 방식
- 작업자 수만큼 행 페이지를 복제하는 방식
- 시스템 메타를 사용자 기본 속성으로 전부 노출하는 방식
- 사용자가 일정 생성 때마다 고급 속성을 모두 직접 입력하게 만드는 방식
- 프리셋을 JSON 셀 하나에만 숨겨두고 관리 UI를 만들지 않는 방식
- 워크스페이스와 무관한 고정 DB ID를 쓰는 방식
- LC스케줄러 권한을 일반 워크스페이스/DB 권한 옵션처럼 변경 가능하게 두는 방식
- 연간 화면 진입 시 과거 1년치 전체 작업 페이지를 항상 모두 로드하는 방식
- `dbCells` JSON만으로 기간 필터를 처리해 서버/클라이언트에서 전체 스캔하는 방식
- 필터 상태를 모두 로컬 저장소에만 두는 방식

## 1차 완료 기준

다음이 모두 되면 1차 통합 완료로 본다.

- `LC스케줄러` DB가 자동 생성되고 삭제되지 않는다
- 모든 active 구성원이 `LC스케줄러` DB에 편집 권한을 가진다
- `LC스케줄러` 권한 옵션은 임의 변경할 수 없다
- `json` 셀 타입이 저장/동기화/편집된다
- 일정 생성 프리셋을 생성/적용/삭제할 수 있다
- Ctrl/Alt 드래그가 DB 행 페이지를 만든다
- Ctrl 드래그 생성 시 선택한 프리셋 기본값이 적용된다
- DB에서 행을 직접 만들면 스케줄러 카드가 생긴다
- 카드 클릭 시 DB 행 페이지 피커가 열린다
- 사람 속성 다중 선택이 여러 구성원 카드로 렌더링된다
- 카드 드래그/리사이즈가 DB 날짜 속성에 저장된다
- DB 날짜/작업자/프로젝트 변경이 스케줄러에 즉시 반영된다
- 최초 진입 시 현재월 근처 범위만 우선 로드한다
- 과거 월 접근 시 해당 기간이 지연 로드된다
- 최근 구간은 캐시를 통해 빠르게 재표시된다

## 추천 작업 순서

1. DB `json` 셀 타입을 먼저 추가한다.
2. 일정 생성 프리셋의 타입과 저장 방식을 정한다.
3. `LC스케줄러` 전용 DB bootstrap, 권한 강제, 삭제 보호를 만든다.
4. 기간 기반 projection/index 레코드와 range query를 설계한다.
5. DB 행 → 카드 projection adapter를 만든다.
6. 현재월 근처 우선 로드, 과거 지연 로드, 최근 캐시를 붙인다.
7. 기존 스케줄러 UI를 projection 기반으로 전환한다.
8. Ctrl/Alt 드래그 생성 경로를 DB 행 생성과 프리셋 적용으로 바꾼다.
9. 카드 클릭 편집을 DB 피커로 대체한다.
10. 다중 작업자 렌더링과 작업자별 rowIndex 메타를 붙인다.
11. 공유 뷰 프리셋과 분석용 속성은 그 다음 단계에서 확장한다.
