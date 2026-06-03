# 이미지 리사이즈

## 관련 파일
- `src/lib/tiptapExtensions/imageBlock.tsx` — ImageBlock 확장 (addAttributes 포함)
- `src/components/editor/ImageResizeOverlay.tsx` — 리사이즈 핸들 오버레이

## 정상 동작 흐름
1. 이미지 클릭 → ProseMirror `NodeSelection` 생성
2. `ImageResizeOverlay.measure` → `editor.view.nodeDOM(sel.from)` 으로 wrapper 획득
3. wrapper 내부 `<img>` 를 `querySelector("img")` 로 찾아 `getBoundingClientRect` 로 핸들 위치 계산
4. 핸들 드래그 → `updateAttributes({ width, height })` 호출
5. `addAttributes` 에 등록된 width/height 가 doc 에 저장
6. NodeView 가 `attrs.width` → `<img width=N style="width:Npx; max-width:100%">` 렌더

## 회귀 증상별 원인

| 증상 | 원인 |
|------|------|
| 핸들이 행 양 끝에 그려짐 | `measure` 가 outer wrapper 만 측정 — inner `<img>` 미측정 |
| 선택 박스가 행 전체 너비 | `ReactNodeViewRenderer(Comp, { as: "span" })` 누락 |
| 새로고침 시 크기 원복 | `addAttributes` 에 width/height 미등록 |
| 핸들 안 보임 | `box.width < 8` early return / `nodeDOM` null |

## 핵심 규칙
- `@tiptap/extension-image` 기본 schema 에 width/height 없음 → `addAttributes` 로 직접 등록 필수
- NodeView wrapper 는 `as: "span"` 지정 (block div 면 row 전체 차지)
- 측정 순서: wrapper → inner `<img>` fallback (wrapper 만 측정하면 구조 변경 시 깨짐)
- 인라인 `style.width` 로 명시 (`max-w-full` 만으로는 사용자 지정 width 보존 불가)
