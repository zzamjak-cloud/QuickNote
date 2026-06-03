# Editor

## 역할
QuickNote의 핵심 에디터 컴포넌트. TipTap 인스턴스를 생성·관리하며 페이지 문서 렌더링, 자동저장, 드래그&드롭, 댓글, 이미지 업로드 등 에디터 전반의 조율을 담당한다.

## 위치
`src/components/editor/Editor.tsx`

## 주요 exports
| 이름 | 종류 | 설명 |
|------|------|------|
| `Editor` | React 컴포넌트 | 에디터 최상위 컴포넌트 |
| `DOC_SYNC_IDLE_MS` | 상수 | 자동저장 idle 대기시간 (3000ms) |
| `DYNAMIC_LAYOUT_INPUT_AUTOSAVE_DEBOUNCE_MS` | 상수 | 동적 레이아웃 입력 자동저장 debounce (1200ms) |

## Props
| 필드 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `pageId` | `string \| null \| undefined` | — | 편집 대상 페이지 ID |
| `bodyOnly` | `boolean` | `false` | 타이틀 바 없이 본문만 렌더 |
| `peek` | `boolean` | `false` | 사이드 피크(좁은 패널) 모드. 댓글을 컴팩트 배지로 표시 |
| `showTailSpacer` | `boolean` | `true` | 본문 하단 spacer 렌더 여부 |
| `bodyPrefix` | `ReactNode` | — | bodyOnly 모드에서 본문 위에 선행 렌더할 영역 |

## 주요 상태 (State)
| 이름 | 타입 | 설명 |
|------|------|------|
| `simpleAlert` | `string \| null` | 단순 경고 다이얼로그 메시지 |
| `mentionRange` | `{from, to} \| null` | `@` 키 입력 시 멘션 모달 위치 범위 |
| `lowlightApi` | `LowlightApi \| null` | 코드 하이라이트 라이브러리 (동적 import) |
| `pasteUrlChoice` | — | URL 붙여넣기 시 처리 방식 선택 상태 |
| `blockDropIndicator` | `BlockDropIndicatorRect \| null` | 블록 드래그 중 드롭 위치 표시 rect |
| `editorTailSpacerPx` | `number` | 에디터 하단 spacer 높이 (px) |
| `boxSelectedStarts` | `readonly number[]` | 박스 선택으로 잡힌 블록 시작 위치 목록 |

## 주요 함수/액션
| 함수명 | 설명 |
|--------|------|
| `handleAtOpenMention` | `@` 키 입력 감지 → `mentionRange` 세팅, 코드블록 내부면 skip |
| `handleEditorInsertImage` | 파일에서 이미지 삽입. 5MB 초과 시 경고 |
| `applyPasteUrlChoice` | URL 붙여넣기 처리 모드 적용 (mention / url / bookmark / embed) |
| `clearColumnDropUi` | 컬럼 드롭 UI CSS 클래스 제거 |
| `clearBlockDropIndicator` | 블록 드롭 인디케이터 초기화 |

## 의존 관계

### 사용하는 훅·유틸
- `useEditorExtensions` — TipTap extension 목록 생성
- `useEditorProps` — TipTap editorProps (이벤트 핸들러) 생성
- `useBoxSelect` — 박스 드래그 선택
- `insertImageFromFile` (`lib/editor/insertImageFromFile`) — 이미지 파일 삽입 로직
- `editorNavigationBridge` — 블록 ID 기반 스크롤 이동
- `pendingNavigation` — 페이지 전환 시 내비게이션 예약
- `editorByPageRegistry` — 페이지별 editor 인스턴스 레지스트리
- `pageScrollMemory` — 스크롤 위치 저장/복원
- `scheduleEditorMutation` — PM 트랜잭션 예약 실행
- `tipTapJsonDocEquals` — doc JSON 동등 비교 (불필요 자동저장 방지)

### 사용하는 스토어
- `usePageStore` — 페이지 문서(doc) 읽기/저장
- `useUiStore` — openCommentThread 등 UI 상태
- `useMemberStore` — 내 멤버 ID
- `useBlockCommentStore` — 블록 댓글 데코레이션 갱신

### 내부에서 렌더하는 주요 컴포넌트
| 컴포넌트 | 설명 |
|----------|------|
| `PageTitleBar` | 페이지 제목 입력 영역 |
| `BlockHandles` | 블록 좌측 드래그 핸들 레이어 |
| `BubbleToolbar` (memo) | 텍스트 선택 시 버블 툴바 |
| `ImageResizeOverlay` (memo) | 이미지/동영상 리사이즈 핸들 |
| `ColumnReorderHandles` | 컬럼 레이아웃 순서 변경 핸들 |
| `TableBlockControls` | 테이블 행/열 제어 UI |
| `SlashMenu` | `/` 슬래시 명령 메뉴 |
| `MentionSearchModal` | `@` 멘션 검색 모달 |
| `PageCommentBar` | 페이지 우측 댓글 사이드바 |
| `PageCoverImage` | 페이지 커버 이미지 |

## 주의사항

- **초기 content는 `EMPTY_EDITOR_DOC` 고정**: store의 page.doc을 `content`로 넘기면 자동저장마다 참조가 바뀌어 `setOptions` 무한 호출이 발생한다. 실제 문서는 별도 effect에서만 주입한다.
- **`shouldRerenderOnTransaction: false`**: PM 트랜잭션마다 React 리렌더를 막아 성능을 보호한다.
- **`lowlightApi` 동적 import**: 코드 하이라이트 라이브러리는 초기 번들에서 분리되어 비동기 로드된다. 로드 전에는 `CodeBlockWithMarkdownPreview`, 완료 후 `CodeBlockLowlightWithMarkdownPreview`로 교체된다. (`[lowlightApi, isFullPageDatabase]` deps로 `useEditor` 재실행)
- **`memo` 래퍼**: `BubbleToolbar`, `ImageResizeOverlay`는 `memo`로 감싸 editor 인스턴스 참조가 바뀔 때만 재마운트한다.
- **`bodyOnly` / `peek` 모드**: 스크롤 메모리 바인딩, 타이틀 바, 댓글 사이드바 표시 여부가 이 두 prop에 따라 분기된다.
- **`isFullPageDatabase` 모드**: editable이 false로 고정되고 UniqueID `updateDocument`가 비활성화된다.
