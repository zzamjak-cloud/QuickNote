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

## 헤더 (`SchedulerHeader.tsx`)

- **제목 = 스코프 드롭다운**: 캘린더 아이콘 오른쪽 제목 영역 자체가 조직/팀/프로젝트 선택 `ScopeSelectDropdown`. 선택값이 곧 제목이 되며 뒤에 "일정" 표기. (별도 정적 `<h1>` 없음)
- **내일정 버튼**: 우측 설정 아이콘 왼쪽. 클릭 시 내 스코프로 즉시 전환(조직 우선 → 없으면 팀, 가시 항목 우선) + 다중선택 해제 + `selectMember(myMemberId)`로 내 구성원 탭 활성화.

### ⚠️ 회귀 방지 — "나" 식별은 이메일 조인

스케줄러는 별도 워크스페이스(`LC_SCHEDULER_WORKSPACE_ID`)라 로그인 사용자의 `me.memberId`가 스케줄러 멤버 ID와 **일치하지 않을 수 있다**. `me.memberId`로 조직/팀을 찾으면 항상 못 찾아 버튼이 무반응이 된다.

→ `memberStore.members`(스케줄러 워크스페이스 멤버)에서 **이메일**로 나를 찾아 `myMemberId`를 확정한 뒤 사용한다. (memberId 직접 일치 우선 → 이메일 일치 fallback). 식별 불가 시 버튼 숨김.

같은 이유로 `WeeklyMmPanel.tsx`의 `selectedMemberId === me.memberId` 비교도 cross-workspace 환경에선 신뢰할 수 없다.
