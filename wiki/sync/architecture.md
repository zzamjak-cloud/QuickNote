# 동기화 아키텍처

## 소스 오브 트루스
```
AppSync (원격)  ←  진실의 원천
localStorage    ←  빠른 첫 렌더용 캐시 (원격 스냅샷)
```

## 워크스페이스 초기 로드 전략 (분할 로드)

워크스페이스가 커져도 쾌적하게 동작하도록 **메타 먼저, 본문·행은 필요 시** 방식으로 전환됐다.

```
1단계: 메타 스냅샷 로드 (항상)
  fetchApplyWorkspaceRemoteMetaSnapshot()
  ├─ listPageMetas (제목·아이콘·parentId 등 메타만, doc 제외)
  ├─ listDatabases
  └─ listComments
  → 사이드바·트리 즉시 렌더 가능

2단계: 페이지 본문 지연 로드 (열 때)
  ensurePageContentLoaded(pageId)
  ├─ metaOnlyByPageId[pageId] 확인
  ├─ fetchPageById(workspaceId, pageId)
  └─ applyRemotePageToStore() + refreshWorkspaceSnapshot()

3단계: 외부 보호 DB 행 배치 로드 (DB 접근 시)
  ensureExternalProtectedDatabaseLoaded(databaseId)
  ├─ fetchDatabaseById() + fetchDatabaseRowsBatch() 병렬
  ├─ nextToken 저장 → loadMoreExternalProtectedDatabaseRows() (페이지네이션)
  └─ schema 미지원 서버 → legacy 전체 스냅샷 fallback
```

**예외(전체 스냅샷 경로):**
- `no-cache` 상태이면서 `listPageMetas` API가 응답 후 캐시가 여전히 비어 있는 경우 → `fetchApplyWorkspaceRemoteSnapshot`(전체) fallback 자동 실행

## fetchMode 결정 (delta vs full)

`resolveWorkspaceRemoteFetchMode()` → `WorkspaceRemoteFetchMode` 반환

| 조건 | 모드 | reason |
|------|------|--------|
| 캐시 없음 | full | `no-cache` |
| watermark 없음 | full | `no-watermark` |
| switchResult.cleared | full | `cache-cleared` |
| reason: deferred-switch / pending-outbox / initial-cache-mismatch / switched | full | 해당 reason |
| 위 조건 모두 미해당 | **delta** | `cache-watermark` |

delta 모드는 `updatedAfter = watermark` 이후 변경분만 페치하며 **절대 prune 하지 않는다**.

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
  → delta 또는 full 재페치 (fetchMode 결정)
  → outbox flush (오프라인 중 쌓인 mutations 전송)
```

## 핵심 파일

| 파일 | 역할 |
|------|------|
| `src/lib/sync/engine.ts` | IndexedDB outbox, 뮤테이션 전송, 재시도 |
| `src/lib/sync/subscribers.ts` | AppSync WebSocket 구독 재연결 |
| `src/lib/sync/storeApply.ts` | LWW 충돌 해결 |
| `src/lib/sync/workspaceFetchMode.ts` | delta/full 모드 결정 로직 |
| `src/lib/sync/workspaceSnapshotBootstrap.ts` | 메타·전체 스냅샷 페치 및 적용 |
| `src/lib/sync/pageContentLoad.ts` | 페이지 본문 지연 로드 |
| `src/lib/sync/externalProtectedDatabaseLoad.ts` | 외부 보호 DB 행 배치·페이지네이션 로드 |
| `src/store/pageContentLoadStore.ts` | metaOnly 상태 추적 (persist) |
| `src/store/databaseRowRemoteStore.ts` | DB 행 nextToken·로딩 상태 (persist) |
| `src/Bootstrap.tsx` | 초기 로드 및 동기화 시작 |

## 관련 위키
- [incremental-sync.md](incremental-sync.md) — delta/watermark 상세
- [page-content-load.md](page-content-load.md) — 페이지 본문 지연 로드
- [external-protected-database-load.md](external-protected-database-load.md) — 외부 DB 행 배치 로드
- [outbox.md](outbox.md)
- [conflict-resolution.md](conflict-resolution.md)
