# 모바일 반응형 UX

웹 단일 코드베이스에 breakpoint + `useViewport` 조건부 렌더로 모바일 대응. **데스크톱(≥lg) 레이아웃은 무변경**이 원칙. 상세 계획: `docs/mobile-ux-plan.md`(gitignore, 로컬).

---

## 기반 (foundation)

| 파일 | 역할 |
|------|------|
| `src/hooks/useViewport.ts` | `useIsMobile()`(<768)·`useIsCompact()`(<1024). matchMedia 구독(안정 참조, SSR-safe). |
| `src/components/ui/MobileDrawer.tsx` | 좌측 오버레이 드로어(Portal + 스크림). |

**원칙: 가능하면 CSS(`md:`/`lg:`)로 분기, 컴포넌트 종류 자체가 달라질 때만 `useViewport`.**

### breakpoint
- **phone** `< md`(768): 모바일 전용 컴포넌트(카드 DB·시트·큰 타깃)
- **compact** `< lg`(1024): 셸 동작(사이드바 drawer·우측패널 오버레이·본문 전폭)
- **desktop** `≥ lg`: 현행 3단 고정

---

## ⛔ z-index 규칙 (헤더 가림 사고)

TopBar/TabBar 는 `z-[350]`. **모바일 드로어·우측 패널 오버레이는 `z-[360]`** (상단 바 위, 다이얼로그 `z-[400]`·Settings `z-[500]` 아래). 드로어를 350 이하로 두면 TopBar/TabBar 가 드로어 위로 뚫고 나와 헤더(워크스페이스 스위처 등)를 가린다.

## ⛔ 터치 탭 → 키보드/포커스 차단 패턴

ProseMirror contenteditable 안의 인터랙티브 요소는 모바일 터치에서 탭이 **커서 배치/에디터 포커스**(가상 키보드)로 처리되어 click 이 안 먹는다. 데스크톱 마우스는 통과 → "모바일만" 깨지는 버그.

- **inline/atom 노드 뷰**(`buttonBlock` 블록 링크): `ReactNodeViewRenderer(View, { stopEvent: () => true })` — PM 이 node view 내부 DOM 이벤트를 무시 → 네이티브 click 동작. (`onMouseDown preventDefault` 는 click 까지 막을 수 있어 비권장.)
- **atom 블록 chrome**(`databaseBlock` 툴바): `NodeViewWrapper contentEditable={false}` — 탭이 에디터를 포커스하지 않음(키보드 안 뜸·스크롤 튐 없음). 입력 폼(input/textarea)은 ancestor contentEditable=false 와 무관하게 동작.

---

## 화면별 적응

| 영역 | 모바일 처리 | 파일 |
|------|------------|------|
| 앱 셸 | 사이드바=드로어(`Sidebar variant="drawer"`), 우측패널(`FavoritesPanel`)=우측 오버레이, 본문 전폭, `h-[100dvh]`, TopBar 햄버거(44px) | `App.tsx`, `Sidebar.tsx`, `FavoritesPanel.tsx`, `TopBar.tsx` |
| 에디터 가독성 | 좌우 거터 = 외부 `px-4`만(내부 `px-12`→`md:px-12`로 모바일 0). 콘텐츠 폭 ~92% | `editorLayout.ts`, `useEditorProps.ts`(ProseMirror class), `Editor.tsx`, `PageCoverImage.tsx`, `DatabaseRowPage.tsx`, `DatabaseRowPeek.tsx`(684) |
| 모달 | 풀스크린(`h-[100dvh]`·`p-0 md:p-4`·`rounded-none md:rounded-xl`) | `SettingsModal.tsx`, `DatabaseManagerDialog.tsx`. 공용 `DialogBase` 는 `max-h-[90dvh] overflow-y-auto` |
| DB 테이블 | 카드 리스트 fallback(`isMobile && view==="table"`) + 그룹화 반영. 행 탭 → RowPeek 풀스크린 | `DatabaseCardListView.tsx`, `DatabaseBlockView.tsx`, `DatabaseFullPageStandalone.tsx`, `DatabaseRowPeek.tsx` |
| 셀/컬럼 피커 | `AnchoredPanelBase` 가 모바일에서 하단 바텀시트(스크림) | `AnchoredPanelBase.tsx` |
| 블록 액션 | hover 그립 대신 **포커스 블록 우상단 ⋯**(selection 구동) → 바텀시트 메뉴(기존 메뉴 재사용) | `BlockHandles.tsx` (`isMobile`·`effectiveBar`) |
| 다단 컬럼 | `<768`에서 `.column-layout` flex-col, 셀 전폭(인라인 `flex` 를 `!important` 오버라이드) | `src/index.css` 미디어쿼리 |
| 워크스페이스 스위처 | `AppSelect portal`(드로어 overflow 클리핑 회피, z-9999) | `WorkspaceSwitcher.tsx` |
| 뷰모드 드롭다운 | 모바일은 hover 없어 `isMobile` 시 버튼 항상 노출 | `DatabaseToolbarControls.tsx` |
| 플로우차트 | 모바일 편집 차단 `canEdit = isEditable && !isMobile`(열람·전체보기·히스토리는 유지) | `FlowchartBlockView.tsx` |
| 댓글 | 모바일 블록 댓글 = `compactComments`(노란 말풍선+카운트, 탭 시 열기) | `Editor.tsx`(`compactComments={peek||isMobile}`), `BlockHandles.tsx` |

---

## 인라인 DB 표시설정 (제목 숨기기·헤더 컬러)

`panelState.hideTitle`·`panelState.headerColor`(zod 스키마 + node attrs·서버 동기화). 표시설정 팝업(`DatabaseColumnSettingsButton`, `layout==="inline"` 한정)에서 토글/스와치. 헤더 컬러는 `CALLOUT_PRESETS`(텍스트 블록 배경 프리셋) 재사용. 렌더: `DatabaseBlockInlineHeader`.

---

## 네비게이션
- 사이드바 페이지 **Ctrl/Cmd(가운데)+클릭 → 신규 탭**(`PageListItem`, `shouldOpenInternalLinkInNewTab`).

## 검증 주의
- 합성 DOM 이벤트로는 ProseMirror 선택·터치 포커스·시트 겹침을 재현 못 함 → **실기기 확인 필수**(Android Chrome / iOS Safari).
- dev 재테스트: stale SW 교체 위해 새로고침 1~2회([pwa/overview.md](../pwa/overview.md)).

## 관련 위키
- [pwa/overview.md](../pwa/overview.md) — 설치·SW·오프라인
- [ui/popup-clipping.md](../ui/popup-clipping.md) — 팝업 위치
- [editor/BlockHandles.md](../editor/BlockHandles.md) — 블록 그립/메뉴
