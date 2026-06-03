# LWW 충돌 해결

## 파일
`src/lib/sync/storeApply.ts`

## 전략: Last-Write-Wins (LWW)
원격에서 수신한 변경과 로컬 상태가 충돌할 때 **타임스탬프가 최신인 쪽** 이 승리.

## 적용 시점
AppSync WebSocket 구독을 통해 원격 변경 수신 시 `storeApply` 호출.

## 주의
- 동일 타임스탬프: 원격 우선
- 오프라인 중 쌓인 로컬 변경은 네트워크 복구 후 outbox flush 로 원격에 전송되며, 이후 구독으로 다시 수신될 수 있음 (idempotent 처리 필요)
