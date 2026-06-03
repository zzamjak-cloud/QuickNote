# QuickNote Database 구조 및 컴포넌트 분석 리포트

생성일: 2026-06-03 | 분석 대상: `/src/components/database/`, `/src/lib/database/`, `/src/store/database*Store.ts`

---

## 📋 목차

1. [스토어 계층](#스토어-계층)
2. [라이브러리 유틸 계층](#라이브러리-유틸-계층)
3. [컴포넌트 계층](#컴포넌트-계층)
4. [의존성 관계](#의존성-관계)

---

## 스토어 계층

### 1. databaseStore.ts
**역할:** 모든 데이터베이스와 행(row) 데이터의 진실의 원천. Zustand persist 미들웨어로 localStorage 동기화.

#### 주요 타입
```typescript
type DatabaseStoreState = {
  version: number;
  databases: DbMap;                          // databaseId -> DatabaseBundle
  cacheWorkspaceId: string | null;          // 현재 캐시의 워크스페이스
  migrationQuarantine: PersistedQuarantine[]; // 자동 복구 실패 데이터 안전보관
  dbTemplates: Record<string, DatabaseTemplate[]>; // DB별 로컬 템플릿
};
```

#### 핵심 액션 메서드

| 메서드 | 시그니처 | 설명 |
|--------|---------|------|
| `createDatabase` | `(title?: string) => string` | 새 DB 생성, databaseId 반환 |
| `deleteDatabase` | `(id: string) => void` | DB 삭제 (보호 DB 제외) |
| `addRow` | `(databaseId: string, preset?: DatabaseRowPreset) => string` | 새 행 추가, pageId 반환 |
| `deleteRow` | `(databaseId: string, rowId: string) => void` | 행 삭제 |
| `updateCell` | `(databaseId: string, rowId: string, columnId: string, value: CellValue) => void` | 셀 값 업데이트 |
| `addColumn` | `(databaseId: string, config: ColumnDefInput) => string` | 컬럼 추가 |
| `updateColumn` | `(databaseId: string, columnId: string, changes: Partial<ColumnDef>) => void` | 컬럼 설정 수정 |
| `deleteColumn` | `(databaseId: string, columnId: string) => void` | 컬럼 삭제 |
| `reorderColumns` | `(databaseId: string, columnIds: string[]) => void` | 컬럼 순서 변경 |

#### 저장소 설정
- **persist 이름:** `quicknote.databases.v{DATABASE_STORE_VERSION}`
- **스토리지:** `zustandStorage` (웹: localStorage, 네이티브: Tauri SQLite)
- **마이그레이션:** `./databaseStore/migrations.ts` 분리 관리
- **병합 전략:** `mergePersistedSubset` (selectos 기반 부분 병합)

---

### 2. databaseViewPrefsStore.ts
**역할:** 데이터베이스 뷰 기본 설정 (테이블, 칸반, 갤러리, 타임라인, 리스트) 및 패널 상태 로컬 저장.

#### 주요 타입
```typescript
type DatabaseViewPrefsState = {
  panelStateByKey: Record<string, DatabasePanelState>;  // workspaceId::databaseId -> 필터/정렬/그룹
  viewByKey: Record<string, ViewKind>;                  // workspaceId::databaseId -> 현재 뷰 종류
};

type ViewKind = "table" | "kanban" | "gallery" | "timeline" | "list";
```

#### 핵심 액션
| 메서드 | 시그니처 | 설명 |
|--------|---------|------|
| `getPanelState` | `(databaseId: string, fallbackJson?: string) => DatabasePanelState` | 필터/정렬/그룹 상태 조회 |
| `patchPanelState` | `(databaseId: string, patch: Partial<DatabasePanelState>, fallbackJson?: string) => void` | 패널 상태 부분 업데이트 |
| `getView` | `(databaseId: string, fallback?: ViewKind) => ViewKind` | 현재 뷰 종류 조회 |
| `setView` | `(databaseId: string, view: ViewKind) => void` | 뷰 종류 변경 |

#### 저장소 설정
- **persist 이름:** `quicknote.databaseViewPrefs.v1`
- **Key 형식:** `{currentWorkspaceId}::{databaseId}` (워크스페이스별 격리)
- **마이그레이션:** v0→v1 기본값 삽입

---

### 3. databaseInlineUiPrefsStore.ts
**역할:** 피커뷰 UI 인라인 컨트롤 위치 기억 (이미지 박스, 비디오, 파일 블록의 toolbar 좌표).

#### 주요 타입
```typescript
type InlineControlsPrefs = {
  blockType: "image" | "video" | "file";
  positionX?: number;
  positionY?: number;
};
```

#### 핵심 함수
- `makeInlineControlsPrefsKey(databaseId, rowPageId, blockId): string` — 키 생성
- `getInlineControlsPrefs(key): InlineControlsPrefs | null` — 저장된 위치 조회
- `setInlineControlsPrefs(key, prefs): void` — 위치 저장

---

## 라이브러리 유틸 계층

### 1. src/lib/database/columnSource.ts
**역할:** 컬럼 설정의 외부 소스(linkedScope, sourceFromDb)를 해석해 옵션·셀값·진행률 도출. **순수 함수** → 컴포넌트와 디스플레이 양쪽에서 동일 사용.

#### 주요 타입
```typescript
type ScopeOptionsCtx = {
  organizations: Organization[];
  teams: Team[];
  projects: SchedulerProject[];
};
```

#### 핵심 함수

| 함수 | 시그니처 | 설명 |
|------|---------|------|
| `resolveSyncedOptions` | `(column, databases, scopeCtx?) => SelectOption[] \| null` | sourceFromDb 따라 옵션 재귀 해석 |
| `isOptionSourceLocked` | `(column) => boolean` | 외부 소스 옵션 잠금 여부 판단 |
| `resolveDerivedCellValue` | `(column, rowCells, pages, opts?) => CellValue \| undefined` | viaPageLinkColumnId 미러링 셀값 도출 |
| `isCellValueDerived` | `(column) => boolean` | 셀값이 외부 소스 연결 여부 |
| `effectiveOptions` | `(column, databases, scopeCtx?) => SelectOption[]` | select 컬럼의 최종 옵션 목록 |
| `resolveItemFetchPageIds` | `(column, currentPage, databases) => string[]` | itemFetch 컬럼이 매칭한 행 ID 배열 |
| `computeProgressFromSource` | `(column, database, rowPageId, pages) => number \| null` | progress 컬럼 값 계산 |
| `applySearchFilters` | `(databases, rules, scopeCtx?) => string[][]` | 검색 필터 규칙 적용 결과 |

---

### 2. src/lib/database/pageLinkMirror.ts
**역할:** pageLink 컬럼의 양방향 미러링 관계 해석 (스코프·역참조).

#### 핵심 함수
- `resolvePageLinkMirrorValue(args: ResolvePageLinkMirrorArgs) => string[] | undefined` 
  - `pageLinkScopeDatabaseId`, `pageLinkMirrorColumnId` 기반 역참조 페이지 ID 배열 도출
  - 재귀적으로 중간 페이지 추적

---

### 3. src/lib/database/schema/normalizeDatabase.ts
**역할:** AppSync 스냅샷을 로컬 DatabaseBundle로 정규화/검증.

#### 주요 상수
```typescript
const DATABASE_COLUMN_TYPES = Set[
  "title", "text", "json", "number",
  "select", "multiSelect", "status",
  "date", "person", "file", "checkbox",
  "url", "phone", "email",
  "dbLink", "pageLink", "progress", "itemFetch"
]

const SEARCH_FILTER_KINDS = Set[
  "database", "milestone", "feature", "organization", "team", "project"
]
```

#### 핵심 함수
- `normalizeDatabaseSnapshot(snapshot) => DatabaseBundle` — 스냅샷 정규화
- `validateColumnDef(column) => boolean` — 컬럼 유효성 검증

---

### 4. src/lib/database/timelineCardColor.ts
**역할:** Timeline 뷰의 카드 색상 할당 (status/select 옵션 기반 또는 date 범위).

#### 핵심 함수
- `getTimelineCardColor(config, option?, dateRange?) => string` — CSS 색상 값

---

### 5. src/lib/database/timelineGeometry.ts
**역할:** Timeline 뷰의 시각적 레이아웃 계산 (카드 위치, 겹침 해결).

#### 핵심 함수
- `calculateTimelineLayout(rows, dateColumnId, ...) => LayoutResult` — 좌표 및 높이 계산

---

### 6. src/lib/database/filterValueLabels.ts
**역할:** 검색 필터의 사용자 친화적 레이블 생성.

#### 핵심 함수
- `getFilterLabelForValue(column, value, context) => string` — 필터 조건 표시 텍스트

---

### 7. src/lib/database/jsonCell.ts
**역할:** JSON 타입 셀의 파싱·직렬화·요약.

#### 핵심 함수
- `parseJsonValueInput(input: string) => unknown` — JSON 문자열 파싱
- `stringifyJsonValue(value: unknown) => string` — JSON 직렬화
- `summarizeJsonValue(value: unknown) => string` — 짧은 미리보기

---

## 컴포넌트 계층

### 1. DatabaseBlockView.tsx (루트)
**역할:** Database 블록의 마운트 포인트. 뷰 종류별 Lazy Loading 및 레이아웃 전환.

#### Props
```typescript
type Props = NodeViewProps  // @tiptap/react
```

#### 상태 연결
```typescript
const databaseId = String(node.attrs.databaseId ?? "");
const view = String(node.attrs.view ?? "table") as ViewKind;
const panelState = parseDatabasePanelStateJson(node.attrs.panelState ?? "{}");
const bundle = useDatabaseStore((s) => s.databases[databaseId]);
```

#### 로드되는 뷰 컴포넌트 (Lazy)
```
DatabaseTableView.tsx     (테이블 + 행 편집)
DatabaseKanbanView.tsx    (칸반 보드)
DatabaseGalleryView.tsx   (갤러리)
DatabaseTimelineView.tsx  (타임라인)
DatabaseListView.tsx      (리스트)
```

---

### 2. 뷰 컴포넌트들 (views/)

#### DatabaseTableView.tsx
- **크기:** 27KB
- **역할:** 테이블 그리드 렌더, 셀 편집, 행 선택
- **주요 Hooks:** 
  - `useDatabaseStore(s => s.databases[databaseId])` — DB 데이터
  - `useDatabaseStore(s => s.updateCell)` — 셀 업데이트
  - `useDatabaseViewPrefsStore(s => s.getPanelState(databaseId))` — 필터/정렬/그룹

#### DatabaseTimelineView.tsx
- **크기:** 78KB (최대)
- **역할:** 날짜별 타임라인 카드 배치, 겹침 해결
- **주요 유틸:** `timelineGeometry`, `timelineCardColor`

#### DatabaseKanbanView.tsx
- **역할:** 상태/옵션 기반 칸반 보드
- **구조:** 컬럼별 수영장(swim lane) → 카드 드래그

#### DatabaseGalleryView.tsx
- **역할:** 이미지/파일 갤러리 그리드

#### DatabaseListView.tsx
- **역할:** 단순 행 목록 (핵심 필드 요약)

---

### 3. 셀 컴포넌트들 (cells/)

#### DatabaseCell.tsx (에디터 모드)
**역할:** 수정 가능한 셀 입력 폼. 타입별 에디터 디스패치.

```typescript
// 지원 타입별 컴포넌트
"title"        → <input type="text">
"text"         → <textarea>
"json"         → JSON 파서 + 에러 표시
"number"       → <input type="number">
"date"         → <DateCell>
"select"       → <SelectCell>
"multiSelect"  → <MultiSelectCell>
"status"       → <StatusCell>
"person"       → <PersonCell>
"file"         → <FileCell>
"checkbox"     → <input type="checkbox">
"url"          → <UrlCell>
"phone"        → <PhoneCell>
"email"        → <EmailCell>
"pageLink"     → <PageLinkCell>
"dbLink"       → <DbLinkCell>
"progress"     → <ProgressCell>
"itemFetch"    → <ItemFetchCell>
```

**핵심 로직:**
```typescript
const commit = () => {
  if (final !== value) updateCell(databaseId, rowId, column.id, final);
}
```

---

#### DatabaseCellDisplay.tsx (읽기 모드)
**역할:** 셀 값의 렌더링 가능한 표현. `effectiveValue` 도출 (외부 소스 해석).

**흐름:**
1. `sourceFromDb` 확인 → `resolveDerivedCellValue` 호출
2. 미러링된 값이 있으면 사용, 없으면 원값
3. 디스플레이 컬럼 결정 (재귀 sourceFromDb 추적)
4. 타입별 렌더러 호출 (OptionChip, 날짜 포매팅 등)

---

#### 특화 셀 컴포넌트들

| 파일 | 역할 | 편집 UI |
|------|------|--------|
| `DateCell.tsx` | 날짜 입력 | 달력 피커 |
| `PersonCell.tsx` | 사람/멤버 선택 | 멤버 리스트 검색 |
| `OptionCells.tsx` | Select/MultiSelect/Status | 드롭다운 또는 칩 |
| `OptionChip.tsx` | 옵션 칩 렌더링 | 색상 + 라벨 |
| `PageLinkCell.tsx` | 다른 행 링크 | 페이지 검색 팝업 + 미리보기 |
| `DbLinkCell.tsx` | 다른 DB 행 링크 | DB/행 검색 |
| `ProgressCell.tsx` | 진행률 | sourceFromDb 기반 자동 계산 또는 수동 입력 |
| `ItemFetchCell.tsx` | 자동 가져오기 | sourceFromDb 매칭 열 검색 |
| `SimpleCells.tsx` | URL, Phone, Email | <input type="url"> 등 |

---

### 4. 헤더 및 컨트롤 컴포넌트

#### DatabaseBlockFullPageHeader.tsx
- **역할:** 풀페이지 DB 헤더 (제목, 도구모음)

#### DatabaseBlockInlineHeader.tsx
- **역할:** 인라인 DB 헤더 (컴팩트)

#### DatabaseColumnHeader.tsx
- **역할:** 컬럼 헤더 (정렬, 필터, 메뉴)

#### DatabaseColumnMenu.tsx
- **역할:** 컬럼 우클릭 메뉴 (정렬, 숨김, 편집, 삭제)

#### DatabaseToolbarControls.tsx
- **역할:** 도구 모음 (뷰 전환, 필터, 검색, 그룹)

#### DatabaseAddColumnButton.tsx
- **역할:** 컬럼 추가 버튼 및 타입 선택

---

### 5. 다이얼로그 및 패널

#### DatabaseBlockBinding.tsx
- **역할:** DB 선택/생성 바인딩 대화

#### DatabaseBlockLinkExistingDialog.tsx
- **역할:** 기존 DB 연결 대화

#### DatabaseBlockLinkExistingPanel.tsx
- **역할:** DB 리스트 + 검색

#### DatabaseDeleteConfirmDialog.tsx
- **역할:** DB 삭제 확인 대화

#### DatabaseBlockHistoryDialog.tsx
- **역할:** 버전 히스토리 미리보기

#### ColumnOptionsEditor.tsx
- **역할:** Select 옵션 편집 (추가, 삭제, 색상)

#### DatabasePropertyPanel.tsx
- **역할:** 우측 사이드 패널 (DB 메타, 템플릿)

---

### 6. 유틸 훅

#### useEffectiveOptions.ts
```typescript
function useEffectiveOptions(column: ColumnDef): SelectOption[] {
  // sourceFromDb 또는 linkedScope 기반 옵션 도출
  // 재귀적으로 원본 컬럼 추적
}
```

#### useProcessedRows.ts
```typescript
function useProcessedRows(
  bundle: DatabaseBundle,
  panelState: DatabasePanelState,
): ProcessedRow[] {
  // 필터·정렬·그룹 적용 후 렌더 목록 생성
}
```

#### DatabaseRowPage.tsx / DatabaseRowPeek.tsx
- **역할:** 행 상세 뷰 (에디터 peek 또는 풀페이지)

---

## 의존성 관계

### 계층 구조

```
App (페이지 에디터)
 └─ TipTap DatabaseBlock 확장
     └─ DatabaseBlockView.tsx (루트 컴포넌트)
         ├─ useDatabaseStore (모든 행/셀 데이터)
         ├─ useDatabaseViewPrefsStore (뷰 필터/정렬)
         ├─ useDatabaseInlineUiPrefsStore (인라인 UI 위치)
         └─ DatabaseTableView|KanbanView|... (Lazy)
             ├─ DatabaseCell.tsx (편집) / DatabaseCellDisplay.tsx (읽기)
             │   ├─ columnSource.ts (sourceFromDb/linkedScope 해석)
             │   ├─ pageLinkMirror.ts (페이지링크 역참조)
             │   └─ 셀 타입별 컴포넌트 (DateCell, PersonCell 등)
             ├─ DatabaseColumnHeader.tsx
             ├─ DatabaseToolbarControls.tsx (필터/정렬 UI)
             └─ useProcessedRows.ts (필터/정렬/그룹 로직)
```

### 데이터 흐름

```
1. 사용자 입력 (셀 편집/필터 변경)
   ↓
2. 액션 호출
   - updateCell(databaseId, rowId, columnId, value) [databaseStore]
   - patchPanelState(databaseId, patch) [databaseViewPrefsStore]
   ↓
3. Zustand 상태 업데이트 → 자동 localStorage 저장
   ↓
4. 컴포넌트 리렌더 (selector 기반 선택적)
   ↓
5. AppSync 뮤테이션 (백그라운드)
   - enqueueUpsertDatabase(bundle)
   - 외부 소스 컬럼 변경 시 역참조 행도 함께 업데이트
```

### 외부 소스 의존성

**sourceFromDb 사용:**
- 선택 컬럼 → 다른 DB의 동일 컬럼 옵션 미러
- 진행률 컬럼 → 다른 DB의 진행 중인 행 개수 계산
- itemFetch 컬럼 → 매칭 조건 기반 자동 행 추출

**pageLink 미러링:**
- `pageLinkMirrorColumnId` → 역방향 링크 자동 채우기
- `viaPageLinkColumnId` → 연결된 페이지의 셀값 복사

---

## 컬럼 타입별 저장 형식

| 타입 | 저장 형태 | 예시 |
|------|---------|------|
| title | string | "항목 1" |
| text | string | "설명..." |
| json | any (JSON.stringify) | `{"key":"value"}` |
| number | number | 42 |
| date | ISO 8601 string | "2026-06-03" |
| select | string (optionId) | "opt_abc123" |
| multiSelect | string[] | ["opt_abc", "opt_def"] |
| status | string (optionId) | "status_done" |
| checkbox | boolean | true |
| person | string[] (memberId) | ["user_123"] |
| url | string | "https://..." |
| phone | string | "+82-10-1234-5678" |
| email | string | "test@example.com" |
| file | FileCellItem[] | `[{fileId, name, size, ...}]` |
| pageLink | string[] (pageId) | ["page_1", "page_2"] |
| dbLink | string[] (rowPageId) | ["row_page_3"] |
| progress | number (0-100) | 75 |
| itemFetch | string[] (rowPageId) | 자동 계산 |

---

## 주요 설계 패턴

### 1. Selector 기반 성능 최적화
```typescript
// ❌ 금지 (전체 store 리렌더)
const { databases, updateCell } = useDatabaseStore();

// ✅ 권장 (selector 기반 선택적 리렌더)
const database = useDatabaseStore(s => s.databases[databaseId]);
const updateCell = useDatabaseStore(s => s.updateCell);
```

### 2. 순수 함수 유틸 (캐싱 친화)
```typescript
// columnSource.ts의 함수들은 모두 순수 함수
// → 메모이제이션, 테스트, 컴포넌트/디스플레이 양쪽 재사용
resolveDerivedCellValue(column, rowCells, pages, opts)
effectiveOptions(column, databases, scopeCtx)
```

### 3. 이중 렌더 모드
```typescript
DatabaseCell.tsx      // 에디터 모드 (입력 폼)
DatabaseCellDisplay   // 읽기 모드 (포매팅된 표시)
                      // 같은 columnSource 함수 사용 → 일관성 보장
```

### 4. 동적 뷰 로딩
```typescript
const DatabaseTableView = lazy(() => 
  import("./views/DatabaseTableView").then(m => ({ default: m.DatabaseTableView }))
);
// → 뷰 전환 시에만 해당 번들 로드
```

---

## 성능 고려사항

### Memoization 지점
- `useProcessedRows` — 필터/정렬 결과 캐싱 (500+ 행 시 필수)
- `useEffectiveOptions` — sourceFromDb 재귀 추적 캐싱
- `DatabaseTimelineView` — 시각적 레이아웃 계산 캐싱

### 셀렉터 규칙 (CLAUDE.md 강제)
```typescript
// ❌ 위반
const store = useSchedulerStore();  // 모든 키 변화 감지

// ✅ 준수
const action = useSchedulerStore(s => s.actionName);  // 단일 필드
```

---

## 마이그레이션 및 버전 관리

### databaseStore 버전
- **persist 버전:** `DATABASE_STORE_PERSIST_VERSION`
- **마이그레이션:** `./databaseStore/migrations.ts`
- **격리:** 워크스페이스별 캐시 (cacheWorkspaceId)

### databaseViewPrefsStore 버전
- **v1:** 현재 버전
- **Key 형식:** `{workspaceId}::{databaseId}` (워크스페이스 간 격리)

---

## 테스트 커버리지

주요 테스트 파일:
- `__tests__/DatabaseCellDisplay.test.tsx` — 셀 렌더링
- `__tests__/DatabaseTableView.test.tsx` — 테이블 그리드
- `__tests__/useProcessedRows.test.tsx` — 필터/정렬 로직
- `__tests__/DatabaseTimelineView.test.tsx` — 타임라인 레이아웃
- `lib/database/__tests__/normalizeDatabase.test.ts` — 스키마 정규화
- `lib/database/__tests__/timelineFocusScroll.test.ts` — 타임라인 스크롤

---

## 다음 단계

1. **컬럼 타입 확장**: 새 타입 추가 시 → normalizeDatabase 업데이트 + 셀 컴포넌트 추가
2. **뷰 추가**: 새 레이아웃 → views/ 에 추가 + DatabaseBlockView lazy 등록
3. **성능**: 500+ 행 시 → useProcessedRows 메모이제이션 강화
4. **스키마 변경**: DatabaseBundle 필드 추가 → persist version bump + 마이그레이션 함수
