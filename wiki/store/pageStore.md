# pageStore

## 역할
앱 내 모든 페이지(노트, DB 행, 전체 페이지 DB 홈 등)의 트리 구조·본문·메타데이터를 관리하는 핵심 스토어.

## 위치 및 파일 구성

```
src/store/pageStore.ts          # 스토어 본문 (701줄) — persist 설정·코어 액션 인라인
src/store/pageStore/
  helpers.ts                    # enqueueUpsertPage, allocateUniquePageTitle 등 공통 유틸
  selectors.ts                  # selectPageTree, createFilterPageTreeSelector 등 트리 셀렉터
  migrations.ts                 # PAGE_STORE_PERSIST_VERSION, migratePageStore
  actions/
    fullPageDbActions.ts        # findFullPagePageIdForDatabase, ensureFullPagePageForDatabase, markFullPageDatabaseHome
    moveActions.ts              # reorderPages, movePage, movePageRelative
    duplicateActions.ts         # duplicatePage, duplicatePageToWorkspace
    appearanceActions.ts        # setIcon, setTitleColor, setCoverImage
  __tests__/                    # 단위 테스트
```

### 액션 슬라이스 패턴 (behavior-preserving 분리)

databaseStore 의 `columnActions`/`rowActions` 와 동일한 패턴. 각 슬라이스는:

```ts
type PageStoreSet = StoreApi<PageStore>["setState"];
type PageStoreGet = StoreApi<PageStore>["getState"];

export function createXxxActions(set: PageStoreSet, get: PageStoreGet): Pick<PageStore, ...> {
  return { ... };
}
```

- `PageStore` 는 **type-only import** → 런타임 순환 의존 없음.
- 스토어 본문에서 `...createXxxActions(set, get)` 스프레드로 합성.
- 분리 순서: `...createMoveActions`, `...createAppearanceActions`, `...createDuplicateActions`, `...createFullPageDbActions`.

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
| `createPage` | `title?, parentId?, opts?` | 새 페이지 생성. **워크스페이스 내 제목 중복 시 `(1)`, `(2)` … 접미사 자동 부여**(`allocateUniquePageTitle`). 생성된 페이지 ID 반환 |
| `deletePage` | `id` | 페이지와 자손을 삭제. `lastDeletedBatch`에 저장 |
| `undoLastDelete` | 없음 | 마지막 삭제 배치 복원. 성공 시 `true` 반환 |
| `renamePage` | `id, title` | 페이지 제목 변경. **동일 워크스페이스에 같은 제목이 있으면 `false`**(스토어·원격 변경 없음). UI는 `SimpleAlertDialog` 로 안내 |
| `updateDoc` | `id, doc, options?` | 페이지 본문(TipTap JSON) 업데이트. `skipHistory`, `deferSync` 옵션 지원 |
| `setActivePage` | `id \| null` | 활성 페이지 전환 |
| `navigateToParentPage` | 없음 | 부모 페이지로 이동 (루트면 무시) |
| `reorderPages` | `orderedIds` | 같은 부모 내 페이지 순서 재정렬 |
| `setIcon` | `id, icon \| null` | 페이지 아이콘 설정 |
| `setTitleColor` | `id, titleColor \| null` | 페이지 제목 텍스트 색(hex). 멘션 제목 색과 연동 |
| `setCoverImage` | `id, coverImage \| null` | 커버 이미지 설정 |
| `movePage` | `id, parentId \| null, index` | 다른 부모/위치로 이동 |
| `movePageRelative` | `id, direction` | 키보드 단축키용 상대 이동 (up/down/indent/outdent) |
| `duplicatePage` | `id` | 같은 워크스페이스에서 **선택한 페이지 자기 자신만** 복제하여 바로 다음에 삽입(자식 페이지는 복제하지 않음). 제목은 `{title} (Copy)`. 형제 순서 재조정은 같은 워크스페이스·부모·DB/일반 페이지 스코프에만 적용하여 루트의 숨은 DB 행·DB 홈·타 워크스페이스 페이지를 건드리지 않는다. 복제된 ID 반환 |
| `duplicatePageToWorkspace` | `id, targetWorkspaceId` | **async** — 다른 워크스페이스로 복제. 대상 WS 의 로컬 페이지 + `fetchPageMetasByWorkspace` 메타로 제목 충돌 검사 후 **루트·자손 각각 `allocateUniquePageTitle`**(`(1)` 형식, `(Copy)` 접미사 없음). 복제된 페이지 수 반환 |
| `setPageDbCell` | `pageId, columnId, value` | DB 행 페이지의 셀 값 업데이트 (title 제외) |
| `restorePageFromLatestHistory` | `pageId` | 최신 히스토리로 페이지 복원 |
| `restorePageFromHistoryEvent` | `pageId, eventId` | 특정 히스토리 이벤트로 페이지 복원 |
| `findFullPagePageIdForDatabase` | `databaseId` | DB의 전체 페이지 홈 ID 반환 (없으면 null) |
| `ensureFullPagePageForDatabase` | `databaseId, title?, view?` | DB의 숨김 홈 페이지를 보장하고 ID 반환 |
| `markFullPageDatabaseHome` | `pageId, databaseId` | 기존 페이지를 DB 홈으로 태깅 (`fullPageDatabaseId` 설정) |
| `updateButtonBlockLabels` | `homePageId, newLabel` | DB 제목 변경 시 buttonBlock 레이블 동기화 |

## 제목 중복 방지 (`pageStore/helpers.ts`)

| 함수 | 용도 |
|------|------|
| `normalizePageTitle` | trim·빈 값 → `"제목 없음"` |
| `isPageTitleTaken` | 워크스페이스 스코프·`exceptId`·`deletedAt` 제외·`reservedTitles`(복제 배치) |
| `allocateUniquePageTitle` | 신규 생성·WS 간 복제 시 `(1)`, `(2)` … 부여 |
| `isDefaultNewPageTitle` | `"새 페이지"`, `"새 페이지 (1)"` 등 — 생성 직후 제목 자동 포커스 판별 |
| `PAGE_TITLE_DUPLICATE_MESSAGE` | rename 중복 시 UI 공통 문구 |

> **회귀 주의**
> - 제목 비교는 **워크스페이스 단위**. 다른 WS 와 같은 이름은 허용.
> - 휴지통(`deletedAt`) 페이지는 중복 검사에서 제외.
> - rename 거부는 **스토어가 `false` 반환** → UI(`PageListItem`, `Editor`/`PageTitleBar`, `DatabaseRowPage`, `DatabaseRowPeek`)에서 alert + 입력 재포커스. 스토어에서 silent skip 하지 말 것.

## Persist

- localStorage 키: `quicknote.pages.v1`
- storage: `deferredPageStorage` (커스텀 deferred 스토리지)
- version: `PAGE_STORE_PERSIST_VERSION` (`src/store/pageStore/migrations.ts` 에서 관리)
- 저장 필드: `pages`, `activePageId`, `cacheWorkspaceId`, `migrationQuarantine`
- 마이그레이션 로직: `migratePageStore` (`src/store/pageStore/migrations.ts`)
- 마이그레이션 필요 조건: `Page` 타입에 필수 필드 추가·제거·이름 변경 시 version bump 필요

## Page 메타 필드 (동기화)

| 필드 | 타입 | upsert |
|------|------|--------|
| `titleColor` | `string \| null` | `toGqlPage` / `toPageInputPayload` / GraphQL `PAGE_FIELDS` 포함. 스키마: `Page.titleColor` |

## 히스토리 기록 게이트웨이 (`recordPageMutation`)

pageStore 의 변이 액션(updateDoc·setIcon·movePage 등 10여 곳)이 직접 `getState→이벤트수 조회→shouldWriteAnchor→recordPageEvent` 를 복붙하던 패턴은 **`historyStore.recordPageMutation(pageId, kind, patch, anchor)`** 단일 게이트웨이로 통합됐다(Phase 5.2, behavior-preserving).

- 위치: `src/store/historyStore.ts` (`recordPageMutation`).
- `anchor` 는 **thunk**(`() => PageSnapshot`)로 받아 앵커 기록 시점(`shouldWriteAnchor(events.length+1)` true)에만 평가한다 → `page.doc`/`dbCell` 핫패스에서 불필요한 스냅샷 계산을 막는다. 앵커 주기·기록 결과는 이전과 동일.

## 의존 관계

- `useHistoryStore` — 변이 시 `recordPageMutation` 게이트웨이로 히스토리/앵커 기록
- `useSettingsStore` — 탭 상태 갱신 (DB 삭제 시 탭 정리)
- `useNotificationStore` — 페이지 멘션 알림 생성
- `src/lib/sync/engine.ts` (outbox) — AppSync 뮤테이션 enqueue
- `src/lib/sync/localDeleteGuards.ts` — 로컬 삭제 마킹

## 사용처 (주요 컴포넌트)

- `src/Bootstrap.tsx` — 초기 페치 후 스토어에 pages 주입
- `src/components/layout/Sidebar.tsx`, `PageListGroup.tsx`, `PageListItem.tsx` — 페이지 트리 렌더링
- `src/components/Editor.tsx` — 활성 페이지 본문 편집
- `src/store/pageStore/selectors.ts` — `selectPageTree`, `selectSortedPages`, `createFilterPageTreeSelector` 등 트리 셀렉터
