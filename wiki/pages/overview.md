# 페이지 관리

## 파일

| 파일 | 역할 |
|------|------|
| `src/store/pageStore.ts` | 페이지 CRUD, 제목/아이콘/제목색 (persist) |
| `src/components/page/PageTitleBar.tsx` | 제목 입력·아이콘·즐겨찾기·제목 색 툴바 |
| `src/components/page/PageTitleColorToolbar.tsx` | 제목 드래그 선택 시 컬러칩 부유 툴바 |
| `src/components/page/PageSubpageTree.tsx` | 헤더 페이지 트리 팝오버 |
| `src/components/page/` | 기타 페이지 레이아웃, 템플릿 |
| `src/components/layout/Sidebar.tsx`, `PageListGroup.tsx`, `PageListItem.tsx` | 사이드바 페이지 트리 렌더링 |
| `src/Bootstrap.tsx` | 초기 페이지 fetch |

## 페이지 데이터 구조
```ts
Page {
  id: string
  title: string
  titleColor?: string | null  // 제목 텍스트 색(hex). GraphQL titleColor 동기화
  icon?: string
  content: JSONContent  // TipTap doc
  workspaceId: string
  parentId?: string     // 중첩 페이지
  createdAt: string
  updatedAt: string
}
```

## CRUD 흐름
1. 로컬 `pageStore` 즉시 업데이트 (낙관적 업데이트)
2. IndexedDB outbox → AppSync 뮤테이션
3. 다른 클라이언트는 AppSync 구독으로 실시간 수신

## persist
localStorage 키: `quicknote.pages.v1`
버전 관리: [store/schema-versioning.md](../store/schema-versioning.md)

## 중첩 페이지
`parentId` 로 트리 구조. `createFilterPageTreeSelector` 로 사이드바 트리를 만들고
`Sidebar` → `PageListGroup` → `PageListItem` 순서로 렌더.

- 펼침 상태는 `settingsStore.expandedIds` 에 저장.
- 하위 페이지가 있는 항목은 접기/펼치기 버튼을 페이지 리스트 왼쪽 고정 슬롯에 항상 표시.
- 자식 없는 항목도 같은 폭의 빈 슬롯을 유지해 아이콘·제목 정렬이 깊이별로 흔들리지 않게 한다.
- 접기/펼치기 버튼은 자식 존재 여부를 알려주는 시각 신호이므로 `opacity-0`/`group-hover:opacity-100` 같은 호버 전용 숨김 처리 금지.

- `src/components/layout/PageCopyToWorkspaceDialog.tsx` — WS 간 복제 UI(async, 복제 중 disabled)

## 페이지 제목 중복 방지

### 생성 (`createPage`)
- `allocateUniquePageTitle` — 같은 WS 에 `"새 페이지"` 가 있으면 `"새 페이지 (1)"`, `"(2)"` …
- 사이드바 +, `/새 페이지` 슬래시, DB 하위 페이지 등 **모든 `createPage` 경로**에 공통 적용
- `/새 페이지` 멘션 삽입 시 `mention` label 은 실제 부여된 제목 사용

### 이름 변경 (`renamePage`)
- 동일 WS · 동일 정규화 제목이 **다른 페이지**에 있으면 `false`
- UI: `SimpleAlertDialog` — *"이미 같은 이름의 페이지가 있습니다. 다른 이름을 입력해 주세요."* (`PAGE_TITLE_DUPLICATE_MESSAGE`)
- 확인 후 제목 입력란 재포커스·전체 선택. 사이드바 인라인 편집은 **editing 모드 유지**

### 다른 워크스페이스로 복제 (`duplicatePageToWorkspace`)
- 대상 WS: 로컬 `pages` + `fetchPageMetasByWorkspace` 원격 메타 병합
- 복제 subtree 각 페이지 제목을 `allocateUniquePageTitle` + `reservedTitles` 로 일괄 고유화
- 과거 루트 `(Copy)` 접미사 **사용 안 함** — 충돌 시에만 `(n)` 부여

검색·멘션 구분을 위해 WS 내 페이지 제목 유일성을 유지한다 → [search/overview.md](../search/overview.md)

## 페이지 제목 색 (`titleColor`)

- `pageStore.setTitleColor(id, color | null)` — 히스토리 `page.titleColor` + `upsertPage` enqueue
- `PageTitleBar`: 제목 `<input>` 에서 텍스트 **드래그 선택** 시 `PageTitleColorToolbar` 표시 → 컬러칩으로 `titleColor` 설정
- `Editor.tsx` 가 `titleColor` / `onTitleColorChange` 를 `PageTitleBar` 에 전달
- 멘션 칩 제목 색은 `mention.tsx` 가 `pageStore.titleColor` 를 구독해 반영 → [navigation/overview.md](../navigation/overview.md)
- 서버 필드: `infra/lib/sync/schema.graphql` `Page.titleColor` / `PageInput.titleColor` — **AppSync 배포 전**에는 로컬 persist 만 동작

## 템플릿
`src/components/page/` 내 템플릿 정의. 새 페이지 생성 시 선택 가능.
