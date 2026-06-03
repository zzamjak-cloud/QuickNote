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
