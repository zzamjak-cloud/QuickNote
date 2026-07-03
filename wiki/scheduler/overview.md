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

## 터치(태블릿) 회귀 방지

- **카드 더블탭 → 피커뷰**: 카드는 react-rnd(react-draggable) 래핑이라 `touchstart` 에서 `preventDefault()` 되어 합성 click/dblclick 이 생성되지 않는다 → `onDoubleClick` 은 터치에서 절대 발화하지 않는다. `useDoubleTap` 훅(`src/hooks/useDoubleTap.ts`)을 카드 콘텐츠 div 에 스프레드해 터치 더블탭을 직접 감지한다. **카드 구현은 세 곳** — 연간뷰(`ScheduleCard.tsx`)·주간뷰(`ScheduleWeekCard.tsx`)·**DB 타임라인(`SchedulerDatabaseTimeline.tsx`, 마일스톤/작업/날짜없음 카드)** 전부 적용해야 함. 실제로 앞 두 곳만 고쳐서 실기기 미동작이 재발한 이력 있음. 타임라인처럼 map 렌더 내부라 카드별 훅이 불가한 곳은 `useDoubleTapByKey`(pageId 키 기반 공용 감지기 1개) 사용. 탭 판정 파라미터(슬롭 24px·간격 400ms)는 실기기 손가락 오차 기준 — 좁히면 회귀.
- **행 +/- 버튼 노출**: `opacity-0 group-hover:opacity-100` 은 hover 없는 터치 기기에서 버튼이 안 보인다. `[@media(hover:none)]:opacity-100` 병기로 터치에서 상시 노출 (`ScheduleGrid.tsx`).

## 구성원 행 개수(rowCount) 권한

행 늘리기/줄이기는 화면 표시 설정이므로 **모든 구성원이 자유롭게** 가능해야 한다. 서버 `updateMember`(`infra/lambda/v5-resolvers/handlers/member.ts`)는 **rowCount 단독 업데이트에 한해** `requireRoleAtLeast("manager")`·`preventOwnerMutation` 가드를 건너뛴다(1~10 클램프). 다른 필드가 섞이면 기존 가드 적용. 클라이언트 실패 시 무음 롤백 금지 — 에러 토스트 표시.

## 마일스톤/피처 DB 로드 — assigneeId 금지

서버 구성원 인덱스(`DatabaseRowMembers`)는 **작업 DB(`lc-scheduler-db:`)만** 색인한다. 마일스톤/피처 DB 로드에 `assigneeId` 가 붙으면 서버가 assignee 경로로 라우팅되어 **항상 0건**을 반환한다(구성원 선택 잔존 + 스코프 전환 시 마일스톤 카드 전체 미표시 버그). `resolveCurrentDatabaseRowScope()`(`src/lib/sync/externalProtectedDatabaseLoad.ts`)가 작업 DB일 때만 `assigneeId` 를 scope 에 넣는다. 멤버 선택(`selectedMemberId`)은 persist 되고 스코프 드롭다운 전환 시 해제되지 않는 점 주의.

## 피처뷰 행 표시

스케줄러 모달의 피처 뷰에서 행이 비어 보이던 문제가 수정됐다. 로드 scope 메커니즘 상세는 `wiki/sync/external-protected-database-load.md` 참조.

## 헤더 (`SchedulerHeader.tsx`)

- **제목 = 스코프 드롭다운**: 캘린더 아이콘 오른쪽 제목 영역 자체가 조직/팀/프로젝트 선택 `ScopeSelectDropdown`. 선택값이 곧 제목이 되며 뒤에 "일정" 표기. (별도 정적 `<h1>` 없음)
- **내일정 버튼**: 우측 설정 아이콘 왼쪽. 클릭 시 내 스코프로 즉시 전환(조직 우선 → 없으면 팀, 가시 항목 우선) + 다중선택 해제 + `selectMember(myMemberId)`로 내 구성원 탭 활성화.

### ⚠️ 회귀 방지 — "나" 식별은 이메일 조인

스케줄러는 별도 워크스페이스(`LC_SCHEDULER_WORKSPACE_ID`)라 로그인 사용자의 `me.memberId`가 스케줄러 멤버 ID와 **일치하지 않을 수 있다**. `me.memberId`로 조직/팀을 찾으면 항상 못 찾아 버튼이 무반응이 된다.

→ `memberStore.members`(스케줄러 워크스페이스 멤버)에서 **이메일**로 나를 찾아 `myMemberId`를 확정한 뒤 사용한다. (memberId 직접 일치 우선 → 이메일 일치 fallback). 식별 불가 시 버튼 숨김.

같은 이유로 `WeeklyMmPanel.tsx`의 `selectedMemberId === me.memberId` 비교도 cross-workspace 환경에선 신뢰할 수 없다.
