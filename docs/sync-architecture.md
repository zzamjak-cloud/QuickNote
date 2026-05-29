# Sync Architecture

QuickNote sync는 로컬 우선 편집, outbox 전송, AppSync 원격 반영, LWW 충돌 해결로 구성된다.

## Flow

1. 사용자가 페이지 또는 DB를 수정한다.
2. Zustand store가 즉시 갱신되어 UI가 먼저 반영된다.
3. 변경 payload가 outbox에 enqueue된다.
4. sync engine이 outbox를 AppSync GraphQL mutation으로 flush한다.
5. 원격 subscription 또는 bootstrap fetch가 변경을 다시 수신한다.
6. `storeApply`가 LWW 규칙으로 로컬 store에 적용한다.

## Outbox

Outbox는 네트워크 실패와 오프라인 작업을 흡수하는 durable queue다.

- Web: IndexedDB adapter를 사용한다.
- Tauri: SQLite adapter를 사용한다.
- 같은 entity에 대한 반복 upsert는 dedupe key로 최신 payload만 남긴다.
- flush 순서는 page/database/comment 관계를 고려해 정렬한다.
- 반복 실패나 더 이상 처리할 수 없는 entry는 dead letter로 이동할 수 있다.

워크스페이스 전환 시 pending outbox가 있으면 캐시 삭제를 보류한다. 이 규칙은 미전송 로컬 변경을 원격 snapshot으로 잃지 않기 위한 안전장치다.

## LWW Rules

LWW는 `updatedAt`을 기준으로 원격과 로컬 중 더 최신 값을 선택한다.

- remote `deletedAt` tombstone은 삭제 신호로 처리한다.
- local이 더 최신이면 remote snapshot을 무시한다.
- 페이지 구조(parent/order/databaseId)는 동일 timestamp라도 drift가 있으면 보정할 수 있다.
- 로컬 삭제 직후 늦게 도착한 remote upsert는 local delete guard로 무시할 수 있다.

## Bootstrap And Subscription

인증 후 bootstrap은 현재 workspace의 pages, databases, comments, client prefs를 가져와 store에 적용한다. 이후 AppSync subscription이 같은 workspace의 변경을 수신한다.

온라인 복귀 시에는 다음을 수행한다.

- 원격 snapshot 재페치
- subscription 재연결
- outbox flush 재시도

LC 스케줄러 protected DB는 일반 workspace와 다른 공유 scope를 포함할 수 있으므로, workspace guard와 local delete guard에서 별도 정책을 확인해야 한다.

## Database Serialization

DB column과 preset은 AppSync에서 AWSJSON string으로 오간다.

- local-to-GQL: `toGqlDatabase`가 `serializeColumns`, `serializePresets`를 사용한다.
- GQL-to-local: `applyRemoteDatabaseToStore`가 `parseSerializedColumns`, `parseSerializedPresets`를 사용한다.
- persist migration: `migrateDatabaseStore`가 `normalizeDatabaseBundle`을 사용한다.

이 세 경로가 같은 schema module을 사용해야 column config 손실을 막을 수 있다.

## Deployment Checklist

배포 전 다음 항목을 순서대로 확인한다.

- `git status`로 미커밋 변경과 infra 변경 여부를 확인한다.
- `infra/` 또는 GraphQL schema가 바뀌었으면 CDK 배포를 프론트 배포보다 먼저 완료한다.
- `Page`, `Database`, `ColumnDef`, `DatabaseRowPreset`의 필수 field가 바뀌었으면 persist version bump와 migration test를 준비한다.
- AWSJSON column/preset payload가 바뀌었으면 AppSync resolver fixture를 추가하거나 갱신한다.
- `npm run -s typecheck`를 통과시킨다.
- 관련 Vitest suite를 통과시킨다.
- `infra/lambda/v5-resolvers/handlers/pageDatabase.test.ts` 같은 resolver fixture를 통과시킨다.
- `git diff --check`로 whitespace error가 없는지 확인한다.

## Recovery Notes

데이터가 사라진 것처럼 보이면 먼저 outbox를 확인한다. outbox에 pending entry가 있으면 서버 반영이 아직 끝나지 않은 상태일 수 있다.

확인 순서:

- 브라우저 DevTools 또는 Tauri SQLite에서 outbox entry 확인
- AppSync resolver log 확인
- localStorage/Zustand persist snapshot 확인
- GraphQL schema와 deployed resolver가 프론트 payload를 받는지 확인

로컬 캐시 초기화는 최후 수단이다. 초기화 전 pending outbox와 원격 데이터 존재를 확인해야 한다.
