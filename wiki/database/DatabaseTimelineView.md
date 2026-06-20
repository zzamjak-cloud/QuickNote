# DatabaseTimelineView

## 역할
데이터베이스의 날짜 범위 컬럼을 가로 타임라인 막대(간트 차트 스타일)로 시각화하는 뷰 컴포넌트. 연/월/주 단위 줌, 카드 드래그·리사이즈, 미예약 항목 패널, 컨텍스트 메뉴를 제공한다.

> **리팩토링 (behavior-preserving)**: 기존 단일 파일(~2008줄)을 다수 파일로 분할했다. 동작은 완전히 보존되며 import 경로만 변경됐다.

## 파일 구조

### 메인 컴포넌트
| 파일 | 역할 |
|------|------|
| `src/components/database/views/DatabaseTimelineView.tsx` | 타임라인 뷰 루트 — 전체 상태 관리, 스크롤/박스선택/가상화 조율. 분할 후 대폭 축소됨 |

### 추출된 컴포넌트
| 파일 | 역할 |
|------|------|
| `src/components/database/views/DatabaseTimelineCard.tsx` | 단일 타임라인 카드 — `react-rnd` 기반 드래그/리사이즈, 호버 툴팁(포털), 우클릭 색상 컨텍스트 메뉴(포털). 부모와는 props 계약으로만 통신 |
| `src/components/database/views/TimelineControlBar.tsx` | 상단 컨트롤 바 — 단위(연/월/주) 토글, 카드 설정 토글, 월/연 이동, 오늘 이동, 셀 너비 줌. 순수 표현 컴포넌트(상태/핸들러는 props) |
| `src/components/database/views/TimelineDateCardSettings.tsx` | 날짜 카드 설정 패널 — 날짜 컬럼별 카드 표시 토글, 별도 제목, 색상 프리셋 선택. 순수 표현 컴포넌트(store 변이는 props 콜백으로 위임) |

### 추출된 훅
| 파일 | 역할 |
|------|------|
| `src/components/database/views/useTimelineAxis.ts` | 축/오늘 기준선 계산 — 줌 단위별 헤더 틱·스케일·주말 스트립 파생. `/* eslint-disable react-hooks/purity */` 주석 유지(렌더 시각 `Date.now()` 사용) |
| `src/components/database/views/useTimelineCardLayouts.ts` | 카드 레이아웃 파생 — 가상화(renderedRows/virtualRows.start)·축 계산 결과를 입력으로 받아 카드 배치 배열 생성. 순수 useMemo(부수효과·ref·DOM 없음) |
| `src/components/database/views/useTimelineColumns.ts` | 날짜 컬럼/타임라인 카드 엔트리 파생 — columns/panelState만 입력으로 받는 순수 useMemo 묶음. store 변이·ref·effect는 컴포넌트에 남음 |

### 추출된 유틸/타입
| 파일 | 역할 |
|------|------|
| `src/components/database/views/timelineCardUtils.ts` | 카드 id/색상/제목 순수 유틸 + 상수(`makeTimelineCardId`, `defaultTimelineColor`, `timelineCardTitle`, `TIMELINE_CARD_COLOR_PRESETS`) |
| `src/components/database/views/timelineLayoutConstants.ts` | 레이아웃 상수 — `ROW_HEIGHT`, `ROW_GAP`, `HEADER_HEIGHT`, `SIDE_LABEL_W*`, `UNSCHEDULED_CARD_*` |
| `src/components/database/views/timelineSelectionGeometry.ts` | 박스 선택/포인터 기하 순수 유틸 — `isInteractiveTarget`(DOM 판별), `rectsIntersect`(사각형 교차 계산). 외부 store/ref/state 의존 없음 |
| `src/components/database/views/timelineTypes.ts` | type-only 추출 — `Granularity`, `TimelineDateEntry`, `ContextPointerEvent`, `TimelineBoxRect`, `TimelineCardLayout`. 런타임 0 |
| `src/components/database/views/timelineZoom.ts` | 줌 상수 — `CELL_WIDTH_MIN/MAX/STEP/DEFAULT`. 메인과 컨트롤 바가 공유 |
| `src/lib/database/timelineDateUtils.ts` | 순수 날짜/월 유틸 — `fmtDate`, `toDateIso`, `startOfMonth`, `addMonths`, `endOfMonth`, `monthInputToStart`, `monthLabel`. 의존성은 `timelineGeometry`의 `DAY_MS`뿐 |

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

## 주요 타입 (`timelineTypes.ts`)
| 타입 | 설명 |
|------|------|
| `Granularity` | `"year" \| "month" \| "week"` — 타임라인 줌 단위 |
| `TimelineDateEntry` | 카드 1개의 컬럼ID·이름·제목모드·색상·주요여부 |
| `ContextPointerEvent` | 우클릭/롱탭 이벤트 추상 타입 |
| `TimelineBoxRect` | 박스 선택 사각형 좌표 |
| `TimelineCardLayout` | 카드 배치 결과(위치·크기·행 인덱스 등) |

## 주요 상수
| 상수 | 값 | 위치 | 설명 |
|------|-----|------|------|
| `ROW_HEIGHT` | `32` | `timelineLayoutConstants.ts` | 행 높이(px) |
| `SIDE_LABEL_W` | `160` | `timelineLayoutConstants.ts` | 좌측 행 레이블 기본 너비(px), 120~360 범위 리사이즈 가능 |
| `CELL_WIDTH_DEFAULT` | `100` | `timelineZoom.ts` | 기본 셀(1일) 너비(px) |
| `CELL_WIDTH_STEP` | `8` | `timelineZoom.ts` | 드래그 날짜 스냅 단위(px) |
| `DRAG_ACTIVATE_PX` | `3` | `DatabaseTimelineCard.tsx` | 드래그 인식 최소 이동량(px) |
| `LS_ZOOM_KEY` | `"quicknote.timeline.zoom"` | `DatabaseTimelineView.tsx` | localStorage 줌 저장 키 |
| `LS_GRANULARITY_KEY` | `"quicknote.timeline.granularity"` | `DatabaseTimelineView.tsx` | localStorage 단위 저장 키 |
| `LS_MONTH_KEY` | `"quicknote.timeline.month"` | `DatabaseTimelineView.tsx` | localStorage 현재 월 저장 키 |

## 주요 렌더 구조
- 좌측 고정 레이블 열: 행 제목, 아이콘
- 가로 스크롤 영역: 날짜 헤더 + 카드 행들
- 카드: `DatabaseTimelineCard` (`react-rnd` 드래그·리사이즈)
- 미예약 패널: 날짜 미지정 행들을 별도 표시
- 컨텍스트 메뉴: `ContextMenu` (우클릭 시 노출)

## 색상 시스템
- 카드 기본 색상: `TIMELINE_CARD_COLOR_PRESETS` (`timelineCardUtils.ts`, index 순환)
- 개별 카드 색상 오버라이드: `_qn_timelineCardColorOverrides` 특수 셀에 JSON으로 저장
- 헥스 색상 → 반투명 배경: `timelineHexToRgba` 사용

## 의존 관계
- **사용하는 스토어**: `useDatabaseStore`, `useUiStore`
- **사용하는 훅**: `useProcessedRows`, `useWindowedRows`, `useTimelineAxis`, `useTimelineCardLayouts`, `useTimelineColumns`
- **사용하는 유틸**: `src/lib/database/timelineGeometry.ts`, `src/lib/database/timelineCardColor.ts`, `src/lib/database/timelineDateUtils.ts`
- **사용하는 컴포넌트**: `DatabaseTimelineCard`, `TimelineControlBar`, `TimelineDateCardSettings`, `TimelineCardPropertyLabels`, `ScheduleCardDetailRows`, `TimelineCardText`, `ContextMenu`
- **사용하는 헬퍼**: `applyTimelineCardStickyOffset`, `applyUnscheduledCardPin`, `buildTimelineCardConfigPatch`, `animateScrollLeft`
- **이 컴포넌트를 사용하는 곳**: `DatabaseBlockView.tsx` (view === "timeline" 분기, lazy)

## 주의사항
- `/* eslint-disable react-hooks/purity */` 주석이 **메인 파일과 `useTimelineAxis.ts` 양쪽에** 있다. 오늘 기준선(`Date.now()`)을 렌더 시각에 직접 사용하기 때문.
- 줌·단위·월 상태는 useState가 아닌 localStorage에 직접 저장되어 컴포넌트 재마운트 후에도 유지된다.
- 카드 색상 오버라이드는 실제 DB 셀값(`_qn_timelineCardColorOverrides`)에 저장되므로, 이 특수 셀 ID를 컬럼 목록에서 필터링해야 한다.
- `react-rnd`로 카드 드래그·리사이즈 시 날짜 스냅은 `CELL_WIDTH_STEP`(8px) 단위로 적용된다.
- 주(week) 단위에서는 토·일요일을 시각화에서 제외하므로 평일 5일 × 3주 = 15칸 구조다.
- `lastTimelineScrollerClientWidth`는 모듈 스코프 변수로, 첫 렌더 전 스크롤 컨테이너 너비 추정에 사용된다.
- `TimelineDateCardSettings` 표시 가드(`timelineSettingsOpen && dateCols.length > 0`)는 호출처(메인 컴포넌트)가 담당한다.
