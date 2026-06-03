# IndexedDB Outbox

## 파일
`src/lib/sync/engine.ts`

## 역할
로컬 액션을 즉시 IndexedDB outbox 에 적재하고, AppSync GraphQL 뮤테이션으로 전송.
전송 실패 시 지수 백오프(1s→2s→...→60s)로 재시도.
전송 성공 시 outbox 항목 제거.

## 디버깅: outbox 확인
```
브라우저 DevTools → Application → IndexedDB → (앱명) → outbox 테이블
```
entries 가 있으면 → 뮤테이션이 서버에 전달되지 않은 것 (CDK 미배포 또는 네트워크 문제)

## outbox 가 쌓이는 원인
1. CDK 미배포 → AppSync 스키마 불일치
2. 인터넷 오프라인
3. AppSync API Key 만료
