# 실시간 공동 편집 — Phase 4 (DB 구조 실시간 협업, slice A) 설계

- 작성일: 2026-06-11
- 상태: 설계(승인됨)
- 범위: **Phase 4 = 데이터베이스 "구조"(columns·presets·panelState·rowPageOrder)의 실시간 협업(CRDT).**
- 선행: Phase 1~3 완료(페이지 본문 sync·프레즌스·오프라인). 협업 WS 인프라·`QnWsProvider`·`IndexeddbPersistence` 재사용.

---

## 0. 로드맵 재정렬 (배경)

버전 히스토리를 Yjs 스냅샷으로 하려면 대상이 Y.Doc 기반이어야 한다. 현재 협업은 페이지 본문 doc만 Y.Doc 화돼 있고 DB(데이터베이스)는 LWW(AppSync/AWSJSON)다. 따라서 **DB 협업을 먼저 만들고(Phase 4·후속) 그 위에 버전 히스토리(Phase 5)** 를 얹는 순서가 맞다. DB 협업 자체가 크므로 슬라이스로 분해한다:

- **slice A (이 문서) = DB 구조**: columns·presets·panelState·rowPageOrder.
- **slice B = 행 셀 값**(dbCells 동시 편집) — 후속 spec.
- **slice C = 행 추가/삭제/순서 동시성** — 후속 spec.
- **Phase 5 = Yjs 스냅샷 버전 히스토리**(페이지+DB 통합, 마지막 편집자 스탬프) — 후속 spec.

## 1. 배경 / 동기

`DatabaseBundle`(meta·columns·presets·panelState·rowPageOrder)은 현재 `upsertDatabase` 로 통째 AWSJSON 저장되며 **LWW** 다(`src/store/databaseStore`). 두 사용자가 동시에 컬럼 추가·뷰 설정·정렬·필터 프리셋을 바꾸면 늦게 저장한 쪽이 전체를 덮어써 **한쪽 구조 변경이 유실**된다. slice A는 DB 구조를 CRDT(Yjs)로 만들어 충돌 없이 수렴시킨다. 행 셀 데이터(`dbCells`)는 slice A 비목표(현행 LWW 유지).

규모 전제는 Phase 1과 동일(동시 2~5명).

## 2. 목표 / 비목표

### 목표 (slice A)
- 같은 DB를 연 클라이언트들의 **구조 변경**(컬럼 추가/이름/타입/옵션, 뷰/프리셋, panelState 정렬·필터, rowPageOrder)이 **하나의 Y.Doc으로 수렴**.
- Y.Doc 구조를 디바운스로 `DatabaseBundle` 로 **materialize → 기존 `upsertDatabase`** (AWSJSON 영속·기존 diff/patch 히스토리·sync 엔진 호환 유지).
- 기존 인증·워크스페이스 권한으로 **DB room 접속/인가**.
- Phase 1~3 인프라(WS·연결테이블·QnYDoc·IndexeddbPersistence) 재사용, 서버 변경 최소.

### 비목표 (slice A 제외)
- 행 셀 값(`dbCells`) 동시 편집 → slice B.
- 행 추가/삭제 동시성·rowPageOrder membership 경합 해소 → slice C(이 문서는 order 배열만 CRDT, membership 은 기존 역추적 권위).
- DB 프레즌스 커서/접속자(셀 단위) → 후속.
- Yjs 스냅샷 버전 히스토리 → Phase 5.
- 페이지 본문(Phase 1~3 그대로).

## 3. 용어
- **DB room**: 한 데이터베이스(databaseId) 단위 협업 채널. room 키 `db:<databaseId>`.
- **DatabaseBundle**: `{ meta, columns, presets?, panelState?, rowPageOrder }`(`src/types/database.ts`).
- **구조 권위**: 협업 ON DB의 columns/presets/panelState/rowPageOrder 라이브 소스 = Y.Doc. `databaseStore` 는 Y에서 투영된 파생본.

## 4. 아키텍처 개요

```
databaseStore(UI) ── dbBundleYjs ── Y.Doc(db) ── QnWsProvider(room "db:<id>") ── WSS ── 서버(fan-out·영속)
                                          └── IndexeddbPersistence(로컬, Phase 3 재사용)
   materialize(디바운스) → DatabaseBundle → upsertDatabase(AWSJSON 영속·기존 히스토리)
```

## 5. 클라이언트 설계

### 5.1 세션 훅 (`src/lib/collab/useDatabaseCollabSession.ts`)
- `useCollabSession` 의 DB판. `isCollabEnabledForDatabase(databaseId)` 이면 Y.Doc + `QnWsProvider`(room `db:<databaseId>` URL) + `IndexeddbPersistence("qn-collab-db:" + databaseId)` 생성.
- synced/idbLoaded 게이팅(Phase 3 `canEditCollab` 동일 패턴: 서버 sync 또는 로컬 콘텐츠 로드 시 구조 편집 허용; 그 전엔 구조 변경 보류).
- Y.Doc 변경 → 디바운스 materialize → `databaseStore` 투영 + `upsertDatabase` enqueue(deferSync).
- 연결 상태는 기존 `collabConnectionStore` 재사용(배지 공유).

### 5.2 Bundle ↔ Y.Doc 변환 (`src/lib/collab/dbBundleYjs.ts`)
루트 Y.Map(`"db"`) 아래:
- `columns` → **Y.Array<Y.Map>**: 각 컬럼 Y.Map `{ id, name, type, ...options }`. 동시 추가가 둘 다 보존, 순서 수렴.
- `presets` → **Y.Array<Y.Map>**.
- `panelState` → **Y.Map**(중첩 viewConfigs 등도 Y.Map): 필드 단위 병합.
- `rowPageOrder` → **Y.Array<string>**.
- `meta` 중 협업 대상(title 등 LWW 유지 항목)은 Y.Doc 에 넣지 않거나 별도 — slice A 는 **구조 4종만** Y.Doc 권위. title/icon 등 메타는 기존 LWW 경로 유지.
- 함수: `bundleToYDoc(bundle): Y.Doc`(시드용), `yDocToBundleStructure(ydoc, base): DatabaseBundle`(materialize — base 는 Y 밖 메타·row 데이터 보존용).

### 5.3 databaseStore 바인딩
- 협업 ON DB: 구조 변경 액션(컬럼 추가/수정/삭제, 뷰/정렬/필터, presets, rowPageOrder)이 **Y.Doc 트랜잭션을 통해** 반영되고(직접 `upsertDatabase` LWW 호출 비활성), Y 변경 이벤트 → store 투영.
- 협업 OFF DB: 현행 LWW 경로 그대로(회귀 가드).
- 단방향 materialize(Y→Bundle) 고정, 원격 Bundle→Y 역주입 금지(협업 활성 DB 구조는 Y 권위).

### 5.4 feature flag (`collabConfig.ts` 확장)
- `isCollabEnabledForDatabase(databaseId)`: `VITE_COLLAB_WS_URL` + `VITE_COLLAB_ENABLED_DB_IDS`(콤마, `*` 전체). 페이지 flag와 동일 패턴. 기본 OFF.
- `buildDbCollabWsUrl(databaseId, token)`: room 키 `db:<databaseId>` 를 connect 쿼리스트링에 실음(서버가 prefix 로 DB room 판별).

## 6. 서버 설계

### 6.1 `$connect` 인가 분기 (`infra/lambda/realtime/connect.ts`·`auth.ts`)
- connect 쿼리스트링의 room 식별자가 `db:<databaseId>` prefix 면 **DB room**으로 처리.
- DB room: PAGE_TABLE 대신 **DATABASE_TABLE** 에서 `databaseId` 로 workspaceId 조회 → 기존 `getCallerMember` + `hasWorkspaceViewAccess` 로 멤버십 확인. 통과 시 connections 에 room 키(`db:<id>`)로 join.
- 페이지 room(prefix 없음/기존)은 현행 그대로.
- 신규 env `DATABASE_TABLE` + IAM(GetItem) 을 realtime 스택 connectFn 에 추가.

### 6.2 room/영속 재사용
- connections·QnYDoc·QnYDocUpdates 의 키 속성(`pageId`)에 room 키 문자열(`db:<databaseId>`)을 그대로 저장 — **DynamoDB 스키마·GSI 변경 없음**. fan-out(byPageId GSI)·영속·압축·sync(hello/update/sv-reply)·awareness fan-out 로직 전부 그대로 동작.
- 첫 진입 시 `QnYDoc` 미존재면 서버가 `DatabaseBundle`(현 DynamoDB Database 항목)에서 Y.Doc 1회 시드(`bundleToYDoc` 서버판) → 권위적 구조 시드(중복 컬럼 방지).

### 6.3 CDK (`infra/lib/realtime-collab-stack.ts`·`bin/quicknote.ts`)
- connectFn 에 `DATABASE_TABLE` env + Database 테이블 GetItem IAM 추가(syncStack.databaseTable 교차참조).
- WS API·연결/YDoc 테이블·sync/disconnect 핸들러 무변경.

## 7. 기존 시스템과의 통합 / 충돌 의미
- **소스 분리**: 협업 ON DB 구조 라이브 소스 = Y.Doc. AWSJSON `Database` 항목은 materialize 된 파생본(검색·비협업 클라·히스토리 호환).
- **컬럼 동시 추가**: 둘 다 보존(Y.Array). **다른 컬럼/다른 필드 동시 편집**: 병합(Y.Map). **컬럼 삭제 vs 편집**: 삭제 우선 — materialize 시 array 에서 빠진 컬럼의 잔여 편집은 무시(고아 제거).
- **panelState/presets**: 필드 단위 병합. panelState 새 필드는 반드시 zod 스키마에도 추가(동기화 누락 방지 — 기존 교훈).
- **rowPageOrder**: 순서는 Y.Array 수렴. 행 membership(어떤 페이지가 이 DB 행인지)은 기존 `collectRowPageIdsForDatabase`/`ensurePageInDatabaseRowOrder` 역추적이 권위(slice C 전까지). materialize 시 Y order 와 실제 membership 을 교차 정합.
- **히스토리**: slice A 는 기존 diff/patch 유지(materialize 된 Database 변경이 기존 `recordDatabaseHistory` 를 그대로 태움). Phase 5 에서 Yjs 스냅샷으로 교체.
- **마이그레이션**: 기존 DB 는 첫 협업 진입 시 6.2 시드. 협업 OFF DB 는 현행 그대로.

## 8. 에러 처리 / 복원력
- WS 끊김·재연결·오프라인: Phase 1~3 메커니즘 그대로(SV 재교환·IndexedDB·onLine).
- materialize 변환 실패: 다음 변경에서 재시도, 라이브 세션은 피어 sync 로 진행.
- 협업 OFF DB 회귀: Y.Doc·세션 미생성 → 현행 LWW 동작 보존.

## 9. 테스트 전략
- **단위**:
  - `dbBundleYjs` 라운드트립: Bundle → Y.Doc → Bundle 동치(columns/presets/panelState/rowPageOrder).
  - 수렴 시뮬: 두 Y.Doc 에 동시 컬럼 추가 교차 적용 → 동일 컬럼 집합 수렴. 컬럼 삭제 vs 다른 필드 편집 → 삭제 우선.
  - panelState 필드 단위 병합(동시에 서로 다른 뷰 설정 변경 → 둘 다 반영).
  - `isCollabEnabledForDatabase`/`buildDbCollabWsUrl` flag·URL.
- **서버**: DB room 인가(DATABASE_TABLE 조회·멤버십), room 키 네임스페이스 fan-out(페이지 room 과 격리).
- **수동(dev)**: 2탭 같은 DB — 동시 컬럼 추가/뷰 정렬 변경 수렴, 협업 OFF DB 회귀 없음.
- **회귀**: 협업 OFF DB·페이지 room 동작 불변.

## 10. 리스크 & 완화
| 리스크 | 완화 |
|--------|------|
| DB 구조 이중 소스(Y.Doc vs AWSJSON) 불일치 | materialize 단방향(Y→Bundle) 고정, 역주입 금지 |
| 컬럼 삭제-편집 경합 잔여 | materialize 고아 컬럼 제거 |
| room 키 혼선(page vs db) | `db:` prefix 네임스페이스 + connect 인가 분기 |
| panelState 필드 누락 동기화 | 새 필드 zod 스키마 동시 반영(기존 교훈) |
| 행 데이터(셀)와 구조 권위 분리 혼동 | slice A 는 구조만 Y 권위, 셀은 LWW 명시 — slice B 에서 통합 |
| 점진 롤아웃 혼재 | DB 단위 feature flag |

## 11. 배포 / 롤아웃
- 인프라: connectFn env(DATABASE_TABLE)+IAM 추가 → `DevQuicknoteRealtimeCollabStack` 재배포(테이블·라우트 무변경). **develop 구현·dev 검증·명시 승인 후 배포**.
- 프론트: DB 단위 flag(`VITE_COLLAB_ENABLED_DB_IDS`)로 단계 검증.

## 12. 향후 단계
- **slice B**: 행 셀(`dbCells`) 동시 편집(행 페이지 Y.Doc 또는 DB Y.Doc 내 행맵 — 별도 설계).
- **slice C**: 행 추가/삭제/순서 동시성.
- **Phase 5**: Yjs 스냅샷 버전 히스토리(페이지+DB), 마지막 편집자 스탬프.
