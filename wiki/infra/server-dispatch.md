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

디스패치(`index.ts:852` handler):
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
