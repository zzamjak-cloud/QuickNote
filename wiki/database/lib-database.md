# lib/database 디렉토리 요약

## 역할
데이터베이스 뷰·셀·필터·컬럼 소스 해석에 필요한 순수 함수 유틸 모음. React 훅 없이 작성되어 컴포넌트와 스토어 양쪽에서 동일하게 사용 가능하다.

## 위치
`src/lib/database/`

## 파일 목록
| 파일 | 역할 |
|------|------|
| `columnSource.ts` | 컬럼 옵션 소스 해석, 파생 셀값 계산, 진행률 자동 계산 |
| `effectiveCellValue.ts` | 화면·스케줄러·필터가 공통으로 쓰는 실효 셀값 해석 |
| `filterValueLabels.ts` | 필터 UI에 표시할 레이블 및 필터 가능 셀값 해석 |
| `jsonCell.ts` | JSON 타입 셀값 검증·파싱·직렬화·요약 |
| `pageLinkMirror.ts` | pageLink 컬럼의 미러 값 해석 |
| `timelineCardColor.ts` | 타임라인 카드 색상 오버라이드 읽기/쓰기 |
| `timelineGeometry.ts` | 타임라인 날짜 범위·좌표 계산 유틸 |
| `schema/` | (하위 디렉토리) DB 스키마 관련 유틸 |
| `__tests__/` | 단위 테스트 |

---

## columnSource.ts

### 주요 exports
| 함수/타입 | 설명 |
|----------|------|
| `effectiveOptions(column, databases, scopeCtx?)` | 컬럼의 실효 옵션 반환. sourceFromDb → linkedScope → config.options 우선순위 |
| `resolveSyncedOptions(column, databases, scopeCtx?)` | sourceFromDb 소스 컬럼의 옵션을 재귀 해석 |
| `isOptionSourceLocked(column)` | 외부 소스에 묶인 컬럼인지 판단 (옵션 직접 편집 잠금용) |
| `resolveDerivedCellValue(column, currentRowCells, pages, ctx?)` | viaPageLinkColumnId 설정 시 연결 페이지의 소스 셀값 반환 |
| `isCellValueDerived(column)` | 자동 derivation 모드 컬럼 여부 |
| `shouldUseManualCellValueForAutomation(column, derivedValue)` | sourceFromDb 자동화 결과가 비었을 때 수동 셀값 fallback 여부 판정 |
| `resolveItemFetchPageIds(column, rowPageId, databases, pages)` | itemFetch 소스 DB에서 현재 행과 매칭되는 페이지 ID 목록 반환 |
| `computeProgressFromSource(column, databases, pages, ctx)` | progressSource 설정 시 백분율(0–100) 계산, 없으면 null |
| `applySearchFilters(candidatePages, filters, databases, pages)` | pageLink 검색 팝업 단계 필터 적용. 파생/자동화 셀값도 해석 |
| `ScopeOptionsCtx` | organizations/teams/projects 컨텍스트 타입 |

### 주의사항
- `effectiveOptions`는 `sourceFromDb` 를 먼저 재귀 해석하고, 없으면 `linkedScope` 옵션을 사용한다. 순환 참조는 depth/seen guard로 방어한다.
- sourceFromDb 자동화 결과가 `null`, 빈 문자열, 빈 배열이면 저장된 수동 셀값을 fallback 으로 쓴다. 참조 DB 값이 다시 채워지면 자동화 값이 우선한다.
- pageLink 자동화는 값을 복사하거나 역방향으로 쓰지 않는다. 참조 표시는 `sourceFromDb`, `itemFetch`, `pageLinkMirror` 해석 결과로 계산한다.
- `isCellCompleted`는 `"done"/"complete"/"completed"/"완료"` 토큰을 완료로 판정.

---

## effectiveCellValue.ts

### 주요 exports
| 함수 | 설명 |
|------|------|
| `resolveEffectiveCellValue(args)` | 컬럼 타입별 raw 값, sourceFromDb 파생값, pageLink mirror, itemFetch 결과를 하나의 실효 셀값으로 계산 |
| `resolveEffectiveCellValueById(args)` | databaseId/columnId/rowPageId 기준으로 컬럼을 찾아 실효 셀값 반환 |

### 사용처
- DB 셀 표시·필터·검색뿐 아니라 LC Scheduler 카드/추천/속성 패널처럼 raw `dbCells`만 보던 경로도 이 유틸을 통해 파생값을 읽는다.
- 복사형 자동 채움 제거 후에도 스케줄러의 조직·팀·프로젝트·마일스톤 값은 저장 복제가 아니라 실효값으로 해석된다.

---

## filterValueLabels.ts

### 주요 exports
| 함수/타입 | 설명 |
|----------|------|
| `FilterLabelContext` | 필터 레이블 계산에 필요한 컨텍스트 타입 (databases, pages, members, scopeCtx) |
| `resolveFilterableCellValue(...)` | 파생 컬럼 포함 실효 셀값 반환 (필터 매칭용) |
| `resolveFilterValueLabels(column, ctx)` | 컬럼 타입별 필터 UI 옵션 목록 반환 |

### 주의사항
- person 타입은 memberStore의 멤버 목록에서 옵션을 생성한다. 멤버가 없으면 빈 배열.
- pageLink, itemFetch, sourceFromDb 자동화 컬럼은 raw 셀값 대신 실효값을 기준으로 필터링될 수 있다.
- `isIdLabelBackedColumn`은 이제 하드코딩 배열 대신 `COLUMN_TYPE_META[type].idLabelBacked`(`src/types/database.ts`)를 읽는다. 새 id-backed 타입은 메타에만 표시하면 된다.

---

## jsonCell.ts

### 주요 exports
| 함수 | 설명 |
|------|------|
| `isJsonValue(value)` | 값이 직렬화 가능한 JsonValue인지 검사 |
| `normalizeJsonValue(value)` | JSON 직렬화 후 역직렬화로 정규화. 불가능하면 null |
| `parseJsonValueInput(input)` | 문자열 입력을 파싱해 `{ok, value}` 또는 `{ok: false, error}` 반환 |
| `stringifyJsonValue(value)` | pretty-print JSON 문자열 (들여쓰기 2칸) |
| `summarizeJsonValue(value)` | 짧은 요약 문자열 (예: "배열 3개", "객체 5개 키") |

---

## pageLinkMirror.ts

### 주요 exports
| 함수 | 설명 |
|------|------|
| `resolvePageLinkMirrorValue(args)` | pageLink 컬럼의 `pageLinkMirrorColumnId` 설정에 따라 소스 DB에서 미러 pageLink 값 배열 반환 |

### 동작 원리
1. 소스 DB의 pageLink 컬럼 또는 현재 행의 직접 연결 값으로 현재 행과 연결된 소스 페이지를 찾음
2. 연결된 소스 페이지들의 `pageLinkMirrorColumnId` 셀값 수집
3. 중복 제거 후 반환

---

## timelineCardColor.ts

### 주요 exports
| 함수/상수 | 설명 |
|----------|------|
| `TIMELINE_CARD_COLOR_OVERRIDES_CELL_ID` | `"_qn_timelineCardColorOverrides"` — 색상 오버라이드 저장 특수 셀 ID |
| `getTimelineCardColorOverride(cells, columnId)` | 특정 컬럼의 카드 색상 오버라이드 조회 |
| `resolveTimelineCardColor(cells, columnId, fallback)` | 오버라이드 있으면 반환, 없으면 fallback |
| `makeTimelineCardColorOverrides(cells, columnId, color)` | 기존 오버라이드 맵에 새 항목 추가한 복사본 반환 |

### 주의사항
- 색상은 반드시 `#RRGGBB` 형식(6자리 16진수)이어야 한다. 유효성 검사 실패 시 null 반환.
- 오버라이드 맵 전체가 단일 셀(`_qn_timelineCardColorOverrides`)에 JSON 객체로 저장된다.

---

## timelineGeometry.ts

### 주요 exports
| 함수/상수 | 설명 |
|----------|------|
| `DAY_MS` | 하루(ms) = `24 * 60 * 60 * 1000` |
| `TIMELINE_WEEK_DAYS` | 5 (평일만) |
| `TIMELINE_WEEK_RANGE_DAYS` | 15 (평일 5일 × 3주) |
| `TIMELINE_WEEK_CAL_DAYS` | 7 (캘린더 주 길이, 시작점 계산용) |
| `timelineIsoDate(t)` | 타임스탬프 → `YYYY-MM-DD` 문자열 |
| `timelineStartOfDay(t)` | 해당 날 00:00:00 타임스탬프 |
| `timelineStartOfWeekMon(t)` | 월요일 기준 주 시작일 00:00 타임스탬프 |
| `timelineGetRange(cell)` | `DateRangeValue` 셀에서 `{start, end}` ms 추출. 유효하지 않으면 null |
| `timelineHexToRgba(hex, alpha)` | 16진 컬러 → `rgba(r, g, b, alpha)` 문자열 |
| `timelinePickStatusColor(row, columns)` | 행의 status/select 첫 옵션 색상 반환 |

### 주의사항
- `timelineGetRange`는 end가 start보다 작으면 start로 클램프한다.
- 주 단위 모드에서 토·일은 시각화 제외. `TIMELINE_WEEK_DAYS`(5)와 `TIMELINE_WEEK_CAL_DAYS`(7)를 혼동하지 않도록 주의.
