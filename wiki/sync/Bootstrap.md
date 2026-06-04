# Bootstrap.tsx

## 역할
인증 상태 변화를 감지해 전체 동기화 부트스트랩(페치·구독·outbox flush)을 조율하고, `/auth/callback` 리다이렉트를 처리하는 루트 컴포넌트.

## 위치
`src/Bootstrap.tsx`

## 주요 exports
| 이름 | 종류 | 설명 |
|------|------|------|
| `Bootstrap` | React component | 앱 진입점. `useSyncBootstrap` 훅을 호출하고 경로에 따라 `App` 또는 `AuthCallback` 렌더 |
| `useSyncBootstrap` | hook (내부) | 인증·워크스페이스 상태 변화에 반응해 동기화 라이프사이클 전체를 관리 |

## 주요 함수
| 함수명 | 파라미터 | 반환값 | 설명 |
|--------|---------|--------|------|
| `useSyncBootstrap` | — | `void` | 두 개의 useEffect/useLayoutEffect로 인증 부트스트랩과 워크스페이스 동기화를 분리 관리 |
| `fetchApply` | — | `Promise<void>` | 원격 스냅샷 전체 페치 + LWW 적용 + 마이그레이션 |

## 동작 흐름

### 인증 부트스트랩 (`authStatus === "authenticated"` 감지)
1. `listMyWorkspacesApi()` → `setWorkspaces()` — 본인 워크스페이스 목록 적재
2. `preloadWorkspaceSnapshots()` — 전체 워크스페이스 스냅샷 사전 로드
3. `flushClientPrefsToServerNow()` — 즐겨찾기 등 clientPrefs 서버 동기화
4. `refreshWorkspaceMeta(LC_SCHEDULER_WORKSPACE_ID)` — 스케줄러 메타 갱신
5. 알림 비동기 로드 (`fetchMyNotificationsApi`)

### 워크스페이스 동기화 (`currentWorkspaceId` 변경 감지, `useLayoutEffect`)
1. `applyWorkspaceSwitch(prevWorkspaceId, currentWorkspaceId)` — 전환 이유 판정
2. `resolveWorkspaceRemoteFetchMode(...)` — delta/full/meta 경로 결정
   - `cacheAvailable`: cacheBelongsToCurrentWorkspace && pageContentCacheAvailable
   - `switchCleared`, `switchReason`, `watermark` 참조
3. `fetchApply()` 실행 (내부 경로 분기):
   - `useMetaBaseline`(no-cache full): `fetchApplyWorkspaceRemoteMetaSnapshot()` → 캐시 비어 있으면 전체 fallback
   - delta 모드: `fetchApplyWorkspaceRemoteSnapshot({ updatedAfter })` → 캐시 비어 있으면 전체 fallback
   - full 모드: `fetchApplyWorkspaceRemoteSnapshot()`
   - `migrateLegacyBlockCommentsToPagesOnce()` / `migratePageBlockCommentsToServerOnce()`
4. `startSubscriptions(currentWorkspaceId, handlers)` — 실시간 구독 시작
   - LC 스케줄러는 항상 별도 구독 유지 (`unsubLcScheduler`)
5. `engine.flush()` — 오프라인 중 쌓인 outbox 전송
6. `reconcileWorkspaceCacheAfterFlush()` — flush 후 캐시 정합성 검증 (전체 모드 `fetchApplyFull` 사용)
7. cleanup: `unsub()`, `unsubLcScheduler()`, `shutdownSyncEngine()`

### 온라인 복귀 핸들러
- `window 'online'` 이벤트 → fetchMode 결정 후 delta 또는 full 재페치

### Bootstrap 컴포넌트
- `window.location.pathname === "/auth/callback"` → `AuthCallback` 렌더
- 나머지 → `App` 렌더
- `onDone`을 `useCallback`으로 안정화 (인라인 함수 사용 시 `handleCallback` 중복 호출 버그 발생)

## 외부 의존
- `useAuthStore`, `useWorkspaceStore`, `useUiStore`, `usePageStore`
- `startSubscriptions` (`src/lib/sync`)
- `applyRemotePageToStore`, `applyRemoteDatabaseToStore`, `applyRemoteCommentToStore`
- `applyWorkspaceSwitch`, `reconcileWorkspaceCacheAfterFlush`
- `getSyncEngine`, `shutdownSyncEngine` (`src/lib/sync/runtime`)
- `fetchApplyWorkspaceRemoteSnapshot`
- `useSchedulerStore`, `useSchedulerProjectsStore`

## 주의사항
- 초기 마운트(`startedForRef.current === null`)에서는 persist 복원 캐시를 유지해 첫 렌더 빈 화면 방지
- 워크스페이스 전환 시 160ms 디바운스 후 로딩 UI 표시 (`startWorkspaceLoadingTimer`)
- LC 스케줄러 워크스페이스는 부트스트랩에서 미리 페치하지 않음 — 사이드바 누수 및 지연 방지
- `tryRecoverQuarantine` 호출로 격리된 데이터 복구 시도
- `cancelled` 플래그로 마운트 해제 후 비동기 콜백 실행 방지
