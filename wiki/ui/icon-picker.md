# IconPicker (페이지 아이콘)

페이지·콜아웃·DB 등에서 공통으로 쓰는 아이콘 선택 UI.

## 위치

| 파일 | 역할 |
|------|------|
| `src/components/common/IconPicker.tsx` | 트리거 버튼 + 포털 팝오버. `IconPickerPanel` export(동일 파일) |
| `src/components/common/IconPickerEmoji.tsx` | 이모지 탭 |
| `src/components/common/PageIconDisplay.tsx` | 이모지·`quicknote-image://`·Lucide(`quicknote-lucide:`) 렌더 |
| `src/lib/recentIconStorage.ts` | 통합 탭 "최근 항목" localStorage |
| `src/lib/lucideIconColorStorage.ts` | 루시드 탭 마지막 선택 색 localStorage |
| `src/lib/pageIcon.ts` | `encodeLucidePageIcon` / `decodeLucidePageIcon` |

## 탭 구성

| 탭 id | 라벨 | 내용 |
|-------|------|------|
| `unified` | 통합 | **최근 사용 아이콘** 그리드 (`recentIconStorage`, 최대 24개). 기본 진입 탭 |
| `lucide` | 루시드 | 카테고리·검색·색상 드롭다운 |
| `emoji` | 이모지 | `IconPickerEmoji` |
| `custom` | 커스텀 | 워크스페이스 공유 커스텀 아이콘 (`customIconStore`) |
| `shortcuts` | 단축어 | `:체크` 등 shortcode 목록 |

## 최근 항목 (통합 탭)

- 키: `quicknote.recentPageIcons.v1` (localStorage)
- 이모지·Lucide·커스텀 이미지 ref 선택 시 `pushRecentIcon`으로 맨 앞에 적재
- 통합 탭에서 최근 아이콘 클릭 시 종류별로 분기: Lucide → `onPickLucide`, 이미지 ref → `onPickCustom`, 그 외 → `onPickEmoji`
- 패널은 picker 닫힐 때 언마운트되므로 재오픈 시 `loadRecentIcons()`로 최신 목록 표시

## 루시드 색상 유지

- 키: `quicknote.iconPickerLucideColor.v1` (localStorage)
- 색상 칩 선택 시 `saveLucideIconColor` — 패널 재오픈·탭 전환 후에도 마지막 색 유지
- Lucide 아이콘 저장 형식: `quicknote-lucide:{Name}:{hexWithoutHash}` (`pageIcon.ts`)

## 사용처

- `PageTitleBar` — 페이지 제목 옆 대형 아이콘
- `PageListItem` / 사이드바 — `size="sm"` 인라인
- `CalloutNodeView` — `IconPickerPanel`만 임베드(트리거 없음)
- `DatabaseTableView` 등 DB 뷰 — 행/컬럼 아이콘

## 회귀 주의

- 커스텀·Lucide·이미지 ref를 **문자열 그대로** `{icon}` 출력하지 말 것 — 반드시 `PageIconDisplay` 사용 ([navigation/overview.md](../navigation/overview.md) 멘션·페이지 트리 동일 규칙)
- `.page-mention-icon svg` 에 `color: inherit` 을 두면 Lucide `color` prop 이 무시됨 — 이모지 분기만 inherit ([navigation/overview.md](../navigation/overview.md))
