# 실시간 공동 편집 — Phase 2 (프레즌스/awareness) 설계

- 작성일: 2026-06-11
- 상태: 설계(승인됨)
- 범위: **Phase 2 = awareness 프레즌스만.** 커서·선택영역·접속자 표시. 오프라인·Yjs 스냅샷 히스토리는 후속 Phase.
- 선행: Phase 1(코어 실시간 sync) 완료·dev 검증·develop push 완료. (`docs/superpowers/specs/2026-06-10-realtime-collab-phase1-design.md`)

---

## 1. 배경 / 동기

Phase 1로 본문은 하나의 Y.Doc으로 수렴하고 여러 클라이언트가 실시간으로 주고받는다. 그러나 **누가 함께 보고 있는지, 어디를 편집 중인지** 알 수 없다. Phase 2는 Yjs 표준 **awareness**(`y-protocols/awareness`)를 도입해:

- 다른 사용자의 **캐럿 위치**(이름 라벨)와 **텍스트 선택영역**을 에디터에 표시.
- 현재 이 페이지를 보고 있는 **접속자 아바타 목록**을 상단바에 표시.

awareness는 본문 update와 달리 **휘발성**이다. 영속하지 않고 룸 피어에게 릴레이만 한다(커서 노이즈를 DynamoDB에 쌓지 않는다).

규모 전제는 Phase 1과 동일: 한 페이지 동시 편집 2~5명.

## 2. 목표 / 비목표

### 목표 (Phase 2)
- 같은 협업 페이지를 연 피어들의 **원격 캐럿·선택영역**을 에디터에 실시간 렌더(이름·색).
- 상단바(TopBar) 우측, 알림벨 옆에 **접속자 아바타 스택**(본인 제외, 초과 시 `+N`).
- 사용자 **색은 memberId로 결정적 생성** — 모든 피어가 같은 사용자에게 같은 색을 본다.
- Phase 1 인프라(WS 라우트·인가·연결테이블) **그대로 재사용**, 서버 변경 최소.
- Phase 1 feature flag 재사용 — 협업 ON 페이지에서만 프레즌스 활성.

### 비목표 (Phase 2 제외)
- 오프라인 로컬 영속(`y-indexeddb`) → Phase 3.
- Yjs 스냅샷 기반 버전 히스토리 → Phase 4.
- DB(데이터베이스) 블록 셀의 커서/프레즌스 — Phase 2는 **페이지 본문 doc만**.
- 팔로우 모드/뷰포트 추적(다른 사용자 화면 따라가기).
- 타이핑 인디케이터(캐럿/선택 외 별도 "입력 중…" 표시).
- idle/away 상태 구분 — 접속 여부만 표시.

## 3. 용어
- **Awareness**: `y-protocols/awareness`의 클라이언트별 휘발성 상태 저장소. 변경 시 바이너리 awareness update를 emit.
- **awareness state**: 한 클라이언트의 상태. 본 설계에서 `{ user: { memberId, name, color, avatarUrl }, cursor, ... }` 형태. cursor/selection은 yCursorPlugin이 관리.
- **clientID**: Yjs 문서별 클라이언트 식별자(awareness state 키).
- **yCursorPlugin**: `y-prosemirror`가 제공하는 ProseMirror 플러그인. awareness로부터 원격 캐럿·선택을 렌더하고, 로컬 선택을 awareness에 기록.

## 4. 아키텍처 개요

```
TipTap 선택변경 ─ yCursorPlugin ─ Awareness(local) ─ QnWsProvider ┐
                                                                  │ {t:"awareness", update}
                                          서버 sync.ts: 룸 피어 fan-out (영속 X)
                                                                  │
peer Awareness ◄─ applyAwarenessUpdate ◄──────────────────────────┘
       │
       ├─ yCursorPlugin → 원격 캐럿(이름 라벨)·선택 하이라이트 렌더
       └─ collabPresenceStore → TopBar 아바타 스택(CollabPresenceAvatars)
```

## 5. 클라이언트 설계

### 5.1 전송 프로토콜 (`src/lib/collab/wsProtocol.ts`)
- `ClientMessage`/`ServerMessage`에 `{ t: "awareness"; update: Uint8Array }` 추가.
- 직렬화는 기존 update와 동일하게 base64 text 프레임. 서버 `infra/lambda/realtime/protocol.ts`와 계약 일치.

### 5.2 provider (`QnWsProvider`)
- 생성 옵션에 `awareness?: Awareness` 추가(없으면 Phase 1 동작 그대로 — 하위호환).
- `awareness.on("update", ({ added, updated, removed }, origin) => …)`: origin이 REMOTE면 무시(echo 방지), 아니면 변경 clientID 목록을 `encodeAwarenessUpdate(awareness, changed)`로 인코딩해 `{t:"awareness", update}` 전송.
- 수신 `{t:"awareness", update}` → `applyAwarenessUpdate(awareness, update, REMOTE_ORIGIN)`.
- 연결 open 시(최초·재연결) 로컬 클라이언트 awareness 상태를 한 번 인코딩해 전송(피어가 새 접속자를 즉시 인지).
- `destroy()`에서 `removeAwarenessStates(awareness, [doc.clientID], "local")` 호출 → 정상 이탈 시 즉시 self 제거가 피어에 브로드캐스트되고, 로컬 awareness 리스너가 그 update를 전송.

### 5.3 세션 훅 (`useCollabSession`)
- 협업 enabled일 때 `new Awareness(doc)` 생성.
- `memberStore.me`에서 `{ memberId, name, avatarUrl }`을 읽어 `awareness.setLocalStateField("user", { memberId, name, color, avatarUrl })`. `color`는 `collabColor(memberId)`.
- me가 바뀌면(로그인 정보 로드 지연) user 필드 갱신.
- 세션 객체에 `awareness`를 노출: `{ enabled: true; doc; awareness; synced }`.
- 정리(cleanup) 시 `awareness.destroy()`.

### 5.4 결정적 색 (`src/lib/collab/collabColor.ts` 신규)
- `collabColor(memberId: string): { color: string; light: string }` — memberId 문자열 해시 → 고정 팔레트 또는 HSL 색. caret/라벨용 진한 색과 선택 하이라이트용 옅은 색(알파) 한 쌍 반환.
- 순수 함수, 단위 테스트로 결정성 보장.

### 5.5 TipTap 바인딩 (`src/lib/tiptapExtensions/collaboration.ts`)
- 옵션에 `awareness: Awareness | null` 추가.
- `addProseMirrorPlugins`: 기존 `ySyncPlugin`·`yUndoPlugin`에 더해 awareness 있으면 `yCursorPlugin(awareness, { cursorBuilder, selectionBuilder })` 추가.
  - `cursorBuilder(user)`: user.color로 캐럿 막대 + 이름 라벨 DOM 생성.
  - `selectionBuilder(user)`: user.light 배경의 선택 하이라이트 스타일.
- yCursorPlugin이 로컬 선택을 awareness의 `cursor` 필드에 기록하고, 원격 상태를 데코레이션으로 렌더한다.

### 5.6 프레즌스 브리지 + 접속자 UI
- **`src/store/collabPresenceStore.ts`(신규, zustand)**: `{ pageId, users: RemoteUser[] }`. Editor 영역(useCollabSession 소비처)이 awareness 변경을 구독해 본인 제외 remote user 목록을 publish. TopBar는 이 스토어만 구독 → Editor↔TopBar prop drilling 회피.
  - `RemoteUser = { clientId: number; memberId?: string; name: string; color: string; avatarUrl?: string }`.
  - 같은 memberId 다중 탭은 표시상 1명으로 dedupe(memberId 기준), memberId 없으면 clientId 기준.
- **`useCollabPresence` 훅**: awareness `change` 이벤트 구독 → `awareness.getStates()`를 RemoteUser[]로 매핑해 store에 반영. Editor에서 awareness가 생성되면 마운트.
- **`src/components/collab/CollabPresenceAvatars.tsx`(신규)**: presence store 구독, 겹친 아바타 스택 렌더(아바타 없으면 이니셜+색 원형), 일정 수 초과 시 `+N`, hover 시 이름 tooltip. **TopBar 우측 NotificationBell 옆**에 배치. 협업 비활성/0명이면 렌더 안 함.

## 6. 서버 설계

### 6.1 전송 프로토콜 (`infra/lambda/realtime/protocol.ts`)
- `ClientMessage`/`ServerMessage`에 `{ t: "awareness"; update: Uint8Array }` 추가(클라이언트와 동일 계약).

### 6.2 sync 핸들러 (`infra/lambda/realtime/sync.ts`)
- `awareness` 메시지 수신 시: 같은 pageId의 다른 connection으로 `{t:"awareness", update}`를 `PostToConnection` fan-out. **DynamoDB 미기록**(Y.Doc 상태/로그와 무관).
- `GoneException` 발생 connection 정리는 기존 `post()` 로직 재사용.
- 기존 `hello`/`update` 경로는 변경 없음.

### 6.3 변경 없는 부분
- DynamoDB 테이블·CDK 스택 변경 없음(awareness는 휘발성).
- `$connect`/`$disconnect` 변경 없음. 끊김 정리는 클라이언트 awareness 타임아웃(~30초) + 정상 이탈 시 beforeunload/destroy의 self 제거 브로드캐스트로 처리.

## 7. 데이터 흐름 · 정체성
- 로컬 캐럿 이동 → PM selection → yCursorPlugin이 awareness `cursor` 갱신 → awareness update → provider → 서버 → 피어 → applyAwarenessUpdate → 피어 yCursorPlugin 렌더.
- `user` 필드(이름·색·아바타·memberId)는 awareness에 실려 피어가 그대로 렌더. 색은 memberId 결정적 생성이라 모든 화면에서 동일.
- 접속자 목록 = 각 클라이언트의 `getStates()` → 본인(clientID) 제외 → RemoteUser[].

## 8. 인증 / 인가
- 별도 인가 없음. awareness는 이미 Phase 1 `$connect` 인가(워크스페이스 멤버십)를 통과한 연결로만 흐른다. 연결 시 확정된 룸(pageId) 컨텍스트로 fan-out하므로 추가 검증 불필요.

## 9. 에러 처리 / 복원력
- awareness apply 실패는 무시(휘발성, 다음 update로 복구).
- WS 끊김: provider 재연결 시 로컬 awareness 재전송. 재연결 전까지 피어의 내 커서는 타임아웃으로 사라졌다가 재등장.
- 크래시/네트워크 단절 잔존 커서: y-protocols Awareness 기본 타임아웃(~30초)으로 자동 제거.
- 정상 이탈(페이지 전환·탭 닫기): destroy/beforeunload self 제거로 즉시 정리.

## 10. 테스트 전략
- **단위**:
  - `wsProtocol` awareness 인코딩/디코딩 라운드트립(클라·서버 계약 일치).
  - `collabColor` 결정성(같은 memberId → 같은 색, 분포 합리성).
  - `useCollabPresence`/store 매핑(본인 제외, memberId dedupe, getStates → RemoteUser[]).
  - `QnWsProvider` awareness 송수신(mock socket): 로컬 update 전송, 원격 update 적용, REMOTE_ORIGIN echo 미전송, open 시 로컬 상태 재전송, destroy 시 self 제거 전송.
- **서버**: `sync` awareness 처리 — 같은 룸 피어 fan-out, 발신자 제외, DynamoDB 미기록(yjsStore 호출 없음).
- **수동/스모크**: 2클라이언트 — A 캐럿·선택이 B 에디터에 렌더, 양쪽 아바타 스택 표시, 한쪽 이탈 시 정리. (Phase 1 스모크 스크립트 확장 또는 브라우저 2탭.)
- **회귀**: 협업 OFF 페이지·awareness 미주입 시 Phase 1 동작·렌더 그대로(yCursorPlugin 비활성).

## 11. 리스크 & 완화
| 리스크 | 완화 |
|--------|------|
| awareness echo 루프 | provider에서 REMOTE_ORIGIN update는 재전송 안 함 |
| 잔존 커서(좀비) | Awareness 타임아웃 + 정상 이탈 self 제거 |
| 같은 사용자 다중 탭 중복 아바타 | presence store에서 memberId dedupe |
| Editor↔TopBar 결합 | collabPresenceStore로 단방향 브리지(직접 의존 없음) |
| 색 불일치(피어마다 다른 색) | memberId 결정적 생성으로 전역 일치 |
| awareness가 본문 update 채널 오염 | 별도 메시지 타입, 서버 미영속 |

## 12. 배포 / 롤아웃
- **인프라 변경**: `infra/lambda/realtime/protocol.ts`·`sync.ts`만 수정 → `DevQuicknoteRealtimeCollabStack` 재배포(테이블·라우트 변경 없음, Lambda 코드만). **develop에서 구현·dev 검증 후 사용자 명시 승인 시 배포**.
- **프론트**: Phase 1과 동일 feature flag로 단계 검증.
- DynamoDB/CDK 구조 변경 없음 → 배포 리스크 낮음.

## 13. 향후 단계
- **Phase 3**: `y-indexeddb` 오프라인 + 견고한 재연결.
- **Phase 4**: Yjs 스냅샷 기반 버전 히스토리(마지막 편집자 스탬프 포함).
