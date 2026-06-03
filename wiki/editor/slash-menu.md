# 슬래시 메뉴

## 관련 파일
- `src/components/editor/SlashMenu.tsx` — 슬래시 메뉴 UI
- `src/lib/editor/slashCommands.ts` (또는 유사 경로) — 커맨드 목록 정의

## 동작
- 에디터에서 `/` 입력 시 트리거
- 커맨드 선택 → TipTap command 실행 (블록 삽입/변환)

## 커맨드 추가 시
1. 커맨드 목록 파일에 항목 추가 (label, icon, command 함수)
2. 필요 시 대응 TipTap 확장을 `useEditorExtensions.ts` 에 등록
