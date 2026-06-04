# 증분 동기화 (델타 + 워터마크)

워크스페이스 재페치 시 변경분만 받아 AppSync/DynamoDB 비용을 줄이는 메커니즘.

## 핵심 파일
| 파일 | 역할 |
|------|------|
| `src/store/syncWatermarkStore.ts` | 워크스페이스별 마지막 적용 `updatedAt`(ISO) 워터마크. persist 키 `quicknote.sync.watermark.v1` |
| `src/lib/sync/workspaceFetchMode.ts` | `resolveWorkspaceRemoteFetchMode()` — delta/full 결정 순수 함수 |
| `src/lib/sync/workspaceSnapshotBootstrap.ts` | `fetchApplyWorkspaceRemoteSnapshot` / `fetchApplyWorkspaceRemoteMetaSnapshot` — 전체/메타/델타 모드 |
| `src/lib/sync/bootstrap.ts`, `commentApi.ts` | `fetchPageMetasByWorkspace`/`fetchPagesByWorkspace`/`fetchDatabasesByWorkspace`/`fetchCommentsByWorkspace(workspaceId, updatedAfter?)` |
| `src/Bootstrap.tsx` | fetchMode 결정 후 meta·delta·full 경로 분기 |

## fetchMode 결정 (`resolveWorkspaceRemoteFetchMode`)

```
cacheAvailable = cacheBelongsToCurrentWorkspace && pageContentCacheAvailable

no-cache       → full (reason: "no-cache")       → useMetaBaseline=true (메타 먼저)
no-watermark   → full (reason: "no-watermark")
cache-cleared  → full (reason: "cache-cleared")
deferred-switch / pending-outbox /
  initial-cache-mismatch / switched → full
그 외           → delta (updatedAfter = watermark, reason: "cache-watermark")
```

## 세 가지 페치 경로

### 1. 메타 베이스라인 (첫 방문 / 캐시 없음)
- 조건: `fetchMode.kind === "full" && fetchMode.reason === "no-cache"`
- `fetchApplyWorkspaceRemoteMetaSnapshot()` 호출 → 페이지 메타(제목·아이콘 등)만 수신, doc 제외
- 메타 적용 후 캐시가 여전히 비어 있으면 `fetchApplyWorkspaceRemoteSnapshot()`(전체) fallback
- **효과**: 워크스페이스가 아무리 커도 첫 로드가 빠름; 페이지 본문은 열 때 지연 로드

### 2. 델타 모드 (캐시 있음 + watermark 있음)
- `fetchApplyWorkspaceRemoteSnapshot({ updatedAfter: watermark })` — 변경분만
- 델타 적용 후 캐시가 비어 있으면 전체 fallback 자동 실행 (`delta-empty-cache-fallback`)
- **서버**: `byWorkspaceAndUpdatedAt` GSI Query로 `updatedAt > updatedAfter` 항목만 반환

### 3. 전체 모드 (워크스페이스 전환·캐시 초기화 등)
- `fetchApplyWorkspaceRemoteSnapshot()` (updatedAfter 없음) — 전체 스냅샷
- prune (`reconcileWorkspaceFullSnapshot`) 실행 가능한 유일한 경로

## 동작
- 적용 후 모든 도메인(pages·dbs·comments)이 성공하면 워터마크를 **최대 `updatedAt`** 으로 전진.
- 메타 모드(`fetchApplyWorkspaceRemoteMetaSnapshot`)도 동일하게 워터마크 전진.

## CRITICAL 회귀 주의
- **델타 모드에서는 절대 prune 하지 않는다.** `reconcileWorkspaceFullSnapshot`은 **전체 스냅샷에서만** 안전하다. 부분 결과로 prune 하면 변경되지 않은 항목이 전부 삭제된다. (`workspaceSnapshotBootstrap.ts`의 `isDelta` 가드)
- **reconcile 콜백에 넘기는 `fetchApply` 는 반드시 전체 모드여야 한다.** `reconcileWorkspaceCacheAfterFlush`는 캐시를 비우고 재페치하므로, 델타로 넘기면 비운 캐시가 일부만 복구된다. (`Bootstrap.tsx`의 `fetchApplyFull`)
- **워터마크는 모든 도메인 성공 시에만 전진**한다. 한 도메인이라도 실패하면 보류.
- 하드 삭제(영구삭제/`emptyTrash`)는 구독·델타로 전파되지 않는다 → 다음 **워크스페이스 전환의 전체 prune**에서 정리(설계상 허용).
- `listPageMetas` API 미배포 서버에서는 schema 에러 감지 → 경고 로그만 남기고 전체 스냅샷 fallback 대기.

## 비용 메모
- 분할 로드: 초기 `listPageMetas`는 doc 필드를 제외하므로 RCU·전송량 대폭 절감.
- 델타: 온라인 복귀마다 전체 페치하던 것을 변경분만 수신 → AppSync 요청·DynamoDB RCU 절감.
- 관련 배포 항목: [infra/cost-optimization-deploy.md](../infra/cost-optimization-deploy.md) #3.
