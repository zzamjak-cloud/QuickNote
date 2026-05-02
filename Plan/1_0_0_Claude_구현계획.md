# QuickNote v1.0.0 구현 계획 (Web Editor MVP)

## Context

**왜 이 작업을 하는가**
- 개인용 노션 대체 앱(QuickNote) 구축의 첫 릴리즈.
- 본 v1.0.0은 **웹 에디터 단독 범위**로 한정한다. Tauri 데스크톱 이식, AWS 백엔드, Cognito 인증, 자동 업데이트는 v2.0.0 이후에 별도 계획으로 진행한다.
- 향후 확장(데스크톱·동기화·실시간 협업)을 위해 데이터 모델·상태 관리·블록 구조는 처음부터 확장 가능하게 설계한다.

**현재 상태**
- `/Users/woody/Desktop/AI/QuickNote/`: 현재 비어있는 Git 저장소(브랜치 `jp_work`, 커밋 0개).
- 참고 프로젝트: `TeamScheduler` (React 19 + Vite 7 + TS 5.9 + Tailwind 3 + TipTap 3 + Zustand + lucide-react 스택 검증됨).
- 외부 GitHub 레포 `zzamjak-cloud/QuickNote` 신규 생성 후 push 한다.

**완료 기준**
- 브라우저에서 다음이 가능하다: 페이지 생성·삭제·이름 변경, 블록 단위 텍스트 편집, `/` 슬래시 명령으로 블록 타입 전환, 블록 드래그로 순서 변경, 이미지 삽입(로컬), 체크박스·코드 블록·인용·구분선 사용, localStorage 자동 저장, 새로고침 후 데이터 유지.
- `npm run build` 성공, GitHub `main` 브랜치에 코드와 README가 올라가 있다.

---

## 기술 스택

| 영역 | 선택 | 비고 |
|---|---|---|
| 프레임워크 | React 19 + Vite 7 | TeamScheduler와 동일 |
| 언어 | TypeScript 5.9 (strict) | |
| 스타일 | Tailwind CSS 3 | |
| 에디터 | TipTap 3.x (StarterKit + 커스텀 확장) | ProseMirror 기반 |
| 슬래시 명령 | `@tiptap/suggestion` + `tippy.js` | |
| DnD | `@dnd-kit/core`, `@dnd-kit/sortable` | 페이지 목록·블록 정렬 |
| 상태 관리 | Zustand 4 | persist 미들웨어로 localStorage 동기화 |
| 아이콘 | lucide-react | |
| 코드 하이라이팅 | `@tiptap/extension-code-block-lowlight` + `lowlight` | |
| 이미지 | base64 인라인(MVP) | 향후 S3 업로드로 교체 |
| 테스트 | Vitest + @testing-library/react | 스토어·유틸 위주 |
| 린트 | ESLint 9 (TeamScheduler 설정 포팅) | |
| 패키지 매니저 | npm | TeamScheduler와 동일 |

---

## 파일 구조

```
QuickNote/
├── .github/workflows/ci.yml          # 빌드/린트 CI
├── public/
│   └── favicon.svg
├── src/
│   ├── main.tsx                      # React 엔트리
│   ├── App.tsx                       # 레이아웃 컨테이너
│   ├── index.css                     # Tailwind + 전역
│   ├── types/
│   │   ├── page.ts                   # Page 타입
│   │   └── block.ts                  # Block 종류 enum + JSON 스키마 (TipTap doc)
│   ├── store/
│   │   ├── pageStore.ts              # Zustand: 페이지 목록 + 활성 페이지
│   │   └── settingsStore.ts          # Zustand: 다크모드 등
│   ├── lib/
│   │   ├── id.ts                     # uuid v4
│   │   ├── storage.ts                # localStorage 어댑터 (직렬화/검증)
│   │   └── tiptapExtensions/
│   │       ├── slashCommand.ts       # 슬래시 명령 suggestion
│   │       ├── slashItems.ts         # 슬래시 메뉴 항목 정의
│   │       └── draggableBlock.ts     # 블록 드래그 핸들 확장
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx           # 페이지 목록 + 검색 + 새 페이지 버튼
│   │   │   ├── PageListItem.tsx      # 사이드바 항목 (DnD sortable)
│   │   │   └── TopBar.tsx            # 활성 페이지 제목 + 다크모드 토글
│   │   ├── editor/
│   │   │   ├── Editor.tsx            # TipTap useEditor 래퍼
│   │   │   ├── SlashMenu.tsx         # 슬래시 메뉴 React 렌더러
│   │   │   ├── BlockHandle.tsx       # ⋮⋮ 드래그 핸들 + + 추가 버튼
│   │   │   └── ImageUpload.tsx       # 이미지 base64 인코더
│   │   └── common/
│   │       └── Icon.tsx              # lucide-react 래퍼
│   └── __tests__/
│       ├── storage.test.ts
│       ├── pageStore.test.ts
│       └── id.test.ts
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.node.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── eslint.config.js
├── .gitignore
└── README.md
```

---

## 데이터 모델

### Page
```ts
type Page = {
  id: string;            // uuid v4
  title: string;         // 페이지 제목 (사이드바 표시용)
  icon: string | null;   // 이모지 단일 문자 (선택)
  doc: JSONContent;      // TipTap 문서 JSON (블록 트리 그대로)
  parentId: string | null; // 향후 트리/계층 구조 확장 대비
  order: number;         // 사이드바 정렬용 정수
  createdAt: number;     // epoch ms
  updatedAt: number;     // epoch ms
};
```

### Storage Schema (localStorage 키)
- `quicknote.pages.v1` → `Record<string, Page>`
- `quicknote.activePageId.v1` → `string | null`
- `quicknote.settings.v1` → `{ darkMode: boolean; sidebarWidth: number }`
- `quicknote.schemaVersion` → `1` (마이그레이션 대비)

`parentId`/`order`는 v1에서 단일 레벨로만 사용하지만 필드는 처음부터 두어 v2 트리 확장 시 마이그레이션을 피한다.

---

## 단계별 구현 전략 (Task 분해)

각 Task는 작은 단위로 쪼개고 가능한 곳은 TDD를 적용한다. UI 작업은 브라우저 수동 검증을 명시한다.

### Phase 0: 프로젝트 부트스트랩

#### Task 0.1: Vite + React + TS 초기화
- 파일: 신규 생성 다수
- 단계
  1. `npm create vite@latest . -- --template react-ts` (현재 비어있는 디렉토리에서 실행, 충돌 시 안내에 따라 진행)
  2. `package.json` 정리: 이름 `quicknote`, version `0.1.0`, type module
  3. `npm install`
  4. `npm run dev` 실행하여 기본 화면 확인
  5. 커밋: `chore: scaffold Vite + React 19 + TypeScript`

#### Task 0.2: Tailwind CSS 3 + PostCSS 설정
- 파일: `tailwind.config.js`, `postcss.config.js`, `src/index.css`
- 단계
  1. `npm install -D tailwindcss@3 postcss autoprefixer`
  2. `npx tailwindcss init -p`
  3. `tailwind.config.js`의 `content`를 `["./index.html", "./src/**/*.{ts,tsx}"]`로 설정
  4. `src/index.css`에 `@tailwind base; @tailwind components; @tailwind utilities;`
  5. 다크모드 `class` 전략 사용: `darkMode: 'class'`
  6. `App.tsx`에 임시 Tailwind 클래스로 스타일링 확인
  7. 커밋: `chore: add tailwind css`

#### Task 0.3: ESLint + 타입 설정
- 파일: `eslint.config.js`, `tsconfig.app.json`
- 단계
  1. TeamScheduler `eslint.config.js`를 참고하여 동일한 규칙 포팅 (typescript-eslint, react-hooks, react-refresh)
  2. `tsconfig.app.json`에 `"strict": true`, `"noUncheckedIndexedAccess": true` 추가
  3. `npm run lint` 무결 통과 확인
  4. 커밋: `chore: configure eslint and strict tsconfig`

#### Task 0.4: GitHub 레포 생성 및 첫 push
- 파일: `.gitignore`, `README.md`
- 단계
  1. `.gitignore` 표준(node_modules, dist, .env, .DS_Store) 작성
  2. `README.md` 초안: 프로젝트 개요, 실행 방법, 로드맵
  3. `git checkout -b main` (현재 jp_work에서 main으로 전환)
  4. `git add . && git commit -m "chore: initial scaffold"`
  5. `gh repo create zzamjak-cloud/QuickNote --public --source=. --remote=origin --push`
  6. 커밋: 위 5번에서 자동 push

#### Task 0.5: Vitest 설치
- 파일: `vite.config.ts`, `package.json`
- 단계
  1. `npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom`
  2. `vite.config.ts`에 `test: { environment: 'jsdom', globals: true, setupFiles: './src/__tests__/setup.ts' }` 추가
  3. `src/__tests__/setup.ts`에 `import '@testing-library/jest-dom'`
  4. `package.json` scripts에 `"test": "vitest"`, `"test:run": "vitest run"`
  5. 샘플 테스트 작성/통과 확인
  6. 커밋: `chore: add vitest setup`

---

### Phase 1: 데이터 모델 & 저장소 (TDD)

#### Task 1.1: id 유틸 (TDD)
- 파일: `src/lib/id.ts`, `src/__tests__/id.test.ts`
- 단계
  1. 실패 테스트: `newId()`가 36자 uuid v4 형식 문자열 반환
  2. 구현: `crypto.randomUUID()` 래퍼
  3. 테스트 통과 확인
  4. 커밋: `feat(lib): add id generator`

#### Task 1.2: Page/Block 타입 정의
- 파일: `src/types/page.ts`, `src/types/block.ts`
- 단계
  1. `Page` 타입 작성 (위 데이터 모델 섹션 참조)
  2. `BlockType` enum: `'paragraph' | 'heading1' | 'heading2' | 'heading3' | 'bulletList' | 'orderedList' | 'taskList' | 'codeBlock' | 'blockquote' | 'horizontalRule' | 'image'`
  3. JSONContent는 `@tiptap/core`에서 import
  4. 커밋: `feat(types): define page and block types`

#### Task 1.3: localStorage 어댑터 (TDD)
- 파일: `src/lib/storage.ts`, `src/__tests__/storage.test.ts`
- 단계
  1. 테스트: `loadPages()`가 비어있을 때 `{}` 반환
  2. 테스트: `savePages(map)` 후 `loadPages()`가 동일 객체 반환
  3. 테스트: 손상된 JSON일 경우 `{}` 반환 + console.error
  4. 테스트: 스키마 버전 불일치 시 마이그레이션 함수 호출 (v1에선 no-op)
  5. 구현: 키 상수 + JSON.parse try/catch + 버전 체크
  6. 커밋: `feat(lib): add localStorage adapter for pages`

#### Task 1.4: Zustand 페이지 스토어 (TDD)
- 파일: `src/store/pageStore.ts`, `src/__tests__/pageStore.test.ts`
- 단계
  1. 테스트: `createPage(title)` → 새 페이지가 `pages`에 추가, `activePageId`로 설정
  2. 테스트: `deletePage(id)` → 제거 + activePageId 갱신
  3. 테스트: `renamePage(id, title)` → 제목 변경 + updatedAt 갱신
  4. 테스트: `updateDoc(id, doc)` → doc 갱신 + updatedAt 갱신
  5. 테스트: `reorderPages(orderedIds)` → order 필드 재할당
  6. 구현: zustand `create` + `persist` 미들웨어로 storage.ts 사용
  7. 커밋: `feat(store): add page store with persist`

#### Task 1.5: 설정 스토어
- 파일: `src/store/settingsStore.ts`
- 단계
  1. `darkMode: boolean`, `sidebarWidth: number` 필드
  2. `toggleDarkMode()`, `setSidebarWidth(n)` 액션
  3. persist 적용
  4. `App.tsx`에서 `darkMode` 변화 시 `<html>`에 `dark` 클래스 토글 (useEffect)
  5. 커밋: `feat(store): add settings store`

---

### Phase 2: 레이아웃 & 사이드바

#### Task 2.1: 기본 레이아웃 셸
- 파일: `src/App.tsx`, `src/components/layout/TopBar.tsx`, `src/components/layout/Sidebar.tsx`
- 단계
  1. App: `flex h-screen` 사이드바(좌, 가변 너비) + 메인(우, flex-1)
  2. Sidebar: 상단에 "+ 새 페이지" 버튼, 페이지 목록 placeholder
  3. TopBar: 활성 페이지 제목 표시 + 다크모드 토글
  4. 브라우저 수동 확인 (`npm run dev`)
  5. 커밋: `feat(layout): basic shell with sidebar and topbar`

#### Task 2.2: 페이지 목록 렌더링
- 파일: `src/components/layout/Sidebar.tsx`, `src/components/layout/PageListItem.tsx`
- 단계
  1. pageStore에서 `pages`를 `order` 정렬 후 매핑
  2. PageListItem: 클릭 시 `setActive(id)`, 더블클릭 시 인라인 이름 편집, 우클릭 메뉴(삭제)
  3. 활성 페이지 강조 스타일
  4. 새 페이지 버튼 → `createPage('새 페이지')`
  5. 브라우저 검증: 페이지 추가/삭제/이름변경
  6. 커밋: `feat(sidebar): page list with create/rename/delete`

#### Task 2.3: 사이드바 페이지 DnD 정렬
- 파일: `src/components/layout/Sidebar.tsx`
- 단계
  1. `npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`
  2. `<DndContext>` + `<SortableContext>` 적용
  3. `onDragEnd`에서 `reorderPages` 호출
  4. 브라우저 검증
  5. 커밋: `feat(sidebar): drag-and-drop page reorder`

#### Task 2.4: 사이드바 검색
- 파일: `src/components/layout/Sidebar.tsx`
- 단계
  1. 상단 검색 input (lucide Search 아이콘)
  2. 입력값으로 제목 부분일치 필터(대소문자 무시)
  3. 검색 중에는 DnD 비활성화
  4. 커밋: `feat(sidebar): page search`

---

### Phase 3: TipTap 에디터 통합

#### Task 3.1: TipTap StarterKit 설치 및 기본 에디터
- 파일: `src/components/editor/Editor.tsx`
- 단계
  1. `npm install @tiptap/react @tiptap/starter-kit @tiptap/extension-placeholder @tiptap/extension-link @tiptap/extension-task-list @tiptap/extension-task-item @tiptap/extension-code-block-lowlight lowlight @tiptap/extension-image @tiptap/extension-horizontal-rule`
  2. `useEditor({ extensions: [StarterKit.configure({ codeBlock: false }), Placeholder.configure({ placeholder: '/ 를 입력해 명령 보기...' }), Link, TaskList, TaskItem.configure({ nested: true }), CodeBlockLowlight.configure({ lowlight }), Image, HorizontalRule] })`
  3. `<EditorContent editor={editor} />`을 메인 영역에 렌더
  4. 활성 페이지 변경 시 `editor.commands.setContent(page.doc)` (useEffect)
  5. `editor.on('update')`에서 `pageStore.updateDoc(activeId, editor.getJSON())` (debounce 300ms)
  6. 브라우저: 글자 입력, 새로고침 후 유지 확인
  7. 커밋: `feat(editor): integrate TipTap with autosave`

#### Task 3.2: 에디터 스타일링 (Notion 풍)
- 파일: `src/index.css`, `src/components/editor/Editor.tsx`
- 단계
  1. `.ProseMirror` Tailwind typography 스타일 (또는 `@tailwindcss/typography` 플러그인)
  2. `npm install -D @tailwindcss/typography` 후 `tailwind.config.js` plugins에 추가
  3. 헤딩·리스트·코드 블록 간격, 라인하이트 조정
  4. 다크모드 변형 적용 (`prose dark:prose-invert`)
  5. 커밋: `feat(editor): typography styling`

#### Task 3.3: 페이지 제목 인라인 편집
- 파일: `src/components/editor/Editor.tsx`
- 단계
  1. 에디터 상단에 큰 텍스트 input으로 `page.title` 편집
  2. blur 시 `renamePage` 호출
  3. 새 페이지 생성 직후 자동 포커스
  4. 커밋: `feat(editor): inline title editing`

---

### Phase 4: 슬래시 명령

#### Task 4.1: suggestion 확장 + tippy 설치
- 파일: `src/lib/tiptapExtensions/slashCommand.ts`, `src/lib/tiptapExtensions/slashItems.ts`
- 단계
  1. `npm install @tiptap/suggestion tippy.js`
  2. `slashItems.ts`에 항목 배열 정의: `{ title, description, icon, command(editor) }`
     - paragraph, heading 1/2/3, bullet list, numbered list, todo list, code block, quote, divider, image
  3. `slashCommand.ts`: `Extension.create({ name: 'slashCommand', addOptions: () => ({ suggestion: { char: '/', command: ({ editor, range, props }) => props.command({ editor, range }) } }), addProseMirrorPlugins() { return [Suggestion({ editor: this.editor, ...this.options.suggestion })] } })`
  4. Editor.tsx에서 SlashCommand 확장 등록 + suggestion render에 React 렌더러 연결
  5. 커밋: `feat(editor): slash command extension scaffold`

#### Task 4.2: 슬래시 메뉴 React 컴포넌트
- 파일: `src/components/editor/SlashMenu.tsx`
- 단계
  1. forwardRef로 `onKeyDown` 노출 (↑/↓/Enter)
  2. props로 받은 `items`를 입력값(`query`)으로 필터링
  3. tippy.js 인스턴스에서 React 렌더 (`render` 콜백 안에서 `ReactDOM.createRoot` + ReactRenderer 패턴)
  4. 항목 클릭/Enter 시 `props.command(item)` 호출
  5. 브라우저: `/`, `/heading`, `/todo` 입력 후 메뉴 동작 검증
  6. 커밋: `feat(editor): slash menu UI`

#### Task 4.3: 블록 변환 명령 매핑
- 파일: `src/lib/tiptapExtensions/slashItems.ts`
- 단계
  1. paragraph → `editor.chain().focus().deleteRange(range).setParagraph().run()`
  2. heading1/2/3 → `setHeading({ level })`
  3. bulletList → `toggleBulletList()`
  4. orderedList → `toggleOrderedList()`
  5. taskList → `toggleTaskList()`
  6. codeBlock → `toggleCodeBlock()`
  7. blockquote → `toggleBlockquote()`
  8. horizontalRule → `setHorizontalRule()`
  9. image → ImageUpload 모달 트리거
  10. 각각 브라우저 검증
  11. 커밋: `feat(editor): slash command block transforms`

---

### Phase 5: 이미지 & 코드 블록

#### Task 5.1: 이미지 삽입 (base64)
- 파일: `src/components/editor/ImageUpload.tsx`
- 단계
  1. 슬래시 메뉴에서 image 선택 → 모달 열림
  2. 파일 input(accept image/*) → FileReader로 base64 변환
  3. `editor.chain().focus().setImage({ src: dataUrl }).run()`
  4. 5MB 초과 시 경고 (localStorage 5~10MB 제한 고려)
  5. 드래그&드롭 영역 추가
  6. 커밋: `feat(editor): image upload with base64`

#### Task 5.2: 코드 블록 언어 선택
- 파일: `src/components/editor/Editor.tsx`
- 단계
  1. `npm install lowlight highlight.js`
  2. `import { common, createLowlight } from 'lowlight'` → `createLowlight(common)`
  3. `CodeBlockLowlight.configure({ lowlight, defaultLanguage: 'plaintext' })`
  4. CSS: highlight.js 테마 import (예: `highlight.js/styles/github-dark.css` for dark)
  5. 코드 블록 렌더 확인
  6. 커밋: `feat(editor): syntax highlighting in code blocks`

---

### Phase 6: 블록 드래그 앤 드롭

#### Task 6.1: 블록 호버 핸들 표시
- 파일: `src/components/editor/BlockHandle.tsx`, `src/lib/tiptapExtensions/draggableBlock.ts`
- 단계
  1. ProseMirror 플러그인으로 마우스 위치의 노드 좌표 추적
  2. 좌측 여백에 절대 위치로 ⋮⋮ 핸들 + ➕ 버튼 렌더
  3. ➕ 클릭 시 해당 노드 아래에 빈 paragraph 삽입 후 슬래시 메뉴 자동 호출
  4. 커밋: `feat(editor): hover block handle`

#### Task 6.2: 블록 순서 변경
- 파일: `src/lib/tiptapExtensions/draggableBlock.ts`
- 단계
  1. ⋮⋮ 핸들 mousedown → ProseMirror 트랜잭션으로 노드 절단/이동
  2. 드롭 위치는 마우스 Y 좌표를 ProseMirror `posAtCoords`로 매핑
  3. `tr.delete + tr.insert` 또는 `replaceRangeWith` 사용
  4. 브라우저: 다양한 블록(헤딩, 리스트, 이미지) 정렬 검증
  5. 커밋: `feat(editor): drag-to-reorder blocks`

> 참고: Notion 수준의 완성도가 어렵다면 1차로는 Cmd/Ctrl+Shift+↑/↓ 키보드 단축키로 노드 이동만 구현하고 핸들 기반 DnD는 후속 태스크로 분리해도 된다.

---

### Phase 7: 마무리 & 배포

#### Task 7.1: 다크모드 + 키보드 단축키
- 파일: `src/App.tsx`, `src/components/editor/Editor.tsx`
- 단계
  1. settingsStore.darkMode 변화 시 `document.documentElement.classList.toggle('dark')`
  2. 글로벌 단축키: `Cmd/Ctrl+N`(새 페이지), `Cmd/Ctrl+K`(검색 포커스), `Cmd/Ctrl+/`(다크모드)
  3. 커밋: `feat: dark mode and global shortcuts`

#### Task 7.2: 빌드 검증 & CI
- 파일: `.github/workflows/ci.yml`
- 단계
  1. `npm run build` 성공 확인
  2. `dist/` 결과물을 `npm run preview`로 검증
  3. CI 워크플로: PR/main push 시 install → lint → test:run → build
  4. 커밋: `ci: add build and test workflow`

#### Task 7.3: README 보강 + v1.0.0 태그
- 파일: `README.md`
- 단계
  1. 스크린샷, 단축키, 데이터 저장 위치(localStorage), 알려진 한계, 로드맵 갱신
  2. `git tag v1.0.0 && git push origin v1.0.0`
  3. (선택) GitHub Release 페이지 생성: `gh release create v1.0.0`
  4. 커밋: `docs: README and v1.0.0 release notes`

---

## 주요 외부 라이브러리 메모

- TipTap 3 슬래시 명령은 `@tiptap/suggestion`을 사용하며 React 렌더는 `ReactRenderer` + `tippy.js` 조합이 표준 패턴(공식 노션 클론 예제 참고). React 19와 호환됨이 TeamScheduler에서 검증됨.
- `@tailwindcss/typography`는 ProseMirror 콘텐츠에 자동 스타일링을 제공하지만 코드 블록·체크박스 스타일은 추가 오버라이드가 필요할 수 있음.
- `crypto.randomUUID()`는 모든 모던 브라우저(2022+)에서 사용 가능. fallback 불필요.

---

## 검증 (End-to-End)

릴리즈 직전 다음 시나리오를 브라우저에서 수동 검증한다.

1. `npm install && npm run dev` 후 `http://localhost:5173` 진입.
2. 새 페이지 생성 → 제목 변경 → 본문에 텍스트 입력.
3. `/heading` 입력 후 H1 변환, 한 줄 입력.
4. 새 줄에서 `/todo` → 체크박스 3개 추가 → 1개 체크.
5. `/code` → 자바스크립트 코드 입력, 하이라이팅 확인.
6. `/image` → 5MB 미만 PNG 업로드 → 본문에 이미지 표시.
7. 블록 드래그 핸들로 두 블록 순서 변경.
8. 사이드바에서 페이지 3개 만든 뒤 DnD로 정렬 변경.
9. 검색 input에 일부 제목 입력 → 필터 동작.
10. 다크모드 토글 → 색상 변경.
11. 페이지 새로고침 → 모든 변경사항 유지.
12. `npm run lint && npm run test:run && npm run build` 모두 성공.
13. `gh repo view zzamjak-cloud/QuickNote --web` 으로 origin 반영 확인.

---

## v2.0.0+ 후속 작업 (참고만)

이 계획에는 포함하지 않지만 데이터 모델·구조는 다음을 염두에 두고 설계됨.
- Tauri 2.x + `tauri-plugin-sql` (SQLite)로 데스크톱 이식 → localStorage 어댑터를 SQLite 어댑터로 교체.
- AWS Cognito + Google OAuth + Whitelist Lambda로 인증.
- Lambda + DynamoDB로 페이지 동기화 API. `parentId`/`updatedAt`은 동기화 머지 키로 그대로 사용.
- S3 Pre-signed URL 이미지 업로드 (현재 base64를 마이그레이션).
- GitHub Actions + Tauri updater로 자동 업데이트.

---

## 비고

- 모든 코드 주석·커밋 메시지·UI 텍스트는 한국어, 식별자는 영어 사용 (CLAUDE.md 규칙).
- 진행 중간 로그 파일(`PROGRESS.md` 등)은 만들지 않는다. README와 CHANGELOG로만 기록.
- 각 Task 완료 시 즉시 커밋한다. PR 단위는 Phase 단위(0~7).
