# 에디터 개요

## 기술 기반
- TipTap (ProseMirror 래퍼) + React
- 진입점: `src/components/editor/Editor.tsx`
- 확장 목록: `src/components/editor/useEditorExtensions.ts`

## 주요 파일

| 파일 | 역할 |
|------|------|
| `src/components/editor/Editor.tsx` | 메인 에디터 컴포넌트 |
| `src/components/editor/useEditorExtensions.ts` | TipTap 확장 조합 |
| `src/lib/tiptapExtensions/` | 커스텀 ProseMirror 확장 |
| `src/lib/pm/` | ProseMirror 유틸 함수 |
| `src/lib/editor/` | 에디터 네비게이션·드롭 처리 |

## 커스텀 확장 목록 (`src/lib/tiptapExtensions/`)

| 확장 파일 | 기능 |
|----------|------|
| `imageBlock.tsx` | 이미지 블록 (리사이즈·속성 저장) |
| `databaseLink.tsx` | DB 블록 인라인 삽입 |
| `fileBlock.tsx` | 파일 첨부 블록 |
| `videoBlock.tsx` | 동영상 블록 |
| `codeBlock.tsx` | 코드 블록 |

## 레이아웃 구조
```
Editor.tsx
└─ .overflow-y-auto (스크롤 컨테이너)
   └─ data-qn-editor-column (에디터 컬럼)
      └─ EditorContent (TipTap 렌더 루트)
         └─ view.dom (ProseMirror contenteditable)
```

## 내보내기 (`src/lib/export/`)

페이지 doc → HTML/Markdown 직렬화. 노션 export 형식과 호환되도록 출력해 QN 노션 import 파서(`notionImport/htmlToDoc*`)로 **라운드트립**을 보장한다.

| 파일 | 역할 |
|------|------|
| `pageToHtml.ts` | `pageDocToHtml(doc, options?)`. 블록 → HTML 직렬화 |
| `pageToMarkdown.ts` | `pageDocToMarkdown`. GFM 마크다운(표 `\| col \|`) |
| `pageHtmlZip.ts` | `buildPageHtmlZipBlob`. HTML + `assets/` 를 zip 으로 묶음 |
| `collectDocAssets.ts` | `collectDocAssetRefs`. doc 순회로 자산 ref 수집 |
| `databaseCollection.ts` | `collectDatabaseCollection`. DB → 헤더/행 평탄화 |

- **미처리 블록 직렬화(3.5a)**: callout→`<aside>`, toggle→`<details><summary>`, columns→`div.column-list`, bookmark→`figure.bookmark`, youtube→`figure>iframe`, image+caption→`figure.image>figcaption`, file→링크, button→anchor 문단. 각 출력 구조는 import 파서(`calloutFromAside`/`toggleFromDetails`/`columnLayoutBlocksFromColumnList`/`bookmarkBlockFromAnchor`/`youtubeNodeFromElement` 등)가 읽는 클래스/태그에 맞춤. 기존 블록 출력·default 평탄화는 불변.
- **이미지 첨부 zip(3.5b)**: `buildPageHtmlZipBlob` 이 doc 의 `quicknote-image://`·file ref 바이트를 모아 `assets/{id}.{ext}` 로 묶고 `<img src>` 를 상대경로로 치환 → 노션 import 시 이미지까지 복원. 바이트 실패 ref 는 원본 src 유지(graceful).
- **DB collection 표(3.5b)**: `databaseBlock` → `<table class="collection-content">`(thead 컬럼명 + tbody 셀 텍스트). 셀은 store 의 `formatPlainDisplay` 로 수집. import 파서 `onCollectionTable` 라운드트립.
- **options 후방호환**: `pageDocToHtml(doc, { resolveAssetPath, resolveCollection })`. 두 옵션 **미지정 시 기존 동작(이미지 원본 src·DB 빈/평탄)** 그대로. 호출부: `TopBar.tsx`, `DatabaseRowPeek.tsx`.

## 관련 위키
- [image-resize.md](image-resize.md) — 이미지 리사이즈 구현·회귀 방지
- [slash-menu.md](slash-menu.md) — 슬래시 메뉴
- [extensions.md](extensions.md) — 확장 상세
- [lib-tiptapExtensions.md](lib-tiptapExtensions.md#멘션-prefix-단일진실원-mentionkindts) — 멘션 prefix 단일진실원(`mentionKind.ts`)
