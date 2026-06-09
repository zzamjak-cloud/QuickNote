# DatabaseBlockView

## 역할
TipTap NodeView로서 에디터 내 데이터베이스 블록을 렌더링하는 최상위 컴포넌트. 뷰 전환, 타이틀 편집, 삭제 확인, 히스토리 다이얼로그, 기존 DB 연결 등 모든 DB 블록 UI를 총괄한다.

## 위치
`src/components/database/DatabaseBlockView.tsx`

## 주요 exports
| 이름 | 종류 | 설명 |
|------|------|------|
| `DatabaseBlockView` | React 컴포넌트 | TipTap `NodeViewProps`를 받는 DB 블록 루트 |

## Props (NodeViewProps 기반)
| 속성 | 타입 | 설명 |
|------|------|------|
| `node.attrs.databaseId` | `string` | 연결된 DB ID |
| `node.attrs.layout` | `"inline" \| "fullPage"` | 인라인 vs 전체 페이지 레이아웃 |
| `node.attrs.view` | `ViewKind` | 현재 뷰 종류 (table/timeline/gallery 등) |
| `node.attrs.panelState` | `string` (JSON) | 직렬화된 `DatabasePanelState` |
| `node.attrs.readOnlyTitle` | `boolean` | 기존 DB 연결 시 자동으로 `true`로 설정되나, 제목 잠금에는 더 이상 사용되지 않음 (하위 호환용 attr) |

## 주요 로직
| 항목 | 설명 |
|------|------|
| 뷰 컴포넌트 스위치 | `view` 값에 따라 `DatabaseTableView`, `DatabaseTimelineView`, `DatabaseGalleryView`를 `Suspense` + `lazy`로 렌더 |
| 더보기 버튼 | `visibleRowLimit` 초과 시 "+ N개 더보기" 버튼 노출. 표시 단위는 `databaseRowLimit.ts` 정책을 따르고, row index count까지 포함해 남은 행을 계산 |
| 새 항목 생성 UX | 각 뷰의 "+ 새 항목"은 `useAddDatabaseRowAndOpen`으로 row 생성 직후 반환된 pageId를 피크뷰로 연다. 필터/표시설정 때문에 새 row가 리스트 하단이나 현재 화면 밖에 생겨도 사용자에게 생성 성공이 즉시 보여야 한다. |
| 삭제 확인 | `deleteConfirmPhrase` 문구 직접 입력 후 `executeDeleteDatabasePermanently` 실행 |
| 보호된 DB | `isProtectedDatabaseId` 판별 후 삭제/수정 차단 |
| 제목 편집 UX | 제목 hover 시 테두리 표시, 클릭 시 포커스. `inlineTitleLocked`는 `isProtectedDatabase`만 참조 (readOnlyTitle은 더 이상 잠금에 사용 안 함). 외부 클릭 시 blur를 위해 `document.addEventListener("mousedown", ..., true)` 캡처 리스너 사용 (tiptap이 mousedown을 가로채므로). |
| 인라인 컨트롤 접기 | `useDatabaseInlineUiPrefsStore`로 컨트롤 영역 접힘 상태 관리 |
| 기존 DB 연결 | `DatabaseBlockLinkExistingDialog`로 다른 DB에 바인딩 |
| 히스토리 | `DatabaseBlockHistoryDialog`로 DB 버전 히스토리 열람·복원 |

## 의존 관계
- **사용하는 스토어**: `useDatabaseStore`, `usePageStore`, `useWorkspaceStore`, `useSettingsStore`, `useNavigationHistoryStore`, `useMemberStore`, `useDatabaseInlineUiPrefsStore`
- **사용하는 뷰 컴포넌트**: `DatabaseTableView`, `DatabaseTimelineView`, `DatabaseGalleryView` (lazy import)
- **사용하는 다이얼로그**: `DatabaseDeleteConfirmDialog`, `DatabaseBlockHistoryDialog`, `DatabaseBlockLinkExistingDialog`
- **사용하는 컨트롤**: `DatabaseToolbarControls`, `DatabaseBlockDataArea`
- **이 컴포넌트를 사용하는 곳**: TipTap extension NodeView 등록 (에디터 내 `database` 노드 타입)

## 주의사항
- `layout === "fullPage"` 일 때 DB 삭제 시 연결된 activePageId도 함께 삭제한다.
- `isProtectedDatabase` 체크를 반드시 삭제·수정 액션 진입부에서 수행해야 한다. 스케줄러/마일스톤/피처 DB는 UI에서 보호되어야 한다.
- 제목 잠금은 `isProtectedDatabase`만으로 판단한다. `readOnlyTitle` attr은 기존 DB 연결 시 자동 세팅되지만 편집 가능 여부에는 영향을 주지 않는다.
- 제목 편집 input의 외부 클릭 감지는 `onBlur`만으로 불충분하다(tiptap이 mousedown을 소비). `useEffect`에서 `isFocused` 시 `document.addEventListener("mousedown", handler, true)` 캡처 리스너를 등록하고 cleanup에서 제거해야 한다. `onBlur`에서 `setIsHovered(false)`도 함께 호출해야 hover 테두리가 즉시 사라진다.
- `DatabaseDirectPage`(`src/components/database/DatabaseDirectPage.tsx`)도 동일한 hover/click 편집 UX와 캡처 리스너 패턴을 따른다.
- `panelState`는 node.attrs에 JSON 문자열로 저장된다. `parseDatabasePanelStateJson`으로 파싱 후 사용.
- DB가 없는 상태(`bundleGone`)와 아직 바인딩 안 된 상태(`needsBinding`)를 구분하여 다른 UI를 표시한다.
- `isInsidePeek`는 `editor.view.dom.closest("[data-qn-peek-editor='true']")`로 감지하며, 피크뷰 내부 여부에 따라 다이얼로그 동작이 달라질 수 있다.
- row index 캐시가 있으면 실제 `pageStore`에 없는 row도 필터·정렬 후보가 될 수 있다. row 열기는 각 뷰에서 `useOpenDatabaseRow`를 통해 `ensurePageContentLoaded`를 먼저 통과해야 한다.
- 새 row 생성 버튼은 `addRow`만 직접 호출하지 말고 `useAddDatabaseRowAndOpen`을 사용한다. 생성 후 피크뷰를 열지 않으면 필터/정렬/표시 개수에 따라 사용자가 버튼 반응을 못 볼 수 있다.
- 서버 데이터 강제 refresh 버튼은 제공하지 않는다. row index 전체 캐시 구조에서는 실수로 수천 row를 다시 받는 UI를 만들지 않는다.
