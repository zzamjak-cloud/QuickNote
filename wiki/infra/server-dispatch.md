# v5-resolvers 서버 디스패치 (resolver map)

파일: `infra/lambda/v5-resolvers/index.ts`. AppSync Lambda 리졸버 라우터 —
`event.info.fieldName` 으로 분기한다.

## switch → resolver map 테이블 (`041a39d7`, 5.8)

기존 105 case `switch` 를 `RESOLVERS` Record 맵으로 치환했다.
각 case body·캐스트·정규화·반환값은 **인라인 그대로 이전(behavior-preserving)**.

```ts
// index.ts:279
const RESOLVERS: Record<
  string,
  (event: AppsyncEvent, base: ResolverBase) => unknown | Promise<unknown>
> = {
  me: (_event, base) => normalizeMemberForGql(base.caller ...),
  createMember: async (event, base) => ...,
  // ... fieldName → resolver
};
```

디스패치(`index.ts:871` handler):
1. `fieldName === "publishPageChanged"` → 조기 반환(`event.arguments.input` 그대로).
2. `getCallerMember` 로 caller 생성 → `base = { doc, tables, caller }`.
3. `RESOLVERS[fieldName]` 조회 → 없으면 `ResolverError("unknown fieldName: ...", "InternalError")`.
4. `await resolver(event, base)`.
5. try/catch: `ResolverError` 는 `errorResponse(message, errorType)`, 그 외는 콘솔 로그 후 `InternalError`.

이 동작(publishPageChanged 조기반환·unknown fieldName 에러·try/catch)은 switch 시절과 동일하게 보존됐다.

## 새 resolver 추가 지점
1. `RESOLVERS` 맵에 `fieldName: (event, base) => ...` 엔트리 추가.
2. 핸들러 함수는 `infra/lambda/v5-resolvers/handlers/*` 에 구현하고 import.
3. 응답 정규화가 필요하면 기존 `normalizeMemberForGql`/`normalizeTeamForGql`/`normalizeOrgForGql`/
   `normalizeWorkspaceForGql`/`normalizeMmEntryForGql` 재사용.
4. AppSync 스키마(`infra/graphql/`)에 필드가 있어야 라우팅된다.

> normalizer 미들웨어 추출은 추상화 위험을 줄이려 **보류**했다. 정규화는 각 엔트리에서 직접 호출한다.

---

## pageDatabase 핸들러 도메인 분할

기존 `handlers/pageDatabase.ts`(단일 파일) 를 `handlers/pageDatabase/` 디렉토리 7개 모듈로 분할.
호출부(라우터·template-automation/runner·테스트) 수정 없이 배럴 `index.ts` 가 동일 심볼 34개를 re-export.

### 모듈별 공개 심볼

| 모듈 | 공개 심볼 |
|------|----------|
| `_shared.ts` | `Connection<T>`, `BaseRecord`, `cloneJson`, `jsonEqual`, `isPlainObject`, `parseJsonLike`, `upsertRecord`, `softDeleteRecord`, `validateWorkspaceSubscription` |
| `row.ts` | `listDatabaseRows`, `deriveDatabaseRowScopeKeys`, `normalizePageOrderField` |
| `history.ts` | `PAGE_HISTORY_FIELDS`, `normalizePageSnapshot`, `requireDatabaseHistoryOwnerKey`, `listPageHistoryAsc`, `listDatabaseHistoryAsc`, `recordPageHistory`, `recordPageDeleteHistory`, `recordDatabaseHistory`, `listPageHistory`, `listDatabaseRowHistory`, `restorePageVersion`, `savePageVersion`, `saveDatabaseVersion`, `deletePageHistoryEvents`, `listDatabaseHistory`, `restoreDatabaseVersion`, `deleteDatabaseHistoryEvents` |
| `database.ts` | `hasMeaningfulDbCells`, `preserveExistingDbCellsForNullInput`, `listDatabases`, `getDatabase`, `upsertDatabase`, `softDeleteDatabase` |
| `page.ts` | `isPlaceholderPageDoc`, `hasMeaningfulPageDocContent`, `incomingDocLacksContent`, `preserveExistingDocForPlaceholderInput`, `listPages`, `listPageMetas`, `getPage`, `upsertPage`, `softDeletePage` |
| `trash.ts` | `TRASH_RETENTION_MS`, `permanentlyDeleteDatabase`, `permanentlyDeletePage`, `emptyTrash`, `listTrashedPages`, `restorePage`, `listTrashedDatabases`, `restoreDatabase` |
| `index.ts` | 위 모듈 심볼 전체 re-export (배럴) |

### import 의존 그래프

무순환(acyclic). 위상 순서: `_shared < row < history < {database, trash} < page`.

```
_shared ← row ← history ← database ─┐
   ↑       ↑       ↑      trash ────┤
   └───────┴───────┴──────────────→ page  (모두를 import 하는 sink)
```

- `row` → `_shared`
- `history` → `_shared`, `row`
- `database`·`trash` → `_shared`, `history`
- `page` → `_shared`, `row`, `history`, `database`, `trash` (최상위 sink, 아무도 page 를 import 하지 않음)
- `history` 는 `page`·`database`·`trash` 를 import 하지 않는다(핵심 불변식).

### 새 핸들러 추가 시

1. 도메인에 맞는 모듈에 함수 추가·export.
2. `index.ts` 배럴에 re-export 항목 추가.
3. 라우터(`index.ts:51-79` 의 pageDatabase import 블록) 에 심볼 추가.
