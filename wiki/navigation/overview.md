# 내부 네비게이션 & 뒤로가기

페이지 멘션·페이지 링크·블록 링크 클릭 이동, 브라우저 뒤로가기(history), 헤더 "이전 페이지" 인앱 백스택, 탭 가운데클릭 닫기를 다룬다.

---

## 페이지 멘션 / 페이지 링크 / 블록 링크 클릭 이동

| 종류 | 렌더 | 비고 |
|------|------|------|
| 페이지 멘션(`@`) | `mention.tsx` (`MentionExtension`, class `page-mention`) | 모든 멘션(member/page/database)이 **이 단일 노드**로 처리됨. 멘션 버그는 무조건 `mention.tsx` 한 곳만 본다 (과거 `pageMention.tsx` 죽은 코드가 혼동을 유발해 제거함) |
| 인라인 페이지 링크 | `pageLink.tsx` (`PageLink`) | 회색/아웃라인 버튼 |
| 블록 링크 | `buttonBlock.tsx` (`ButtonBlock`) | "블럭 링크 복사" → 붙여넣기 시 `buttonBlock` 으로 삽입(`useEditorProps.ts`). 내부 `quicknote` 링크는 `parseQuickNoteLink` 로 판별 |

| 인라인 **외부** 웹 링크 | TipTap `Link` mark → `<a href>` | `openOnClick: false` — 클릭 열기는 **`App.tsx` capture** ([아래](#에디터-외부-웹-링크-클릭)) |
| 북마크 블록 | `bookmarkBlock.tsx` | `onClick` → `window.open` (에디터 capture와 별도) |

### 페이지 멘션 클릭 이동 — `pageMentionClick.ts` (document capture mouseup)

페이지 멘션 이동은 **`App.tsx` click 이 아니라** `installPageMentionClickNavigation()` (`src/lib/navigation/pageMentionClick.ts`) 이 담당한다. `App.tsx` 마운트 시 `document` capture **`mousedown`/`mouseup`** 으로 press 정보를 캡처·이동한다.

- **왜 mouseup 인가**: 멘션 삽입 직후 React NodeView 재마운트로 `click` 이벤트가 깨지거나(mousedown/mouseup 타깃 불일치) PM `handleDOMEvents` 만으로는 에디터 인스턴스 경계에서 누락될 수 있다. document mouseup 은 재마운트와 무관하게 수신된다.
- **동작**: `.ProseMirror` 내 `[data-type="mention"][data-id]` 중 페이지 멘션(`mentionKind: page` 또는 `p:` prefix)만 대상. 드래그(4px 초과)는 이동 제외.
- **분기**: `Ctrl/Cmd` → `openPageInNewTab`, 사이드 피크(`[data-qn-peek-editor]`) → `peekNavigate`, 그 외 → `openPageInCurrentTab` + `navigationHistoryStore.pushBack`.
- **`mention.tsx` PM 플러그인**: **mousedown** 에서 멤버(프로필 팝업)·DB(안내 토스트)만 처리. 페이지 멘션은 atom NodeSelection 만 `preventDefault` — **이동은 하지 않는다**.

> **CRITICAL 회귀 주의 — Ctrl+클릭 새 탭 2개**
> PM mousedown 과 document mouseup 양쪽에서 페이지 이동을 실행하면 `openPageInNewTab` 이 두 번 불려 **새 탭이 2개** 열린다. 페이지 이동은 **`pageMentionClick.ts` 한 곳**에서만 한다.

### 에디터 외부 웹 링크 클릭 — `App.tsx onEditorPointerClick`

TipTap `Link` 는 `openOnClick: false`(`useEditorExtensions.ts`) — 편집 중 의도치 않은 navigation 방지. 대신:

- `.ProseMirror a[href]` 클릭 시 `onEditorPointerClick` 이 **`http(s)://`·`mailto:`·`tel:`** 이면 `preventDefault` + `window.open(..., "_blank", "noopener,noreferrer")`.
- **제외**: `[data-bookmark-block]`, `[data-page-link]`, `[data-button-block]` — 각 NodeView/블록이 자체 클릭 처리.
- **제외**: `parseQuickNoteLink(href)` 가 잡히는 내부 quicknote URL — 페이지/블록 링크 흐름에 위임.
- CSS `.ProseMirror a[href] { cursor: pointer }`(`index.css`)만 있고 클릭이 안 되면 **App.tsx 핸들러 누락**을 의심한다(커서만 pointer 인 전형적 증상).

---

## 브라우저 뒤로가기 (history.pushState)

내부 페이지 이동은 브라우저 히스토리를 쌓아, 브라우저 뒤로가기가 앱을 벗어나지 않고 이전 페이지로 돌아오게 한다.

- `openPageInCurrentTab(pageId)` (`internalNavigation.ts`) 가 `pushPageBrowserHistory` 로 `history.pushState(?page=<id>)` 를 호출.
- 복원: `App.tsx` 의 `popstate`/`hashchange` 리스너 `applyLocationLink` 가 URL 의 `?page` 를 읽어 `setActivePage` + `setCurrentTabPage` **직접 호출**(헬퍼 미사용 → 재push 없음).
- 마운트 시 URL 에 `?page` 가 없으면 현재 활성 페이지를 `replaceState` 로 초기 히스토리 엔트리에 기록 → 첫 뒤로가기가 시작 페이지로 정확히 복귀.
- LC 스케줄러 모달(`TabBar.tsx`)은 열릴 때 현재 URL 위에 `qnLCSchedulerModal` history entry 를 하나 쌓는다. 브라우저 뒤로가기는 이 entry 를 소비해 모달만 닫고 앱 밖으로 나가지 않는다.

> **회귀 주의**
> - popstate 복원 경로는 `openPageInCurrentTab` 을 **쓰지 말 것**(직접 setter 사용). 안 그러면 pushState 재진입 루프.
> - 동일 페이지 중복 push 방지: `pushPageBrowserHistory` 가 현재 `?page` 와 같으면 skip.
> - `openPageInNewTab`(새 탭)은 push 하지 않는다.

---

## 헤더 "이전 페이지" 버튼 — 인앱 백스택 (`navigationHistoryStore`)

브라우저 히스토리와 **별개**인 인앱 백스택. `TopBar` 헤더가 소비한다(브라우저 뒤로가기와 둘 다 동작).

- **push 시점**: 멘션(`pageMentionClick.ts`), 페이지 링크(`pageLink`), 블록 링크(`buttonBlock`), DB 인라인→풀페이지(`DatabaseBlockView`), DB 슬래시 커맨드(`dbCommands`).
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

`.page-mention` 은 **웹 링크 스타일** — 버튼 테두리·배경·패딩·`rounded` 없이 본문에 녹는 인라인 텍스트:

| | 라이트 | 다크 |
|---|---|---|
| 글자 | zinc-950 `#18181b` | zinc-50 `#fafafa` |
| 제목 밑줄(`.truncate`) | zinc-200 `#e4e4e7` | zinc-700 `#3f3f46` |

- 글자 크기는 부모 본문 텍스트 상속(`font-size` 미지정), hover 시 `opacity: 0.7`.
- 제목(`.truncate`)에만 `text-decoration: underline` + 연한 밑줄색(컬럼 구분선 톤). `text-underline-offset: 2px`.
- 아이콘은 `<PageIconDisplay icon size="md" className="page-mention-icon" />` 로 렌더 — **이모지·커스텀 이미지(`quicknote-image://`)·Lucide 아이콘을 모두 정상 표시**. (과거 `{icon}` 텍스트 직접 출력이라 이미지 ref 가 `quicknote-image://...` 문자열로 노출되던 버그가 있었음). 아이콘 없으면 `PageIconDisplay` 가 `FileText` 폴백. `.page-mention-icon` `font-size: 1.6rem` 은 **이모지 분기만** 적용.
- **Lucide 컬러**: `PageIconDisplay` 가 `color={lucideIcon.color}` 로 stroke 색을 지정한다. `.page-mention-icon svg` 에 `color: inherit` / `stroke: currentColor` 를 두면 루시드 색이 사라지므로 **금지** — `index.css` 는 `:not(:has(svg))` 로 이모지만 inherit.
- **제목 컬러**: `mention.tsx` 가 `pageStore` 의 `titleColor` 를 구독해 `.truncate` 에 `style={{ color }}` 적용. 페이지 제목 색 변경 시 멘션 제목도 즉시 연동 ([pages/overview.md](../pages/overview.md)).
- 정적 직렬화(`renderHTML`/`renderText`)는 `isPlainEmojiIcon` 가드로 **이모지만** 텍스트로 내보낸다 — 이미지·Lucide ref 가 복사/붙여넣기 시 raw 문자열로 새지 않도록.
- **chevron(`>`) 제거됨** — `mention.tsx` 의 React 노드뷰·`renderHTML` 양쪽에서 삭제.

구형 저장 HTML 폴백(`.member-mention[data-mention-kind="page"]`, `span.member-mention[data-id^="p:"]`)은 별도 규칙으로 남아있다(레거시 회색 칩).

---

## 페이지 트리 팝오버 (`PageSubpageTree`)

`TopBar` 우측 **페이지 트리** 버튼 → `PageSubpageTree` (`hideHeader`).

- 각 행 아이콘은 **`PageIconDisplay`** 로 렌더 — 이모지·`quicknote-image://`·`quicknote-lucide:` 모두 표시.
- 과거 `pageIcon()` 헬퍼가 Lucide ref 를 raw 문자열로 출력하던 회귀와 동일 패턴 — **멘션 수정 이력과 같이 `PageIconDisplay` 단일 경로**를 유지한다.

---

## 핵심 파일

| 파일 | 역할 |
|------|------|
| `src/lib/navigation/internalNavigation.ts` | `openPageInCurrentTab`/`openPageInNewTab`, `shouldOpenInternalLinkInNewTab`, `pushPageBrowserHistory` |
| `src/lib/navigation/quicknoteLinks.ts` | `buildQuickNotePageUrl`/`parseQuickNoteLink`(딥링크 `?page&blockId`/`quicknote://`) |
| `src/store/navigationHistoryStore.ts` | 인앱 백스택(`backStack`, `lastTargetPageId`, `pushBack`/`popBack`/`jumpTo`) |
| `src/lib/navigation/pageMentionClick.ts` | 페이지 멘션 클릭 이동(document capture mousedown/mouseup). `App.tsx` 에서 설치 |
| `src/App.tsx` | `installPageMentionClickNavigation`, `onEditorPointerClick`(에디터 **외부** `<a>` 링크만), `applyLocationLink`(popstate 복원) |
| `src/components/layout/TopBar.tsx` | "이전 페이지" 버튼·브레드크럼·클리어 가드 |
| `src/components/layout/TabBar.tsx` | 탭 가운데클릭 닫기 |
| `src/lib/tiptapExtensions/mention.tsx` | **모든 멘션(member/page/database) 단일 노드** `MentionExtension`. 페이지 멘션 렌더 + PM mousedown(멤버/DB·atom 선택 차단만) |
| `src/lib/tiptapExtensions/pageLink.tsx`, `buttonBlock.tsx` | 인라인 링크 / 블록 링크 이동 |
| `src/components/page/PageSubpageTree.tsx` | 헤더 페이지 트리 팝오버 — 아이콘은 `PageIconDisplay` |
| `src/components/common/PageIconDisplay.tsx` | 페이지 아이콘 공통 렌더 (멘션·트리·사이드바·IconPicker) |
