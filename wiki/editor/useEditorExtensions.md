# useEditorExtensions

## 역할
TipTap 에디터에 등록할 extension 배열을 생성하는 훅. `lowlightApi` 로드 완료 시 CodeBlock extension이 교체되며, 페이지 컨텍스트·멤버 정보에 따라 일부 extension이 동적으로 구성된다.

## 위치
`src/components/editor/useEditorExtensions.ts`

## 주요 exports
| 이름 | 종류 | 설명 |
|------|------|------|
| `useEditorExtensions` | 훅 | extension 배열 반환 |
| `UseEditorExtensionsParams` | 타입 | 훅 파라미터 인터페이스 |

## Props (파라미터)
| 필드 | 타입 | 설명 |
|------|------|------|
| `lowlightApi` | `ReturnType<typeof createLowlight> \| null` | 코드 하이라이트 API (null이면 기본 CodeBlock 사용) |
| `isFullPageDatabase` | `boolean` | 전체 페이지 DB 모드 여부 (UniqueID updateDocument 비활성화) |
| `effectivePageId` | `string \| null \| undefined` | 현재 편집 중인 페이지 ID (PageContext·댓글 데코레이션에 주입) |
| `myMemberId` | `string \| null \| undefined` | 내 멤버 ID (댓글 데코레이션 강조에 사용) |

## 반환값
`useMemo`로 메모이제이션된 TipTap extension 배열. deps: `[lowlightApi, isFullPageDatabase, effectivePageId, myMemberId]`

## 등록된 Extension 전체 목록

### StarterKit 에서 비활성화하고 별도 등록하는 항목
| 비활성화 항목 | 대체 Extension | 이유 |
|--------------|---------------|------|
| `codeBlock` | `CodeBlockWithMarkdownPreview` / `CodeBlockLowlightWithMarkdownPreview` | 첫 프레임 마크다운 노출 방지 |
| `blockquote` | `BlockquoteNoInput` | 커스텀 동작 |
| `orderedList` | `OrderedListMarkdownShortcut` | 마크다운 단축키 통합 |
| `listItem` | `ListItemPermissive` | content를 `block+`으로 완화 — 글머리 안에 이미지·파일·콜아웃 허용 |
| `link` | `Link` (직접 configure) | `isAllowedTipTapLinkUri` 검증 + rel/target 속성 |
| `horizontalRule` | `HorizontalRule` | 별도 등록 |

### 커스텀 Extension (src/lib/tiptapExtensions/)
| Extension | 파일 | 설명 |
|-----------|------|------|
| `PageContext` | `pageContext.ts` | editor 인스턴스에 pageId 주입 |
| `ImageBlock` | `imageBlock.tsx` | 이미지 노드 (width/height/align/caption 속성, ReactNodeView) |
| `YoutubeBlock` | `youtubeBlock.tsx` | YouTube 임베드 노드 |
| `FileBlock` | `fileBlock.tsx` | 파일·동영상·PDF 통합 블록 (mime에 따라 NodeView 분기) |
| `CodeBlockWithMarkdownPreview` / `CodeBlockLowlightWithMarkdownPreview` | `markdownCodeBlockPreview.tsx` | 마크다운 프리뷰 + 선택적 문법 강조 |
| `CodeBlockCopy` | `codeBlockCopy.ts` | 코드블록 복사 버튼 |
| `BlockquoteNoInput` | `blockquote.ts` | 인용구 (커스텀 입력 제한) |
| `OrderedListMarkdownShortcut` | `orderedListShortcut.ts` | 순서 있는 목록 마크다운 단축키 |
| `ListItemPermissive` | `listItemPermissive.ts` | 글머리 항목 content 완화 |
| `MoveBlock` | `moveBlock.ts` | 블록 이동 키보드 단축키 |
| `DeleteCurrentBlock` | `deleteCurrentBlock.ts` | 현재 블록 삭제 단축키 |
| `Callout` | `callout.ts` | 콜아웃 블록. 에디터 렌더는 일반 DOM, 아이콘 클릭은 Editor 레벨 피커로 처리 |
| `Toggle` / `ToggleHeader` / `ToggleContent` | `toggle.tsx` | 토글 블록 3종 |
| `ColumnLayout` / `Column` | `columns.ts` | 컬럼 레이아웃 2종 |
| `TabBlock` / `TabPanel` | `tabBlock.tsx` | 탭 블록 2종 |
| `MentionExtension` | `mention.tsx` | `@멤버`·`@페이지`·`@DB` 통합 인라인 멘션 (단일 노드) |
| `createBlockCommentDecorations` | `blockCommentDecorations.ts` | 블록 댓글 데코레이션 (effectivePageId, myMemberId 주입) |
| `EmojiShortcode` | `emojiShortcode.ts` | `:이모지:` 단축코드 |
| `DatabaseBlock` | `databaseBlock.ts` | 인라인 데이터베이스 블록 |
| `PageLink` | `pageLink.tsx` | 페이지 링크 블록 |
| `ButtonBlock` | `buttonBlock.tsx` | 버튼 블록 |
| `BookmarkBlock` | `bookmarkBlock.tsx` | 북마크 블록 |
| `InsertBeforeBlock` | `insertBeforeBlock.ts` | 블록 앞 삽입 단축키 |
| `LucideInlineIcon` | `lucideInlineIcon.tsx` | 인라인 Lucide 아이콘 |
| `ImageInlineIcon` | `imageInlineIcon.tsx` | 인라인 커스텀 이미지 아이콘(슬래시 `/이모지` 커스텀 탭) |
| `DateInline` | `dateInline.ts` | 인라인 날짜 |
| `BlockBackground` | `blockBackground.ts` | 블록 배경색 |
| `SlashCommand` | `slashCommand.ts` | `/` 슬래시 메뉴 (`filterSlashMenuEntries`, `createSlashRenderer` 연동) |
| `Indentation` | `indentation.ts` | Tab 들여쓰기 |
| `InlineCodeShortcut` | `inlineCodeShortcut.ts` | 인라인 코드 단축키 |
| `BracketAutoClose` | `bracketAutoClose.ts` | 괄호 자동 닫기 |
| `PageContext` | `pageContext.ts` | pageId 저장소 |

### 서드파티 Extension
| Extension | 설명 |
|-----------|------|
| `NodeRange` | 노드 범위 선택 |
| `Placeholder` | 빈 에디터 안내 문구 (`/ 를 입력해 명령 보기...`) |
| `Link` | 링크 (`openOnClick: false` — **클릭 열기는 `App.tsx` `onEditorPointerClick`**, [navigation/overview.md](../navigation/overview.md)) |
| `TaskList` / `TaskItem` | 체크리스트 |
| `Table` / `TableRow` / `TableHeader` / `TableCell` | 테이블 (resizable) |
| `TextStyle` / `Color` / `Highlight` | 텍스트 스타일·색상·강조 |
| `TextAlign` | 텍스트 정렬 (heading, paragraph) |
| `UniqueID` | 블록 고유 ID 자동 부여 |

## 의존 관계
- `editorPolicy.ts` (`EDITOR_UNIQUE_ID_TYPES`) — UniqueID 적용 노드 타입 목록
- `editorUniqueIdFilter.ts` — UniqueID filterTransaction 함수
- `safeUrl.ts` (`isAllowedTipTapLinkUri`) — 링크 허용 URI 검증
- `slashItems.ts` (`filterSlashMenuEntries`) — 슬래시 메뉴 필터
- `slashRenderer.ts` (`createSlashRenderer`) — 슬래시 메뉴 렌더러

## 주의사항
- **`lowlightApi` null 분기**: `lowlightApi`가 null이면 기본 `CodeBlockWithMarkdownPreview`를 사용하고, 로드 완료 시 `CodeBlockLowlightWithMarkdownPreview`로 교체된다. 이 교체가 `useEditor`의 `[lowlightApi, isFullPageDatabase]` deps를 통해 에디터 재생성을 유발한다.
- **`SlashCommand.shouldShow`**: 커서가 codeBlock 내부에 있으면 슬래시 메뉴를 표시하지 않는다.
- **`UniqueID.filterTransaction`**: 짧은 텍스트 입력마다 `appendTransaction`을 생략해 YouTube·임베드 노드의 불필요한 ID 갱신을 방지한다.
- **`isFullPageDatabase`**: 전체 페이지 DB 모드에서는 `UniqueID.updateDocument: false`로 설정한다.
- **ImageBlock.allowBase64: false**: 대용량 data URL을 문서 JSON에 저장하지 않는다. 이미지는 `quicknote-image://` 스킴으로 관리한다.
- **`Link.openOnClick: false`**: TipTap 기본 링크 navigation 은 끈다. `.ProseMirror` 내 `http(s)://`·`mailto:`·`tel:` 인라인 링크 클릭은 **`App.tsx` capture 리스너**(`onEditorPointerClick`)가 `window.open` 으로 처리한다. 북마크·페이지링크·버튼 블록은 NodeView 자체 핸들러.
