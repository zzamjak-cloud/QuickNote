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

## CRITICAL 회귀 주의

- **ghost 재발 조건**: `upsertPage` 호출 시 `fullPageDatabaseId`를 빠뜨리면 레거시 폴백에만 의존하게 된다. 폴백은 doc 본문이 로드된 후에만 동작하므로 메타 베이스라인 경로에서 사이드바에 순간 노출될 수 있다.
- **수동 제거된 ghost**: localStorage 캐시에 `fullPageDatabaseId` 없이 저장된 기존 ghost는 재동기화 전까지 표시될 수 있다. F5(재동기화)로 해결.
- **reconcileWorkspaceFullSnapshot**: ghost 제거(prune)는 전체 스냅샷에서만 실행된다. 델타 동기화 중에는 실행되지 않는다.

## 관련 파일

| 파일 | 역할 |
|------|------|
| `src/store/pageStore/selectors.ts` | `isHiddenInSidebar`, `isFullPageDatabaseHomePage` |
| `src/store/pageStore.ts` | `createFullPageDatabase` — `fullPageDatabaseId` 설정 |
| `infra/lambda/v5-resolvers/handlers/pageDatabase.ts` | `listPageMetas` ProjectionExpression, `upsertPage` |
| `infra/lib/sync/schema.graphql` | `PageInput.fullPageDatabaseId`, `PageMeta.fullPageDatabaseId` |
