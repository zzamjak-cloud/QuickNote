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
  ├─ listPageMetas (제목·아이콘·parentId·fullPageDatabaseId 등 메타만, doc 제외)
  │   └─ GSI: byWorkspaceAndUpdatedAt (ALL 프로젝션) — 페이지 수 무제한
  │       nextToken 자동 루프 → 100개 초과 워크스페이스도 전부 로드
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
- LC 스케줄러 워크스페이스에서 `마일스톤 DB`, `피처 DB`, `작업 DB` 루트 페이지가 빠진 캐시가 감지되면 → page meta token/watermark 를 초기화하고 `forceMetaBaseline` 으로 재조회

### LC 스케줄러 루트 DB 페이지 결손 복구

개발/라이브 origin 별 IndexedDB 캐시가 갈라진 상태에서 LC 보호 DB 정의와 row cache 는 남아 있는데
사이드바 루트 페이지(`마일스톤 DB`, `피처 DB`, `작업 DB`)만 빠질 수 있다. 이 상태에서 watermark 가
해당 루트 페이지의 `updatedAt` 보다 최신이면 delta 모드는 오래된 루트 페이지를 다시 받지 못한다.

복구 경로:
1. `src/lib/sync/lcSchedulerWorkspaceRepair.ts` 가 LC 워크스페이스 루트 페이지 3개 존재 여부를 검사한다.
   - meta-only 페이지는 제목으로 인정한다.
   - 사용자가 제목을 바꾼 경우 첫 `databaseBlock` 의 protected DB id 로도 인정한다.
2. `src/Bootstrap.tsx` 는 결손 감지 시 `databaseRowRemote`, `pageContentLoad`, `pageMetaRemote`, `syncWatermark` 를 초기화한다.
3. 이어서 `fetchApply({ forceMetaBaseline: true })` 로 서버 메타를 baseline 재조회한다.
4. `createLCSchedulerRootPageRepairGate()` 는 같은 앱 실행 세션에서 동일 워크스페이스 repair 를 1회만 허용한다. 루트 페이지가 복구되면 gate 는 다시 열린다.

상세 판정 기준과 회귀 체크는 [lc-scheduler-workspace-repair.md](lc-scheduler-workspace-repair.md)를 참조한다.

## Ghost 페이지 방지 (풀페이지 DB 홈 페이지)

풀페이지 DB를 생성하면 홈 페이지가 사이드바에 중복 표시(`ghost`)될 수 있다.

**방지 체계:**
- `upsertPage` 시 `fullPageDatabaseId` 필드를 함께 저장 (클라이언트 → 서버 → DynamoDB)
- `listPageMetas` 응답에 `fullPageDatabaseId` 포함 → 동기화 시 클라이언트 수신
- `isHiddenInSidebar` selector: `fullPageDatabaseId` 있으면 `true` → 사이드바 필터링

**레거시 backfill:** 기존 생성 항목(dev 22건, live 24건)은 일괄 `fullPageDatabaseId` 설정 완료.

관련: [ghost-page-prevention.md](../pages/ghost-page-prevention.md)

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
| `src/lib/sync/lcSchedulerWorkspaceRepair.ts` | LC 스케줄러 루트 DB 페이지 결손 감지 및 repair gate |
| `src/lib/sync/pageContentLoad.ts` | 페이지 본문 지연 로드 |
| `src/lib/sync/externalProtectedDatabaseLoad.ts` | 외부 보호 DB 행 배치·페이지네이션 로드 |
| `src/store/pageContentLoadStore.ts` | metaOnly 상태 추적 (persist) |
| `src/store/databaseRowRemoteStore.ts` | DB 행 nextToken·로딩 상태 (persist) |
| `src/Bootstrap.tsx` | 초기 로드 및 동기화 시작 |

## 관련 위키
- [incremental-sync.md](incremental-sync.md) — delta/watermark 상세
- [lc-scheduler-workspace-repair.md](lc-scheduler-workspace-repair.md) — LC 스케줄러 루트 DB 페이지 결손 복구
- [page-content-load.md](page-content-load.md) — 페이지 본문 지연 로드
- [external-protected-database-load.md](external-protected-database-load.md) — 외부 DB 행 배치 로드
- [outbox.md](outbox.md)
- [conflict-resolution.md](conflict-resolution.md)
