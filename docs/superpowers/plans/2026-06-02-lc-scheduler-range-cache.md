# LC Scheduler Range Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LC Scheduler가 현재 사용 범위 중심으로 일정 데이터를 읽고, 웹/로컬 캐시를 10GB LRU 정책으로 관리하도록 만든다.

**Architecture:** 기존 Page/Database는 source of truth로 유지하고, 기존 `Schedules` 테이블을 LC schedule page read index로 재사용한다. 클라이언트는 3개월 window 단위로 `listSchedules`를 호출하고, page/database snapshot 대조는 `updatedAfter` watermark 기반으로 낮춘다.

**Tech Stack:** React, Zustand, Vitest, AWS AppSync, Lambda TypeScript, DynamoDB, Tauri SQLite.

---

### Task 1: Scheduler Window Helpers

**Files:**
- Create: `src/lib/scheduler/rangeWindow.ts`
- Create: `src/lib/scheduler/__tests__/rangeWindow.test.ts`
- Modify: `src/components/scheduler/LCSchedulerModal.tsx`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import { getSchedulerFetchWindow } from "../rangeWindow";

describe("getSchedulerFetchWindow", () => {
  it("returns previous current next month for the visible scheduler year", () => {
    const result = getSchedulerFetchWindow({
      currentYear: 2026,
      now: new Date("2026-06-02T00:00:00.000Z"),
    });
    expect(result.from).toBe("2026-05-01T00:00:00.000Z");
    expect(result.to).toBe("2026-07-31T23:59:59.999Z");
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `npm run test:run -- src/lib/scheduler/__tests__/rangeWindow.test.ts`

- [ ] **Step 3: Implement helper and replace full-year fetch**

`getSchedulerFetchWindow` returns the 3-month ISO window. `LCSchedulerModal` uses it instead of `startOfYear`/`endOfYear`.

- [ ] **Step 4: Run passing test**

Run: `npm run test:run -- src/lib/scheduler/__tests__/rangeWindow.test.ts`

### Task 2: Schedule Index Projection

**Files:**
- Create: `infra/lambda/v5-resolvers/handlers/lcScheduleIndex.ts`
- Create: `infra/lambda/v5-resolvers/handlers/lcScheduleIndex.test.ts`
- Modify: `infra/lambda/v5-resolvers/handlers/pageDatabase.ts`
- Modify: `infra/lambda/v5-resolvers/handlers/schedule.ts`
- Modify: `infra/lib/sync/schema.graphql`
- Modify: `src/lib/sync/queries/schedule.ts`

- [ ] **Step 1: Write failing projection tests**

Test that one LC schedule page with two assignees becomes two index rows and that non-scheduler pages produce no rows.

- [ ] **Step 2: Run failing infra test**

Run: `cd infra && npm test -- lambda/v5-resolvers/handlers/lcScheduleIndex.test.ts`

- [ ] **Step 3: Implement projection and resolver sync**

`syncLCScheduleIndexForPage` deletes existing `pageId#` rows by query and writes current rows. `removeLCScheduleIndexForPage` deletes existing rows on soft delete.

- [ ] **Step 4: Extend listSchedules filters**

Add optional `organizationId`, `teamId`, `projectId`, `assigneeId` args and apply them in the resolver query filter expression.

- [ ] **Step 5: Run infra tests**

Run: `cd infra && npm test -- lambda/v5-resolvers/handlers/lcScheduleIndex.test.ts lambda/v5-resolvers/handlers/pageDatabase.test.ts`

### Task 3: Client Schedule Range Cache

**Files:**
- Modify: `src/store/schedulerStore.ts`
- Modify: `src/lib/sync/queries/schedule.ts`
- Create: `src/store/__tests__/schedulerStore.rangeFetch.test.ts`

- [ ] **Step 1: Write failing store test**

Test that `fetchSchedules` calls AppSync for the requested 3-month range and does not call full workspace page fetch on cache hit.

- [ ] **Step 2: Run failing frontend test**

Run: `npm run test:run -- src/store/__tests__/schedulerStore.rangeFetch.test.ts`

- [ ] **Step 3: Implement range fetch path**

For LC workspace, call `listSchedules` for the visible window, keep local projection fallback, and preserve optimistic local updates.

- [ ] **Step 4: Run passing frontend test**

Run: `npm run test:run -- src/store/__tests__/schedulerStore.rangeFetch.test.ts`

### Task 4: Incremental Reconcile Watermark

**Files:**
- Modify: `src/store/schedulerStore.ts`
- Create: `src/lib/scheduler/schedulerReconcileCache.ts`
- Create: `src/lib/scheduler/__tests__/schedulerReconcileCache.test.ts`

- [ ] **Step 1: Write failing watermark tests**

Test that a successful reconcile stores the max `updatedAt` and the next reconcile passes it as `updatedAfter`.

- [ ] **Step 2: Run failing test**

Run: `npm run test:run -- src/lib/scheduler/__tests__/schedulerReconcileCache.test.ts`

- [ ] **Step 3: Implement watermark cache**

Store per-workspace watermark under a `.cache.` key so it can be pruned safely and rebuilt.

- [ ] **Step 4: Run passing test**

Run: `npm run test:run -- src/lib/scheduler/__tests__/schedulerReconcileCache.test.ts`

### Task 5: 10GB Web and Tauri Cache Quota

**Files:**
- Create: `src/lib/storage/cacheQuota.ts`
- Modify: `src/lib/storage/web.ts`
- Modify: `src/lib/media/mediaBlobCache.ts`
- Modify: `src/lib/storage/tauri.ts`
- Add: `src-tauri/migrations/002_kv_cache_metadata.sql`
- Modify: `src-tauri/src/lib.rs`
- Create: `src/lib/storage/__tests__/cacheQuota.test.ts`

- [ ] **Step 1: Write failing quota tests**

Test hard limit is 10GB, target is 9GB, and old cache entries are selected before newer entries.

- [ ] **Step 2: Run failing test**

Run: `npm run test:run -- src/lib/storage/__tests__/cacheQuota.test.ts`

- [ ] **Step 3: Implement shared quota helper**

Use `CACHE_HARD_LIMIT_BYTES`, `CACHE_PRUNE_TARGET_BYTES`, and `selectCacheKeysToPrune`.

- [ ] **Step 4: Add Tauri SQLite metadata**

Add `updated_at` and `size` columns and update `tauriStorage.setItem` to write them.

- [ ] **Step 5: Run passing test**

Run: `npm run test:run -- src/lib/storage/__tests__/cacheQuota.test.ts`

### Task 6: Final Verification

**Files:**
- All touched files.

- [ ] **Step 1: Run frontend tests**

Run: `npm run test:run`

- [ ] **Step 2: Run frontend typecheck**

Run: `npm run typecheck`

- [ ] **Step 3: Run infra tests**

Run: `cd infra && npm test`

- [ ] **Step 4: Run infra build**

Run: `cd infra && npm run build`

- [ ] **Step 5: Review diff**

Run: `git diff --stat` and `git diff --check`.
