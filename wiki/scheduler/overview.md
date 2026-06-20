# 스케줄러 / 캘린더

## 파일

| 파일 | 역할 |
|------|------|
| `src/components/scheduler/` | 캘린더/주간 뷰 UI |
| `src/store/schedulerStore.ts` | 스케줄 데이터 |
| `src/store/schedulerViewStore.ts` | 뷰 상태 (월/주/일) |
| `src/store/schedulerFiltersStore.ts` | 멤버 필터 등 |

## 뷰 종류
- 월별 달력 뷰
- 주간 뷰

## 멤버 필터
`schedulerFiltersStore` — 특정 멤버의 일정만 표시

## AppSync 연동
스케줄 생성/수정/삭제 → AppSync 뮤테이션 + 구독 실시간 반영

## Mutation 견고화 (`schedulerMutationResilience.ts`)

`runSchedulerMutation` 래퍼가 모든 스케줄러 뮤테이션에 적용된다(`schedulerHolidaysApi`, `schedulerMmApi`, `schedulerProjectsApi`).

**동작 원칙**
- **성공 경로**: 반환값을 그대로 전달, 재시도/보고 없음.
- **일시적 네트워크 오류** (`timed_out`, `timeout`, `failed to fetch`, `NetworkError` 등): `retryable: true` op에 한해 최초 1회 + 재시도 최대 2회(백오프: 400ms → 800ms). 재시도 소진 후에도 실패하면 `reportNonFatal`로 보고 후 호출처로 재던짐(fail-closed).
- **비일시적 오류**(서버 검증 등): 재시도 없이 즉시 보고·재던짐.

**retryable 분류 기준**

| Op 유형 | `retryable` | 이유 |
|---------|-------------|------|
| update / delete / upsert (id 주소지정) | `true` | 멱등 → 재시도 안전 |
| create (서버 id 할당) | `false` | 비멱등 → 중복 생성 위험 |
| lock / unlock / review | `false` | 상태 전이 → 이중 적용 위험 |

list 계열(조회)은 이 래퍼를 거치지 않는다.

## 피처뷰 행 표시

스케줄러 모달의 피처 뷰에서 행이 비어 보이던 문제가 수정됐다. 로드 scope 메커니즘 상세는 `wiki/sync/external-protected-database-load.md` 참조.

## 헤더 (`SchedulerHeader.tsx`)

- **제목 = 스코프 드롭다운**: 캘린더 아이콘 오른쪽 제목 영역 자체가 조직/팀/프로젝트 선택 `ScopeSelectDropdown`. 선택값이 곧 제목이 되며 뒤에 "일정" 표기. (별도 정적 `<h1>` 없음)
- **내일정 버튼**: 우측 설정 아이콘 왼쪽. 클릭 시 내 스코프로 즉시 전환(조직 우선 → 없으면 팀, 가시 항목 우선) + 다중선택 해제 + `selectMember(myMemberId)`로 내 구성원 탭 활성화.

### ⚠️ 회귀 방지 — "나" 식별은 이메일 조인

스케줄러는 별도 워크스페이스(`LC_SCHEDULER_WORKSPACE_ID`)라 로그인 사용자의 `me.memberId`가 스케줄러 멤버 ID와 **일치하지 않을 수 있다**. `me.memberId`로 조직/팀을 찾으면 항상 못 찾아 버튼이 무반응이 된다.

→ `memberStore.members`(스케줄러 워크스페이스 멤버)에서 **이메일**로 나를 찾아 `myMemberId`를 확정한 뒤 사용한다. (memberId 직접 일치 우선 → 이메일 일치 fallback). 식별 불가 시 버튼 숨김.

같은 이유로 `WeeklyMmPanel.tsx`의 `selectedMemberId === me.memberId` 비교도 cross-workspace 환경에선 신뢰할 수 없다.
