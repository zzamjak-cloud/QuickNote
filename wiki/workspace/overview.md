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
