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
- `fetchApplyWorkspaceRemoteMetaSnapshot()` 호출 → 페이지 메타(제목·아이콘·`fullPageDatabaseId` 등)만 수신, doc 제외
- **nextToken 자동 루프**: 첫 배치(100개) 이후 `nextToken`이 있으면 자동으로 다음 배치를 순차 로드 → 페이지 수 제한 없음. 각 배치마다 워터마크도 전진.
- 메타 적용 후 캐시가 여전히 비어 있으면 `fetchApplyWorkspaceRemoteSnapshot()`(전체) fallback
- **효과**: 워크스페이스가 아무리 커도 첫 로드가 빠름; 페이지 본문은 열 때 지연 로드

### 2. 델타 모드 (캐시 있음 + watermark 있음)
- `fetchApplyWorkspaceRemoteSnapshot({ updatedAfter: watermark })` — 변경분만
- 델타 적용 후 캐시가 비어 있으면 전체 fallback 자동 실행 (`delta-empty-cache-fallback`)
- **서버**: `byWorkspaceAndUpdatedAt` GSI Query로 `updatedAt > updatedAfter` 항목만 반환

### 3. 전체 모드 (워크스페이스 전환·캐시 초기화 등)
- `fetchApplyWorkspaceRemoteSnapshot()` (updatedAfter 없음) — 전체 스냅샷
- **페이지** prune (`reconcileWorkspacePagesFullSnapshot`) 가능한 유일한 경로

## DB 는 항상 전체 조회 + 증분에서도 prune (2026-06-21)

DB 목록은 워크스페이스당 소수(보통 수십 개)라 `updatedAfter` 를 무시하고 **항상 전체 조회**한다
(`fetchDatabasesByWorkspace(workspaceId)`, 댓글이 항상 전체 조회인 것과 동일 패턴). 그 권위 있는
전체 목록으로 **delta·meta 경로에서도** 좀비 DB 를 prune 한다(`reconcileWorkspaceDatabasesFullSnapshot`).

- **이유**: prune 이 전체 스냅샷 경로에만 있으면, 캐시 보유 복귀 사용자는 항상 delta 만 타므로
  서버에서 사라진 DB(과거 노션 임포트·삭제 반복으로 로컬 캐시에만 남은 중복 DB)가 영구 잔존했다.
  → DB 관리 팝업에 **동일 제목 DB 가 2개씩** 표시되는 증상. 서버에는 1건뿐, 로컬 좀비가 원인이었다.
- **DB 번들(`databases` 맵)만 제거하고 그 DB 의 행 페이지는 건드리지 않는다.** 행 페이지 meta 는
  멘션·페이지링크가 아이콘/이동을 해석하는 근거(`listPageMetas` 로 로드)라, 여기서 지우면
  멀쩡한 멘션이 깨진다(행 페이지가 서버에 살아있어도 delta 로는 복구 안 됨). 진짜 좀비 행 페이지
  (서버에도 없음)는 전체 스냅샷의 `reconcileWorkspacePagesFullSnapshot` 가 안전하게 정리한다.
- 보존 규칙: `remoteDatabaseIds`(서버 생존)·`pendingUpsertDatabaseIds`(outbox 대기)·보호 DB(LC)·
  다른 워크스페이스 DB 는 prune 대상에서 제외.

## 동작
- 적용 후 모든 도메인(pages·dbs·comments)이 성공하면 워터마크를 **최대 `updatedAt`** 으로 전진.
- 메타 모드(`fetchApplyWorkspaceRemoteMetaSnapshot`)도 동일하게 워터마크 전진.

## CRITICAL 회귀 주의
- **페이지는 델타 모드에서 절대 prune 하지 않는다.** `reconcileWorkspacePagesFullSnapshot`은 **전체 스냅샷에서만** 안전하다. 부분 결과로 prune 하면 변경되지 않은 페이지가 전부 삭제된다. (`workspaceSnapshotBootstrap.ts`의 `isDelta` 가드)
- **DB prune 은 delta 에서도 안전**한데, 오직 DB 를 항상 전체 조회하기 때문이다. DB fetch 를 다시 `updatedAfter` 증분으로 바꾸면 부분 목록으로 prune 하게 되어 멀쩡한 DB 가 삭제된다 — 절대 되돌리지 말 것.
- **reconcile 콜백에 넘기는 `fetchApply` 는 반드시 전체 모드여야 한다.** `reconcileWorkspaceCacheAfterFlush`는 캐시를 비우고 재페치하므로, 델타로 넘기면 비운 캐시가 일부만 복구된다. (`Bootstrap.tsx`의 `fetchApplyFull`)
- **워터마크는 모든 도메인 성공 시에만 전진**한다. 한 도메인이라도 실패하면 보류.
- 하드 삭제(영구삭제/`emptyTrash`)된 **페이지**는 구독·델타로 전파되지 않는다 → 다음 **워크스페이스 전환의 전체 prune**에서 정리(설계상 허용). **DB** 는 위처럼 매 동기화 prune 되므로 즉시 정리된다.
- `listPageMetas` API 미배포 서버에서는 schema 에러 감지 → 경고 로그만 남기고 전체 스냅샷 fallback 대기.
- `listPageMetas`는 **`byWorkspaceAndUpdatedAt` GSI(ALL 프로젝션)** 를 사용한다. 과거의 `byWorkspaceMetaUpdatedAt`(INCLUDE 프로젝션)은 `fullPageDatabaseId` 같은 신규 속성을 추가할 수 없어 GSI를 교체했다. CDK 배포 없이 Lambda IndexName 변경만으로 전환 가능.
- **nextToken 미처리 버그 회귀 주의**: `fetchApplyWorkspaceRemoteMetaSnapshot` 내부에서 nextToken 루프를 직접 돌린다. `loadMorePageMetas`(pageMetasLoad.ts)는 별도 외부 호출용이므로 Bootstrap 경로에서 호출하지 않는다.

## 비용 메모
- 분할 로드: 초기 `listPageMetas`는 doc 필드를 제외하므로 RCU·전송량 대폭 절감.
- 델타: 온라인 복귀마다 전체 페치하던 것을 변경분만 수신 → AppSync 요청·DynamoDB RCU 절감.
- 관련 배포 항목: [infra/cost-optimization-deploy.md](../infra/cost-optimization-deploy.md) #3.
