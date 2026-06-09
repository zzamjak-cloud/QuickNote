# pageStore

## 역할
앱 내 모든 페이지(노트, DB 행, 전체 페이지 DB 홈 등)의 트리 구조·본문·메타데이터를 관리하는 핵심 스토어.

## 위치
`src/store/pageStore.ts`

## State 타입

| 필드 | 타입 | 설명 |
|------|------|------|
| `pages` | `PageMap` | `Record<string, Page>` — 전체 페이지 딕셔너리 |
| `activePageId` | `string \| null` | 현재 열려 있는 페이지 ID |
| `cacheWorkspaceId` | `string \| null` | persist 된 페이지들이 속한 워크스페이스 ID |
| `migrationQuarantine` | `PersistedQuarantine[]` | 마이그레이션 실패 시 격리된 항목 목록 |
| `lastDeletedBatch` | `DeletedBatch \| null` | 마지막으로 삭제한 페이지 배치 (실행 취소용) |

## 액션 목록

| 액션명 | 파라미터 | 설명 |
|--------|---------|------|
| `createPage` | `title?, parentId?, opts?` | 새 페이지 생성. 생성된 페이지 ID 반환 |
| `deletePage` | `id` | 페이지와 자손을 삭제. `lastDeletedBatch`에 저장 |
| `undoLastDelete` | 없음 | 마지막 삭제 배치 복원. 성공 시 `true` 반환 |
| `renamePage` | `id, title` | 페이지 제목 변경 |
| `updateDoc` | `id, doc, options?` | 페이지 본문(TipTap JSON) 업데이트. `skipHistory`, `deferSync` 옵션 지원 |
| `setActivePage` | `id \| null` | 활성 페이지 전환 |
| `navigateToParentPage` | 없음 | 부모 페이지로 이동 (루트면 무시) |
| `reorderPages` | `orderedIds` | 같은 부모 내 페이지 순서 재정렬 |
| `setIcon` | `id, icon \| null` | 페이지 아이콘 설정 |
| `setCoverImage` | `id, coverImage \| null` | 커버 이미지 설정 |
| `movePage` | `id, parentId \| null, index` | 다른 부모/위치로 이동 |
| `movePageRelative` | `id, direction` | 키보드 단축키용 상대 이동 (up/down/indent/outdent) |
| `duplicatePage` | `id` | 페이지와 자손을 복제하여 바로 다음에 삽입. 복제된 루트 ID 반환 |
| `duplicatePageToWorkspace` | `id, targetWorkspaceId` | 다른 워크스페이스로 복제. 복제된 페이지 수 반환 |
| `setPageDbCell` | `pageId, columnId, value` | DB 행 페이지의 셀 값 업데이트 (title 제외) |
| `restorePageFromLatestHistory` | `pageId` | 최신 히스토리로 페이지 복원 |
| `restorePageFromHistoryEvent` | `pageId, eventId` | 특정 히스토리 이벤트로 페이지 복원 |
| `findFullPagePageIdForDatabase` | `databaseId` | DB의 전체 페이지 홈 ID 반환 (없으면 null) |
| `ensureFullPagePageForDatabase` | `databaseId, title?, view?` | DB의 숨김 홈 페이지를 보장하고 ID 반환 |
| `updateButtonBlockLabels` | `homePageId, newLabel` | DB 제목 변경 시 buttonBlock 레이블 동기화 |

## Persist

- localStorage 키: `quicknote.pages.v1`
- storage: `deferredPageStorage` (커스텀 deferred 스토리지)
- version: `PAGE_STORE_PERSIST_VERSION` (`src/store/pageStore/migrations.ts` 에서 관리)
- 저장 필드: `pages`, `activePageId`, `cacheWorkspaceId`, `migrationQuarantine`
- 마이그레이션 로직: `migratePageStore` (`src/store/pageStore/migrations.ts`)
- 마이그레이션 필요 조건: `Page` 타입에 필수 필드 추가·제거·이름 변경 시 version bump 필요

## 의존 관계

- `useHistoryStore` — `updateDoc` 에서 히스토리 앵커 기록
- `useSettingsStore` — 탭 상태 갱신 (DB 삭제 시 탭 정리)
- `useNotificationStore` — 페이지 멘션 알림 생성
- `src/lib/sync/engine.ts` (outbox) — AppSync 뮤테이션 enqueue
- `src/lib/sync/localDeleteGuards.ts` — 로컬 삭제 마킹

## 사용처 (주요 컴포넌트)

- `src/Bootstrap.tsx` — 초기 페치 후 스토어에 pages 주입
- `src/components/layout/Sidebar.tsx`, `PageListGroup.tsx`, `PageListItem.tsx` — 페이지 트리 렌더링
- `src/components/Editor.tsx` — 활성 페이지 본문 편집
- `src/store/pageStore/selectors.ts` — `selectPageTree`, `selectSortedPages`, `createFilterPageTreeSelector` 등 트리 셀렉터
