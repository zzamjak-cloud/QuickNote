# workspaceStore

## 역할
사용자가 접근 가능한 워크스페이스 목록과 현재 선택된 워크스페이스 ID를 관리하는 스토어.

## 위치
`src/store/workspaceStore.ts`

## State 타입

| 필드 | 타입 | 설명 |
|------|------|------|
| `currentWorkspaceId` | `string \| null` | 현재 선택된 워크스페이스 ID |
| `workspaces` | `WorkspaceSummary[]` | 접근 가능한 워크스페이스 목록 |

**`WorkspaceSummary`** 필드:

| 필드 | 타입 | 설명 |
|------|------|------|
| `workspaceId` | `string` | 워크스페이스 고유 ID |
| `name` | `string` | 워크스페이스 이름 |
| `type` | `WorkspaceType` | `"personal"` \| `"shared"` |
| `ownerMemberId` | `string` | 소유자 멤버 ID |
| `myEffectiveLevel` | `WorkspaceAccessLevel` | `"edit"` \| `"view"` |

## 액션 목록

| 액션명 | 파라미터 | 설명 |
|--------|---------|------|
| `setCurrentWorkspaceId` | `workspaceId \| null` | 현재 워크스페이스 변경 및 sessionStorage에 저장 |
| `setWorkspaces` | `workspaces` | 전체 목록 교체. 빈 배열이면 기존 유지 (레이스 방지) |
| `upsertWorkspace` | `workspace` | 특정 워크스페이스 추가 또는 갱신 |
| `removeWorkspace` | `workspaceId` | 특정 워크스페이스 제거. 현재 선택된 것이면 fallback으로 전환 |
| `clear` | 없음 | 전체 초기화 |

## Persist

- localStorage 키: `quicknote.workspace.session.v1`
- storage: `sessionStorage` (탭 단위 격리 — `tabWorkspaceStorage`)
- 저장 필드: `currentWorkspaceId` 만 저장 (workspaces 목록은 저장 안 함)
- version: 없음 (단순 구조)

## 의존 관계

- `src/lib/scheduler/scope.ts` — `LC_SCHEDULER_WORKSPACE_ID`, `LC_SCHEDULER_WORKSPACE_NAME` (시스템 워크스페이스 상수)
- `LC_SCHEDULER_WORKSPACE_SUMMARY` — 항상 목록에 포함되는 내장 워크스페이스 (삭제 불가)
- `pageStore` — 워크스페이스 전환 시 pages 캐시 무효화 기준

## 사용처 (주요 컴포넌트)

- `src/Bootstrap.tsx` — 로그인 후 워크스페이스 목록 페치 및 `setWorkspaces` 호출
- `src/components/WorkspaceSwitcher.tsx` — 워크스페이스 선택 UI
- `src/store/pageStore/helpers.ts` — `getCurrentWorkspaceId()` 에서 참조
- `src/store/blockCommentStore.ts` — `getCurrentWorkspaceId()` 에서 참조
