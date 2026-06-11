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

| 속성 | 대상 노드 |
|------|-----------|
| `backgroundColor` | `paragraph`, `heading`, `blockquote`, `toggle`, `toggleHeader`, `bulletList`, `orderedList`, `taskList`, `listItem`, `taskItem` |
| `blockTextColor` | `paragraph`, `heading`, `blockquote`, `toggle`, `toggleHeader`, **`listItem`, `taskItem`만** (ul/ol 컨테이너 제외) |

**추가 속성**

| 속성 | 타입 | 설명 |
|------|------|------|
| `backgroundColor` | `BlockBgColor` | `"yellow"` \| `"blue"` \| `"gray"` \| … \| null |
| `blockTextColor` | `BlockTextColor` | `"default"` \| `"gray"` \| `"brown"` \| … — HTML `data-text-color` |

> **회귀 주의 — 중첩 글머리 목록**
> 자식 `listItem` 텍스트 색만 바꿔야 하는데 `bulletList` 에 `blockTextColor` 가 있으면 형제·부모 항목까지 연쇄 변색된다. BlockHandles 메뉴는 hover 노드(`listItem` 우선)에만 적용하되, 스키마에서 ul/ol 에 텍스트 색 attr 자체를 금지한다.

`BlockBgColor` 팔레트: yellow, blue, gray, brown, red, orange, green, purple, pink, teal (10가지 + null).

---

## codeBlock

`@tiptap/extension-code-block-lowlight` 기반. 별도 커스텀 파일 없음.
- registry id: `codeBlock`, nodeType: `codeBlock`, toolbar: `text`, dnd: leaf.

---

## callout (callout.ts + CalloutNodeView.tsx)

- TipTap name: `callout`
- group: `block`, content: `block+`, isolating: true, defining: true
- registry id: `callout`, toolbar: `container`, flattenBeforeTypeChange: true
- 렌더: `ReactNodeViewRenderer(CalloutNodeView)`

### addAttributes

| 속성 | 기본값 | HTML 속성 | 설명 |
|------|--------|-----------|------|
| `preset` | `"idea"` | `data-preset` | `CalloutPresetId` — 프리셋 종류 |
| `emoji` | `null` | `data-emoji-override` | 사용자가 직접 지정한 아이콘. null이면 프리셋 기본 이모지 사용 |

### CalloutPresetId 목록

`none` · `empty`(프레임) · `info` · `warning` · `danger` · `idea` · `success` · `note` · `tip`

컬러칩 전용 plain 변형(아이콘 없음): `info-plain` · `warning-plain` · `danger-plain` · `idea-plain` · `success-plain` · `note-plain` · `tip-plain`

### 아이콘 레이아웃 (CalloutNodeView)

- 아이콘을 박스 내부 좌측 상단(`flex items-start gap-3`)에 배치. 크기 `1.8rem`, `drop-shadow-md`로 가독성 보조.
- 아이콘이 없는 프리셋(`empty`, `-plain` 계열)은 아이콘 버튼 자체를 렌더하지 않음.
- 아이콘 클릭 → `IconPickerPanel` 팝업 열림. 이모지 또는 Lucide 아이콘 선택 가능.
- 선택된 아이콘은 `emoji` 속성에 저장(`updateAttributes({ emoji })`). Lucide는 `encodeLucidePageIcon(name, color)` 형식.

### 커맨드

| 커맨드 | 동작 |
|--------|------|
| `setCallout(preset?)` | 새 콜아웃 삽입 |
| `updateCalloutPreset(preset)` | 프리셋 변경. `-plain` 계열은 emoji 유지, 일반 계열은 `emoji: null` 리셋 |
| `updateCalloutEmoji(emoji\|null)` | 아이콘만 교체 |

### 주의사항

- `preset`이 `-plain`으로 끝나면 배경색만 변경, 기존 아이콘 유지.
- `CALLOUT_PRESET_MAP`은 `CALLOUT_PRESETS + CALLOUT_COLOR_CHIP_PRESETS` 합집합으로 구성.
- `presetFromLegacyEmoji(emoji)` — 구 버전 data-emoji 속성으로 저장된 콜아웃을 preset ID로 마이그레이션.

---

## columnLayout / column (columns.ts)

- TipTap name: `columnLayout` (컨테이너), `column` (개별 열)
- group: `block`, content: `column+` / `block+`
- registry id: `columns`, toolbar: `container`, suppressBlockHandle: true
- **컬럼 중첩 허용**: `allowInsideColumns: true` (슬래시 메뉴, DnD, 드래그 가드 모두 허용)

### columnLayout attributes

| 속성 | 기본값 | 설명 |
|------|--------|------|
| `preset` | `"empty"` | `CalloutPresetId` — None/프레임/컬러칩 포함 |

### COLUMN_LAYOUT_PRESETS

`none`(아웃라인 숨김, `[data-preset="none"]` CSS로 border/divider 숨김) + `CALLOUT_PRESETS` 전체.

### updateColumnLayoutPreset 커맨드

`setNodeMarkup(selection.from)` 사용 — `updateAttributes`와 달리 NodeSelection에 포함된 자식 컬럼까지 일괄 적용되는 문제를 방지. 선택된 노드 한 개만 정확히 대상.

### 컬럼 중첩 허용 변경 내역

슬래시 메뉴(`slashMenu/filter.ts`)의 `column` 블록 필터에서 `columnLayout` 제거, `registry.ts`에서 `allowInsideColumns: true`, `editorHandleDrop.ts` columnLayout 드롭 가드 제거.
