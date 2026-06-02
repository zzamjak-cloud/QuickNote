# QuickNote Project Keywords

## Repository

- cwd: `D:/0_Client/QuickNote`
- stack: React, TypeScript, Vite, Tailwind CSS, Zustand, TipTap, Tauri, AWS AppSync, Lambda, DynamoDB, CDK
- response language: Korean; identifiers and technical terms in English
- code comments and docs: Korean

## Core Files

- Bootstrap and initial sync: `src/Bootstrap.tsx`
- Page store: `src/store/pageStore.ts`
- Database store: `src/store/databaseStore.ts`
- Sync engine and outbox: `src/lib/sync/engine.ts`
- Remote apply and LWW: `src/lib/sync/storeApply.ts`
- AppSync subscribers: `src/lib/sync/subscribers.ts`
- GraphQL schema: `infra/lib/sync/schema.graphql`
- V5 resolver handlers: `infra/lambda/v5-resolvers/handlers/`
- Database full page: `src/components/database/DatabaseFullPageStandalone.tsx`

## Database Timeline Keywords

- General DB timeline view: `src/components/database/views/DatabaseTimelineView.tsx`
- Timeline geometry helpers: `src/lib/database/timelineGeometry.ts`
- Timeline card sticky labels: `src/components/database/timelineCardStickyOffset.ts`
- Regression keyword: item click focus scroll should align `start date - 1 day` to the first visible date cell next to the sticky item column, not center the card
- Related tests: `src/lib/database/__tests__/timelineFocusScroll.test.ts`, `src/components/database/views/__tests__/DatabaseTimelineView.workspaceSwitch.test.tsx`

## LC Scheduler Keywords

- Modal: `src/components/scheduler/LCSchedulerModal.tsx`
- Database timeline: `src/components/scheduler/SchedulerDatabaseTimeline.tsx`
- Annual grid: `src/components/scheduler/ScheduleGrid.tsx`
- Scheduler date/grid helpers: `src/lib/scheduler/dateUtils.ts`, `src/lib/scheduler/gridUtils.ts`
- Scope: `src/lib/scheduler/scope.ts`
- Protected DB schema: `src/lib/scheduler/database.ts`
- Recent cost optimization keywords: Schedules read index, range fetch, previous/current/next month, `fetchScheduleRange`, local cache, 10GB cache quota

## Sync Contract Keywords

- For new syncable DB/Page fields, check the whole chain: local source of truth, GraphQL serialization, remote apply, schema, Lambda resolver normalization
- Database serialization: `src/store/databaseStore/helpers.ts`, `src/lib/sync/queries/database.ts`
- Resolver normalization: `infra/lambda/v5-resolvers/handlers/pageDatabase.ts`
- AppSync schema changes require CDK deploy before relying on web deployment

## Verification Commands

- Frontend tests: `npm run test:run`
- Targeted test: `npm run test:run -- <test paths>`
- TypeScript: `npm run typecheck`
- Frontend build: `npm run build`
- Infra tests: `cd infra && npm test`
- Infra build: `cd infra && npm run build`
- CDK deploy when infra/schema/resolver changed: from `infra`, set `CDK_DEFAULT_ACCOUNT` and `CDK_DEFAULT_REGION`, then run `npm run deploy -- --require-approval never`
