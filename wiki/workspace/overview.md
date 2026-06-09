# 워크스페이스

## 파일

| 파일 | 역할 |
|------|------|
| `src/store/workspaceStore.ts` | 워크스페이스 선택·설정 |
| `src/store/workspaceAccessCacheStore.ts` | 접근 권한 캐시 |
| `src/store/organizationStore.ts` | 조직 정보 |
| `src/components/workspace/` | 권한 관리 UI |
| `src/components/sidebar/` | 워크스페이스 전환 사이드바 |
| `infra/lambda/v5-resolvers/handlers/workspace.ts` | 워크스페이스 생성·수정 resolver |

## 워크스페이스 구조
```
Organization
└── Workspace (1개 이상)
    └── Pages, Databases
```

## 멤버 역할
`memberStore` 에서 멤버 목록 및 역할(Owner/Member/Guest) 관리.
워크스페이스별 접근 권한은 `workspaceAccessCacheStore` 에 캐시.

## 생성 저장 실패처럼 보이는 경우

증상: 신규 워크스페이스 생성 모달에서 제목과 권한을 입력한 뒤 저장하면 빨간 오류가 뜨지만,
창을 닫고 새로고침하면 워크스페이스가 실제로 생성되어 있다.

원인 후보: AppSync mutation 이 DynamoDB write 는 완료했지만 GraphQL 응답 직렬화에서 실패한 상태다.
`Workspace` 스키마의 non-null 필드(`options` 등)를 `createWorkspace` resolver 반환값이 빠뜨리면
클라이언트는 저장 실패로 처리하고 즉시 `workspaceStore` 에 반영하지 못한다.

회귀 방지:
- `infra/lambda/v5-resolvers/handlers/workspace.ts` 의 `createWorkspace` 반환값은 `Workspace!`의 모든 non-null 필드를 채운다.
- resolver 수정 뒤에는 dev backend 배포(`cd infra && npm run deploy:dev`)까지 완료해야 개발 빌드에 반영된다.
- 프론트 보강은 `src/components/settings/AdminWorkspacesTab.tsx` 에서 생성 mutation 실패 후 `listMyWorkspacesApi` 재조회로
  저장 전 없던 같은 이름의 새 shared 워크스페이스가 확인될 때만 성공 복구한다.

회귀 테스트:
- `infra/lambda/v5-resolvers/handlers/workspace.test.ts`
- `src/components/settings/__tests__/AdminWorkspacesTab.test.tsx`

## 전환
사이드바에서 워크스페이스 선택 → `workspaceStore.activeWorkspaceId` 업데이트 → 해당 워크스페이스 페이지 로드

## 진입 랜딩 (첫 인덱스 페이지 리셋)

워크스페이스 진입(전환·새로고침·강제 새로고침) 시 **항상 첫 인덱스(루트) 페이지로 리셋**한다.
직전에 보던 페이지·풀페이지 DB 탭을 복원하지 않는다.

- `applyWorkspaceLanding(workspaceId, { forceFirstRoot: true })` (`src/lib/sync/workspaceLanding.ts`)
  - `forceFirstRoot` 시: 활성 탭의 `databaseId`·`lastVisitedPageIdByWorkspaceId` 를 무시하고
    `getFirstRootSidebarPageId` 결과로 탭·activePage 를 덮어쓴다.
  - 첫 인덱스 후보는 반드시 현재 `workspaceId` 소속 페이지만 사용한다.
  - 일반 워크스페이스에서는 LC 보호 DB(작업·마일스톤·피처) 페이지/블록을 후보에서 제외한다.
- Bootstrap 의 모든 데이터 적용 경로에서 `landingForceFirstRoot: true` 로 호출.
- 앱 최초 마운트에서는 URL 의 `?page=` 를 복원하지 않는다. 새로고침 landing 은 항상 첫 인덱스가 권위이며,
  stale `?page=...` 는 landing 후 현재 active page URL 로 교정한다.

**이유**: 풀페이지 DB 탭을 복원하면 `ensureFullPagePageForDatabase` 가 메타 상태에서 홈을
재생성해 ghost(중복 풀페이지 홈)가 생긴다. 진입 화면을 결정적으로 고정해 이 회귀를 차단한다.
새로고침 레이스 보강으로 `uiStore.workspaceBootstrapping` 구간에는 자동 홈 생성을 막는다.
상세: [ghost-page-prevention.md](../pages/ghost-page-prevention.md)

**회귀 테스트**:
- `src/__tests__/sync/workspaceLanding.test.ts`
- `src/__tests__/sync/workspaceSwitch.test.ts`
- `src/store/pageStore/__tests__/selectors.test.ts`
