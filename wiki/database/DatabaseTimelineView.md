# DatabaseTimelineView

## 역할
데이터베이스의 날짜 범위 컬럼을 가로 타임라인 막대(간트 차트 스타일)로 시각화하는 뷰 컴포넌트. 연/월/주 단위 줌, 카드 드래그·리사이즈, 미예약 항목 패널, 컨텍스트 메뉴를 제공한다.

## 위치
`src/components/database/views/DatabaseTimelineView.tsx`

## 주요 exports
| 이름 | 종류 | 설명 |
|------|------|------|
| `DatabaseTimelineView` | React 컴포넌트 | 타임라인 뷰 루트 (DatabaseBlockView에서 lazy import) |

## Props
| 속성 | 타입 | 설명 |
|------|------|------|
| `databaseId` | `string` | 렌더링할 DB ID |
| `panelState` | `DatabasePanelState` | 필터·정렬·컬럼 설정 |
| `setPanelState` | `(p: Partial<DatabasePanelState>) => void` | 패널 상태 업데이트 콜백 |
| `visibleRowLimit` | `number?` | 최대 표시 행 수 |

## 내부 타입
| 타입 | 설명 |
|------|------|
| `Granularity` | `"year" \| "month" \| "week"` — 타임라인 줌 단위 |
| `TimelineDateEntry` | 카드 1개의 컬럼ID·이름·제목모드·색상·주요여부 |
| `ContextPointerEvent` | 우클릭/롱탭 이벤트 추상 타입 |

## 주요 상수
| 상수 | 값 | 설명 |
|------|-----|------|
| `ROW_HEIGHT` | `32` | 행 높이(px) |
| `SIDE_LABEL_W` | `160` | 좌측 행 레이블 기본 너비(px), 120~360 범위 리사이즈 가능 |
| `CELL_WIDTH_DEFAULT` | `100` | 기본 셀(1일) 너비(px) |
| `DRAG_ACTIVATE_PX` | `3` | 드래그 인식 최소 이동량(px) |
| `LS_ZOOM_KEY` | `"quicknote.timeline.zoom"` | localStorage 줌 저장 키 |
| `LS_GRANULARITY_KEY` | `"quicknote.timeline.granularity"` | localStorage 단위 저장 키 |
| `LS_MONTH_KEY` | `"quicknote.timeline.month"` | localStorage 현재 월 저장 키 |

## 주요 렌더 구조
- 좌측 고정 레이블 열: 행 제목, 아이콘
- 가로 스크롤 영역: 날짜 헤더 + 카드 행들
- 카드: `react-rnd`로 드래그·리사이즈 지원
- 미예약 패널: 날짜 미지정 행들을 별도 표시
- 컨텍스트 메뉴: `ContextMenu` (우클릭 시 노출)

## 색상 시스템
- 카드 기본 색상: `TIMELINE_CARD_COLOR_PRESETS` (index 순환)
- 개별 카드 색상 오버라이드: `_qn_timelineCardColorOverrides` 특수 셀에 JSON으로 저장
- 헥스 색상 → 반투명 배경: `timelineHexToRgba` 사용

## 의존 관계
- **사용하는 스토어**: `useDatabaseStore`, `useUiStore`
- **사용하는 훅**: `useProcessedRows`, `useWindowedRows`
- **사용하는 유틸**: `src/lib/database/timelineGeometry.ts`, `src/lib/database/timelineCardColor.ts`
- **사용하는 컴포넌트**: `TimelineCardPropertyLabels`, `ScheduleCardDetailRows`, `TimelineCardText`, `ContextMenu`
- **사용하는 헬퍼**: `applyTimelineCardStickyOffset`, `applyUnscheduledCardPin`, `buildTimelineCardConfigPatch`, `animateScrollLeft`
- **이 컴포넌트를 사용하는 곳**: `DatabaseBlockView.tsx` (view === "timeline" 분기, lazy)

## 주의사항
- `/* eslint-disable react-hooks/purity */` 주석이 있다. 오늘 기준선(`Date.now()`)을 렌더 시각에 직접 사용하기 때문.
- 줌·단위·월 상태는 useState가 아닌 localStorage에 직접 저장되어 컴포넌트 재마운트 후에도 유지된다.
- 카드 색상 오버라이드는 실제 DB 셀값(`_qn_timelineCardColorOverrides`)에 저장되므로, 이 특수 셀 ID를 컬럼 목록에서 필터링해야 한다.
- `react-rnd`로 카드 드래그·리사이즈 시 날짜 스냅은 `CELL_WIDTH_STEP`(8px) 단위로 적용된다.
- 주(week) 단위에서는 토·일요일을 시각화에서 제외하므로 평일 5일 × 3주 = 15칸 구조다.
- `lastTimelineScrollerClientWidth`는 모듈 스코프 변수로, 첫 렌더 전 스크롤 컨테이너 너비 추정에 사용된다.
