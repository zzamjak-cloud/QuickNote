# databaseStore

## 역할
데이터베이스(열, 행, 셀, 필터, 프리셋, 템플릿) 전체 로컬 상태를 관리하는 Zustand persist 스토어.

## 위치
`src/store/databaseStore.ts`

## 주요 exports
| 이름 | 종류 | 설명 |
|------|------|------|
| `useDatabaseStore` | Zustand store hook | 컴포넌트에서 DB 상태/액션 구독 |
| `migrateDatabaseStore` | 함수 (re-export) | persist 버전 마이그레이션 로직 |
| `normalizeDbTitle` | 함수 (re-export) | DB 제목 정규화 (중복 검사용) |
| `DatabaseStore` | 타입 | State + Actions 합성 타입 |

## 상태 (State)
| 필드 | 타입 | 설명 |
|------|------|------|
| `version` | `number` | DB_STORE_VERSION 상수값 |
| `databases` | `DbMap` | `Record<databaseId, DatabaseBundle>` |
| `cacheWorkspaceId` | `string \| null` | 현재 캐시가 속한 워크스페이스. null이면 미확정 캐시 |
| `migrationQuarantine` | `PersistedQuarantine[]` | 자동 복구 실패한 persisted 원본 보관 (삭제 금지) |
| `dbTemplates` | `Record<string, DatabaseTemplate[]>` | DB별 템플릿 목록 (로컬 전용) |

## 주요 액션
| 액션 | 파라미터 | 설명 |
|------|---------|------|
| `createDatabase` | `(title?: string) => string` | 새 DB 생성, ID 반환 |
| `deleteDatabase` | `(id: string) => void` | DB 영구 삭제. 블록만 지울 때는 호출하지 않음 |
| `setDatabaseTitle` | `(id, title) => boolean` | 제목 변경. 정규화 후 중복이면 false 반환 |
| `patchDatabasePanelState` | `(databaseId, patch) => void` | 필터 프리셋 탭·뷰 설정을 동기화 payload에 반영 |
| `addRow` | `(databaseId) => string` | 새 행(Page) 생성, pageId 반환 |
| `importRowsBatch` | `(databaseId, existingSeedPageId, rows) => string[]` | 여러 행 일괄 가져오기 |
| `deleteRow` | `(databaseId, pageId) => void` | 행 삭제 |
| `setCellValue` | `(databaseId, pageId, columnId, value) => void` | 셀 값 설정 |
| `updatePageLinkCell` | `(databaseId, pageId, columnId, linkedPageId) => void` | pageLink 셀 업데이트 |
| `orderedPageIds` | `(databaseId) => string[]` | 정렬된 행 ID 목록 반환 |
| `attachPageAsRow` | `(databaseId, pageId) => void` | 기존 페이지를 DB 행으로 연결 |
| `detachRowToNormalPage` | `(databaseId, pageId) => void` | DB 행을 일반 페이지로 분리 |
| `restoreDatabaseFromLatestHistory` | `(databaseId) => void` | 최신 히스토리로 DB 복원 |
| `restoreDatabaseFromHistoryEvent` | `(databaseId, eventId) => void` | 특정 이벤트로 DB 복원 |
| `restoreDeletedRowFromHistory` | `(databaseId, pageId) => void` | 삭제된 행 복원 |
| `getBundle` | `(databaseId) => DatabaseBundle \| undefined` | DB 번들 조회 |
| `resolveBundle` | `(databaseId) => DatabaseBundle \| undefined` | getBundle 별칭 |
| `createTemplate` | `(databaseId, pageId) => string` | 템플릿 생성, pageId 반환 |
| `updateTemplate` | `(databaseId, templateId, patch) => void` | 템플릿 수정 |
| `deleteTemplate` | `(databaseId, templateId) => void` | 템플릿 삭제 (연결 페이지 포함) |

## persist 설정
| 항목 | 값 |
|------|-----|
| storage key | `"quicknote.databases.v1"` |
| storage | `deferredDatabaseStorage` |
| version | `DATABASE_STORE_PERSIST_VERSION` |
| migrate | `migrateDatabaseStore` |
| partialize | `databases`, `cacheWorkspaceId`, `migrationQuarantine`, `dbTemplates` |
| merge | `mergePersistedSubset` (DATABASE_STORE_DATA_KEYS 기준) |

## 의존 관계
- **사용하는 스토어**: `usePageStore`, `useHistoryStore`, `useWorkspaceStore`
- **사용하는 유틸**: `src/store/databaseStore/helpers.ts`, `src/store/databaseStore/migrations.ts`, `src/store/databaseStore/actions/columnActions.ts`
- **동기화**: `enqueueUpsertDatabase`, `enqueueUpsertPageRaw` (AppSync outbox)
- **이 스토어를 사용하는 주요 파일**: `DatabaseBlockView.tsx`, `DatabaseTableView`, `DatabaseTimelineView`, `DatabaseGalleryView`, `Bootstrap.tsx`

## 주의사항
- `deleteDatabase`는 페이지에서 블록만 제거할 때는 호출하지 않는다. DB 데이터가 유지되어야 하기 때문.
- `isProtectedDatabaseId`로 보호된 DB (스케줄러/마일스톤/피처)는 삭제 불가.
- 행 추가 시 활성 필터를 통과하는 값을 해당 컬럼에 자동 주입하여 필터 상태에서도 새 행이 즉시 보이도록 한다.
- `importRowsBatch`는 단일 `pageStore.setState`로 일괄 반영해 렌더 flicker를 최소화한다.
- `migrationQuarantine` 배열은 자동 복구 실패 데이터 보존용이므로 절대 삭제하지 않는다.
- 컬럼 액션(`addColumn`, `deleteColumn`, `updateColumn` 등)은 `createColumnActions`로 별도 분리됨 (`src/store/databaseStore/actions/columnActions.ts`).
