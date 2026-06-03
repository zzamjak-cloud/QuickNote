# TipTap 확장 목록

## 등록 위치
`src/components/editor/useEditorExtensions.ts`

## 커스텀 확장 (`src/lib/tiptapExtensions/`)

| 확장 | 파일 | 주요 속성 |
|------|------|---------|
| ImageBlock | `imageBlock.tsx` | width, height, src, alt |
| DatabaseLink | `databaseLink.tsx` | databaseId |
| FileBlock | `fileBlock.tsx` | url, name, size |
| VideoBlock | `videoBlock.tsx` | src |
| CodeBlock | `codeBlock.tsx` | language |

## 확장 추가 절차
1. `src/lib/tiptapExtensions/` 에 파일 생성
2. `Node.create({ name, group, atom, addAttributes, renderHTML, parseHTML })` 패턴 사용
3. `useEditorExtensions.ts` 배열에 추가
4. 필요 시 슬래시 메뉴 커맨드 등록

## 주의
- `addAttributes` 누락 시 속성이 doc 에 저장되지 않음
- atom 노드는 `NodeSelection` 으로 선택됨 (텍스트 커서 X)
