# Persisted Store Migration Policy

QuickNote persisted stores must preserve user data across schema changes.

## Rules

- Keep an explicit persist `version` for each store.
- Add a migration for every persisted shape change.
- Prefer `migratePersistedStore` so migrations run in version order.
- Keep migrations idempotent: running the same app version repeatedly must not keep changing data.
- Never mix workspace-scoped caches without a workspace marker.
- If a persisted cache cannot prove it belongs to the current workspace, clear the cache before first paint and refetch from the server.
- If the outbox has pending mutations, preserve local cache and defer destructive cleanup.
- Add focused tests for migration and hydration behavior.

## Workspace-Scoped Caches

`pageStore` and `databaseStore` persist `cacheWorkspaceId`.

On bootstrap:

- matching `cacheWorkspaceId` keeps the cache for fast first paint.
- missing or mismatched `cacheWorkspaceId` clears page/database cache before rendering stale data.
- clearing also resets active page and tabs to avoid stale page ids.

This policy favors correctness over first-paint convenience whenever cache ownership is uncertain.
