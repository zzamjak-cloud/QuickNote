# databaseViewPrefsStore

## 역할
DB별 뷰 종류(table/timeline/gallery 등)와 패널 상태(필터·정렬·그룹 설정)를 워크스페이스 단위로 로컬 persist하는 Zustand 스토어.

## 위치
`src/store/databaseViewPrefsStore.ts`

## 주요 exports
| 이름 | 종류 | 설명 |
|------|------|------|
| `useDatabaseViewPrefsStore` | Zustand store hook | 뷰 설정 구독/변경 |
| `DatabaseViewPrefsStore` | 타입 | State + Actions 합성 타입 |
| `DATABASE_VIEW_PREFS_STORE_VERSION` | 상수 (`1`) | persist 버전 |

## 상태 (State)
| 필드 | 타입 | 설명 |
|------|------|------|
| `panelStateByKey` | `Record<string, unknown>` | `{workspaceId}:{databaseId}` 키 → `DatabasePanelState` |
| `viewByKey` | `Record<string, ViewKind>` | `{workspaceId}:{databaseId}` 키 → 현재 뷰 종류 |

## 주요 액션
| 액션 | 파라미터 | 설명 |
|------|---------|------|
| `getPanelState` | `(databaseId, fallbackJson?) => DatabasePanelState` | 패널 상태 조회. 없으면 `emptyPanelState()` 반환 |
| `patchPanelState` | `(databaseId, patch, fallbackJson?) => void` | 패널 상태 부분 업데이트 |
| `getView` | `(databaseId, fallback?) => ViewKind` | 현재 뷰 종류 조회 |
| `setView` | `(databaseId, view) => void` | 뷰 종류 변경 |

## 키 구조
스토어 내부적으로 `{currentWorkspaceId}:{databaseId}` 형태의 복합 키를 사용한다 (`viewPrefsKey` 함수). 워크스페이스가 없을 경우 `"local"` 접두사 사용.

## persist 설정
| 항목 | 값 |
|------|-----|
| storage | `zustandStorage` (localStorage 기반) |
| version | `DATABASE_VIEW_PREFS_STORE_VERSION` (1) |

## 의존 관계
- **사용하는 스토어**: `useWorkspaceStore` (currentWorkspaceId 조회)
- **사용하는 타입**: `DatabasePanelState`, `ViewKind` (`src/types/database`)
- **이 스토어를 사용하는 주요 파일**: `DatabaseBlockView.tsx` (뷰 전환 및 패널 상태 읽기/쓰기)

## 주의사항
- 패널 상태는 `coercePanelState`로 항상 `emptyPanelState()` 기본값과 병합되어 반환되므로, 저장된 값이 불완전해도 안전하다.
- 워크스페이스 단위 키를 사용하므로 워크스페이스 전환 시 이전 워크스페이스의 뷰 설정이 그대로 유지된다.
- `databaseStore`의 `patchDatabasePanelState`와 역할이 다름: 이 스토어는 UI 로컬 표시 설정 전용이고, `databaseStore`의 패널 상태 패치는 동기화 payload에도 반영된다.
