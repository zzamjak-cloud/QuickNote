# Ghost 페이지 방지 (풀페이지 DB 홈 페이지)

## 문제 정의

풀페이지 DB를 생성하면 DB의 "홈 페이지"(`databaseBlock layout=fullPage` 페이지)가 사이드바에
일반 페이지처럼 중복 표시된다. 이를 ghost 페이지라고 부른다.

## 방지 체계

### 신규 생성 시 (자동)

```
클라이언트 createFullPageDatabase()
  → Page 객체에 fullPageDatabaseId: databaseId 설정
  → upsertPage mutation (PageInput.fullPageDatabaseId 포함)
  → 서버 upsertPage 핸들러: ...args.input 으로 DynamoDB에 저장
  → listPageMetas 응답에 fullPageDatabaseId 포함
  → 클라이언트 isHiddenInSidebar: fullPageDatabaseId 있으면 true
```

### 사이드바 필터링 (`src/store/pageStore/selectors.ts`)

```typescript
// isFullPageDatabaseHomePage
if (page.fullPageDatabaseId) return true;
// 폴백: doc 기반 판별 (fullPageDatabaseId 미설정 레거시)
return doc.content[0].type === "databaseBlock" && layout === "fullPage";

// isHiddenInSidebar
databaseId != null           → true (DB row 페이지)
isFullPageDatabaseHomePage   → true (풀페이지 DB 홈)
workspaceId !== currentWsId  → true (다른 워크스페이스)
```

### `listPageMetas` GSI

`byWorkspaceAndUpdatedAt` GSI (ALL 프로젝션) — `fullPageDatabaseId` 포함.
과거 `byWorkspaceMetaUpdatedAt` (INCLUDE 프로젝션)은 신규 속성을 추가할 수 없어 교체됨.

## 레거시 backfill

`fullPageDatabaseId` 없이 생성된 기존 풀페이지 DB 홈 페이지에 일괄 설정 완료:
- dev: 22건
- live: 24건

폴백 로직(`doc.content[0].type === "databaseBlock"`)이 있으므로 미처리 항목도 사이드바에서 숨겨진다.

## 진입 시 ghost 재생성 (CRITICAL)

가장 빈번한 ghost 발생 경로는 **워크스페이스 진입 시 복원된 풀페이지 DB 탭**이다.

```
persist 된 탭이 { databaseId: X } (풀페이지 DB 탭)
  → 부트스트랩이 그 탭을 복원
  → App.tsx 효과가 tabDatabaseId 감지 → ensureFullPagePageForDatabase(X) 호출
  → 메타 베이스라인 상태(doc 미로드) + 기존 홈에 fullPageDatabaseId 없음
  → findFullPagePageIdForDatabase 가 기존 홈을 못 찾음
  → 새 풀페이지 홈을 중복 생성 = ghost
```

**2중 방어 (둘 다 필요):**

1. **진입 시 첫 인덱스 페이지로 리셋** — `applyWorkspaceLanding(ws, { forceFirstRoot: true })`.
   Bootstrap 의 모든 워크스페이스 데이터 적용에서 `landingForceFirstRoot: true` 로 호출 →
   전환·새로고침·강제 새로고침 진입 시 직전 DB 탭/마지막 방문 페이지를 복원하지 않고
   항상 첫 인덱스 페이지로 결정적 리셋한다. DB 탭이 비워지므로 ensure 트리거 자체가 사라진다.
   일반 워크스페이스 landing 후보에서는 다른 워크스페이스 페이지와 LC 보호 DB 페이지/블록을 제외한다.
   (`src/lib/sync/workspaceLanding.ts`, `src/Bootstrap.tsx`)

2. **부트 구간 자동 생성 차단** — `uiStore.workspaceBootstrapping`.
   landing 이 탭을 비우기 전 새로고침 레이스로 ensure 가 먼저 실행될 수 있으므로,
   부트(페치~landing) 구간에는 App.tsx 의 `ensureFullPagePageForDatabase` 자동 생성을 막는다.
   사용자가 부트 이후 직접 연 DB 풀페이지(`setCurrentTabDatabase`)는 정상 동작한다.
   (`src/store/uiStore.ts`, `src/App.tsx`)

> 레거시 ghost(`fullPageDatabaseId` 없는 풀페이지 홈)는 서버에서 softDelete 로 제거한다.
> `quicknote-page` 의 `byWorkspaceAndUpdatedAt` GSI 로 `databaseId=null` 루트를 조회해
> 정식 페이지만 남기고 중복을 삭제(`deletedAt`/`updatedAt` 전진 + `purgeAt` epoch초)하면 delta 동기화로 전파된다.

## 임포트가 만든 미태깅 홈 (재발 경로, 2026-06-09)

라이브에서 같은 DB("아트 직군 살롱 지식 DB", `c5ce2a99`)의 풀페이지 홈이 날짜별로 미태깅 중복 생성되어 유령으로 반복 노출됐다.

원인: **Notion CSV 폴더 임포트**(`src/components/settings/NotionCsvFolderSection.tsx`)가 DB 홈 페이지를 `createPage` + `updateDoc(databaseBlock)` 로 만들면서 페이지 레벨 `fullPageDatabaseId`(및 명시 `layout: "fullPage"`)를 설정하지 않았다. 서버 `upsertPage` 는 input 을 그대로 저장하므로(필드를 버리지 않음) 클라이언트가 안 보낸 것이 원인. 미태깅 홈은 메타 베이스라인에서 doc 폴백이 안 돼 사이드바에 노출되고, 델타 부트라 prune(`reconcileWorkspaceFullSnapshot`)도 안 돼 삭제해도 재동기화로 부활한다.

수정:
- 임포트가 홈 생성 시 `layout: "fullPage"` 를 명시하고 `pageStore.markFullPageDatabaseHome(pageId, dbId)` 로 태깅한다.
- `pageStore.markFullPageDatabaseHome` 액션 신설(태깅 + `enqueueUpsertPage`, idempotent).
- `ensureFullPagePageForDatabase` 가 기존 홈을 찾으면 태그 누락 시 자동 보강(자기 치유, doc 로드된 경우 한정).
- 기존 서버 미태깅 홈은 코드로 못 잡으므로 `quicknote-page` 에서 중복 홈을 softDelete 로 정리한다(`deletedAt`/`updatedAt`/`purgeAt`+30일, `attribute_not_exists(fullPageDatabaseId) AND attribute_not_exists(deletedAt)` 조건). 정식 태깅 홈만 남긴다.

> 점검 쿼리: `quicknote-page` 전체 스캔에서 `미삭제 AND 미태깅 AND 루트(databaseId 없음)` 후보 중 `doc.content[0]` 이 `databaseBlock` + `layout==="fullPage"` 인 것이 유령. 정상 워크스페이스는 0건이어야 한다.

## CRITICAL 회귀 주의

- **ghost 재발 조건**: `upsertPage` 호출 시 `fullPageDatabaseId`를 빠뜨리면 레거시 폴백에만 의존하게 된다. 폴백은 doc 본문이 로드된 후에만 동작하므로 메타 베이스라인 경로에서 사이드바에 순간 노출될 수 있다.
- **수동 제거된 ghost**: localStorage 캐시에 `fullPageDatabaseId` 없이 저장된 기존 ghost는 재동기화 전까지 표시될 수 있다. F5(재동기화)로 해결.
- **reconcileWorkspaceFullSnapshot**: ghost 제거(prune)는 전체 스냅샷에서만 실행된다. 델타 동기화 중에는 실행되지 않는다.
- **landing 진입 리셋을 끄지 말 것**: `landingForceFirstRoot` 를 false 로 되돌리면 복원된 DB 탭이 다시 ghost 를 만든다. 진입 화면 고정은 UX 선택이자 ghost 방지책이다.
- **초기 `?page=` 복원 금지**: 새로고침/콜드 부트에서 URL 의 stale `?page` 를 먼저 열면 landing 결과를 다시 덮는다. 최초 마운트는 landing 을 권위로 두고, URL 은 active page 확정 후 교정한다.

## 관련 파일

| 파일 | 역할 |
|------|------|
| `src/store/pageStore/selectors.ts` | `isHiddenInSidebar`, `isFullPageDatabaseHomePage` |
| `src/store/pageStore.ts` | `ensureFullPagePageForDatabase`(생성 시 `fullPageDatabaseId` 설정), `findFullPagePageIdForDatabase` |
| `src/lib/sync/workspaceLanding.ts` | `applyWorkspaceLanding({ forceFirstRoot })` — 진입 시 첫 인덱스 리셋 |
| `src/Bootstrap.tsx` | `landingForceFirstRoot: true`, `workspaceBootstrapping` 플래그 토글 |
| `src/store/uiStore.ts` | `workspaceBootstrapping` — 부트 구간 자동 생성 차단 신호 |
| `src/App.tsx` | DB 탭 홈 보장 효과(부트 중 생성 스킵) |
| `infra/lambda/v5-resolvers/handlers/pageDatabase.ts` | `listPageMetas` ProjectionExpression, `upsertPage` |
| `infra/lib/sync/schema.graphql` | `PageInput.fullPageDatabaseId`, `PageMeta.fullPageDatabaseId` |
