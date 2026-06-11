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

## 페이지 제목 색 (`titleColor`)

- `pageStore.setTitleColor(id, color | null)` — 히스토리 `page.titleColor` + `upsertPage` enqueue
- `PageTitleBar`: 제목 `<input>` 에서 텍스트 **드래그 선택** 시 `PageTitleColorToolbar` 표시 → 컬러칩으로 `titleColor` 설정
- `Editor.tsx` 가 `titleColor` / `onTitleColorChange` 를 `PageTitleBar` 에 전달
- 멘션 칩 제목 색은 `mention.tsx` 가 `pageStore.titleColor` 를 구독해 반영 → [navigation/overview.md](../navigation/overview.md)
- 서버 필드: `infra/lib/sync/schema.graphql` `Page.titleColor` / `PageInput.titleColor` — **AppSync 배포 전**에는 로컬 persist 만 동작

## 템플릿
`src/components/page/` 내 템플릿 정의. 새 페이지 생성 시 선택 가능.
