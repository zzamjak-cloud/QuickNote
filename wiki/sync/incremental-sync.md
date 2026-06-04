# 증분 동기화 (델타 + 워터마크)

워크스페이스 재페치 시 변경분만 받아 AppSync/DynamoDB 비용을 줄이는 메커니즘.

## 핵심 파일
| 파일 | 역할 |
|------|------|
| `src/store/syncWatermarkStore.ts` | 워크스페이스별 마지막 적용 `updatedAt`(ISO) 워터마크. persist 키 `quicknote.sync.watermark.v1` |
| `src/lib/sync/workspaceSnapshotBootstrap.ts` | `fetchApplyWorkspaceRemoteSnapshot({ updatedAfter })` — 전체/델타 모드 분기 |
| `src/lib/sync/bootstrap.ts`, `commentApi.ts` | `fetchPagesByWorkspace`/`fetchDatabasesByWorkspace`/`fetchCommentsByWorkspace(workspaceId, updatedAfter?)` |
| `src/Bootstrap.tsx` | 온라인 복귀 경로에서 델타, 워크스페이스 전환 경로에서 전체 |

## 동작
- `updatedAfter` 가 있으면 **델타 모드**: `listPages/listDatabases/listComments` 가 `updatedAt > updatedAfter` 인 항목만 반환(서버 리졸버는 `byWorkspaceAndUpdatedAt` GSI Query).
- 적용 후 모든 도메인(pages·dbs·comments)이 성공하면 워터마크를 적용 항목들의 **최대 `updatedAt`** 으로 전진시킨다.
- **온라인 복귀**(`Bootstrap.tsx` online 핸들러): 1차 페치는 워터마크 기반 델타. 워터마크가 없으면(첫 동기화) `updatedAfter=undefined` → 자동으로 전체 모드.
- **워크스페이스 전환**: 항상 전체 모드(워터마크 무시) — prune 기준점.

## CRITICAL 회귀 주의
- **델타 모드에서는 절대 prune 하지 않는다.** `reconcileWorkspaceFullSnapshot`(원격에 없는 로컬 항목 삭제)은 **전체 스냅샷에서만** 안전하다. 부분 결과로 prune 하면 변경되지 않은 멀쩡한 항목이 전부 삭제된다. (`workspaceSnapshotBootstrap.ts` 의 `isDelta` 가드)
- **reconcile 콜백에 넘기는 `fetchApply` 는 반드시 전체 모드여야 한다.** `reconcileWorkspaceCacheAfterFlush` 는 워크스페이스 전환 hold 해제 후 캐시를 비우고 재페치할 수 있으므로, 델타로 넘기면 비운 캐시가 일부만 복구된다. (`Bootstrap.tsx` 의 `fetchApplyFull`)
- **워터마크는 모든 도메인 성공 시에만 전진**한다. 한 도메인이라도 실패했는데 전진시키면 그 도메인의 미수신 변경분을 다음 델타에서 영구히 놓친다.
- 하드 삭제(영구삭제/`emptyTrash`)는 구독·델타로 전파되지 않는다 → 다음 **워크스페이스 전환의 전체 prune** 에서 정리된다(설계상 허용).

## 비용 메모
온라인 복귀가 빈번한 환경(노트북 sleep/wake)에서 매번 전체 페치하던 것을 델타로 바꿔 `listPages/Databases/Comments` 요청·전송량을 크게 줄인다. 관련 배포 항목: [infra/cost-optimization-deploy.md](../infra/cost-optimization-deploy.md) #3.
