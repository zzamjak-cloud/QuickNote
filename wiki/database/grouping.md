# DB 그룹화

표시설정의 "그룹화" 옵션 — 선택한 컬럼으로 항목을 그룹 단위로 접기 가능하게 분할 표시한다.

## 적용 범위
- **v1 적용 뷰**: 표 · 리스트 · 갤러리
- **후속**: 타임라인(그룹별 스윔레인)
- **칸반은 분리** — 자체 `kanbanGroupColumnId`(보드 컬럼=그룹) 유지. 표시설정 그룹화 섹션은 칸반 뷰에서 숨김.
- **그룹화 가능 타입**: 사람(person) · 상태(status) · 선택(select). 이제 `GROUPABLE_COLUMN_TYPES`(`grouping.ts`)는 하드코딩 Set 이 아니라 **`COLUMN_TYPE_META.groupable`(`src/types/database.ts:51`)에서 파생**한다. 확장하려면 메타의 `groupable: true` 플래그만 바꾼다(엔진/뷰 수정 불필요).

## 관련 파일

| 파일 | 역할 |
|------|------|
| `src/lib/database/grouping.ts` | 그룹화 엔진(순수 함수): `isGroupableColumn`, `getGroupableColumns`, `buildRowGroups`, `resolveRowGroupKeys`, `GROUPABLE_COLUMN_TYPES`(=`COLUMN_TYPE_META.groupable` 파생), `GROUP_UNASSIGNED` |
| `src/types/database.ts` | `COLUMN_TYPE_META.groupable` — 그룹화 가능 타입의 단일 출처 |
| `src/components/database/useRowGroups.ts` | 뷰 공용 훅 — store 읽어 `RowGroup[] \| null` 반환(그룹화 off=null) |
| `src/components/database/GroupSectionHeader.tsx` | 그룹 헤더(chevron+색점+라벨+개수) |
| `src/store/databaseGroupCollapseStore.ts` | 접힘 상태(로컬 전용, **동기화 안 함**) |
| `src/components/database/DatabaseColumnSettingsButton.tsx` | 표시설정 popover 내 "그룹화" 드롭다운 |
| `views/DatabaseListView.tsx` / `DatabaseGalleryView.tsx` / `DatabaseTableView.tsx` | 그룹 렌더 통합 |

## 데이터 모델 & 동기화

- `DatabasePanelState.groupByColumnId: string | null` (`src/types/database.ts`). `emptyPanelState()` 기본 `null`.
- **반드시** `src/lib/schemas/panelStateSchema.ts` 의 `databasePanelStatePartialSchema` 에도 `groupByColumnId` 추가 — 누락 시 동기화 수신에서 잘림(알 수 없는 키 제거, CWE-1321). → [databaseViewPrefsStore.md](databaseViewPrefsStore.md), `wiki/store/schema-versioning.md`
- 설정값은 `setPanelState` → `node.attrs.panelState` JSON → 문서 동기화 경로로 자동 전파(별도 작업 불필요).
- **접힘 상태는 동기화하지 않는다** — 개인 UI 상태로 `databaseGroupCollapseStore`(localStorage)에만 저장. 키 `workspaceId::databaseId::viewKind::groupKey`, 기본 펼침.

## 엔진 규칙 (`buildRowGroups`)

- 그룹 순서: 컬럼 옵션 순서(select/status=`config.options`, person=멤버 순서) → 옵션에 없는 잔여 키(등장 순) → **미지정(항상 마지막)**.
- 행 순서: 입력 순서(이미 필터·정렬 완료) 보존 — 그룹화는 표시 레이어.
- **person 다중값**: 한 행이 여러 멤버 그룹에 모두 표시(노션 방식, 행 중복 허용). 그룹 개수 합계 > 전체 행 수 가능.
- 값 없는 행 → "미지정" 그룹. 행이 없는 옵션 그룹은 표시 안 함.
- 라벨/색은 `filterValueLabels.ts`(`filterDisplayOptionsForColumn`/`resolveFilterValueLabel`) 재사용. person 색은 `personChipColor`.

## 회귀 주의

- `groupByColumnId` 미설정/삭제컬럼/그룹불가타입 → `useRowGroups`가 `null` 반환 → **기존 평면 렌더 그대로**(회귀 0).
- **표 뷰**: 그룹 활성 시 가상화 비활성(그룹별 `<tbody>` 분할과 평면 윈도잉 충돌). fill-drag 의 `rIdx`는 그룹 순서 누적 인덱스(`effectiveRows`)로 통일해야 동작 보존.
- 리스트/갤러리도 그룹 활성 시 가상화 비활성.
