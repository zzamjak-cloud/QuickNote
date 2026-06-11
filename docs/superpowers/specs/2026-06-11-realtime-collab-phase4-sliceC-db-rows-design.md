# 실시간 공동 편집 — DB 협업 slice C (행 membership 동시성) 설계

- 작성일: 2026-06-11
- 상태: 설계(승인됨)
- 범위: **slice C = 데이터베이스 행 추가/삭제(membership)의 실시간 협업(CRDT). 순서는 LWW.**
- 선행: slice A(DB 구조 협업)·slice B(행 셀 협업) 완료. 동일 `db:<databaseId>` Y.Doc 룸·세션·인프라를 그대로 확장.
  - slice A: `docs/superpowers/specs/2026-06-11-realtime-collab-phase4-db-structure-design.md`
  - slice B: `docs/superpowers/specs/2026-06-11-realtime-collab-phase4-sliceB-db-cells-design.md`

---

## 1. 배경 / 동기

slice A·B 로 DB "구조"와 "행 셀 값"은 CRDT 로 수렴한다. 그러나 **행 추가/삭제/순서**(`rowPageOrder`)는 여전히 LWW 다. 현재 reconcile 는 `rowPageOrder` 를 **배열 통째 replace** 한다(`dbStructureReconcile.ts`). 두 사용자가 동시에 행을 추가하면 늦게 쓴 쪽의 배열이 상대의 새 행을 덮어써 **유실**된다.

slice C 는 행 멤버십(추가/삭제)을 Y.Doc 에서 충돌 없이 수렴시킨다. 순서(재정렬)는 LWW 로 둔다(동시 재정렬 빈도 낮음, fractional index 미도입 — YAGNI). 단, 순서가 LWW 여도 동시 추가된 행이 유실되지 않게 한다.

규모 전제: slice A·B 와 동일(동시 2~5명, DB 동시 편집은 드묾).

## 2. 목표 / 비목표

### 목표 (slice C)
- **동시 행 추가** → 양쪽 모두 보존(어느 쪽도 유실 없음).
- **동시 행 삭제** → 삭제 승(삭제된 행은 모두에게 사라짐).
- **삭제 vs 동시 셀 편집** → 삭제 승(편집은 무시, 행 부활 없음).
- **재정렬** → LWW(마지막 쓰기 승). 단 동시 추가 행은 순서에 append 되어 표시 유실 없음.
- slice B 의 "신규 행 inner-map 경합" 해소(행 추가 시 빈 inner map 선시드).
- slice A·B 세션·룸·인프라 재사용(추가 WS·테이블·서버 라우트 없음).

### 비목표 (slice C 제외)
- 재정렬 수렴(동시 드래그 이동은 LWW 로 수용 — fractional index 미도입).
- 크로스-DB 행 이동 동시성(attach/detach 의 동시성은 현행 LWW).
- 원격 삭제의 undo/되살리기(로컬 undo 히스토리는 현행 유지).
- 행 페이지 본문·제목 동시성(셀만 — slice B 범위).

## 3. 용어
- **rowMembers**: DB Y.Doc 루트(`"db"`) 아래 `rowMembers` = `Y.Array<pageId>`. 살아있는 행의 **집합**(순서 무의미). 멤버십 권위.
- **rowPageOrder**(기존 키 재사용): `string[]`. **표시 순서** LWW 오버레이.
- **member**: `rowMembers` 에 있는 rowPageId. 머티리얼라이즈는 member 만 표시.

## 4. 아키텍처 개요

```
databaseStore 행 add/delete ── enqueueUpsertDatabase ── reconcile ──┐
                                                                     ├─ Y.Doc(db).rowMembers (CRDT 집합 diff)
                                                                     └─ Y.Doc(db).rowPageOrder (LWW replace, 순서)
                                                            │
   materialize → finalOrder = order∩members ++ (members∖order) → bundle.rowPageOrder
```
멤버십(추가/삭제)은 CRDT, 순서는 LWW. 둘을 분리해 "추가/삭제 수렴 + 순서 LWW" 를 동시에 만족.

## 5. 클라이언트 설계

### 5.1 Y.Doc 표현 (`dbBundleYjs` 확장)
- `DbStructure` 에 `rowMembers: string[]` 추가.
- 루트 Y.Map 에 `rowMembers` → **Y.Array\<string\>**. `rowPageOrder` 는 기존 그대로(LWW 순서).
- `seedDbStructure` 가 `rowMembers` 도 시드, `readDbStructure` 가 `rowMembers` 도 반환.
- `DatabaseBundle` 은 변경 없음 — 스토어 단일 `rowPageOrder` 에서 멤버 집합을 파생(localNew.rowMembers = bundle.rowPageOrder).

### 5.2 reconcile (`dbStructureReconcile` 확장)
- 신규 `rowPageOrder`(LWW): 현행 replace 유지.
- 신규 `rowMembers`(CRDT 집합 diff, baseline 기반):
  - Y 에 있고 localNew 에도 있음 → 유지.
  - Y 에 있고 localNew 에 없고 baseline 에 있음 → 로컬 삭제 → Y 에서 제거(삭제 승).
  - Y 에 있고 localNew 에 없고 baseline 에도 없음 → 원격 신규 → 유지(레이스 보호).
  - localNew 에만 있음(Y 에 없음) → 로컬 추가 → push.
  - (slice A `reconcileById` 의 문자열 집합 버전. id-객체가 아니라 plain string.)
- `reconcileStructureIntoYDoc` 호출부(enqueueUpsertDatabase)에서 localNew 에 `rowMembers: bundle.rowPageOrder` 를 함께 전달.

### 5.3 머티리얼라이즈 (`applyCollabDbStructure` 확장)
- `members = structure.rowMembers`(집합), `order = structure.rowPageOrder`.
- `finalOrder = order.filter((id) => members.has(id))` 뒤에 `members 중 finalOrder 에 없는 id 를 append`.
- `bundle.rowPageOrder = finalOrder`. slice B rows 머티리얼라이즈는 member 행에만 적용(비멤버 rows 항목 무시).
- baseline 갱신 시 `rowMembers` 포함.

### 5.4 스토어 액션
- `addRow`/`importRowsBatch`: 신규 페이지 생성 후 `rowPageOrder` 에 append(현행). 협업 ON 이면 reconcile 가 `rowMembers` 에 추가. **신규 행 기본 셀**은 협업 시 `writeCellsToCollabDoc(databaseId, pageId, defaults)` 로 라우팅(slice B 와 일관) — 이때 빈 cells 라도 inner Y.Map 이 생성되어 신규 행의 다른-셀 동시편집 병합을 보장.
- `deleteRow`: `rowPageOrder` 에서 제거(현행) → reconcile 가 `rowMembers` 에서 제거(삭제 승) + 기존 페이지 soft-delete(현행 `pageStore.deletePage`). 동시 셀 편집이 rows 에 남아도 비멤버라 머티리얼라이즈 제외.
- `setRowOrder`: `rowPageOrder` 만 변경 → LWW replace. `rowMembers` 불변(순서만).

## 6. 서버 설계
- **서버 변경 최소.** `dbSeed.ts` 시드에 `rowMembers = rowPageOrder`(동일 리스트) 추가. slice B 의 rows 시드·캡·폴백 그대로. WS·테이블·라우트 무변경.

## 7. 충돌 의미
- **동시 추가**: 양쪽 `rowMembers` 에 push(CRDT) → 둘 다 member. 순서는 LWW 지만 append-missing 으로 둘 다 표시.
- **동시 삭제**: baseline 기반 제거(삭제 승).
- **삭제 vs 편집**: member 제거 → 머티리얼라이즈가 비멤버 제외(편집 무시). 행 부활 없음.
- **재정렬**: `rowPageOrder` LWW replace. 동시 추가 행은 append 로 보존.
- **원격 신규 보호**: reconcile 가 baseline 에 없는 Y 멤버를 유지(동시 추가 레이스).

## 8. 기존 시스템과의 통합
- 멤버십 권위 = Y.Doc `rowMembers`(협업 doc 안 → 페이지 동기화 채널 타이밍과 무관).
- 행 페이지 자체(제목·본문·셀)는 기존 경로(셀=slice B Y rows, 그 외=페이지 동기화). 행 삭제의 페이지 soft-delete 는 현행 LWW(`deletedAt`)와 일관 → 삭제 승 보강.
- 협업 OFF DB 는 전부 현행 LWW(회귀 가드). 비멤버 구조(`rowMembers` 미사용) Y.Doc 도 안전(materialize 가 빈 members → order 그대로 폴백).

## 9. 에러 처리 / 복원력
- slice A~B·Phase 1~3 메커니즘 그대로(재연결·오프라인·SV 재교환).
- 구버전 Y.Doc(`rowMembers` 없음): materialize 가 `members` 빈 집합이면 `rowPageOrder` 를 그대로 사용(폴백) — slice B→C 전환 중 깨지지 않음.
- 비멤버 rows 잔여 항목: 머티리얼라이즈가 무시. 선택적 정리(후속).

## 10. 테스트 전략
- **단위**: `rowMembers` 라운드트립(seed/read); 집합 diff reconcile(추가/삭제/원격신규/baseline 삭제); 동시 추가 수렴·동시 삭제 수렴; materialize finalOrder(order∩members ++ 누락 append, 비멤버 제외); 구버전 폴백(members 빈 집합 → rowPageOrder 사용); addRow 신규 행 inner-map 선시드.
- **라우팅**: 협업 ON addRow 기본 셀이 Y 로 가고 deleteRow 가 멤버 제거; 협업 OFF 현행.
- **수동(dev)**: 2탭 같은 표 — 동시 행 추가 둘 다 보존, 동시 삭제 수렴, 삭제 vs 편집 삭제 승, 협업 OFF 회귀 없음.

## 11. 리스크 & 완화
| 리스크 | 완화 |
|--------|------|
| 멤버십(rowMembers)·순서(rowPageOrder) 이중화 | 순서는 파생/LWW, 멤버십이 권위. materialize 가 단일 finalOrder 생성 |
| 재정렬 LWW 로 동시 추가 유실 | append-missing(members∖order) 으로 보존 |
| 삭제 후 rows 잔여 항목 | 머티리얼라이즈가 비멤버 무시(권위=members) |
| 구버전 Y.Doc(rowMembers 없음) | members 빈 집합 → rowPageOrder 폴백 |
| 신규 행 inner-map 경합(slice B 잔여) | addRow 시 writeCellsToCollabDoc 로 inner map 선시드 |

## 12. 배포 / 롤아웃
- 인프라: 서버 `dbSeed.ts`(rowMembers 시드) 변경 → `DevQuicknoteRealtimeCollabStack` 재배포. WS·테이블·라우트 무변경.
- 프론트: slice A·B 와 동일 DB 단위 flag(`VITE_COLLAB_ENABLED_DB_IDS`). develop 구현·dev 검증·승인 후 배포.

## 13. 향후 단계
- 재정렬 수렴(fractional index) — 필요 시.
- 크로스-DB 행 이동 동시성.
- **Phase 5**: Yjs 스냅샷 버전 히스토리(페이지+DB).
