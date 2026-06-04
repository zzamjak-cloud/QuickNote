# 내부 네비게이션 & 뒤로가기

페이지 멘션·페이지 링크·블록 링크 클릭 이동, 브라우저 뒤로가기(history), 헤더 "이전 페이지" 인앱 백스택, 탭 가운데클릭 닫기를 다룬다.

---

## 페이지 멘션 / 페이지 링크 / 블록 링크 클릭 이동

| 종류 | 렌더 | 비고 |
|------|------|------|
| 페이지 멘션(`@`) | `memberMention.tsx` (class `page-mention`) | **`pageMention.tsx` 의 `PageMention` 은 어디서도 import 안 되는 죽은 코드** — 실제 멘션은 `MemberMention` 이 그림 |
| 인라인 페이지 링크 | `pageLink.tsx` (`PageLink`) | 회색/아웃라인 버튼 |
| 블록 링크 | `buttonBlock.tsx` (`ButtonBlock`) | "블럭 링크 복사" → 붙여넣기 시 `buttonBlock` 으로 삽입(`useEditorProps.ts`). 내부 `quicknote` 링크는 `parseQuickNoteLink` 로 판별 |

### 멘션 클릭의 단일 권위 = `App.tsx onMentionClick`
- `document.addEventListener("click", onMentionClick, true)` — **capture 단계 + `stopPropagation`** 이라 PM 의 atom NodeSelection 경합이나 특정 컨텍스트(DB 행 페이지 등)에서 클릭이 삼켜지던 회귀와 무관하게 항상 멘션 클릭을 받는다.
- 멤버(`m:`)·DB(`d:`) 멘션은 early-return → PM 핸들러(프로필 팝업·안내 토스트)에 위임.
- 페이지 멘션: `Ctrl/Cmd` → `openPageInNewTab`, 사이드 피크 내부 → `peekNavigate`, 그 외 → `openPageInCurrentTab`.
- `memberMention.tsx` 의 PM 플러그인은 **mousedown 에서 멤버 팝업·DB 토스트만** 처리하고, 페이지 멘션은 atom NodeSelection 만 막고 이동하지 않는다(이동은 App.tsx 담당).

> **CRITICAL 회귀 주의 — Ctrl+클릭 새 탭 2개**
> PM mousedown 과 App.tsx click 양쪽에서 페이지 이동을 실행하면, `Ctrl/Cmd+클릭` 시 `openPageInNewTab` 이 두 번 불려 **새 탭이 2개** 열린다. 페이지 이동은 반드시 App.tsx 한 곳에서만 한다.

---

## 브라우저 뒤로가기 (history.pushState)

내부 페이지 이동은 브라우저 히스토리를 쌓아, 브라우저 뒤로가기가 앱을 벗어나지 않고 이전 페이지로 돌아오게 한다.

- `openPageInCurrentTab(pageId)` (`internalNavigation.ts`) 가 `pushPageBrowserHistory` 로 `history.pushState(?page=<id>)` 를 호출.
- 복원: `App.tsx` 의 `popstate`/`hashchange` 리스너 `applyLocationLink` 가 URL 의 `?page` 를 읽어 `setActivePage` + `setCurrentTabPage` **직접 호출**(헬퍼 미사용 → 재push 없음).
- 마운트 시 URL 에 `?page` 가 없으면 현재 활성 페이지를 `replaceState` 로 초기 히스토리 엔트리에 기록 → 첫 뒤로가기가 시작 페이지로 정확히 복귀.

> **회귀 주의**
> - popstate 복원 경로는 `openPageInCurrentTab` 을 **쓰지 말 것**(직접 setter 사용). 안 그러면 pushState 재진입 루프.
> - 동일 페이지 중복 push 방지: `pushPageBrowserHistory` 가 현재 `?page` 와 같으면 skip.
> - `openPageInNewTab`(새 탭)은 push 하지 않는다.

---

## 헤더 "이전 페이지" 버튼 — 인앱 백스택 (`navigationHistoryStore`)

브라우저 히스토리와 **별개**인 인앱 백스택. `TopBar` 헤더가 소비한다(브라우저 뒤로가기와 둘 다 동작).

- **push 시점**: 멘션(App.tsx), 페이지 링크(`pageLink`), 블록 링크(`buttonBlock`), DB 인라인→풀페이지(`DatabaseBlockView`), DB 슬래시 커맨드(`dbCommands`).
- `pushBack(fromPageId, targetPageId?)` — 떠나는 페이지를 스택에 쌓고, 도착 페이지를 `lastTargetPageId` 로 기록.
- **표시**(`TopBar.tsx`): `backStack.length === 1` → "◁ 이전 페이지" 버튼(`showPreviousButton`), `>= 2` → 상단 브레드크럼 트레일(각 단계 `jumpTo`).
- `popBack`/`jumpTo` 는 돌아간 페이지를 `lastTargetPageId` 로 갱신 → 연속 뒤로가기에서도 백스택 유지.

> **CRITICAL 회귀 주의 — 클리어 가드**
> 클리어 useEffect 는 "비-DB 페이지 + `backStack.length === 1`" 일 때 stale 백스택을 지운다(DB 인라인→풀페이지 후 다른 페이지로 이동 시 잔존 정리 목적). 단 **`activeId === lastTargetPageId`(링크/멘션으로 막 도착한 페이지)면 유지**한다. 이 가드가 없으면 멘션·링크로 일반 페이지 이동 직후 백스택이 즉시 지워져 "이전 페이지" 버튼이 안 보인다.
>
> DB 풀페이지(`isFullPageDatabasePage`)는 클리어 대상에서 제외(기존 동작 유지).

---

## 탭 가운데(휠) 클릭으로 닫기 (`TabBar.tsx`)

- 탭 `div` 의 `onAuxClick`(`button === 1`) → `closeTab(idx)`. X 버튼과 동일하게 **탭이 2개 이상일 때만**.
- `onMouseDown`(`button === 1`) → `preventDefault` 로 브라우저 자동 스크롤(autoscroll) 차단.

---

## 페이지 멘션 칩 스타일 (`index.css`)

`.page-mention` 은 블록 링크 버튼(`buttonBlock` 기본 프리셋)과 **동일한 회색 배경 + 아웃라인**으로 통일:

| | 라이트 | 다크 |
|---|---|---|
| 테두리 | zinc-300 `#d4d4d8` | zinc-600 `#52525b` |
| 배경 | zinc-50 `#fafafa` | zinc-800 `#27272a` |
| 글자 | zinc-700 `#3f3f46` | zinc-200 `#e4e4e7` |

`rounded-lg`, `font-medium`. 내부 요소(@·아이콘·chevron)는 `color: inherit`/`currentColor`. 구형 저장 HTML 폴백(`.member-mention[data-mention-kind="page"]`, `span.member-mention[data-id^="p:"]`)도 동일 스타일.

---

## 핵심 파일

| 파일 | 역할 |
|------|------|
| `src/lib/navigation/internalNavigation.ts` | `openPageInCurrentTab`/`openPageInNewTab`, `shouldOpenInternalLinkInNewTab`, `pushPageBrowserHistory` |
| `src/lib/navigation/quicknoteLinks.ts` | `buildQuickNotePageUrl`/`parseQuickNoteLink`(딥링크 `?page&blockId`/`quicknote://`) |
| `src/store/navigationHistoryStore.ts` | 인앱 백스택(`backStack`, `lastTargetPageId`, `pushBack`/`popBack`/`jumpTo`) |
| `src/App.tsx` | `onMentionClick`(멘션 클릭 권위), `applyLocationLink`(popstate 복원) |
| `src/components/layout/TopBar.tsx` | "이전 페이지" 버튼·브레드크럼·클리어 가드 |
| `src/components/layout/TabBar.tsx` | 탭 가운데클릭 닫기 |
| `src/lib/tiptapExtensions/memberMention.tsx` | 페이지 멘션 렌더 + PM mousedown(멤버/DB 만) |
| `src/lib/tiptapExtensions/pageLink.tsx`, `buttonBlock.tsx` | 인라인 링크 / 블록 링크 이동 |
