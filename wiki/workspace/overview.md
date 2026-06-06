# 워크스페이스

## 파일

| 파일 | 역할 |
|------|------|
| `src/store/workspaceStore.ts` | 워크스페이스 선택·설정 |
| `src/store/workspaceAccessCacheStore.ts` | 접근 권한 캐시 |
| `src/store/organizationStore.ts` | 조직 정보 |
| `src/components/workspace/` | 권한 관리 UI |
| `src/components/sidebar/` | 워크스페이스 전환 사이드바 |

## 워크스페이스 구조
```
Organization
└── Workspace (1개 이상)
    └── Pages, Databases
```

## 멤버 역할
`memberStore` 에서 멤버 목록 및 역할(Owner/Member/Guest) 관리.
워크스페이스별 접근 권한은 `workspaceAccessCacheStore` 에 캐시.

## 전환
사이드바에서 워크스페이스 선택 → `workspaceStore.activeWorkspaceId` 업데이트 → 해당 워크스페이스 페이지 로드

## 진입 랜딩 (첫 인덱스 페이지 리셋)

워크스페이스 진입(전환·새로고침·강제 새로고침) 시 **항상 첫 인덱스(루트) 페이지로 리셋**한다.
직전에 보던 페이지·풀페이지 DB 탭을 복원하지 않는다.

- `applyWorkspaceLanding(workspaceId, { forceFirstRoot: true })` (`src/lib/sync/workspaceLanding.ts`)
  - `forceFirstRoot` 시: 활성 탭의 `databaseId`·`lastVisitedPageIdByWorkspaceId` 를 무시하고
    `getFirstRootSidebarPageId` 결과로 탭·activePage 를 덮어쓴다.
- Bootstrap 의 모든 데이터 적용 경로에서 `landingForceFirstRoot: true` 로 호출.

**이유**: 풀페이지 DB 탭을 복원하면 `ensureFullPagePageForDatabase` 가 메타 상태에서 홈을
재생성해 ghost(중복 풀페이지 홈)가 생긴다. 진입 화면을 결정적으로 고정해 이 회귀를 차단한다.
새로고침 레이스 보강으로 `uiStore.workspaceBootstrapping` 구간에는 자동 홈 생성을 막는다.
상세: [ghost-page-prevention.md](../pages/ghost-page-prevention.md)
