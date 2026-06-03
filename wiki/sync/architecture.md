# 동기화 아키텍처

## 소스 오브 트루스
```
AppSync (원격)  ←  진실의 원천
localStorage    ←  빠른 첫 렌더용 캐시 (원격 스냅샷)
```

## 흐름

### 로컬 액션 → 원격
```
로컬 액션 (createPage 등)
  → Zustand 스토어 업데이트 (즉시 UI 반영)
  → IndexedDB outbox 적재 (src/lib/sync/engine.ts)
  → AppSync GraphQL 뮤테이션 전송
  → 성공: outbox 에서 제거
  → 실패: 지수 백오프 재시도 (1s → 2s → ... → 60s)
```

### 원격 변경 수신
```
AppSync 구독 (WebSocket)
  → LWW 충돌 해결 (src/lib/sync/storeApply.ts)
  → Zustand 스토어 업데이트
```

### 네트워크 복구 시
```
window 'online' 이벤트
  → AppSync 구독 즉시 재연결
  → 원격 전체 재페치 (fetchPagesByWorkspace)
  → outbox flush (오프라인 중 쌓인 mutations 전송)
```

## 핵심 파일

| 파일 | 역할 |
|------|------|
| `src/lib/sync/engine.ts` | IndexedDB outbox, 뮤테이션 전송, 재시도 |
| `src/lib/sync/subscribers.ts` | AppSync WebSocket 구독 재연결 |
| `src/lib/sync/storeApply.ts` | LWW 충돌 해결 |
| `src/Bootstrap.tsx` | 초기 로드 및 동기화 시작 |

## 관련 위키
- [outbox.md](outbox.md)
- [conflict-resolution.md](conflict-resolution.md)
