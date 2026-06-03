# QuickNote Zustand 스토어 구조 분석

**분석일**: 2026-06-03  
**총 스토어**: 28개  
**Persist 활성**: 22개  
**평균 크기**: 265 lines

---

## 스토어별 상세 분석

### databaseStore.ts
**역할**: database store — 데이터베이스 정의, 컬럼, 레코드 등 앱 핵심 데이터 저장

| 항목 | 값 |
|------|-----|
| 파일 크기 | 1424 lines |
| Persist | vDATABASE_STORE_VERSION |
| Storage Key | `quicknote.databases.v1` |
| State 필드 | 5개 |
| Actions | 0개 |

**State 필드** (5개):
- `version` — persist 마이그레이션 버전
- `databases` — Record<dbId, DatabaseMeta> 데이터베이스 객체
- `cacheWorkspaceId` — 캐시의 소속 워크스페이스 ID
- `migrationQuarantine` — 자동 복구 실패 데이터 (사용자 안전을 위해 별도 보관)
- `dbTemplates` — 템플릿 데이터베이스 목록

### pageStore.ts
**역할**: page store — 페이지 계층, 콘텐츠, 메타데이터 저장

| 항목 | 값 |
|------|-----|
| 파일 크기 | 1049 lines |
| Persist | vPAGE_STORE_PERSIST_VERSION |
| Storage Key | `quicknote.pages.v1` |
| State 필드 | 5개 |
| Actions | 0개 |

**State 필드** (5개):
- `pages` — Record<pageId, Page> 페이지 객체
- `activePageId` — 현재 열려있는 페이지
- `cacheWorkspaceId` — 캐시의 소속 워크스페이스 ID
- `migrationQuarantine` — 자동 복구 실패 데이터
- `lastDeletedBatch` — 마지막 삭제된 페이지 배치 (복구용)

### historyStore.ts
**역할**: history store — 페이지/DB 이력, 변경 로그, 삭제된 행 추적

| 항목 | 값 |
|------|-----|
| 파일 크기 | 610 lines |
| Persist | vHISTORY_STORE_VERSION |
| Storage Key | `quicknote.historyStore.v1` |
| State 필드 | 4개 |
| Actions | 0개 |

**State 필드** (4개):
- `pageEventsByPageId` — 페이지별 이력 이벤트
- `dbEventsByDatabaseId` — DB별 이력 이벤트
- `deletedRowTombstonesByDbId` — 삭제된 행의 타임스탬프 (재삽입 추적용)
- `cacheWorkspaceId` — 캐시의 소속 워크스페이스 ID

### schedulerStore.ts
**역할**: scheduler store — 일정(스케줄) 데이터, 일정 조회 API 결과

| 항목 | 값 |
|------|-----|
| 파일 크기 | 602 lines |
| Persist | No (캐시만)
| Storage Key | `quicknote.scheduler.cache.schedules.v1` |

### settingsStore.ts
**역할**: settings store — 사용자 UI 설정 (다크모드, 패널 너비, 아이콘 등)

| 항목 | 값 |
|------|-----|
| 파일 크기 | 528 lines |
| Persist | v2 |
| Storage Key | `quicknote.settings.v1` |
| State 필드 | 8개 |
| Actions | 0개 |

**State 필드** (8개):
- `darkMode` — 다크 테마 활성화 여부
- `fullWidth` — 전역 풀 너비 토글
- `pageFullWidthById` — 페이지별 풀 너비 설정
- `fullWidthUpdatedAt` — 마지막 변경 시각
- `dbPropertyPanelOpen` — DB 속성 패널 오픈 여부
- `entityIcons` — 엔티티별 커스텀 아이콘
- `entityDescriptions` — 엔티티별 설명
- `sidebarWidth` — 사이드바 너비

### authStore.ts
**역할**: auth store — 인증 상태, 사용자 정보, 토큰 관리 (Persist 안 함, 세션 전용)

| 항목 | 값 |
|------|-----|
| 파일 크기 | 472 lines |
| Persist | No (세션 전용) |
| State 필드 | 0개 |
| Actions | 0개 |

**특징**: 로그인 상태(loading/authenticated/anonymous), 사용자 정보, 토큰 갱신 로직을 담당하며, OAuth callback 처리 포함.

### blockCommentStore.ts
**역할**: block comment store — 블록별 댓글(스레드) 메시지

| 항목 | 값 |
|------|-----|
| 파일 크기 | 248 lines |
| Persist | v- (세션 캐시) |
| Storage Key | `quicknote.blockComments.v1` |
| State 필드 | 2개 |
| Actions | 0개 |

**State 필드** (2개):
- `messages` — BlockCommentMsg[] 댓글 메시지 배열
- `threadVisitedAt` — 스레드별 마지막 확인 시각 (로컬 전용)

### uiStore.ts
**역할**: ui store — 현재 워크스페이스 정보, 우측 패널 상태 등 즉시 UI 상태

| 항목 | 값 |
|------|-----|
| 파일 크기 | 248 lines |
| Persist | v- (세션 캐시) |
| Storage Key | `quicknote.ui.v1` |
| State 필드 | 2개 |
| Actions | 0개 |

**State 필드** (2개):
- `workspaceId` — 현재 워크스페이스 ID
- `workspaceName` — 현재 워크스페이스 이름

### schedulerMmStore.ts
**역할**: scheduler mm store — 스케줄러 매월 뷰 데이터 캐시

| 항목 | 값 |
|------|-----|
| 파일 크기 | 222 lines |
| Persist | v- (캐시만) |
| Storage Key | `quicknote.scheduler.cache.mm.v1` |

### notificationStore.ts
**역할**: notification store — 일시 알림 (토스트, 스낵바) 메시지

| 항목 | 값 |
|------|-----|
| 파일 크기 | 207 lines |
| Persist | v2 |
| Storage Key | `quicknote.notifications.v1` |
| State 필드 | 1개 |
| Actions | 0개 |

**State 필드** (1개):
- `items` — Notification[] 알림 아이템 배열

### schedulerProjectsStore.ts
**역할**: scheduler projects store — 프로젝트 목록 캐시

| 항목 | 값 |
|------|-----|
| 파일 크기 | 192 lines |
| Persist | v- (캐시만) |
| Storage Key | `quicknote.scheduler.cache.projects.v1` |

### schedulerViewStore.ts
**역할**: scheduler view store — 스케줄러 UI 상태 (뷰 모드, 확대/축소, 필터 선택 등)

| 항목 | 값 |
|------|-----|
| 파일 크기 | 169 lines |
| Persist | v- (세션 캐시) |
| Storage Key | `quicknote.scheduler.view.v1` |
| State 필드 | 8개 |
| Actions | 0개 |

**State 필드** (8개):
- `schedulerOpen` — 스케줄러 열림 여부
- `viewMode` — 뷰 모드 (주, 월 등)
- `entityMode` — 엔티티 모드 (개인, 팀 등)
- `zoomLevel` — 스케줄러 확대/축소 레벨
- `columnWidthScale` — 컬럼 너비 스케일
- `databaseTimelineItemColumnWidth` — DB 타임라인 컬럼 너비
- `currentYear` — 현재 선택된 연도
- `selectedMemberId` — 선택된 맴버 ID

### workspaceStore.ts
**역할**: workspace store — 워크스페이스 목록, 현재 워크스페이스 (세션 상태)

| 항목 | 값 |
|------|-----|
| 파일 크기 | 158 lines |
| Persist | v- (세션 캐시) |
| Storage Key | `quicknote.workspace.session.v1` |
| State 필드 | 2개 |
| Actions | 0개 |

**State 필드** (2개):
- `currentWorkspaceId` — 현재 워크스페이스 ID
- `workspaces` — 워크스페이스 목록

### memberStore.ts
**역할**: member store — 워크스페이스 맴버 목록, 멘션 후보자 캐시

| 항목 | 값 |
|------|-----|
| 파일 크기 | 140 lines |
| Persist | v- (캐시만) |
| Storage Key | `quicknote.members.cache.v1` |
| State 필드 | 6개 |
| Actions | 0개 |

**State 필드** (6개):
- `me` — 현재 사용자 정보
- `members` — 맴버 목록
- `cacheWorkspaceId` — 캐시의 소속 워크스페이스 ID
- `lastFetchedAt` — 마지막 fetch 시각
- `mentionCandidates` — 멘션 자동완성 후보
- `mentionQuery` — 멘션 검색 쿼리

### schedulerHolidaysStore.ts
**역할**: scheduler holidays store — 공휴일 캐시

| 항목 | 값 |
|------|-----|
| 파일 크기 | 137 lines |
| Persist | v- (캐시만) |
| Storage Key | `quicknote.scheduler.cache.holidays.v1` |

### serverDatabaseHistoryStore.ts
**역할**: server database history store — 서버 DB 히스토리 API 결과 캐시

| 항목 | 값 |
|------|-----|
| 파일 크기 | 136 lines |
| Persist | No (세션만) |

### serverPageHistoryStore.ts
**역할**: server page history store — 서버 페이지 히스토리 API 결과 캐시

| 항목 | 값 |
|------|-----|
| 파일 크기 | 117 lines |
| Persist | No (세션만) |

### databaseViewPrefsStore.ts
**역할**: database view prefs store — DB 뷰별 UI 설정 (패널 상태, 필터 프리셋 등)

| 항목 | 값 |
|------|-----|
| 파일 크기 | 116 lines |
| Persist | vDATABASE_VIEW_PREFS_STORE_VERSION |
| Storage Key | `quicknote.databaseViewPrefs.v1` |
| State 필드 | 2개 |
| Actions | 0개 |

**State 필드** (2개):
- `panelStateByKey` — 뷰별 패널 상태
- `viewByKey` — 뷰별 설정

### customIconStore.ts
**역할**: custom icon store — 커스텀 아이콘 데이터

| 항목 | 값 |
|------|-----|
| 파일 크기 | 97 lines |
| Persist | No (세션만) |

### schedulerMmDashboardViewStore.ts
**역할**: scheduler mm dashboard view store — 스케줄러 대시보드 뷰 상태

| 항목 | 값 |
|------|-----|
| 파일 크기 | 88 lines |
| Persist | v- (캐시만) |
| Storage Key | `quicknote.scheduler.mmDashboard.view.v1` |
| State 필드 | 7개 |
| Actions | 0개 |

**State 필드** (7개):
- `innerTab` — 선택된 탭
- `rangeKind` — 범위 종류
- `weekStart` — 주 시작일
- `year` — 연도
- `monthIndex` — 월 인덱스
- `scope` — 스코프
- `didApplyDefaultScope` — 기본 스코프 적용 여부

### organizationStore.ts
**역할**: organization store — 조직 정보 캐시

| 항목 | 값 |
|------|-----|
| 파일 크기 | 82 lines |
| Persist | v- (캐시만) |
| Storage Key | `quicknote.organizations.cache.v1` |
| State 필드 | 3개 |
| Actions | 0개 |

**State 필드** (3개):
- `organizations` — 조직 목록
- `cacheWorkspaceId` — 캐시의 소속 워크스페이스 ID
- `lastFetchedAt` — 마지막 fetch 시각

### teamStore.ts
**역할**: team store — 팀 정보 캐시

| 항목 | 값 |
|------|-----|
| 파일 크기 | 79 lines |
| Persist | v- (캐시만) |
| Storage Key | `quicknote.teams.cache.v1` |
| State 필드 | 3개 |
| Actions | 0개 |

**State 필드** (3개):
- `teams` — 팀 목록
- `cacheWorkspaceId` — 캐시의 소속 워크스페이스 ID
- `lastFetchedAt` — 마지막 fetch 시각

### databaseInlineUiPrefsStore.ts
**역할**: database inline ui prefs store — DB 인라인 UI 설정

| 항목 | 값 |
|------|-----|
| 파일 크기 | 60 lines |
| Persist | v- (캐시만) |
| Storage Key | `quicknote.database-inline-ui-prefs.v1` |

### workspaceOptionsStore.ts
**역할**: workspace options store — 워크스페이스 옵션 (직무, 직책 등 공통 옵션)

| 항목 | 값 |
|------|-----|
| 파일 크기 | 59 lines |
| Persist | No (세션만) |
| State 필드 | 4개 |
| Actions | 0개 |

**State 필드** (4개):
- `jobFunctions` — 직무 목록
- `jobTitles` — 직책 목록
- `jobCategories` — 직군 분류
- `jobDetails` — 직무 상세

### searchFilterPrefsStore.ts
**역할**: search filter prefs store — 검색 필터 프리셋 설정

| 항목 | 값 |
|------|-----|
| 파일 크기 | 51 lines |
| Persist | v- (캐시만) |
| Storage Key | `quicknote.search-filter-prefs.v1` |

### schedulerFiltersStore.ts
**역할**: scheduler filters store — 스케줄러 필터 (조직, 팀 필터)

| 항목 | 값 |
|------|-----|
| 파일 크기 | 47 lines |
| Persist | v- (캐시만) |
| Storage Key | `quicknote.scheduler.filters.v1` |
| State 필드 | 2개 |
| Actions | 0개 |

**State 필드** (2개):
- `disabledOrgIds` — 비활성화된 조직 ID 목록
- `disabledTeamIds` — 비활성화된 팀 ID 목록

### navigationHistoryStore.ts
**역할**: navigation history store — 브라우저 이전/다음 이력 관리

| 항목 | 값 |
|------|-----|
| 파일 크기 | 43 lines |
| Persist | No (세션만) |

### workspaceAccessCacheStore.ts
**역할**: workspace access cache store — 워크스페이스 접근 권한 캐시

| 항목 | 값 |
|------|-----|
| 파일 크기 | 34 lines |
| Persist | v- (캐시만) |
| Storage Key | `quicknote.workspace.access.cache.v1` |

---

## 스토어 분류

### 1. Core Data Stores (앱 데이터 동기화, 강필수 Persist)

앱의 실제 데이터를 저장하며, 로컬스토리지 + IndexedDB outbox 동기화로 운영되는 핵심 스토어.

- **databaseStore.ts** (1424L, vDATABASE_STORE_VERSION)
  - State: version, databases, cacheWorkspaceId, migrationQuarantine, dbTemplates
  - 역할: 모든 데이터베이스 정의, 컬럼 스키마, 템플릿 저장

- **pageStore.ts** (1049L, vPAGE_STORE_PERSIST_VERSION)
  - State: pages, activePageId, cacheWorkspaceId, migrationQuarantine, lastDeletedBatch
  - 역할: 페이지 계층, 콘텐츠 메타데이터, 삭제 배치 추적

- **historyStore.ts** (610L, vHISTORY_STORE_VERSION)
  - State: pageEventsByPageId, dbEventsByDatabaseId, deletedRowTombstonesByDbId, cacheWorkspaceId
  - 역할: 변경 이력, 삭제된 행 타임스탬프 (복구/추적용)

### 2. Settings & Preferences (사용자 설정 저장)

사용자의 UI/UX 설정을 저장하며, 로컬스토리지에 persist됨.

- **settingsStore.ts** (528L, v2)
  - 다크 모드, 패널 너비, 풀 너비 토글 등

- **databaseViewPrefsStore.ts** (116L, vDATABASE_VIEW_PREFS_STORE_VERSION)
  - DB 뷰별 패널 상태, 필터 프리셋

- **databaseInlineUiPrefsStore.ts** (60L, v-)
  - DB 인라인 UI 설정

- **searchFilterPrefsStore.ts** (51L, v-)
  - 검색 필터 프리셋

### 3. UI State (UI 표시 상태, 세션 캐시)

현재 화면에 표시되는 상태로, 세션 종료 시 초기화됨.

- **blockCommentStore.ts** (248L)
  - 댓글 메시지, 스레드 방문 시각

- **uiStore.ts** (248L)
  - 현재 워크스페이스 정보

- **notificationStore.ts** (207L, v2)
  - 토스트/스낵바 알림

- **workspaceStore.ts** (158L)
  - 워크스페이스 목록, 현재 워크스페이스

- **memberStore.ts** (140L)
  - 맴버 목록, 멘션 후보자 캐시

### 4. Scheduler Feature (일정 관리 기능)

스케줄러 모듈의 전용 스토어 클러스터.

- **schedulerStore.ts** (602L)
  - 일정 데이터, 일정 조회 API 결과

- **schedulerMmStore.ts** (222L)
  - 매월 뷰 캐시

- **schedulerProjectsStore.ts** (192L)
  - 프로젝트 목록 캐시

- **schedulerViewStore.ts** (169L)
  - 뷰 모드, 확대/축소, 선택 필터 등 UI 상태

- **schedulerHolidaysStore.ts** (137L)
  - 공휴일 캐시

- **schedulerMmDashboardViewStore.ts** (88L)
  - 대시보드 뷰 상태

- **schedulerFiltersStore.ts** (47L)
  - 조직/팀 필터 상태

### 5. Cache & Session (임시 캐시, 세션 전용)

AppSync 동기화에서 fetch한 데이터를 메모리에만 보관하고, 필요시 재페치하는 스토어.

- **organizationStore.ts** (82L)
  - 조직 목록 (fetch 기반)

- **teamStore.ts** (79L)
  - 팀 목록 (fetch 기반)

- **serverDatabaseHistoryStore.ts** (136L)
  - 서버 DB 히스토리 API 캐시

- **serverPageHistoryStore.ts** (117L)
  - 서버 페이지 히스토리 API 캐시

- **workspaceOptionsStore.ts** (59L)
  - 워크스페이스 공통 옵션 (직무, 직책)

- **navigationHistoryStore.ts** (43L)
  - 브라우저 이전/다음 이력

- **customIconStore.ts** (97L)
  - 커스텀 아이콘 데이터

- **authStore.ts** (472L)
  - 인증 상태, 사용자 정보, 토큰 관리

- **workspaceAccessCacheStore.ts** (34L)
  - 워크스페이스 접근 권한

---

## 의존성 관계

```
┌─────────────────────────────────────────┐
│     Core Data (AppSync 동기화)           │
├─────────────────────────────────────────┤
│ pageStore ↔ databaseStore ↔ historyStore │
│ 1049L       1424L           610L         │
│ pages       databases       history logs │
└─────────────────────────────────────────┘
           ↓ (변경 시 IndexedDB outbox 적재)
     ┌──────────────────┐
     │ AppSync GraphQL  │
     │ WebSocket 구독   │
     └──────────────────┘
           ↓ (성공)
     outbox 제거, UI 리플레시

┌──────────────────────────────────┐
│    Settings & Preferences        │
├──────────────────────────────────┤
│ settingsStore (v2)               │
│ databaseViewPrefsStore (v정수)   │
│ databaseInlineUiPrefsStore       │
│ searchFilterPrefsStore           │
└──────────────────────────────────┘
      ↓ (사용자 설정 저장)
  localStorage
  키: quicknote.*.v1

┌──────────────────────────────────┐
│   UI State (세션 캐시)            │
├──────────────────────────────────┤
│ uiStore                          │
│ workspaceStore                   │
│ blockCommentStore                │
│ memberStore                      │
│ notificationStore (v2)           │
└──────────────────────────────────┘
  (세션 종료 시 초기화)

┌──────────────────────────────────┐
│   Scheduler Cluster              │
├──────────────────────────────────┤
│ schedulerStore (핵심)            │
│ schedulerViewStore (UI 상태)     │
│ schedulerMmStore, ... (캐시)     │
└──────────────────────────────────┘

┌──────────────────────────────────┐
│   Cache (AppSync fetch)          │
├──────────────────────────────────┤
│ memberStore                      │
│ organizationStore                │
│ teamStore                        │
│ workspaceStore                   │
│ (네트워크 복구 시 재페치)        │
└──────────────────────────────────┘

┌──────────────────────────────────┐
│   Auth (세션 전용)               │
├──────────────────────────────────┤
│ authStore (Persist 안 함)        │
│ customIconStore                  │
│ navigationHistoryStore           │
└──────────────────────────────────┘
```

---

## Persist 마이그레이션 버전 정리

| 스토어 | 현재 버전 | 저장소 키 |
|--------|---------|----------|
| pageStore | PAGE_STORE_PERSIST_VERSION | `quicknote.pages.v1` |
| databaseStore | DATABASE_STORE_VERSION | `quicknote.databases.v1` |
| historyStore | HISTORY_STORE_VERSION | `quicknote.historyStore.v1` |
| settingsStore | 2 | `quicknote.settings.v1` |
| notificationStore | 2 | `quicknote.notifications.v1` |
| databaseViewPrefsStore | DATABASE_VIEW_PREFS_STORE_VERSION | `quicknote.databaseViewPrefs.v1` |
| blockCommentStore | - (캐시) | `quicknote.blockComments.v1` |
| uiStore | - (캐시) | `quicknote.ui.v1` |
| 기타 캐시 스토어 | - | `quicknote.*.cache.v1` |
| authStore | No | - |
| navigationHistoryStore | No | - |
| customIconStore | No | - |

---

## 권장사항

### Selector 패턴 준수
- `useXxxStore()` 호출 금지 (전체 state 리렌더)
- 항상 selector 사용: `useXxxStore(s => s.fieldName)`
- 다중 필드: `useShallow((s) => ({ field1: s.field1, field2: s.field2 }))`

### Persist 변경 시
- **필수 필드 추가/삭제/이름 변경** → version bump 필수
- **선택적 필드 추가** → 기본값 있으면 version bump 불필요
- `migrate()` 함수에서 마이그레이션 로직 구현

### 동기화 흐름
1. 로컬 액션 → Zustand 업데이트 (즉시 UI 반영)
2. IndexedDB outbox 적재
3. AppSync 뮤테이션 전송
4. 성공: outbox 제거 | 실패: 지수 백오프 재시도

### 네트워크 복구 시
- AppSync 구독 자동 재연결
- 원격 전체 재페치
- outbox flush (오프라인 중 쌓인 mutations 전송)
