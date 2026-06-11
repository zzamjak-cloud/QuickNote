# 실시간 공동 편집 — Phase 3 (오프라인 영속 + 견고한 재연결) 설계

- 작성일: 2026-06-11
- 상태: 설계(승인됨)
- 범위: **Phase 3 = 로컬 오프라인 영속(`y-indexeddb`) + 즉시 로드 + 온라인 감지 기반 견고한 재연결 + 연결 상태 배지.**
- 선행: Phase 1(코어 sync)·Phase 2(프레즌스) 완료·dev 검증 완료.
  - Phase 1: `docs/superpowers/specs/2026-06-10-realtime-collab-phase1-design.md`
  - Phase 2: `docs/superpowers/specs/2026-06-11-realtime-collab-phase2-presence-design.md`

---

## 1. 배경 / 동기

Phase 1/2로 여러 사용자가 실시간으로 한 Y.Doc에 수렴하고 서로의 커서를 본다. 그러나:
- 새로고침/재방문 시 본문이 **서버 초기 sync 완료 전까지 read-only**다(체감 지연).
- 네트워크가 끊기면 편집이 사실상 멈추고, 끊긴 동안의 변경 보존이 불확실하다.
- 사용자가 연결 상태(온라인/오프라인)를 알 수 없다.

해법: Yjs 표준 로컬 영속 **`y-indexeddb`(`IndexeddbPersistence`)** 를 같은 Y.Doc에 추가로 바인딩한다. 로컬 IndexedDB에 doc를 영속하여 **재방문 즉시 로드·오프라인 편집**을 지원하고, 재연결 시 서버와 자동 수렴(Yjs 멱등)한다. 더불어 `navigator.onLine` 기반 재연결과 작은 상태 배지를 추가한다.

규모 전제는 Phase 1과 동일(한 페이지 2~5명, 전체 수십~수백 페이지).

## 2. 목표 / 비목표

### 목표 (Phase 3)
- `IndexeddbPersistence`로 협업 Y.Doc을 **브라우저 IndexedDB에 로컬 영속**.
- **즉시 로드**: 재방문 시 서버 응답 전에 로컬 doc으로 편집 가능.
- **오프라인 편집**: 끊긴 동안 편집이 로컬에 쌓이고, 재연결 시 서버·피어와 수렴.
- **견고한 재연결**: `navigator.onLine` + `online`/`offline` 이벤트로 즉시 재연결(backoff 대기 생략), 오프라인이면 재시도 중단.
- **연결 상태 배지**: 온라인(동기됨)·재연결 중·오프라인 3상태를 TopBar에 작게 표시.

### 비목표 (Phase 3 제외)
- IndexedDB 자동 GC/용량 관리(소규모엔 불필요 — 후속).
- 충돌 해결 UI(Yjs 자동 수렴으로 불필요).
- 서비스워커/PWA 풀 오프라인 셸.
- DB(데이터베이스) 블록 셀의 오프라인.
- Yjs 스냅샷 버전 히스토리(Phase 4).

## 3. 용어
- **IndexeddbPersistence**: `y-indexeddb`가 제공하는 provider. Y.Doc을 IndexedDB에 영속하고, 마운트 시 로컬 상태를 doc에 적용한 뒤 `"synced"` 이벤트를 emit.
- **idbLoaded**: 로컬 IndexedDB 로드가 끝나 doc에 반영된 상태.
- **roomKey**: IndexedDB DB 이름. `"qn-collab:" + pageId`.

## 4. 아키텍처 개요

```
            ┌── QnWsProvider ── WSS ── 서버(피어 수렴, 영속)
   Y.Doc ──┤
            └── IndexeddbPersistence ── 브라우저 IndexedDB(로컬 영속)

   에디터 편집가능 = (idbLoaded) OR (server synced)
   상태배지       = navigator.onLine + QnWsProvider status
```
두 provider는 독립적으로 같은 Y.Doc에 update를 흘리고 Yjs가 자동 수렴한다.

## 5. 클라이언트 설계

### 5.1 로컬 영속 (`useCollabSession`)
- 협업 enabled일 때 `new IndexeddbPersistence("qn-collab:" + pageId, doc)` 생성.
- `idb.on("synced", () => setIdbLoaded(true))` 로 로컬 로드 완료를 추적, 세션에 `idbLoaded: boolean` 노출.
- cleanup 시 `idb.destroy()`(데이터는 보존, 인스턴스만 정리).
- awareness/doc/provider 생성 순서와 동일 라이프사이클(pageId 단위).

### 5.2 견고한 재연결 (`QnWsProvider` 확장)
- `StatusValue`에 `"offline"` 추가: `"connecting" | "connected" | "disconnected" | "offline"`.
- 생성 시 `navigator.onLine` 확인 + `window`에 `online`/`offline` 리스너 등록(테스트 위해 주입 가능하게).
- `offline` 이벤트: 진행 중 재연결 타이머 취소, 소켓 정리, status `"offline"` emit, 재연결 시도 중단.
- `online` 이벤트: backoff 리셋 후 **즉시 connect**.
- 기존 지수 backoff 재연결은 유지(예기치 않은 끊김 대비), 단 오프라인 상태에서는 작동 안 함.
- destroy 시 리스너 해제.

### 5.3 에디터 게이팅 (`Editor.tsx`)
- 현재: `collabBlocking = collab.enabled && !collab.synced`.
- 변경: **편집 허용 조건** = `collab.synced || (collab.idbLoaded && docNotEmpty)`.
  - `collabBlocking = collab.enabled && !(편집 허용 조건)`.
  - `docNotEmpty` = 로컬 복원된 Y.Doc XML fragment 에 콘텐츠가 있음(§5.5 첫방문+오프라인 빈 doc 오편집 방지).
- 즉, **서버가 sync됐거나, 로컬에 콘텐츠가 복원됐으면** 편집 허용 → 재방문 즉시 편집. 빈 로컬 doc(첫 방문)에서는 서버 sync 를 기다린다.
- 세션 타입 enabled 분기에 `idbLoaded: boolean` 추가. `docNotEmpty` 는 세션에서 함께 노출(또는 게이팅 계산 시 doc fragment 길이로 판단).

### 5.4 연결 상태 배지
- **`src/store/collabConnectionStore.ts`(신규, zustand)**: `{ status: "online" | "reconnecting" | "offline" | "idle"; setStatus }`. presence store와 동일한 단방향 브리지.
- **`useCollabConnection` 훅**(또는 useCollabSession 내부): QnWsProvider status + `navigator.onLine`를 매핑해 store에 publish.
  - 매핑: provider `"connected"`+synced → `"online"`; `"connecting"`/`"disconnected"`(온라인 상태) → `"reconnecting"`; `"offline"` 또는 `!navigator.onLine` → `"offline"`; 협업 비활성 → `"idle"`.
- **`CollabConnectionBadge.tsx`(신규)**: store 구독, TopBar 아바타(`CollabPresenceAvatars`) 옆에 작은 점/배지. `idle`이면 렌더 안 함. 색·툴팁으로 3상태 구분(온라인=초록, 재연결=황색 펄스, 오프라인=회색).

### 5.5 시드 · 중복 방지 (중요, Phase 1 규칙 유지)
- **첫 방문(IndexedDB 없음)**: 기존 규칙대로 서버 초기 sync 후 바인딩 — 빈 doc에 클라가 초기 콘텐츠를 넣지 않는다(중복 방지, Phase 1 §5.1·§6.4). 이 경우 `idbLoaded`는 곧 true가 되지만 doc이 비어 있으므로 서버 sync로 콘텐츠를 받는다.
- **재방문(IndexedDB 있음)**: 로컬 doc 복원 → 즉시 편집 → 서버와 delta 수렴. 로컬에 이미 콘텐츠가 있어 재시드 없음.
- **첫 방문 + 오프라인(로컬·서버 모두 없음)**: 콘텐츠 확보 불가 → 에디터 read-only + 안내("오프라인 — 이 페이지를 아직 받지 못했습니다"). 게이팅: `idbLoaded`가 true여도 doc이 비어 있고 오프라인이면 편집을 막는다(빈 문서 오편집 방지). 구현은 "idbLoaded이며 (서버 synced 또는 doc 비어있지 않음)"로 가드.

## 6. 기존 sync 엔진과의 공존
- 협업 본문 권위는 여전히 Y.Doc. materialize→`Pages.doc`→기존 outbox 경로 유지.
- 오프라인 중 materialize가 호출하는 `updateDoc(..., { deferSync:true })`는 **기존 sync 아웃박스의 오프라인 큐잉**에 실린다(앱에 `online` 이벤트 재전송 로직이 이미 존재 — `Bootstrap.tsx`, `subscribers.ts`). 재연결 시 아웃박스가 flush.
- IndexedDB 영속(Y.Doc 전용)은 Zustand persist/`Pages.doc`과 **별개 저장소** — 충돌 없음.

## 7. 서버
- **서버 변경 없음.** Phase 3는 전적으로 클라이언트(로컬 영속 + 온라인 감지). 인프라/Lambda/DynamoDB/CDK 무변경.

## 8. 에러 처리 / 복원력
- IndexedDB 쓰기 실패: 라이브 세션은 서버 sync로 진행, 다음 성공 시 로컬 갱신. 치명적 아님.
- 재연결: SV 재교환으로 누락분 멱등 수렴(기존 hello 흐름).
- 오프라인↔온라인 토글 반복: backoff 리셋·중복 소켓 방지(기존 단일 소켓 관리 유지).
- 사생활 모드/IndexedDB 비활성 브라우저: `IndexeddbPersistence` 실패 시 idbLoaded 안 됨 → 서버 sync 게이팅으로 폴백(Phase 2 동작).

## 9. 테스트 전략
- **단위**:
  - 게이팅 로직: `(idbLoaded && (synced || docNotEmpty)) || synced` 진리표.
  - 상태 매핑: provider status + onLine → 배지 status.
  - `QnWsProvider` offline/online 전이(주입된 가짜 이벤트): offline 시 재연결 중단·status offline, online 시 즉시 connect.
- **통합**:
  - 오프라인 편집 → 재연결 수렴: 두 Y.Doc + idb mock(또는 fake-indexeddb)로 끊김 중 편집분이 재연결 후 양쪽 수렴.
  - 첫 방문 시드 중복 없음 회귀: 빈 IndexedDB + 서버 시드 1회.
- **수동(dev)**: 네트워크 끊고 편집 → 복구 시 수렴 / 새로고침 즉시 로드 / 배지 3상태 / 사생활 모드 폴백.
- **회귀**: 협업 OFF 페이지는 idb/배지 미개입(Phase 1/2 동작 유지).

## 10. 리스크 & 완화
| 리스크 | 완화 |
|--------|------|
| 빈 로컬 doc 즉시편집 → 서버 콘텐츠와 중복/혼란 | 게이팅에 "doc 비어있지 않음 또는 서버 synced" 조건 추가 |
| 오프라인↔온라인 토글 중 중복 소켓 | 단일 소켓·타이머 관리, online 시 기존 정리 후 connect |
| IndexedDB 불가 환경 | synced 게이팅 폴백(Phase 2 동작) |
| 로컬·서버 상태 분기 혼동 | 두 provider 모두 같은 Y.Doc — Yjs가 단일 진실로 수렴 |
| 배지 결합도(Editor↔TopBar) | collabConnectionStore 단방향 브리지(Phase 2 presence 패턴 재사용) |

## 11. 배포 / 롤아웃
- **서버/인프라 변경 없음.** 클라이언트 변경만 → develop push로 Vercel dev 반영, 기존 feature flag로 단계 검증.
- 의존성 추가: `y-indexeddb`(클라). `infra` 무변경.

## 12. 향후 단계
- **Phase 4**: Yjs 스냅샷 기반 버전 히스토리(마지막 편집자 스탬프 포함)로 현행 diff/patch 대체.
- 후속(선택): IndexedDB 용량 GC, PWA 오프라인 셸, DB 블록 셀 협업.
