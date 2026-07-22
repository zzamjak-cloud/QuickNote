# DB 템플릿 자동 생성

## 목적

DB 템플릿 자동 생성은 사용자가 DB 템플릿에 요일, 시간, 제목 prefix, 종료일을 설정하면 서버 스케줄러가 지정 시각에 템플릿 페이지를 DB row page로 생성하는 기능이다.

이 기능은 클라이언트 polling으로 실행하지 않는다. 자동화별 Amazon EventBridge Scheduler schedule을 등록하고, 지정된 분 단위 시각에 runner Lambda가 호출된다.

## 관련 파일

| 영역 | 파일 |
|------|------|
| UI 설정 | `src/components/database/DatabaseToolbarControls.tsx`, `src/components/database/DatabaseTemplateButton.tsx` |
| 클라이언트 유틸 | `src/lib/database/templateAutomation.ts` |
| 수동 템플릿 페이지/행 분리 | `src/lib/services/databaseRowPages.ts`, `src/store/databaseStore.ts`, `src/components/database/databaseRowSources.ts` |
| DB template sync | `src/lib/sync/graphql/database.ts`, `src/lib/sync/storeApply/databaseApply.ts`, `src/lib/sync/storeApply/rowOrder.ts` |
| Scheduler 등록 | `infra/lambda/v5-resolvers/handlers/templateAutomationScheduler.ts` |
| Runner | `infra/lambda/template-automation/runner.ts`, `infra/lambda/template-automation/common.ts` |
| AppSync schema | `infra/lib/sync/schema.graphql` |
| CDK | `infra/lib/sync-stack.ts` |

## Source Of Truth

- 자동화 설정은 `Database.templates` AWSJSON payload 안의 `template.automation`에 저장한다.
- Scheduler metadata는 서버 `TemplateAutomationSchedules` table에 보관한다.
- 실행 결과는 `TemplateAutomationRuns` table에 `automationId + scheduledTime` 단위로 보관한다.
- 생성된 페이지는 일반 DB row page와 동일하게 `Pages` table에 저장한다.

## 수동 템플릿 팝업 UX

- 템플릿 팝업의 `+ 빈 페이지`는 팝업을 즉시 닫고 `useAddDatabaseRowAndOpen`으로 새 row page를 만든 뒤 피크뷰를 연다.
- 템플릿 적용도 `applyTemplate`이 반환한 pageId를 `useOpenDatabaseRow`로 열어, 생성된 항목을 바로 편집할 수 있게 유지한다.
- `+ 새 템플릿`은 페이지 생성 시점부터 `dbCells._qn_isTemplate = "1"`을 포함해야 한다. 생성 후 별도 패치하면 `createPage`가 예약한 마커 없는 업서트가 뒤늦게 도착해 일반 항목으로 노출될 수 있다.
- `addTemplate` 호출 안에서 `dbTemplates` 등록과 `Database.templates` 업서트를 시작해 팝업 재진입 시 새로고침 없이 목록에 보여야 한다.
- 템플릿 페이지의 제목 변경은 공통 `renamePage` 성공 경로에서 `pageId` 기반 제목 변경 브리지를 거쳐 `updateTemplate`을 호출한다. 화면의 페이지 제목뿐 아니라 `Database.templates[].title`과 `templatesUpdatedAt`도 즉시 갱신해 새로고침·다른 클라이언트·서버 자동화에서 `새 템플릿`으로 되돌아가지 않게 한다.
- 구독 순서나 stale row index 때문에 템플릿 pageId가 `rowPageOrder`에 들어와도 `ensurePageInDatabaseRowOrder`가 제거하고, `createDatabaseRowSourcesSelector`가 렌더 단계에서 한 번 더 제외한다.
- `onPageChanged`는 대용량 `dbCells`를 제외한 meta-only 이벤트이므로, `_qn_isTemplate`뿐 아니라 `dbTemplates[].pageId`도 템플릿 판별 기준으로 사용한다. DB 이벤트가 페이지 이벤트보다 늦게 와도 templates 적용 직후 row order를 재조정한다.
- 협업 DB의 Y.Doc 구조에는 templates가 없다. 템플릿 변경은 reconcile된 Y.Doc의 최신 컬럼·프리셋 구조와 templates를 함께 서버에 보내고, 이후 materialize 업서트도 독립 버전이 있는 현재 templates를 포함해 outbox dedupe가 값을 유실하지 않게 한다.
- 템플릿 배열은 DB 구조의 `updatedAt`과 독립된 `templatesUpdatedAt`으로 LWW 처리한다. 최신 또는 동일 버전은 배열 전체를 교체하고(빈 배열도 삭제로 반영), 오래된 버전은 무시한다. ID별 union 병합은 삭제를 되살리고 오래된 편집이 최신 값을 덮을 수 있으므로 사용하지 않는다.
- 템플릿 추가·편집·삭제는 `templatesUpdatedAt`만 올리고 구조용 `updatedAt`은 보존한다. 그렇지 않으면 구독이 늦은 클라이언트의 오래된 컬럼·프리셋·패널 상태가 최신 구조로 위장해 서버를 덮을 수 있다.
- 구버전 클라이언트·기존 레코드 양쪽에 `templatesUpdatedAt`이 없을 때만 `updatedAt`을 폴백으로 사용한다. 서버에 독립 버전이 있고 로컬 legacy 캐시에만 없으면 로컬 전역 `updatedAt`과 비교하지 않고 서버 템플릿 배열을 복원한다.
- 독립 템플릿 버전이 없는 legacy 캐시의 배열은 구조 materialize 업서트에 싣지 않는다. 전역 `updatedAt`을 템플릿 버전으로 합성해 서버의 정상 목록을 빈 배열로 덮는 것을 금지한다.
- 앱 부트스트랩은 원격 DB 스냅샷 적용 전에 database persist hydrate를 완료해야 한다. 늦은 hydrate가 방금 받은 `dbTemplates`를 오래된 캐시로 다시 덮으면 안 된다.
- 서버 Put은 `updatedAt`과 조회 당시 `templatesUpdatedAt`을 함께 CAS한다. 경합 재시도 후에도 입력 버전이 최신이면 오류를 반환해 outbox가 다시 시도하며, DB 버전 복원은 현재 두 버전보다 큰 단조 증가 시각을 생성하고 동일 CAS로 동시 편집을 보호한다.
- 이 UX는 클라이언트 수동 생성 경로이며, 서버 Scheduler/Runner 자동 생성 경로와 분리한다.

## Scheduler 등록

1. 사용자가 템플릿 자동화 설정을 저장한다.
2. 클라이언트가 기존 DB 저장 경로로 `upsertDatabase`를 보낸다.
3. 서버 resolver가 templates payload 변경을 저장한 뒤 자동화 diff를 계산한다.
4. 활성 자동화는 deterministic schedule name으로 EventBridge Scheduler schedule을 create/update한다.
5. 비활성화되거나 삭제된 자동화는 schedule을 삭제하고 metadata status를 갱신한다.

요일이 여러 개면 하나의 cron expression에 day-of-week 목록을 넣는다. 예: `cron(30 9 ? * MON,WED,FRI *)`.

EventBridge Scheduler는 초 단위 정밀도가 아니라 분 단위 호출 모델이다. `09:30` 설정은 `09:30:00`부터 `09:30:59` 사이에 target 호출이 발생할 수 있는 것으로 본다.

## Runner 실행

Runner Lambda는 Scheduler payload의 `automationId`, `databaseId`, `templateId`, `scheduledTime`을 기준으로 실행한다.

실행 순서:

1. `TemplateAutomationRuns`에서 동일 `automationId + scheduledTime`의 성공 기록을 확인한다.
2. 이미 성공한 실행분이면 새 페이지를 만들지 않는다.
3. 자동화 설정이 삭제/비활성화되었으면 skipped run으로 기록한다.
4. 실패 횟수가 `maxAttempts`를 넘으면 failed로 남기고 더 이상 생성하지 않는다.
5. 템플릿 페이지와 DB schema를 읽는다.
6. `_qn_isTemplate` 셀은 복사하지 않는다.
7. 날짜 column이 있으면 `scheduledTime`의 KST 날짜를 주입한다.
8. 새 row page를 `upsertPage` 내부 handler로 저장한다.
9. 저장 후 AppSync `publishPageChanged` mutation을 IAM으로 호출해 `onPageChanged` subscription을 발행한다.
10. 성공하면 run ledger를 `succeeded`로 기록한다.

## 실시간 갱신 규칙

Runner는 사용자 클라이언트가 직접 호출한 AppSync mutation이 아니라 Lambda 내부에서 page를 생성한다. 따라서 단순히 DynamoDB에 page를 쓰는 것만으로는 열려 있는 화면에 `onPageChanged` 이벤트가 오지 않는다.

생성 직후 반드시 다음 경로가 유지되어야 한다.

```text
TemplateAutomationRunnerFn
  -> upsertPage 내부 handler로 Pages table 저장
  -> AppSync publishPageChanged(input: PageInput!) IAM mutation 호출
  -> onPageChanged(workspaceId) subscription 발행
  -> 클라이언트 page store 갱신
```

회귀 방지 체크:

- `infra/lib/sync/schema.graphql`의 `onPageChanged` subscribe mutations에 `publishPageChanged`가 포함되어야 한다.
- `publishPageChanged` mutation은 `@aws_iam`으로 제한한다.
- `infra/lambda/v5-resolvers/index.ts`는 `publishPageChanged`를 Cognito caller 조회 전에 처리해야 한다.
- `TemplateAutomationRunnerFn`에는 `APPSYNC_GRAPHQL_URL` env와 `appsync:GraphQL` 권한이 있어야 한다.

## 본문 doc 정규화

빈 템플릿 페이지는 저장 상태에 따라 `doc`이 `{}`처럼 보일 수 있다. 이 값을 그대로 새 페이지에 넣으면 editor가 본문에 `{}` 텍스트를 표시할 수 있다.

Runner는 템플릿 페이지의 `doc`이 유효한 TipTap document가 아니면 다음 빈 문서로 정규화한다.

```json
{"type":"doc","content":[{"type":"paragraph"}]}
```

회귀 방지 테스트는 `infra/lambda/template-automation/common.test.ts`의 `normalizes an empty object doc to an empty editor document`를 유지한다.

## 제목 중복 처리

DB row 제목은 동일 DB 안에서 중복되면 안 된다. Runner는 생성 전에 Pages table의 `byDatabaseAndOrder` GSI로 기존 row 제목을 조회하고, 기본 제목이 이미 있으면 숫자 suffix를 붙인다.

예:

```text
QA 26/06/08
QA 26/06/08 (1)
QA 26/06/08 (2)
```

회귀 방지 테스트는 `infra/lambda/template-automation/common.test.ts`와 `infra/lambda/template-automation/runner.test.ts`의 suffix 테스트를 유지한다.

## 재시도와 중복 방지

- Scheduler retry는 bounded retry로 둔다.
- Runner run ledger는 `automationId + scheduledTime` 단위다.
- 성공 기록은 삭제하지 않는다.
- 반복 schedule 자체는 성공 후 멈추지 않는다. 이번 실행분만 `succeeded`가 되고, 다음 주 같은 요일/시간에 다시 호출된다.
- 같은 실행분에서 이미 page가 만들어졌지만 publish나 완료 기록이 실패한 경우, runner는 기존 page를 다시 생성하지 않고 기존 page로 publish/완료 처리를 재시도한다.

## 배포 영향

다음 변경이 포함되면 CDK 배포가 필요하다.

- `infra/lib/sync/schema.graphql`
- `infra/lib/sync-stack.ts`
- `infra/lambda/template-automation/*`
- `infra/lambda/v5-resolvers/*`
- EventBridge Scheduler 권한, Lambda env, AppSync IAM auth mode, resolver 추가

dev 검증 전에는 `main` 또는 live 환경을 건드리지 않는다.

## 검증 체크리스트

로컬 검증:

```bash
npx vitest run src/store/databaseStore/__tests__/databaseTemplateSync.test.ts src/components/database/__tests__/databaseRowSources.test.ts
```

```powershell
cd infra
npm test -- lambda/template-automation/common.test.ts lambda/template-automation/runner.test.ts lambda/v5-resolvers/handlers/templateAutomationScheduler.test.ts lambda/v5-resolvers/handlers/pageDatabase.test.ts
npm run build
$env:DEPLOY_ENV='dev'; npm run cdk -- synth --quiet
```

dev 배포 후 수동 검증:

1. 테스트 DB에 빈 템플릿 페이지를 만든다.
2. 현재 시각 다음 분으로 자동화를 설정한다.
3. 지정 시간이 지나면 화면 새로고침 없이 row가 표시되는지 확인한다.
4. 생성된 페이지 본문에 `{}`가 표시되지 않는지 확인한다.
5. 같은 템플릿으로 같은 날짜 제목을 다시 생성해 `(1)`, `(2)` suffix가 붙는지 확인한다.
6. `TemplateAutomationRuns`에 성공 실행분이 남아 있는지 확인한다.

## 문제 진단

| 증상 | 확인 지점 |
|------|----------|
| 새 템플릿이 새로고침 전 일반 항목으로 보임 | 템플릿 마커 원자 생성, `ensurePageInDatabaseRowOrder`, `databaseRowSources` fallback 필터 |
| 새 템플릿이 새로고침 후에만 목록에 보임 | `addTemplate`의 `dbTemplates` 즉시 갱신, 협업 Y.Doc 이후 templates 업서트, 동일 DB 버전 templates 수신 |
| 새로고침해야 row가 보임 | `publishPageChanged` schema, resolver, runner env, IAM policy, AppSync subscription |
| 생성 페이지 본문에 `{}` 표시 | `normalizeTemplatePageDoc()` 정규화와 common test |
| 제목이 중복됨 | `byDatabaseAndOrder` GSI 조회, `allocateUniqueTemplateAutomationTitle()` |
| 자동화가 아예 실행되지 않음 | Scheduler schedule group, schedule state, target input, runner CloudWatch log |
| 한 실행분이 여러 번 생성됨 | `TemplateAutomationRuns` run id, deterministic page id, existing page branch |
