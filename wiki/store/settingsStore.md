# settingsStore

## 역할
UI 전역 설정(다크모드, 사이드바, 탭, 즐겨찾기, 전체너비 등)과 엔티티 아이콘·설명 캐시를 관리하는 스토어.

## 위치
`src/store/settingsStore.ts`

## State 타입

| 필드 | 타입 | 설명 |
|------|------|------|
| `darkMode` | `boolean` | 다크 모드 활성 여부 |
| `fullWidth` | `boolean` | 전역 전체 너비 설정 |
| `pageFullWidthById` | `Record<string, boolean>` | 페이지별 전체 너비 오버라이드 |
| `fullWidthUpdatedAt` | `number` | 전체 너비 LWW 타임스탬프 (epoch ms) |
| `dbPropertyPanelOpen` | `boolean` | DB 속성 패널 열림 여부 (기본값: true) |
| `entityIcons` | `Record<string, string \| null>` | 엔티티 ID → 아이콘 문자열 |
| `entityDescriptions` | `Record<string, string>` | 엔티티 ID → 설명 문자열 |
| `sidebarWidth` | `number` | 사이드바 너비 (px) |
| `rightPanelWidth` | `number` | 우측 패널 너비 (px) |
| `sidebarCollapsed` | `boolean` | 사이드바 접힘 여부 |
| `favoritePageIds` | `string[]` | 즐겨찾기 페이지 ID 순서 목록 |
| `favoritePageMetaById` | `Record<string, FavoritePageMeta>` | 즐겨찾기 표시용 메타 캐시 |
| `favoritePageIdsUpdatedAt` | `number` | 즐겨찾기 LWW 타임스탬프 (epoch ms) |
| `expandedIds` | `string[]` | 사이드바에서 펼쳐진 페이지 ID 목록 |
| `tabs` | `Tab[]` | 열린 탭 목록 |
| `activeTabIndex` | `number` | 현재 활성 탭 인덱스 |
| `lastClosedTab` | `ClosedTabSnapshot \| null` | 마지막으로 닫은 탭 (다시 열기용) |
| `lastVisitedPageIdByWorkspaceId` | `Record<string, string>` | 워크스페이스별 마지막 방문 페이지 ID |

**`Tab`** 필드: `pageId: string \| null`, `databaseId?: string \| null`, `back?: string[]`, `refreshKey?: number`

**`FavoritePageMeta`** 필드: `pageId`, `workspaceId`, `workspaceName`, `pageTitle`, `pageIcon`

> `favoritePageMetaById` 는 **표시용 캐시**(즐겨찾기 등록 시점 1회 스냅샷)일 뿐 권위 소스가 아니다. 페이지가 현재 워크스페이스에 로드돼 있으면 라이브 `pages[id].title` 이, 미로드면 서버 조회(`fetchPageByIdOnly`)가 권위다. 이 캐시만 믿으면 이름 변경 전 옛 제목이 다른 워크스페이스에서 노출된다 → 교정 경로는 [navigation/overview.md](../navigation/overview.md#즐겨찾기favorites-이동제목-표시-favoriteslisttsx). 워크스페이스 스냅샷은 stale 할 수 있어 제목 교정 소스로 쓰지 않는다.

## 액션 목록

| 액션명 | 파라미터 | 설명 |
|--------|---------|------|
| `setSidebarWidth` | `width` | 사이드바 너비 변경 |
| `setSidebarCollapsed` | `collapsed` | 사이드바 접힘 토글 |
| `openTab` | `pageId \| null` | 새 탭 열기 또는 기존 탭 활성화 |
| `closeTab` | `index` | 탭 닫기 (lastClosedTab 갱신) |
| `setActiveTab` | `index` | 활성 탭 변경 |
| `toggleFavoritePage` | `pageId` | 즐겨찾기 추가/제거. 추가 시 현재 `pages[id].title` 로 메타 스냅샷 기록 |
| `updateFavoritePageMeta` | `pageId, meta, opts?` | 메타 캐시 갱신(`same` 가드로 무변경 시 skip). 제목 교정 진입점 |
| `removeFavoritePage` | `pageId` | 즐겨찾기 제거 |
| `removeFavoritesForPages` | `pageIds` | 여러 페이지 즐겨찾기 일괄 제거 |
| `setEntityIcon` | `id, icon \| null` | 엔티티 아이콘 설정 |
| `setEntityDescription` | `id, description` | 엔티티 설명 설정 |
| `setLastVisitedPageForWorkspace` | `workspaceId, pageId` | 워크스페이스별 마지막 방문 페이지 기록 |

## Persist

- localStorage 키: `quicknote.settings.v1`
- storage: `zustandStorage`
- version: `SETTINGS_STORE_VERSION = 12`
- 마이그레이션 이력 (v2→12): `sidebarCollapsed`, `favoritePageIds`, `pageFullWidthById`, `dbPropertyPanelOpen`, `entityIcons`, `entityDescriptions`, `fullWidthUpdatedAt`, `lastVisitedPageIdByWorkspaceId` 등 필드 추가. v12에서 `schedulerMemberOrder` 필드 제거.
- 마이그레이션 필요 조건: `SettingsState`에 필수 필드 추가·제거 시 version bump

## 의존 관계

- `pageStore` — 탭 정리 시 (`clearTabsForDeletedFullPageDatabases`) 페이지 존재 여부 확인
- `workspaceStore` — `setLastVisitedPageForWorkspace` 에서 워크스페이스 ID 참조
- `src/lib/sync/clientPrefsSync.ts` — `scheduleEnqueueClientPrefs` (즐겨찾기·전체너비 서버 동기화)

## 사용처 (주요 컴포넌트)

- `src/components/layout/Sidebar.tsx`, `PageListItem.tsx` — `sidebarWidth`, `sidebarCollapsed`, `expandedIds`, `favoritePageIds`
- `src/components/TabBar.tsx` — `tabs`, `activeTabIndex`, `openTab`, `closeTab`
- `src/components/Editor.tsx` — `fullWidth`, `pageFullWidthById`
- `src/Bootstrap.tsx` — clientPrefs 서버 동기화 후 `favoritePageIds`, `fullWidth` 적용
