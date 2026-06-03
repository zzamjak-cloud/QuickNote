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

## 관련 위키
- [image-resize.md](image-resize.md) — 이미지 리사이즈 구현·회귀 방지
- [slash-menu.md](slash-menu.md) — 슬래시 메뉴
- [extensions.md](extensions.md) — 확장 상세
