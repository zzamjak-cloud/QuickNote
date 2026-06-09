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
| `callout.ts` | `Callout` | 콜아웃 블록 (이모지 + 본문) |
| `calloutPresets.ts` | — | 콜아웃 프리셋 정의 (색상·이모지 조합) |
| `toggle.tsx` | `Toggle`, `ToggleHeader`, `ToggleContent` | 토글 블록 3종 |
| `columns.ts` | `ColumnLayout`, `Column` | 다단 컬럼 레이아웃 2종. `Column.width` attr(flex-grow 비율)을 `renderHTML`에서 inline `flex: <w> 1 0%`로 렌더(=너비 비율 권위). 비율 설정은 [BlockHandles](./BlockHandles.md) 2컬럼 프리셋 |
| `tabBlock.tsx` | `TabBlock`, `TabPanel` | 탭 블록 2종 |
| `blockquote.ts` | `BlockquoteNoInput` | 인용구 (커스텀 입력 제한) |

### 인라인 노드
| 파일 | Export | 설명 |
|------|--------|------|
| `memberMention.tsx` | `MemberMention` | `@멤버`·`@페이지`·`@DB` 통합 인라인 멘션 노드. **페이지 멘션도 이 확장이 렌더**(class `page-mention`). 클릭 이동 권위는 `App.tsx onMentionClick` → [navigation/overview.md](../navigation/overview.md) |
| `pageLink.tsx` | `PageLink` | 페이지 링크 인라인 노드(회색/아웃라인 버튼) |
| `pageMention.tsx` | `PageMention` | ⚠️ **죽은 코드** — `useEditorExtensions` 에 등록 안 됨. 실제 페이지 멘션은 `memberMention.tsx` 가 처리 |
| `lucideInlineIcon.tsx` | `LucideInlineIcon` | 인라인 아이콘 노드 |
| `dateInline.ts` | `DateInline` | 인라인 날짜 노드 |

### 코드블록
| 파일 | Export | 설명 |
|------|--------|------|
| `markdownCodeBlockPreview.tsx` | `CodeBlockWithMarkdownPreview`, `CodeBlockLowlightWithMarkdownPreview` | 마크다운 프리뷰 코드블록. lowlightApi 유무에 따라 분기 |
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
| `blockBackground.ts` | `BlockBackground` | 블록 배경색 mark/extension |
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
