# 블록 타입별 상세

TipTap 확장 기반 블록 타입 설명. 각 항목은 `src/lib/tiptapExtensions/` 내 파일에 대응한다.

---

## image (imageBlock.tsx)

- TipTap name: `image`
- group: `block`, atom: false (inline content 없는 leaf이지만 `@tiptap/extension-image` 기반)
- 기반: `Image.extend` (`@tiptap/extension-image`)
- registry id: `image`, toolbar: `media`

**addAttributes**

| 속성 | 기본값 | 설명 |
|------|--------|------|
| `src` | null | `quicknote-image://` 가상 스킴 또는 외부 URL. 브라우저 직접 로드 차단을 위해 `data-qn-src` 로 renderHTML |
| `alt` | null | 대체 텍스트 |
| `width` | null | 픽셀 단위 정수 |
| `height` | null | 픽셀 단위 정수 |
| `id` | null | 내부 고유 ID (`data-id`) |
| `align` | null | `left` / `center` / `right` |
| `caption` | null | 캡션 텍스트 |
| `captionAlign` | null | 캡션 정렬 (`CaptionAlign`) |

**렌더 방식**: `ReactNodeViewRenderer(ImageView)`. `useImageUrl` 훅으로 `quicknote-image://` 스킴을 presigned URL로 비동기 변환. wrapper 클래스 `qn-image-shell`.

**주의**: `src`가 `quicknote-image://` 또는 `quicknote-file://`로 시작하면 renderHTML에서 `src=""`로 출력하고 `data-qn-src`에 원본을 보존한다.

---

## fileBlock (fileBlock.tsx)

- TipTap name: `fileBlock`
- group: `block`, atom: true, draggable: true
- registry id: `file`, toolbar: `media`, excludeFromUniqueId: true

**addAttributes**

| 속성 | 설명 |
|------|------|
| `id` | 내부 고유 ID |
| `src` | `quicknote-file://` 가상 스킴 또는 외부 URL |
| `name` | 파일명 |
| `size` | 바이트 단위 크기 |
| `mime` / `mimeType` / `contentType` | MIME 타입 (3가지 속성 중복 지원) |
| `width`, `height` | 비디오/이미지 크기 |
| `uploading` | 업로드 진행 중 여부 |
| `uploadId` | 업로드 작업 식별자 |
| `uploadError` | 업로드 오류 여부 |
| `align` | 정렬 (기본 `"left"`) |
| `caption` | 캡션 |
| `captionAlign` | 캡션 정렬 (기본 `"left"`) |

**렌더 방식**: `ReactNodeViewRenderer`. mime 타입에 따라 비디오 플레이어 / 오디오 플레이어 / 파일 카드를 렌더한다. `useFileUrl` 훅으로 가상 스킴 해석.

---

## tabBlock (tabBlock.tsx)

- TipTap name: `tabBlock` (탭 컨테이너), `tabPanel` (개별 패널)
- group: `block`, atom: false (컨테이너)
- registry id: `tabs`, toolbar: `container`, suppressBlockHandle: true

**addAttributes** (tabBlock)

| 속성 | 설명 |
|------|------|
| `placement` | 탭 위치: `"top"` \| `"bottom"` \| `"left"` \| `"right"` (기본 `"top"`) |

각 탭 패널은 `tabPanel` 노드로 관리되며 탭 ID, 제목, 아이콘을 attrs로 보유.

**렌더 방식**: `ReactNodeViewRenderer`. 탭 바와 패널을 React로 렌더. 탭 추가/삭제/이름 변경/아이콘 변경 메뉴를 Portal로 body에 렌더(화면 밖 클리핑 방지). `pickTabPanelShells` 헬퍼로 DOM 패널 위치를 계산.

---

## youtubeBlock (youtubeBlock.tsx)

- TipTap name: `youtube`
- group: `block`, atom: true
- 기반: `Youtube.extend` (`@tiptap/extension-youtube`)
- registry id: `youtube`, toolbar: `media`, excludeFromUniqueId: true

**addAttributes**: `@tiptap/extension-youtube` 기본 속성 그대로 사용 (`src`, `start`, `width`, `height` 등).

**렌더 방식**: `ReactNodeViewRenderer(YoutubeEmbedView)`. iframe을 React memo로 래핑해 같은 속성에서 재마운트(동영상 깜빡임) 방지. `getEmbedUrlFromYoutubeUrl`로 embed URL 생성.

---

## bookmarkBlock (bookmarkBlock.tsx)

- TipTap name: `bookmarkBlock`
- group: `block`, atom: true, draggable: true
- registry id: `bookmark`, toolbar: `media`

**addAttributes**

| 속성 | 기본값 | 설명 |
|------|--------|------|
| `href` | `""` | 북마크 URL |
| `title` | `""` | OG title |
| `description` | `""` | OG description |
| `siteName` | `""` | 사이트 이름 |
| `imageUrl` | `""` | OG 이미지 URL |
| `status` | `"ready"` | 메타데이터 fetch 상태 |

**렌더 방식**: `ReactNodeViewRenderer(BookmarkBlockView)`. 마운트 시 `fetchBookmarkMetadata`로 OG 정보를 비동기 fetch해 attrs를 업데이트. `fallbackBookmarkMetadata`로 URL에서 도메인만 추출하는 폴백.

---

## buttonBlock (buttonBlock.tsx)

- TipTap name: `buttonBlock`
- group: `block`, atom: true
- registry id: `button`, toolbar: `text`

**addAttributes**

| 속성 | 기본값 | 설명 |
|------|--------|------|
| `label` | `"버튼"` | 버튼 표시 텍스트 |
| `href` | `""` | 클릭 시 이동할 URL |
| `databaseId` | `""` | 연결된 DB ID (DB 필터 버튼 등) |
| `color` | `"default"` | 버튼 색상 (`ButtonColor`) |

**렌더 방식**: `ReactNodeViewRenderer(ButtonBlockView)`. `span[data-button-block]`으로 renderHTML.

**커맨드**: `insertButtonBlock(label?, href?)` — TipTap command로 등록.

---

## databaseBlock (databaseBlock.ts)

- TipTap name: `databaseBlock`
- group: `block`, atom: true, draggable: true
- registry id: `database`, toolbar: `database`

**addAttributes**

| 속성 | 기본값 | 설명 |
|------|--------|------|
| `databaseId` | `""` | Zustand databaseStore의 DB ID |
| `layout` | `"inline"` | `DatabaseLayout` (`"inline"` \| `"fullPage"`) |
| `view` | `"table"` | `ViewKind` (`"table"` \| `"board"` \| `"gallery"` 등) |
| `panelState` | `emptyPanelState()` JSON | 표시 설정·필터·정렬 상태. 페이지 content에 직렬화됨 |
| `readOnlyTitle` | false | 제목 편집 금지 여부 |

**렌더 방식**: `ReactNodeViewRenderer(DatabaseBlockView)`. `.qn-database-block` wrapper class — 핸들 배치 시 이 rect 기준으로 계산 (`shouldUseDatabaseBlockChrome`).

---

## blockBackground (blockBackground.ts)

- TipTap name: `blockBackground` (GlobalAttributes Extension)
- 블록 타입이 아닌 Extension — 텍스트 계열 블록에 배경/텍스트 색 속성을 추가.

**GlobalAttributes 대상 노드 타입**

`paragraph`, `heading`, `blockquote`, `toggle`, `toggleHeader`, `bulletList`, `orderedList`, `taskList` 등 텍스트 기반 블록.

**추가 속성**

| 속성 | 타입 | 설명 |
|------|------|------|
| `backgroundColor` | `BlockBgColor` | `"yellow"` \| `"blue"` \| `"gray"` \| … \| null |
| `textColor` | `BlockTextColor` | `"default"` \| `"gray"` \| `"brown"` \| … |

`BlockBgColor` 팔레트: yellow, blue, gray, brown, red, orange, green, purple, pink, teal (10가지 + null).

---

## codeBlock

`@tiptap/extension-code-block-lowlight` 기반. 별도 커스텀 파일 없음.
- registry id: `codeBlock`, nodeType: `codeBlock`, toolbar: `text`, dnd: leaf.
