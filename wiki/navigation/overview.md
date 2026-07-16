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

### 공개 워크스페이스 교차 멘션/링크/피크

공개(`Workspace.access` 에 `EVERYONE` view/edit) shared 워크스페이스의 페이지·DB를 현재 워크스페이스에서 멘션·링크·연결할 수 있다. 팀/멤버 전용 통제 워크스페이스와 LC 스케줄러 공용 워크스페이스는 교차 후보에서 제외한다(`isPublicCrossWorkspace`, `src/lib/crossWorkspaceSearch.ts`).

**후보 로딩 (`crossWorkspaceSearch.ts`)**
- `loadCrossWorkspacePageCandidates` / `loadCrossWorkspaceDatabaseCandidates` = 로컬 + 공개 외부 워크스페이스. 외부 로딩은 워크스페이스별 `Promise.allSettled` 격리 — 한 곳이 실패해도 로컬+나머지는 유지(picker 가 통째로 비지 않음).
- 외부 페이지는 **`listPages`(일반 페이지 + DB 행 포함)** 로 가져온다. `listPageMetas` 는 DB 행을 제외하므로 DB 중심 워크스페이스에서 후보가 0개가 되는 것을 피한다(로컬 멘션이 store의 DB 행을 포함하는 것과 대칭).
- 캐시 우선순위: ① 5분 `pageCache` ② **워크스페이스 방문 시 적재된 스냅샷 캐시**(`readWorkspaceSnapshotPages` — 네트워크 0, 첫 검색 지연 제거) ③ 미방문만 `listPages` 네트워크 페치.
- `Workspace.access`/`myEffectiveLevel` 은 서버가 소문자(`everyone`/`edit`)로 내려도 클라이언트 `normalizeAccessEntry`(`workspaceApi.ts`)가 흡수한다(대소문자 무관).

**멘션 검색 (`MentionSearchModal` → `mentionItems.ts`)**
- 검색 UI 는 **단일 통합 입력** — 페이지·구성원을 한 필드에서 함께 검색한다(과거 페이지/구성원 입력 분리는 불편해서 통합, 결과 순서는 `loadMergedMentionItems` 반환 순서 그대로: 멤버 → 페이지).
- 멤버 + 페이지(로컬·교차)만. **DB(데이터베이스 자체)는 멘션 후보 아님** — DB 연결은 DB Link/Page Link/컬럼 소스 UI에서만.
- 각 페이지 항목 subtitle 에 소속 **워크스페이스 이름**을 표시(동명 페이지 구분).

**클릭 이동 — 워크스페이스 전환이 아니라 피크(peek)**
- 타 워크스페이스 페이지를 링크/버튼/멘션으로 클릭하면 `internalNavigation.ts` 가 **워크스페이스를 전환하지 않고** `ensurePageContentLoaded(ws)` 로 본문만 적재해 **피크 팝업**(`DatabaseRowPeek`)으로 띄운다(`openCrossWorkspacePeek`). 현재 탭 구조를 건드리지 않는다.
- 피크 좌상단 버튼이 **"이 워크스페이스로 이동"**(`LogIn` 아이콘)으로 바뀌고, 클릭 시 `navigateToWorkspacePage` 가 실제 전환 + 착지(`requestCrossWorkspaceLanding`)를 수행한다.
- **피크 내부 이동(`peekNavigateToPage`)**: 타 워크스페이스 페이지를 피크로 연 뒤 그 안의 멘션·페이지링크·하위 페이지 트리를 클릭하면, 대상도 같은 타 워크스페이스 소속이라 로컬 store 에 없다. `peekNavigate` 를 그대로 부르면 `DatabaseRowPeek` 가 `pages[id]` 를 못 찾아 **피크가 즉시 닫히고 무반응**이 된다. 따라서 로컬에 없으면 현재 피크 중인 페이지의 workspaceId 로 `ensurePageContentLoaded` 한 뒤 이동한다. (회귀 주의: 피크 내부 네비게이션은 `peekNavigate` 직접 호출이 아니라 `peekNavigateToPage` 를 거쳐야 한다 — `pageMentionClick.ts`/`pageLink.tsx`/`DatabaseRowPeek` 하위 트리.)
- 타 워크스페이스 본문 적재는 storeApply 워크스페이스 가드를 우회해 직접 `pageStore` 에 넣는다(`applyRemotePageToStoreCrossWorkspaceAware` / `ensurePageContentLoaded`). 가드는 `page.workspaceId` 기준 판정이므로 **우회 판정도 가져온 페이지의 실제 workspaceId 기준**으로 한다(요청 workspaceId 가 어긋나도 안전). workspaceId 가 달라 사이드바·동기화 대상에선 자동 제외된다.
  - DB 행을 `useOpenDatabaseRow` 로 열 때 workspaceId 폴백 순서: `page.workspaceId` → rowIndex → **DB 번들 `meta.workspaceId`** → currentWorkspaceId.
- **타 워크스페이스 페이지·인라인 DB 는 협업(Yjs)을 비활성화한다.** `useCollabSession`/`useDatabaseCollabSession` 이 `page.workspaceId`(또는 DB 번들 `meta.workspaceId`) ≠ 현재 워크스페이스면 `enabled=false` 로 게이트한다. 안 그러면 빈 Y.Doc 바인딩이 우회 적재한 본문을 덮어써(**잠깐 보였다 사라짐**) 타 워크스페이스 룸 WebSocket 연결이 404 로 실패한다(라이브 회귀). 같은 워크스페이스 협업엔 영향 없음.

**자기설명적 링크 (`quicknoteLinks.ts`)**
- `buildQuickNotePageUrl` 은 `ws`(원본 워크스페이스, 기본값=현재 워크스페이스) 파라미터를 싣는다. 타 워크스페이스에 붙여넣어 만든 버튼(`buttonBlock`)을 클릭하면 이 `ws` 로 어느 워크스페이스 페이지인지 식별한다. ⚠️ 기존(ws 없이) 복사된 링크는 다시 복사해야 한다.
- 붙여넣기 시 버튼 라벨은 즉시 로컬 제목(없으면 placeholder)으로 만들고, 타 워크스페이스면 `fetchPageById(ws)` 로 제목을 비동기 조회해 라벨을 갱신한다(`useEditorProps` `applyCrossWorkspaceButtonLabel`).

### 페이지 멘션 클릭 이동 — `pageMentionClick.ts` (document capture mouseup)

페이지 멘션 이동은 **`App.tsx` click 이 아니라** `installPageMentionClickNavigation()` (`src/lib/navigation/pageMentionClick.ts`) 이 담당한다. `App.tsx` 마운트 시 `document` capture **`mousedown`/`mouseup`** 으로 press 정보를 캡처·이동한다.

- **왜 mouseup 인가**: 멘션 삽입 직후 React NodeView 재마운트로 `click` 이벤트가 깨지거나(mousedown/mouseup 타깃 불일치) PM `handleDOMEvents` 만으로는 에디터 인스턴스 경계에서 누락될 수 있다. document mouseup 은 재마운트와 무관하게 수신된다.
- **동작**: `.ProseMirror` 내 `[data-type="mention"][data-id]` 중 페이지 멘션만 대상. 멤버/DB 판정은 `mentionKind.ts` 의 `isMemberMention`/`isDatabaseMention`, pageId 추출은 `stripPagePrefix` 로 한다(bare `startsWith("m:"/"d:"/"p:")` 직접 분기 금지 → [editor/lib-tiptapExtensions.md](../editor/lib-tiptapExtensions.md#멘션-prefix-단일진실원-mentionkindts)). 드래그(4px 초과)는 이동 제외.
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
- 초기 진입 URL 에 `?page` 가 있으면 기존 탭/마지막 페이지가 URL 을 덮지 못하게 pending target 으로 잡고, page meta 가 아직 로드 전이면 최대 20초 동안 store 구독으로 대기한 뒤 연다.
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

- 글자 크기와 행간은 부모 본문 텍스트 상속(`font-size` 미지정, `line-height: inherit`), inline 정렬은 `vertical-align: middle`, hover 시 `opacity: 0.7`.
- 제목(`.truncate`)에만 `text-decoration: underline` + 연한 밑줄색(컬럼 구분선 톤). `text-underline-offset: 2px`.
- 아이콘은 `<PageIconDisplay icon size="md" className="page-mention-icon" />` 로 렌더 — **이모지·커스텀 이미지(`quicknote-image://`)·Lucide 아이콘을 모두 정상 표시**. (과거 `{icon}` 텍스트 직접 출력이라 이미지 ref 가 `quicknote-image://...` 문자열로 노출되던 버그가 있었음). 아이콘 없으면 `PageIconDisplay` 가 `FileText` 폴백. `.page-mention-icon` 은 `width/height/font-size: 1em` 으로 본문 텍스트 높이 안에 고정해 아이콘이 행간을 키우지 않게 한다.
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

## 즐겨찾기(Favorites) 이동·제목 표시 (`FavoritesList.tsx`)

즐겨찾기는 `settingsStore.favoritePageIds`(순서) + `favoritePageMetaById`(표시용 메타 캐시). 페이지 id 는 전역 고유(`crypto.randomUUID`)라 워크스페이스 간 충돌하지 않는다.

**클릭 이동** — 로컬 스냅샷의 `workspaceId` 를 신뢰하지 않고, `ensurePageContentLoaded({pageId})`(workspaceId 미지정 → `fetchPageByIdOnly`) 로 **서버가 실제 소속 워크스페이스로 해석**해 본문을 적재한 뒤 판정한다.
- 로드된 페이지의 `workspaceId === currentWorkspaceId`(또는 미상) → `openPageInCurrentTab`.
- 다른 워크스페이스 → 스냅샷 workspaceId 를 실제 값으로 교정 + `requestCrossWorkspaceLanding` 후 `setCurrentWorkspaceId`(본문이 이미 store 에 있어 landing 이 first-root 대신 목표로 착지).
- (구버전: `pages[pageId]` 폴링 + 6초 타임아웃 후 즐겨찾기 자동 제거 → 무반응·지연·**오삭제**. 폐기.)

**제목 표시 — 왜 이름 변경 전 옛 제목이 뜨는가**
- 표시 우선순위: ① 라이브 `pages[pageId].title`(현재 워크스페이스 로드분) → ② 서버 교정된 `favoritePageMetaById` 캐시 → ③ in-memory 워크스페이스 스냅샷.
- `favoritePageMetaById` 는 즐겨찾기 등록 시점 1회 스냅샷이라 **이름 변경 전 제목이 고착**될 수 있다. 특히 페이지가 현재 워크스페이스에 로드 안 된 상태(다른 워크스페이스 진입)에서 이 캐시가 그대로 노출돼 워크스페이스마다 제목이 달라 보였다.
- 교정 경로(3중, 모두 `updateFavoritePageMeta` `same` 가드로 중복 쓰기 없음):
  - `renamePage`(pageStore) 가 즐겨찾기면 캐시 제목 즉시 갱신.
  - effect(1): 현재 워크스페이스에 로드된 페이지의 라이브 제목으로 캐시 갱신(`pages` 의존, 경량 동기).
  - effect(2): **로드 안 된 즐겨찾기는 서버 `fetchPageByIdOnly` 로 권위 제목을 세션 1회 조회해 캐시 교정**(pageId 당 1회, `pages` 미의존 → 타이핑마다 조회 안 함).
- ⚠️ in-memory/persist 워크스페이스 스냅샷은 stale 할 수 있어 **제목 교정 소스로 신뢰 금지** — 스냅샷 기반 교정은 옛 제목을 되살리는 회귀를 냈다. 권위 소스는 라이브 pageStore 또는 서버.
- ⚠️ 배포 후에도 사용자 화면에서 계속 옛 제목이면 **stale SW precache**(옛 번들)를 의심한다 → [pwa/overview.md](../pwa/overview.md). 새 브라우저(무 SW)로 라이브 검증하면 코드/캐시 문제를 구분할 수 있다.

## 목차·댓글·검색 스크롤 (`editorNavigationBridge.ts`)

우측 목차 클릭 이동은 `scrollToOutlineHeadingIndex` → **`scrollToBlockPosition`(DOM 직접 스크롤)** 을 쓴다. PM/TipTap 의 `.scrollIntoView()` 는 에디터 `handleScrollToSelection`(`useEditorProps.ts`)이 전면 `true` 를 반환해(타이핑 자동스크롤·복원 보호) **무력화**되므로, 선택만 설정하고 실제 뷰포트 이동은 DOM 스크롤로 한다. 댓글·검색·블록 링크 이동과 동일 경로다. (회귀 주의: 목차가 커서만 잡히고 스크롤이 안 되면 `.scrollIntoView()` 직접 호출을 의심.)

---

## 핵심 파일

| 파일 | 역할 |
|------|------|
| `src/lib/navigation/internalNavigation.ts` | `openPageInCurrentTab`/`openPageInNewTab`, `shouldOpenInternalLinkInNewTab`, `pushPageBrowserHistory` |
| `src/components/layout/FavoritesList.tsx` | 즐겨찾기 목록·이동·제목 교정(서버 권위 조회) |
| `src/lib/editor/editorNavigationBridge.ts` | 목차/댓글/검색/블록링크 스크롤(DOM 직접). PM `scrollIntoView` 무력화 우회 |
| `src/lib/navigation/quicknoteLinks.ts` | `buildQuickNotePageUrl`/`parseQuickNoteLink`(딥링크 `?page&blockId`/`quicknote://`) |
| `src/lib/crossWorkspaceSearch.ts` | 공개 워크스페이스 교차 페이지/DB 후보 로딩·선택 후보 메타 기억 |
| `src/store/navigationHistoryStore.ts` | 인앱 백스택(`backStack`, `lastTargetPageId`, `pushBack`/`popBack`/`jumpTo`) |
| `src/lib/navigation/pageMentionClick.ts` | 페이지 멘션 클릭 이동(document capture mousedown/mouseup). `App.tsx` 에서 설치 |
| `src/App.tsx` | `installPageMentionClickNavigation`, `onEditorPointerClick`(에디터 **외부** `<a>` 링크만), `applyLocationLink`(popstate 복원) |
| `src/components/layout/TopBar.tsx` | "이전 페이지" 버튼·브레드크럼·클리어 가드 |
| `src/components/layout/TabBar.tsx` | 탭 가운데클릭 닫기 |
| `src/lib/tiptapExtensions/mention.tsx` | **모든 멘션(member/page/database) 단일 노드** `MentionExtension`. 페이지 멘션 렌더 + PM mousedown(멤버/DB·atom 선택 차단만) |
| `src/lib/tiptapExtensions/pageLink.tsx`, `buttonBlock.tsx` | 인라인 링크 / 블록 링크 이동 |
| `src/components/page/PageSubpageTree.tsx` | 헤더 페이지 트리 팝오버 — 아이콘은 `PageIconDisplay` |
| `src/components/common/PageIconDisplay.tsx` | 페이지 아이콘 공통 렌더 (멘션·트리·사이드바·IconPicker) |
