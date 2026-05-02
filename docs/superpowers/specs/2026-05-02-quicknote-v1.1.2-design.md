# QuickNote v1.1.2 설계 명세

날짜: 2026-05-02

## 개요

11개 항목의 버그 수정, UX 개선, 기능 추가를 포함한 릴리즈.

---

## 그룹 1 — 즉시 수정

### Task 1: 슬래시 메뉴 "토글 목록" 중복 제거

- **파일**: `src/lib/tiptapExtensions/slashItems.ts`
- **변경**: `slashItems` 배열에서 "토글 목록" 항목 제거. "토글"만 유지.

### Task 2: 토글 블럭 세로 라인 제거 + 접기/펼치기 수정

- **파일**: `src/index.css`, `src/lib/tiptapExtensions/toggle.ts`
- **변경**:
  - `details[data-toggle]` 또는 관련 CSS에서 하위 콘텐츠 좌측 세로선(border-left) 제거
  - `toggle.ts`의 클릭 핸들러에서 `open` 속성 토글 로직 확인 및 수정. TipTap `details` 노드의 `addAttributes`에서 `open` 속성이 실제 DOM에 반영되도록 보장.

---

## 그룹 2 — 슬래시 메뉴 확장

### Task 6: 슬래시 메뉴 "이모지" 항목 추가

- **파일**: `src/lib/tiptapExtensions/slashItems.ts`
- **변경**: `slashItems` 배열에 이모지 항목 추가
  ```ts
  {
    title: '이모지',
    keywords: ['emoji', '아이콘', 'icon'],
    icon: Smile,
    command: ({ editor, range }) => {
      // range 삭제 후 기존 아이콘 팝업 호출
    }
  }
  ```
- 이미 구현된 아이콘 팝업 컴포넌트를 재사용. 팝업 위치는 현재 커서 블럭 기준으로 설정.

### Task 7: ":" + 아이콘명 자동 삽입

- **파일**: `src/lib/tiptapExtensions/emojiShortcode.ts` (신규), `src/components/editor/Editor.tsx`
- **방식**: TipTap `Extension` — `onUpdate` 또는 `InputRule` 패턴
  - `:아이콘명` + Space/Enter 입력 감지
  - 기존 아이콘 시스템의 name→component 매핑 조회
  - 매칭 시 shortcode 텍스트를 삭제하고 해당 아이콘 노드(또는 인라인 텍스트) 삽입
  - 미매칭 시 아무 동작 없음
- 예시: `:체크` → `Check` 아이콘, `:별` → `Star` 아이콘

---

## 그룹 3 — 이미지 편집 단순화

### Task 5: 이미지 편집 모달 및 툴바 단순화

- **파일**: `src/components/editor/ImageBubbleToolbar.tsx`, `src/components/editor/ImageEditModal.tsx`
- **변경**:
  - `ImageBubbleToolbar`: 기존 "편집" 버튼 → 크롭 아이콘(`Crop`) + 아웃라인 아이콘(`Square`) 2개로 교체
  - **크롭 아이콘 클릭**: 기존 크롭 기능만 남긴 단순화된 모달 열기 (아웃라인 설정 UI 제거)
  - **아웃라인 아이콘 클릭**: 모달 없이 즉시 `border: '1px solid #000'` 토글 적용 (현재 아웃라인 있으면 제거, 없으면 추가)
  - `ImageEditModal.tsx`에서 아웃라인 관련 UI 섹션 제거

---

## 그룹 4 — 페이지/블럭 복제 및 메뉴

### Task 8: 우측 상단 페이지 메뉴 버튼

- **파일**: `src/components/layout/TopBar.tsx`, `src/store/pageStore.ts` (또는 settingsStore)
- **UI**: TopBar 우측에 `⋯` (MoreHorizontal) 버튼 추가, 클릭 시 드롭다운 메뉴:

| 메뉴 항목 | 단축키 | 동작 |
|-----------|--------|------|
| 링크 복사 | Cmd+L | 현재 페이지 ID를 `quicknote://page/{pageId}` 형식으로 클립보드 복사 |
| 페이지 복제 | Cmd+D | 현재 페이지 트리 하위에 복제본 생성 |
| 전체 너비 | — | 에디터 최대 너비 토글 (settingsStore) |
| 페이지 삭제 | Delete | 확인 없이 즉시 삭제 (현재 pageStore.deletePage 활용) |

- **단축키**: `Editor.tsx` 또는 `App.tsx`에서 전역 keydown 핸들러로 처리
- **Cmd+D 우선순위**: 에디터 포커스 시 → Task 10 (블럭 복제), 사이드바 포커스 시 → Task 9 (페이지 복제)

### Task 9: 사이드바 페이지 복제 (Cmd+D)

- **파일**: `src/components/layout/Sidebar.tsx`, `src/store/pageStore.ts`
- **변경**:
  - `pageStore`에 `duplicatePage(pageId)` 액션 추가
  - Sidebar에서 포커스된 페이지가 있을 때 `Cmd+D` → `duplicatePage` 호출
  - 복제된 페이지는 원본 바로 아래 형제로 삽입, 이름은 "원본 이름 (복사본)"

### Task 10: 블럭 복제 (Cmd+D)

- **파일**: `src/components/editor/Editor.tsx`
- **변경**:
  - TipTap keymap extension에 `Mod-d` 추가
  - 현재 커서 위치의 최상위 블럭 노드를 복사하여 바로 아래에 삽입
  - 이미 `Mod-d`가 브라우저 기본 동작(북마크)이므로 `preventDefault` 필수

---

## 그룹 5 — 인터랙션 강화

### Task 3: 블럭 드래그로 컬럼 분할

- **파일**: `src/lib/startBlockNativeDrag.ts`, `src/components/editor/Editor.tsx`
- **방식**:
  1. 드래그 시작: 기존 `startBlockNativeDrag` 로직 유지
  2. `dragover` 이벤트에서 마우스 X 좌표가 대상 블럭의 좌측 30% 또는 우측 30% 이내인지 감지
  3. 해당 영역 위에 있을 때: 파랑 점선 세로 선(`border-left` 또는 `border-right`) 시각적 오버레이 표시
  4. 드롭 시:
     - 기존 블럭 + 드래그된 블럭을 `ColumnLayout` 노드로 래핑
     - 드롭 위치(좌/우)에 따라 열 순서 결정
  5. 중앙 40% 드롭: 기존 블럭 이동 동작 유지
- **제약**: 이미 `ColumnLayout` 안에 있는 블럭은 추가 분할 불가

### Task 4: 박스 드래그 다중 블럭 선택

- **파일**: `src/hooks/useBoxSelect.ts` (신규), `src/components/editor/Editor.tsx`
- **방식**:
  1. 에디터 컨테이너 `mousedown` — 에디터 빈 공간(텍스트 노드 아닌 위치)에서 시작 시에만 활성화
  2. `mousemove`: rubber-band 사각형 CSS overlay (`position: fixed`, `border: 2px dashed blue`, `background: rgba(0,100,255,0.05)`)
  3. 사각형과 교차하는 최상위 블럭 노드에 `.block-selected` CSS 클래스 적용 (파란 배경 하이라이트)
  4. `mouseup`: 선택 확정, overlay 제거, 선택된 블럭 목록 state 유지
  5. 선택된 상태에서:
     - `Backspace`/`Delete`: 선택된 블럭 전체 삭제
     - `Cmd+D`: 선택된 블럭 전체 복제
     - 빈 공간 클릭 또는 `Escape`: 선택 해제
  6. 드래그 이동: 선택된 블럭 중 하나를 핸들로 드래그하면 선택된 블럭 전체를 ProseMirror transaction으로 이동

### Task 11: 블럭 핸들 클릭 메뉴 + 드래그 통합

- **파일**: `src/components/editor/BlockHandles.tsx`
- **변경**:
  1. `mousedown` 시 타이머 시작 (150ms)
     - 150ms 이내 `mouseup`: 클릭 → 메뉴 팝업 표시
     - 150ms 초과 + mousemove: 드래그 → 기존 `startBlockNativeDrag` 호출
  2. **클릭 메뉴 항목**:
     - 타입 변경 (텍스트, 제목1~3, 목록, 체크박스, 인용, 코드, 토글, 콜아웃)
     - 복제
     - 삭제
     - 콜아웃 블럭일 경우: 프리셋 서브메뉴 (기존 `💡` 버튼 기능 이전)
  3. **콜아웃 프리셋 버튼 제거**: 핸들 옆 `💡` 버튼 완전 제거

---

## 파일 변경 요약

| 파일 | 변경 유형 |
|------|-----------|
| `src/lib/tiptapExtensions/slashItems.ts` | 수정 (Task 1, 6) |
| `src/lib/tiptapExtensions/toggle.ts` | 수정 (Task 2) |
| `src/index.css` | 수정 (Task 2) |
| `src/lib/tiptapExtensions/emojiShortcode.ts` | 신규 (Task 7) |
| `src/components/editor/ImageBubbleToolbar.tsx` | 수정 (Task 5) |
| `src/components/editor/ImageEditModal.tsx` | 수정 (Task 5) |
| `src/components/layout/TopBar.tsx` | 수정 (Task 8) |
| `src/store/pageStore.ts` | 수정 (Task 8, 9) |
| `src/components/layout/Sidebar.tsx` | 수정 (Task 9) |
| `src/components/editor/Editor.tsx` | 수정 (Task 7, 10, 3, 4) |
| `src/lib/startBlockNativeDrag.ts` | 수정 (Task 3) |
| `src/hooks/useBoxSelect.ts` | 신규 (Task 4) |
| `src/components/editor/BlockHandles.tsx` | 수정 (Task 11) |
