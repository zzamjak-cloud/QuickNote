# LC 스케줄러 루트 DB 페이지 결손 복구

## 역할
LC 스케줄러 워크스페이스에서 보호 DB 정의와 row cache 는 남아 있는데 사이드바 루트 페이지만 빠진 캐시를 복구한다.

대상 루트 페이지:

| DB | 사이드바 루트 페이지 제목 |
|----|--------------------------|
| `LC_MILESTONE_DATABASE_ID` | `마일스톤 DB` |
| `LC_FEATURE_DATABASE_ID` | `피처 DB` |
| `LC_SCHEDULER_DATABASE_ID` | `작업 DB` |

## 핵심 파일
| 파일 | 역할 |
|------|------|
| `src/lib/sync/lcSchedulerWorkspaceRepair.ts` | 루트 페이지 존재 여부 판정과 repair gate 생성 |
| `src/Bootstrap.tsx` | 결손 감지 시 캐시 초기화 후 `forceMetaBaseline` 재조회 실행 |
| `src/lib/sync/__tests__/lcSchedulerWorkspaceRepair.test.ts` | 제목 기반, databaseBlock 기반, 세션 gate 회귀 테스트 |

## 결손 판정
`getLCSchedulerRootPageStatus(pages)` 는 page store 에서 다음 조건을 만족하는 페이지를 루트 후보로 본다.

- `workspaceId === LC_SCHEDULER_WORKSPACE_ID`
- `parentId == null`
- `databaseId == null`
- `fullPageDatabaseId == null`
- `deletedAt` 이 없음

루트 후보는 두 방식 중 하나로 필수 DB에 매핑된다.

- 제목이 `마일스톤 DB`, `피처 DB`, `작업 DB` 중 하나면 meta-only 페이지여도 존재로 인정한다.
- 사용자가 제목을 바꾼 경우 첫 블록이 inline `databaseBlock` 이고 `databaseId` 가 필수 DB ID 중 하나면 존재로 인정한다.

첫 `databaseBlock` 이 `layout: "fullPage"` 인 페이지는 루트 페이지 후보에서 제외한다. 풀페이지 DB 홈 페이지와 LC 스케줄러 사이드바 루트 페이지를 섞지 않기 위한 경계다.

## Bootstrap 복구 흐름
`Bootstrap.tsx` 의 워크스페이스 동기화 흐름에서 기존 cache repair 와 함께 검사한다.

1. `createLCSchedulerRootPageRepairGate().shouldAttempt(currentWorkspaceId, pages)` 로 repair 가능 여부를 묻는다.
2. repair 가 필요하면 다음 persist cache 를 초기화한다.
   - `databaseRowRemote`
   - `pageContentLoad`
   - `pageMetaRemote`
   - `syncWatermark`
3. `fetchApply({ forceMetaBaseline: true })` 로 page meta baseline 을 다시 받는다.

이 경로는 delta watermark 가 오래된 루트 페이지를 건너뛰는 상황을 우회하기 위한 것이다. 결손 상태에서 전체 row cache 만 유지하면 사이드바는 비어 보일 수 있으므로, page meta token/watermark 를 버리고 루트 페이지 메타를 다시 기준선으로 받는다.

## Repair Gate
`createLCSchedulerRootPageRepairGate()` 는 앱 실행 세션 동안 같은 워크스페이스 repair 를 한 번만 허용한다.

- 결손 감지 첫 호출: `true`
- 같은 결손 상태 반복 호출: `false`
- 루트 페이지가 복구되어 complete 상태가 되면 해당 워크스페이스 시도 기록을 제거
- 이후 다시 결손이 생기면 새로 한 번 repair 허용

`localStorage` 완료 플래그를 쓰지 않는 이유는 실패한 repair 를 영구적으로 막지 않기 위해서다. 대신 같은 실행 세션에서 반복 baseline 재조회를 막고, 새로고침 후에는 다시 1회 시도한다.

## 회귀 체크
- LC 워크스페이스가 아니면 repair 대상이 아니어야 한다.
- meta-only 루트 페이지 제목만 있어도 complete 로 봐야 한다.
- 사용자가 제목을 바꾼 루트 페이지는 첫 inline `databaseBlock.attrs.databaseId` 로 인식해야 한다.
- 결손 상태가 유지되어도 gate 가 같은 세션에서 baseline 재조회를 반복 실행하면 안 된다.

관련 문서:
- [Bootstrap.md](Bootstrap.md)
- [architecture.md](architecture.md)
