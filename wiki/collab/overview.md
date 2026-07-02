# 실시간 협업(Yjs) — 아키텍처·안전장치·운영

2026-06-12 라이브 전체 오픈(v5.4.36, 페이지 `*` + DB `*`). 배포 절차는
[`infra/collab-live-deploy-checklist.md`](../infra/collab-live-deploy-checklist.md),
설계 원문은 `docs/superpowers/specs/2026-06-11-realtime-collab-phase*.md` 참고.

---

## 구조 한눈에

```
[클라이언트]
Editor.tsx ── useCollabSession(pageId) ──→ Y.Doc + QnWsProvider + IndexedDB(qn-collab:<epoch>:<pageId>)
           └─ useDatabaseCollabSession(dbId) → Y.Doc + IndexedDB(qn-collab-db:<epoch>:<dbId>)
플래그: collabConfig.ts — VITE_COLLAB_WS_URL + VITE_COLLAB_ENABLED_PAGE_IDS/DB_IDS("*" 전체)
room = "<epoch>:<pageId>" / "db:<epoch>:<dbId>"  (epoch 기본값 v3, env VITE_COLLAB_ROOM_EPOCH)

[서버 — RealtimeCollabStack (API GW WebSocket)]
connect.ts  : Cognito 토큰 검증 + parseRoom(room.ts, epoch 솔트 제거) + 워크스페이스 view 인가
sync.ts     : hello→diff 응답, update 영속·fan-out. db: 룸은 빈 상태일 때 서버 권위 dbSeed
              ping→즉시 pong(상태 로드 없음) — keepalive 전용(2026-07-03 비용 절감)
disconnect.ts
테이블: {env}quicknote-rt-connections(TTL) / rt-ydoc(스냅샷) / rt-ydoc-updates(로그, 50건 초과 압축)
⚠ rt-ydoc/-updates 는 TTL 없음 — 룸 상태는 영구 보존된다(epoch 격리의 이유)
```

본문 권위: 협업 ON 페이지는 **Y.Doc 이 권위**. 스토어 JSON 역주입은 바인딩 후 차단되고,
Y→store 반영은 materialize(1.8s 디바운스) 단방향. DB 구조는 applyCollabDbStructure 가 materialize.

⚠ **서버 Pages.doc 영속**: materialize 의 `updateDoc(deferSync)` 는 sync enqueue 를 **생략**한다.
서버 영속은 useCollabSession 의 **주기 업서트**(로컬 편집 발생 시 8s 간격 + 페이지 이탈 시 flush)가
담당한다 — 이게 없으면 협업 중 본문이 서버에 안 올라가 **버전 히스토리가 안 쌓이고**, epoch bump
시드 소스(page.doc)가 과거로 밀려 본문 유실 위험(2026-06-12 발견·수정). 로컬 편집 판별은
Y update origin(QN_WS_REMOTE_ORIGIN·IDB 제외) — view-only 클라는 업서트하지 않는다.
DB 쪽은 applyCollabDbStructure 가 `enqueueUpsertDatabase(..., { skipCollab: true })` 로 동일 역할.

---

## 에디터 바인딩 3원칙 (CRITICAL — Editor.tsx)

2026-06-12 라이브 사고 3건의 재설계 결과. **이 순서를 깨면 데이터/화면 사고가 재발한다.**

1. **시드 소스는 서버 본문만** — `fetchPageById` 결과로만 시드한다(모든 클라 byte-동일 →
   고정 SEED_CLIENT_ID 결정적 시드가 안전). **로컬 store 본문으로 시드 금지**: 클라마다
   다른 본문으로 시드하면 같은 (clientID, clock)에 다른 내용이 생겨 CRDT 가 갈라진다
   (라이브 "한 줄 불일치" 사고). 피어가 이미 시드한 doc(비어있지 않음)은 시드 생략.
   서버 본문이 placeholder 면 "진짜 빈 페이지"로 확정하고 시드 없이 바인딩. 단, 기존
   Y.Doc 이 placeholder 또는 렌더 불가능 상태면 fresh 서버 본문으로 교체한 뒤 바인딩한다.
   시드용 fresh 본문은 store 반영 결과가 아니라 방금 받은 서버 응답에서 직접 파싱해 쓴다.
2. **시드 완료 후에만 바인딩** — `collabBoundDoc` 게이트. ySyncPlugin 이 빈 fragment 에
   붙으면 PM 초기 빈 문단을 Y 에 주입해 `seedCollabDocIfEmpty` 가 "콘텐츠 있음"으로
   오판 → 본문 시드 영구 차단 → 전 페이지 빈 화면(라이브 사고). 바인딩 전에는 일반
   경로로 본문을 표시(read-only).
3. **view 마운트 후에만 오버레이** — `editorViewReady` 게이트. useEditor 재생성 직후
   view 미마운트 상태에서 `editor.view` 접근은 TipTap 프록시가 throw → 루트 경계 전파로
   사이드바까지 소실(라이브 크래시). BlockHandles·BubbleToolbar 등은 viewReady 후 렌더.
   `EditorErrorBoundary` 가 에디터 오류를 에디터 영역에 격리한다.

## materialize 방어선 (useCollabSession.ts / databaseStore.ts)

- **synced 게이트**: 서버 sync 전(IndexedDB 단독 로드) 상태는 stale 일 수 있어 materialize 금지.
- **빈 doc 가드**: `isCollabDocBodyEmpty`(fragment length 0) → 저장 생략.
- **placeholder 가드**: 빈 문단뿐인 Y 상태가 의미 있는 기존 본문을 덮지 못함
  (`isPlaceholderBodyJson`, 서버 `preserveExistingDocForPlaceholderInput` 와 동일 의미).
- **서버 최후 방어선(CRITICAL)**: `upsertRecord` 는 전체 PutItem(전치환)이라 본문 없는 입력이
  기존 본문을 통째로 소거할 수 있다. `preserveExistingDocForPlaceholderInput` →
  `incomingDocLacksContent` 가 **doc 키 부재 / null / 빈 문자열 / placeholder** 를 전부 "본문 없음"
  으로 묶어, 기존이 유의미하면 절대 덮어쓰지 않는다. 클라 버전·버그(메타-only 업서트,
  `JSON.stringify(undefined)` 로 doc 탈락 등)와 무관한 유일 backstop — 이 조건을 좁히지 말 것
  (`preserveExistingDoc.test.ts` 11케이스 고정). 신규 페이지(existing=null)는 의도적 빈 본문 허용.
- **storeApply 예외**: 활성 협업 페이지라도 로컬 doc 이 placeholder 이고 서버 doc 이 실제 본문이면
  서버 doc 을 받아 현재 화면과 시드 소스를 복구한다.
- **렌더 가능성 가드**: 에디터 바인딩 전 Y.Doc attrs 를 primitive 만 남기고 정화하고,
  placeholder/오염 상태는 서버 본문으로 교체한다.
- **done 재검증**: 이미 시드 완료로 표시된 세션도 바인딩 직전 Y.Doc 이 placeholder 이면
  로컬에 적재된 서버 본문으로 한 번 더 교체한다.
- **legacy 컬럼 복구**: 버전 히스토리 복원 등으로 `paragraph(attrs.columns)` 아래에
  `column` 자식이 저장된 본문은 Y.Doc 변환 전 현재 `columnLayout` 으로 보정한다.
- **DB**: 컬럼 0개 구조 차단 + 부분 시드(멤버·순서 빈)가 기존 행 순서를 비우지 못하게 보존.
- **fullPageDatabaseId 보존**: toGqlPage/toPageInputPayload 는 태그 있으면 싣고 없으면 키 생략,
  서버 upsertPage 가 키 부재·null 시 기존 태그 유지([`pages/ghost-page-prevention.md`](../pages/ghost-page-prevention.md)).

## epoch (세대 격리)

룸 키·IndexedDB 키에 `collabRoomEpoch()`(기본 v3)가 들어간다. 룸 상태는 서버(TTL 없음)와
각 브라우저 IDB 양쪽에 영구 보존되므로, **협업 OFF→ON 재활성화 시 반드시 epoch 을 bump**
(env `VITE_COLLAB_ROOM_EPOCH` 또는 collabConfig 기본값 수정)해 과거 세대 잔재(stale/오염
상태)를 격리한다. 서버 테이블만 비우는 건 불충분 — 클라 IDB 잔재가 sv-reply 로 룸을 재오염시킨다.

---

## 오프라인 협업 · PWA(SW) 관계 (2026-06-28, PWA Phase 3)

협업 오프라인 동작은 PWA Service Worker 와 **독립**이다. SW 는 정적 셸·해시 청크만 precache 하고
WS·IndexedDB·API 를 가로채지 않으므로, 아래 데이터 흐름에 관여하지 않는다.

데이터 흐름:
- **오프라인 진입**: WS 끊김 → Y.Doc 은 로컬 편집만 가능(`y-indexeddb` 가 자동 영속).
  materialize 는 계속 동작 → store 갱신 + 비협업 변경은 sync outbox 에 큐잉.
- **온라인 복귀**: outbox flush + WS 재연결 → Y.Doc diff sync 로 수렴.
- **권위**: 협업 활성 페이지 본문은 **Y.Doc 단일 권위**. 원격 `page.doc` echo(REST)·store JSON 은
  본문을 역주입하지 못한다(`preserveCollabDoc`, storeApply/pageApply.ts §1.7).
  회귀 테스트: `src/__tests__/sync/storeApply.test.ts` "협업 활성 페이지의 로컬 실본문은 원격 echo 가 덮지 않는다".

불변식: **SW precache 는 협업 본문을 절대 캐시/제공하지 않는다.** epoch 은 빌드타임 박힘이라
stale SW = stale epoch — 배포 정합은 [collab-live-deploy-checklist §1.8](../infra/collab-live-deploy-checklist.md) 참고.

수동 검증(자동 E2E 는 WS 테스트 하니스 부재로 보류):
1. 협업 ON 페이지 열기 → DevTools Network "Offline" → 본문 편집(로컬 반영 확인).
2. 새로고침 → `y-indexeddb` 에서 편집분 복원(셸은 SW precache 로 로드).
3. Online 복귀 → 다른 탭/계정과 본문 수렴, 역주입으로 인한 옛 본문 되돌림 없음.

---

## 운영 규칙

- **env 는 Plain 타입만** — Sensitive 는 값을 읽을 수 없어 "비움 확인"이 가짜 신호가 된다
  (편집화면 빈칸·`vercel env pull` 빈값인데 실제 값 유지). 끌 때는 `vercel env rm`.
- env 변경 후 재배포는 **실코드 변경 커밋**으로(빈 커밋은 Vercel 이 구 번들 재사용 가능).
  빌드 검증은 번들 fetch + `wss://...execute-api` grep.
- WS URL: prod `wss://407mxw4ddl...`, dev `wss://q8x5kgqi76...` — **라이브에 dev WS 금지, 역도 금지.**
- 오픈은 단계적으로: 단일 페이지 → 워크스페이스 → `*`. 검증 시나리오(필수):
  공유 워크스페이스 콘텐츠 페이지 시크릿 콜드로드 / 두 브라우저 동시 첫 진입(시드 race) /
  협업 중 연속 새로고침 4~5회 / 동시 편집 후 양쪽 본문 완전 일치 / 신규 빈 페이지 즉시 입력 /
  **다른 계정**(인가·presence·view-only 편집 차단).

## 진단 가이드

| 증상 | 확인 |
|---|---|
| 협업 연결 안 됨 | Network→WS 에 `pageId=<epoch>:<id>` 연결 여부 → connect 람다 로그(401=인가) → sync 람다 START 카운트 |
| 본문 빈 화면 | 서버 `page.doc` 먼저 확인(대부분 무손실) → 룸 Y 상태 디코딩(아래) → 시드/바인딩 게이트 의심 |
| 룸 상태 디코딩 | rt-ydoc(state, b64) + rt-ydoc-updates(update 로그) 를 `Y.mergeUpdates` 후 `getXmlFragment("prosemirror")` — 빈 문단만 있으면 오염 룸 |
| 클라 로그 | `[collab] placeholder Y 상태 materialize 차단` = 방어선 작동(데이터 보호됨) |
| 람다 | `{Dev}QuicknoteRealtimeCollabStack-{Connect,Sync}Fn*` CloudWatch. 검증 단계 거절은 람다에 안 남음 |

## 파일 맵

| 파일 | 역할 |
|---|---|
| `src/lib/collab/collabConfig.ts` | 플래그·WS URL·epoch |
| `src/lib/collab/useCollabSession.ts` | 페이지 세션(Y.Doc·IDB·materialize·synced 게이트) |
| `src/lib/collab/useDatabaseCollabSession.ts` | DB 구조 세션 |
| `src/lib/collab/yjsDoc.ts` | 시드(buildSeedUpdate)·빈/placeholder 판정·JSON↔Y 변환 |
| `src/lib/collab/QnWsProvider.ts` | WS 프로토콜(hello/ping/sync/update/awareness) + 송신 청킹·수신 재조립·CONNECTING 소켓 cleanup. keepalive 는 경량 ping(4분)·hello 는 연결/재연결/탭 전면 복귀 시만(서버 상태 로드 비용). update·awareness 송신은 leading+쿨다운 배칭(250/300ms) — flush 는 destroy/beforeunload, 단절 시 버퍼 폐기(sv-reply 복구) |
| `src/lib/collab/wsProtocol.ts` | 직렬화(base64+JSON) + `chunk` 분할/재조립(`CHUNK_THRESHOLD=28KB`) |
| `infra/lambda/realtime/protocol.ts` | 서버 직렬화 + 청킹(클라와 바이트 계약 일치) |
| `infra/lambda/realtime/chunks.ts` | 서버 수신 chunk 재조립 버퍼(rt-chunks, TTL 60s) |
| `src/components/editor/Editor.tsx` | 시드→바인딩 게이트·viewReady·서버 시드 effect |
| `src/components/editor/EditorErrorBoundary.tsx` | 에디터 오류 격리 |
| `src/store/databaseStore.ts` (applyCollabDbStructure) | DB 구조 materialize·가드 |
| `infra/lambda/realtime/{connect,sync,disconnect,room,auth,yjsStore,dbSeed}.ts` | WS 백엔드 |
| `infra/lib/realtime-collab-stack.ts` | API GW·람다·rt-* 테이블 |

## 사고 연대기 (2026-06-11~12, 모두 해결·라이브 반영)

1. **stale 룸 롤백 위험** — 룸/IDB 영구 보존 + 신선도 검사 부재 → epoch 솔트 + synced 게이트.
2. **빈 화면(전 페이지)** — 빈 Y.Doc 에 에디터 선바인딩 → 빈 문단 주입 → 시드 영구 차단 → 원칙 2.
3. **한 줄 불일치(CRDT 분기)** — 클라별 다른 본문으로 결정적 시드 → 원칙 1(서버 시드 일원화).
4. **view 크래시 → 사이드바 소실** — view 미마운트 접근이 루트 경계 전파 → 원칙 3 + 경계 격리.
5. **Sensitive env 함정** — 협업이 꺼진 줄 알았으나 실제 값 유지 → 운영 규칙(Plain·env rm·번들 검증).
6. **대용량 본문 collab 끊김(메시지 청킹)** — 2026-06-15. 노션 import 등 본문이 큰 페이지(측정 316KB)를
   collab 으로 열면 sync 가 단일 WS 메시지로 API GW 한도를 넘어 연결이 끊기고 1초 주기 무한 재연결.
   본문이 서버 룸에 한 번도 저장되지 못해 매 재연결마다 전체 본문을 sv-reply 로 재전송 → 영구 루프.
   상세·교훈은 아래 **"WS 메시지 청킹"** 절. (epoch v4→v5 격리)

각 사고의 상세 메커니즘·검증 절차는 [`infra/collab-live-deploy-checklist.md`](../infra/collab-live-deploy-checklist.md) §0·§1.5·§1.6.

## WS 메시지 청킹 (CRITICAL — 2026-06-15)

대용량 본문 페이지의 collab sync 가 API Gateway WebSocket 한도를 넘어 끊기던 사고의 해결책.
`wsProtocol.ts`(클라)·`protocol.ts`(서버) 가 직렬화 문자열을 `chunk` 메시지로 분할하고 수신측이 재조립한다.

핵심 교훈(회귀 방지):
1. **바이너리 프레임 금지** — API GW WebSocket route selection 이 `$request.body.action`(JSON 평가)이라
   바이너리 메시지는 `$default` 라우트에 닿지 못하고 드롭된다(편집 불가 사고). **반드시 base64+JSON 텍스트 유지.**
2. **청크 임계는 프레임 32KB 가 상한 — 메시지 128KB 가 아니다.** 브라우저는 한 `ws.send` 를 단일 WS
   프레임으로 보내므로, 32KB 를 넘는 청크는 API GW 가 거부하며 **연결을 끊는다**. `CHUNK_THRESHOLD=28*1024`
   (프레임 한도 내). 96KB 로 잡았다가 끊김이 재현됐다.
3. **증상 판별** — Network `prod` WS 가 1초 주기로 무한 재생성 + 서버 sync 응답이 `update:"AAA="`(빈 값)면
   = sv-reply 청크가 서버에 안 닿아 룸이 빈 채 유지되는 상태. 첫 sv-reply 가 한 번 저장되면(서버 sv 가
   클라 sv 와 일치) sv-reply 가 수십 바이트로 작아지고 루프가 멈춘다.
4. 서버 수신 재조립은 stateless Lambda 라 `infra/lambda/realtime/chunks.ts`(rt-chunks 테이블, TTL 60s)에 누적.
5. 프로토콜 변경이므로 **epoch bump + 클라(웹/데스크톱)·서버 Lambda 동시 배포** 필수.

## selection 가드 (CRITICAL — 2026-06-15)

`collaboration.ts` 의 `appendTransaction` plugin. 첫 노드가 callout 등 inline content 없는 block 인
문서에서 ySyncPlugin 의 selection 복원이 비-textblock 에 endpoint 를 만들면 ProseMirror 보정이
무한 재귀(stack overflow)하던 크래시를 끊기 위한 안전장치.

**반드시 `TextSelection` 에만 적용해야 한다.**

```ts
appendTransaction: (_trs, _oldState, state) => {
  const sel = state.selection;
  if (!(sel instanceof TextSelection)) return null; // ← CellSelection/NodeSelection 보존
  if (sel.$from.parent.inlineContent && sel.$to.parent.inlineContent) return null;
  const near = Selection.near(state.doc.resolve(Math.min(sel.from, state.doc.content.size)), 1);
  return near.eq(sel) ? null : state.tr.setSelection(near);
},
```

회귀 사고(2026-06-15, v5.4.48 도입): `TextSelection` 한정 없이 "양 끝점 부모가 inlineContent 아니면
보정" 으로 만들었더니, **`CellSelection`(표 셀)·`NodeSelection`도 끝점 부모가 셀/행(=inlineContent 아님)이라
생성 즉시 TextSelection 으로 되돌려져** 표 컬럼 셀 드래그·Shift+클릭 선택·균등분배 툴바가 전부 무력화됐다.
크래시는 TextSelection 복원에서만 발생하므로 `TextSelection` 한정으로 방지 효과는 유지된다.
진단: live 에서 `@tiptap/pm/tables` 의 `CellSelection` 을 직접 dispatch → appendTransaction 통과 후에도
살아있는지로 가드 영향을 판정(Playwright 합성 마우스 드래그는 prosemirror-tables 드래그 추적을 구동 못 함).
