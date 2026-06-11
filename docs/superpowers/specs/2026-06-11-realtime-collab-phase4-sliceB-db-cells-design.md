# 실시간 공동 편집 — DB 협업 slice B (행 셀 동시편집) 설계

- 작성일: 2026-06-11
- 상태: 설계(승인됨)
- 범위: **slice B = 데이터베이스 행 셀(`dbCells`) 값의 실시간 협업(CRDT).**
- 선행: slice A(DB 구조 협업) 완료. slice A의 `db:<databaseId>` Y.Doc 룸·세션·인프라를 그대로 확장.
  - slice A: `docs/superpowers/specs/2026-06-11-realtime-collab-phase4-db-structure-design.md`

---

## 1. 배경 / 동기

slice A 로 DB "구조"(columns·presets·panelState·rowPageOrder)는 CRDT 로 수렴한다. 그러나 **행 셀 값(`dbCells`)** 은 여전히 LWW 다. 셀은 각 행 페이지(`pageStore.pages[pageId].dbCells`)에 저장되고, 변경은 `enqueueUpsertPageRaw(page)`(페이지 전체 upsert)로 영속된다. 두 사용자가 같은 표의 (다른) 셀을 동시에 편집하면 늦게 저장한 쪽의 페이지 upsert 가 상대 셀 변경을 덮어쓸 수 있다.

slice B 는 행 셀 값을 slice A 의 DB Y.Doc 에 `rows` 맵으로 추가해 충돌 없이 수렴시킨다. 행 추가/삭제·순서(membership)는 slice C, 셀 텍스트 문자 단위 협업·셀 프레즌스·버전 히스토리는 비목표.

규모 전제: slice A 와 동일(동시 2~5명).

## 2. 목표 / 비목표

### 목표 (slice B)
- 같은 DB 를 연 클라이언트들의 **기존 행 셀 값 변경**이 DB Y.Doc 의 `rows` 맵으로 수렴.
- **다른 셀/다른 행 동시 편집은 병합**, **같은 셀 동시 편집은 셀 단위 atomic LWW**(마지막 쓰기 승).
- Y `rows` 를 디바운스로 각 행 페이지 `dbCells` 에 materialize → 기존 `upsertPage` 경로로 영속(검색·비협업 클라 호환).
- slice A 세션·룸·인프라 재사용(추가 WS·테이블·서버 라우트 없음).

### 비목표 (slice B 제외)
- 행 추가/삭제/순서 동시성 → slice C(`rows` membership 은 기존 행 페이지 존재가 권위; slice B 는 그 행들의 셀 값만).
- 셀 텍스트 문자 단위 협업(텍스트/긴텍스트 셀도 atomic LWW — 문자 병합 안 함).
- 셀 프레즌스(누가 어떤 셀 편집 중) → 후속.
- 페이지 본문·제목·아이콘(협업 대상 아님 — 셀만; 행 페이지의 비셀 필드는 현행 경로 유지).
- 버전 히스토리(Phase 5).

## 3. 용어
- **rows 맵**: DB Y.Doc 루트(`"db"`) 아래 `rows` = Y.Map(rowPageId → Y.Map(columnId → 셀 값 JSON)).
- **셀 값**: `CellValue`(JSON 직렬화 가능; 문자열·숫자·배열 등). slice B 는 셀 값 통째를 한 단위로 set(atomic).
- **셀 권위**: 협업 ON DB 의 행 셀 라이브 소스 = Y.Doc `rows`. `pageStore...dbCells` 는 materialize 된 파생본.

## 4. 아키텍처 개요

```
databaseStore 셀 변경 ── writeCellsToCollabDoc ── Y.Doc(db).rows ── QnWsProvider(db room) ── WSS ── 서버(fan-out·영속)
                                                       │
   materialize(디바운스) → 각 행 pageStore.dbCells + enqueueUpsertPageRaw(행 페이지)  ← 기존 영속 경로
```
slice A 의 동일 DB Y.Doc·세션·룸을 그대로 쓴다. `rows` 만 추가.

## 5. 클라이언트 설계

### 5.1 Y.Doc 표현 (`dbBundleYjs` 확장)
- `DbStructure` 에 `rows: Record<string, Record<string, unknown>>` 추가(rowPageId → {columnId: cellValue}).
- 루트 Y.Map 에 `rows` → **Y.Map**(key=rowPageId → **Y.Map**(columnId → 셀 값 JSON)). 기존 제네릭 `jsonToY`/`yToJson` 재사용.
- `seedDbStructure` 가 `rows` 도 시드, `readDbStructure` 가 `rows` 도 반환.

### 5.2 셀 쓰기 라우팅 (`databaseStore` + 헬퍼)
- 신규 헬퍼 `writeCellsToCollabDoc(databaseId, pageId, cells)`(레지스트리의 Y.Doc 에 `rows[pageId]` Y.Map 을 columnId 단위로 set; 삭제 셀은 delete; baseline reconcile 와 일관).
- 셀을 바꾸는 store 액션(`updateCell`, 프리셋 적용, 기본값 채움, attach 시 기본 셀 등)은 협업 ON DB 이면 `enqueueUpsertPageRaw`(셀 포함 페이지 LWW upsert) 대신 **`writeCellsToCollabDoc` 로 라우팅**. 비협업이면 현행 그대로.
- 행 페이지의 **비셀 변경**(제목·본문·아이콘)은 협업 ON 이어도 기존 `enqueueUpsertPageRaw` 유지하되, **dbCells 는 페이로드에서 제외**(셀 권위는 Y) — 셀 경쟁 방지.

### 5.3 materialize (`applyCollabDbStructure` 확장)
- materialize 시 `structure.rows` 의 각 rowPageId 에 대해 `pageStore` 의 그 페이지 `dbCells` 를 Y 값으로 갱신하고, 변경된 행 페이지를 `enqueueUpsertPageRaw` 로 영속(파생본).
- 구조(slice A)와 셀(slice B)을 한 materialize 에서 함께 반영. 셀만 바뀐 경우 구조 부분은 no-op(동일).

### 5.4 세션
- slice A 의 `useDatabaseCollabSession` 그대로(같은 Y.Doc·룸). `onMaterialize` 가 구조+셀을 함께 store 에 반영.

## 6. 서버 설계
- **서버 변경 거의 없음.** slice A 의 `db:<id>` 룸 fan-out·영속·압축 그대로. `rows` 는 같은 Y.Doc 안의 또 다른 맵일 뿐.
- 서버 시드(`dbSeed.ts`) 확장: 첫 진입 시 Database 항목뿐 아니라 **각 행 페이지의 dbCells 로 `rows` 맵도 시드**. (행 페이지 dbCells 는 Pages 테이블에 있으므로 서버가 rowPageOrder 로 조회해 시드. 비용 고려해 행 수 상한·페이지네이션 주의 — 큰 DB 는 클라 시드 폴백.)

## 7. 충돌 의미
- **다른 셀(같은/다른 행) 동시 편집**: 병합(Y.Map 필드 단위).
- **같은 셀 동시 편집**: 셀 값 통째 set → Yjs Y.Map 키 LWW(마지막 쓰기 승). 텍스트 셀도 atomic(문자 병합 없음).
- **행 membership**: `rows` 에 어떤 rowPageId 가 있는지는 기존 행 페이지 존재(`collectRowPageIdsForDatabase`)가 권위(slice C 전까지). materialize 시 존재하지 않는 행의 rows 항목은 무시/정리.

## 8. 기존 시스템과의 통합
- 협업 ON DB: 셀 라이브 소스 = Y.Doc `rows`. 행 페이지 `dbCells`(Pages.doc)는 materialize 파생본(검색·비협업 클라·DB row 인덱스 호환).
- 비셀 행 페이지 필드는 현행 LWW. 협업 OFF DB 는 전부 현행 LWW(회귀 가드).
- 셀 변경이 더 이상 페이지 upsert 의 dbCells 로 직접 안 나가므로(협업 ON), 행 페이지 upsert 의 dbCells 제외 처리 필요(§5.2).

## 9. 에러 처리 / 복원력
- slice A·Phase 1~3 메커니즘 그대로(재연결·오프라인·SV 재교환).
- materialize 변환 실패: 다음 변경에서 재시도.
- 협업 OFF DB·페이지 본문 룸 동작 불변(회귀 가드).

## 10. 테스트 전략
- **단위**: `rows` 라운드트립(seed/read), 다른 셀 동시수정 병합·같은 셀 LWW 수렴, `writeCellsToCollabDoc` 가 columnId 단위 set/delete, materialize 가 rows→각 행 dbCells 반영 + 비셀 필드 보존.
- **라우팅**: 협업 ON DB 셀 변경이 Y 로 가고 페이지 LWW upsert 의 dbCells 가 제외되는지; 협업 OFF 는 현행.
- **수동(dev)**: 2탭 같은 표 — 다른 셀 동시 입력 수렴, 같은 셀 동시 입력 마지막 승, 협업 OFF DB 회귀 없음.

## 11. 리스크 & 완화
| 리스크 | 완화 |
|--------|------|
| 셀 권위 이중화(Y vs 페이지 dbCells) | materialize 단방향(Y→dbCells), 협업 ON 페이지 upsert 에서 dbCells 제외 |
| 셀 쓰기 경로 분산(updateCell·프리셋·기본값…) | 단일 헬퍼 `writeCellsToCollabDoc` 로 일원화 |
| 큰 DB 서버 시드 비용 | 행 수 상한/페이지네이션, 초과 시 클라 시드 폴백 |
| 행 membership 경합 | slice C 로 분리; slice B 는 기존 행 존재 권위 |
| 같은 셀 LWW 로 인한 입력 유실 체감 | 셀 단위라 충돌 범위 작음; 문자 병합은 비목표로 명시 |

## 12. 배포 / 롤아웃
- 인프라: 서버 `dbSeed.ts`(rows 시드) 변경 → `DevQuicknoteRealtimeCollabStack` 재배포. WS·테이블·라우트 무변경.
- 프론트: slice A 와 동일 DB 단위 flag(`VITE_COLLAB_ENABLED_DB_IDS`). develop 구현·dev 검증·승인 후 배포.

## 13. 향후 단계
- **slice C**: 행 추가/삭제/순서 동시성(rows membership + rowPageOrder 통합).
- **Phase 5**: Yjs 스냅샷 버전 히스토리(페이지+DB).
