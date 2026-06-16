# lib/tiptapExtensions — 전체 Extension 목록

## 역할
QuickNote 에디터에 등록되는 커스텀 TipTap extension 모음. 블록 노드, 인라인 노드, 키보드 동작, 데코레이션 등을 포함한다.

## 위치
`src/lib/tiptapExtensions/`

## Extension 목록

### 블록 노드
| 파일 | Export | 설명 |
|------|--------|------|
| `imageBlock.tsx` | `ImageBlock` | 이미지 블록. width/height/align/caption 속성. `quicknote-image://` 비동기 해석 |
| `youtubeBlock.tsx` | `YoutubeBlock` | YouTube 임베드 블록. nocookie 모드 |
| `fileBlock.tsx` | `FileBlock` | 파일·동영상·PDF 통합 블록. mime에 따라 NodeView 분기 |
| `bookmarkBlock.tsx` | `BookmarkBlock` | 웹 북마크 블록. href/title/description/siteName 속성 |
| `buttonBlock.tsx` | `ButtonBlock` | 클릭 가능한 버튼 블록 |
| `databaseBlock.ts` | `DatabaseBlock` | 인라인 데이터베이스 블록 |
| `callout.ts` | `Callout` | 콜아웃 블록. `preset` + `emoji`(사용자 오버라이드, `data-emoji-override`) 속성. 에디터 렌더는 일반 DOM, 아이콘 클릭은 `quicknote:open-callout-icon-picker` → Editor 레벨 `IconPickerPanel` 로 처리. `updateCalloutPreset` / `updateCalloutEmoji` 커맨드 제공 |
| `calloutPresets.ts` | `CALLOUT_PRESETS`, `CALLOUT_COLOR_CHIP_PRESETS`, `CALLOUT_PRESET_MAP`, `COLUMN_LAYOUT_PRESETS` | 콜아웃/컬럼 프리셋 정의. plain 변형(`-plain` 접미사) 8종(컬러칩 전용, emoji 없음). "empty" 라벨 = "프레임". "note" 이모지 = 📓 |
| `CalloutNodeView.tsx` | `CalloutNodeView` | 과거 콜아웃 React NodeView. 대형 import 문서에서 React NodeView 재진입 위험이 있어 현재 에디터 렌더에는 사용하지 않음 |
| `toggle.tsx` | `Toggle`, `ToggleHeader`, `ToggleContent` | 토글 블록 3종 |
| `columns.ts` | `ColumnLayout`, `Column` | 다단 컬럼 레이아웃 2종. `Column.width` attr(flex-grow 비율)을 `renderHTML`에서 inline `flex: <w> 1 0%`로 렌더(=너비 비율 권위). 비율 설정은 [BlockHandles](./BlockHandles.md) 2컬럼 프리셋. **컬럼 중첩 허용** — `allowInsideColumns: true`. `updateColumnLayoutPreset`은 `setNodeMarkup(selection.from)`으로 선택 노드만 대상(중첩 격리). `none` 프리셋은 외곽선과 내부 padding/gap을 제거 |
| `tabBlock.tsx` | `TabBlock`, `TabPanel` | 탭 블록 2종 |
| `blockquote.ts` | `BlockquoteNoInput` | 인용구 (커스텀 입력 제한) |

### 인라인 노드
| 파일 | Export | 설명 |
|------|--------|------|
| `mention.tsx` | `MentionExtension` | `@멤버`·`@페이지`·`@DB` 통합 인라인 멘션 **단일 노드** (`mentionKind` 분기). 페이지 멘션도 이 확장이 렌더(class `page-mention`). **멘션 렌더·PM mousedown(멤버/DB) 수정은 이 파일.** 페이지 **클릭 이동**은 `pageMentionClick.ts` → [navigation/overview.md](../navigation/overview.md). kind/prefix 판정은 모두 `mentionKind.ts` 헬퍼 경유(아래 참조) |
| `mentionKind.ts` | `MENTION_*_PREFIX`, `isPageMention`/`isDatabaseMention`/`isMemberMention`, `hasPagePrefix`/`hasDatabasePrefix`/`hasMemberPrefix`, `stripPagePrefix`/`stripMemberPrefix`, `resolveMentionKindAttr` | **멘션 id prefix(`p:`/`d:`/`m:`) 규약 단일진실원.** 아래 "멘션 prefix 단일진실원" 절 참조 |
| `pageLink.tsx` | `PageLink` | 페이지 링크 인라인 노드(회색/아웃라인 버튼) |
| `lucideInlineIcon.tsx` | `LucideInlineIcon` | 인라인 Lucide 아이콘 노드(슬래시 `/이모지` · 본문) |
| `imageInlineIcon.tsx` | `ImageInlineIcon` | 인라인 커스텀 이미지 아이콘(`quicknote-image://` 등). **슬래시 `/이모지` 커스텀 탭 전용** — `image` 블록으로 삽입하면 원본 크기로 붙는 회귀 |
| `dateInline.ts` | `DateInline` | 인라인 날짜 노드 |

### 코드블록
| 파일 | Export | 설명 |
|------|--------|------|
| `markdownCodeBlockPreview.tsx` | `CodeBlockWithMarkdownPreview`, `CodeBlockLowlightWithMarkdownPreview` | 마크다운 언어 codeBlock — **메인 뷰=마크다운 소스**, 상단 헤더바에 「미리보기」·「복사」 버튼. 미리보기는 `DialogBase` 모달(body 포털=에디터 밖)에서 렌더해 텍스트 자유 선택·부분 복사. 인라인 미리보기 자유선택은 PM 이 DOM 선택을 문서 선택과 강제 동기화해 불가하므로 모달로 우회. 래퍼 `bg-[#26262b]` 로 rounded 모서리 흰틈 제거 |
| `codeBlockLowlightStable.ts` | — | lowlight 안정화 유틸 |
| `codeBlockCopy.ts` | `CodeBlockCopy` | 코드블록 복사 버튼 extension |

### 목록
| 파일 | Export | 설명 |
|------|--------|------|
| `listItemPermissive.ts` | `ListItemPermissive` | 글머리 항목 content를 `block+`으로 완화. 이미지·파일·콜아웃 등 블록 직접 삽입 허용 |
| `orderedListShortcut.ts` | `OrderedListMarkdownShortcut` | 순서 있는 목록 마크다운 단축키 (`1.` 입력) |

### 키보드 동작
| 파일 | Export | 설명 |
|------|--------|------|
| `moveBlock.ts` | `MoveBlock` | 블록 이동 키보드 단축키 |
| `deleteCurrentBlock.ts` | `DeleteCurrentBlock` | 현재 블록 삭제 단축키 |
| `insertBeforeBlock.ts` | `InsertBeforeBlock` | 블록 앞에 새 단락 삽입 단축키 |
| `indentation.ts` | `Indentation` | Tab 들여쓰기 extension |
| `inlineCodeShortcut.ts` | `InlineCodeShortcut` | 인라인 코드 마크다운 단축키 (`\`코드\``) |
| `bracketAutoClose.ts` | `BracketAutoClose` | 괄호 자동 닫기 (`(`, `[`, `{`) |

### 슬래시 메뉴
| 파일 | Export | 설명 |
|------|--------|------|
| `slashCommand.ts` | `SlashCommand` | `/` 트리거 슬래시 명령 extension |
| `slashItems.ts` | `filterSlashMenuEntries`, `SlashMenuEntry` | 슬래시 메뉴 항목 목록 및 필터 함수 |
| `slashMenu/` | — | 슬래시 메뉴 UI 컴포넌트 디렉토리 |

### 스타일·데코레이션
| 파일 | Export | 설명 |
|------|--------|------|
| `blockBackground.ts` | `BlockBackground` | 블록 배경색·블록 텍스트 색 GlobalAttributes (목록은 listItem 단위만 텍스트 색) |
| `blockCommentDecorations.ts` | `createBlockCommentDecorations` | 블록 댓글 PM 데코레이션 (effectivePageId, myMemberId 주입) |

### 유틸·컨텍스트
| 파일 | Export | 설명 |
|------|--------|------|
| `pageContext.ts` | `PageContext` | editor storage에 pageId 저장. 슬래시 명령 등 인스턴스만 받는 콜백에서 페이지 ID 접근용 |
| `emojiShortcode.ts` | `EmojiShortcode` | `:이름:` 이모지 단축코드 변환 |
| `mediaCaption.ts` | `toggleSelectedMediaCaption`, `nextCaptionAlign`, `CaptionAlign` | 미디어 캡션 토글·정렬 유틸 (imageBlock, fileBlock에서 사용) |
| `tabPanelDom.ts` | — | 탭 패널 DOM 유틸 |
| `toggleContentEmpty.ts` | — | 토글 콘텐츠 비어있음 판별 유틸 |

### 테스트
| 위치 | 설명 |
|------|------|
| `__tests__/` | extension 단위 테스트 디렉토리 |

## 주의사항
- **TipTap 버전 일치**: 모든 `@tiptap/*` 패키지 버전이 동일해야 한다. 버전 불일치 시 ERESOLVE 오류 발생.
- **`listItemPermissive`**: StarterKit의 `listItem`을 비활성화하고 이 extension을 대신 등록한다. 글머리 항목 내부에 이미지·파일·콜아웃 등 블록 노드를 직접 넣을 수 있게 content 스펙을 `block+`으로 완화한다.
- **`pageContext`**: `editor.storage.pageContext.pageId`로 접근. 슬래시 명령처럼 editor 인스턴스만 받는 콜백에서 현재 페이지 ID가 필요할 때 사용한다.
- **`createBlockCommentDecorations`**: 팩토리 함수로 extension을 생성. `effectivePageId`와 `myMemberId`가 변경되면 `useEditorExtensions`의 `useMemo` deps 재실행으로 extension이 교체된다.
- **`mediaCaption`**: imageBlock, fileBlock 양쪽에서 공유하는 캡션 관련 유틸. 새 미디어 블록 추가 시 이 파일을 재사용한다.
- **`blockBackground` 텍스트 색**: `blockTextColor` 는 `listItem`/`taskItem` 등 **항목 단위**에만 부여. `bulletList`/`orderedList`/`taskList` ul·ol 에 두면 CSS 상속으로 부모·자식 항목이 함께 변색되는 회귀가 있었음 — 목록 컨테이너에는 `backgroundColor` 만 허용.
- **마크다운 붙여넣기**: `Ctrl/Cmd+Shift+V` → `useEditorProps` → `pasteMarkdownAsDocContent` (`lib/editor/pasteMarkdownAsDoc.ts`) — 클립보드 **GFM 마크다운**을 `notionMarkdownToDoc` 으로 변환해 본문 블록으로 삽입(코드블록 아님). 페이지 **내용 복사**(`pageDocToMarkdown`)는 표를 `| col |` GFM 형식으로 내보내야 이 경로에서 table 블록으로 복원된다 — `lib/export/pageToMarkdown.ts`.

## 멘션 prefix 단일진실원 (`mentionKind.ts`)

멘션 id 의 kind/prefix 판정은 **반드시 `src/lib/tiptapExtensions/mentionKind.ts`(`mentionKind.ts:4-50`) 헬퍼만 거친다.** 과거 `mention.tsx`·`pageMentionClick.ts` 등 8개 파일에 `id.startsWith("p:"/"d:"/"m:")` bare 리터럴이 흩어져 있어 "id prefix vs `mentionKind` attr" 이중진실원이었다.

- prefix 상수: `MENTION_PAGE_PREFIX="p:"`, `MENTION_DATABASE_PREFIX="d:"`, `MENTION_MEMBER_PREFIX="m:"`.
- kind 판정: `isPageMention(id, kindAttr)` / `isDatabaseMention` / `isMemberMention` — `kindAttr` 우선, 없으면 prefix 로 도출. precedence(판정 순서·구성)는 각 호출부 기존 동작을 그대로 보존.
- prefix 제거: `stripPagePrefix` / `stripMemberPrefix`. attr 도출: `resolveMentionKindAttr(id, attr)`(미지정 시 prefix → 없으면 `"page"`).
- 흡수된 호출부(2c535655): `MentionSearchModal.tsx`, `NotionImportTab.tsx`, `comments/mentionItems.ts`, `comments/mentionMemberIds.ts`, `editor/editorHandleDrop.ts`, `notionImport/htmlToDoc.ts`, `notionImport/htmlToDoc/pageMentions.ts`, `slashMenu/menuEntries.ts`.

> **회귀 가드 — bare prefix 리터럴 재도입 금지**
> 새 코드에서 멘션 id 를 `id.startsWith("p:")` / `"d:"` / `"m:"` 또는 `id.slice(2)` 로 직접 판정/절단하지 말 것. 반드시 `mentionKind.ts` 헬퍼를 import 해서 쓴다. bare 리터럴이 다시 흩어지면 이중진실원이 부활한다.
> 검증: `grep -rn 'startsWith("[pdm]:")' src --include="*.ts" --include="*.tsx"` 결과가 `mentionKind.ts` 내부 정의(헬퍼 본문)에 한정되는지 확인.

> **`mention.tsx` 4벌 분기는 통합 안 함 (의도된 미이행)**
> `mention.tsx` 의 NodeView·`renderHTML`·`renderText`·PM `click`(mousedown) 4곳은 **kind 분류만** `mentionKind.ts` 로 단일화했고, **반환 시그니처별 분기 자체는 유지**한다. Record 테이블로 흡수하지 않은 이유: 4곳의 반환 타입이 상이(React 엘리먼트 / PM DOM 배열 / 문자열 / boolean)하고, NodeView 는 반응형 store 구독, mousedown 은 네비 핫패스라 통합 시 회귀 위험이 크다. behavior-preserving 리팩토링 범위는 kind 판정 헬퍼화까지다.
