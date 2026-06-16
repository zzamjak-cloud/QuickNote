# Zustand 스토어 목록

## 규칙
- `useXxxStore()` 전체 구독 금지 → 단일 selector 또는 `useShallow` 사용
- 자세한 규칙: `.claude/rules/store-selector.md`

## 스토어 목록

| 스토어 파일 | 역할 |
|------------|------|
| `src/store/pageStore.ts` | 페이지 CRUD, 제목/아이콘 (persist) |
| `src/store/databaseStore.ts` | DB 행·열·뷰 (persist) |
| `src/store/databaseViewPrefsStore.ts` | 뷰 필터·정렬·패널 상태 |
| `src/store/authStore.ts` | 로그인 상태, 사용자 정보 |
| `src/store/memberStore.ts` | 멤버 목록, 역할 |
| `src/store/teamStore.ts` | 팀 메타데이터 |
| `src/store/workspaceStore.ts` | 워크스페이스 선택·설정 |
| `src/store/organizationStore.ts` | 조직 정보 |
| `src/store/schedulerStore.ts` | 스케줄 데이터 → [schedulerStore.md](schedulerStore.md) |
| `src/store/schedulerViewStore.ts` | 스케줄러 뷰 상태 |
| `src/store/schedulerFiltersStore.ts` | 스케줄러 필터 |
| `src/store/schedulerHolidaysStore.ts` | 스케줄러 공휴일(graphql 호출은 `lib/sync/schedulerHolidaysApi.ts` 로 분리) |
| `src/store/schedulerProjectsStore.ts` | 스케줄러 프로젝트(graphql 호출은 `lib/sync/schedulerProjectsApi.ts` 로 분리) |
| `src/store/schedulerMmStore.ts` | 스케줄러 M/M(graphql 호출은 `lib/sync/schedulerMmApi.ts` 로 분리) |
| `src/store/blockCommentStore.ts` | 댓글 스레드 |
| `src/store/historyStore.ts` | 로컬 버전 히스토리 |
| `src/store/serverPageHistoryStore.ts` | 서버 버전 히스토리 |
| `src/store/searchFilterPrefsStore.ts` | 검색 필터 설정 |
| `src/store/settingsStore.ts` | 앱 설정 |
| `src/store/notificationStore.ts` | 알림 목록 |
| `src/store/navigationHistoryStore.ts` | 페이지 네비게이션 이력 |
| `src/store/uiStore.ts` | 전역 UI 상태 |
| `src/store/workspaceAccessCacheStore.ts` | 워크스페이스 접근 권한 캐시 |
| `src/store/assetCacheStore.ts` | 자산 목록 세션 캐시(새로고침 전용 갱신) → [settings/assets.md](../settings/assets.md) |
| `src/store/customIconStore.ts` | 워크스페이스 공유 커스텀 아이콘 캐시(메모리 전용, 구독 페이로드로 증분 반영) |
| `src/store/syncWatermarkStore.ts` | 워크스페이스별 증분 동기화 워터마크(persist) → [sync/incremental-sync.md](../sync/incremental-sync.md) |
| `src/store/databaseGroupCollapseStore.ts` | DB 그룹화 접힘 상태(로컬 전용) → [database/grouping.md](../database/grouping.md) |

## persist 적용 스토어
`pageStore`, `databaseStore` — localStorage 키: `quicknote.pages.v1`, `quicknote.databases.v1`

버전 관리: [schema-versioning.md](schema-versioning.md)
