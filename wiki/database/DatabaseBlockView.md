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
| `node.attrs.readOnlyTitle` | `boolean` | 제목 편집 잠금 여부 |

## 주요 로직
| 항목 | 설명 |
|------|------|
| 뷰 컴포넌트 스위치 | `view` 값에 따라 `DatabaseTableView`, `DatabaseTimelineView`, `DatabaseGalleryView`를 `Suspense` + `lazy`로 렌더 |
| 더보기 버튼 | `visibleRowLimit` 초과 시 "+ N개 더보기" 버튼 노출, 10개씩 추가하며 자동 스크롤 |
| 삭제 확인 | `deleteConfirmPhrase` 문구 직접 입력 후 `executeDeleteDatabasePermanently` 실행 |
| 보호된 DB | `isProtectedDatabaseId` 판별 후 삭제/수정 차단 |
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
- `panelState`는 node.attrs에 JSON 문자열로 저장된다. `parseDatabasePanelStateJson`으로 파싱 후 사용.
- DB가 없는 상태(`bundleGone`)와 아직 바인딩 안 된 상태(`needsBinding`)를 구분하여 다른 UI를 표시한다.
- `isInsidePeek`는 `editor.view.dom.closest("[data-qn-peek-editor='true']")`로 감지하며, 피크뷰 내부 여부에 따라 다이얼로그 동작이 달라질 수 있다.
