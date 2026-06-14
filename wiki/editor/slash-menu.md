# 슬래시 메뉴

## 관련 파일
| 파일 | 역할 |
|------|------|
| `src/components/editor/SlashMenu.tsx` | 슬래시 메뉴 UI |
| `src/lib/tiptapExtensions/slashCommand.ts` | `/` 트리거 extension |
| `src/lib/tiptapExtensions/slashMenu/menuEntries.ts` | leaf/group 커맨드 정의 |
| `src/lib/blocks/registry.ts` | 블록별 `slashTitles` · `nodeTypes` 정책 |

## 동작
- 에디터에서 `/` 입력 시 트리거
- 커맨드 선택 → TipTap command 실행 (블록 삽입/변환)

## `/이모지` — 인라인 아이콘 삽입

슬래시 **「이모지」** 는 `quicknote:open-emoji-picker` 이벤트로 `Editor.tsx` 의 `IconPickerPanel` 을 연다.

| 선택 종류 | 삽입 노드 | 비고 |
|-----------|-----------|------|
| 이모지 텍스트 | plain text | |
| Lucide | `lucideInlineIcon` | name + color attrs |
| 커스텀 이미지 | **`imageInlineIcon`** | `attrs.src` = `quicknote-image://…` |

> **CRITICAL 회귀 주의 — 커스텀을 `image` 블록으로 삽입 금지**
> 커스텀 탭·업로드 선택을 TipTap `image` 노드로 넣으면 본문에 **원본 크기 이미지**가 붙는다. 반드시 `imageInlineIcon`(약 1.15em, `lucideInlineIcon` 과 동일 규격)을 사용한다.

- 커스텀 업로드·목록·삭제: `useCustomIconUpload` + `customIconStore`(페이지 아이콘 picker 와 동일 인프라)
- 페이지 제목 옆 `IconPicker` 래퍼(`onChange` → `pageStore.setIcon`) 경로는 **변경 없음**

## `/새 페이지`

- `createPage("새 페이지", parentId, { activate: false })` — 제목은 `allocateUniquePageTitle` 적용
- 멘션 attrs: `id: p:{newId}`, `mentionKind: "page"`, **`label` = 실제 부여된 제목**
- 클릭 이동: [navigation/overview.md](../navigation/overview.md)

## 커맨드 추가 시
1. `slashMenu/menuEntries.ts` 또는 `blocks/registry.ts` 에 항목 추가
2. 필요 시 TipTap extension 을 `useEditorExtensions.ts` 에 등록
