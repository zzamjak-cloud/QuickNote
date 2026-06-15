# collab WebSocket 메시지 청킹 설계 (2026-06-15)

## 문제 (확정)

노션 import 페이지처럼 본문이 큰 페이지를 협업(Yjs) 룸에서 열면, 단일 collab
메시지가 API Gateway WebSocket 한도를 초과해 연결이 끊기고 재연결마다 같은 큰
메시지를 재송신하는 **무한 끊김 루프**가 발생한다.

- 측정: 끊기는 페이지 doc Resource Size **316.7KB** (사용자 Network 탭).
- API GW WS 한도: 클라→서버 **프레임 32KB / 메시지 128KB**, 서버→클라
  PostToConnection Data **128KB**.
- 직렬화는 `base64 + JSON`(`wsProtocol.ts:31-34`)이라 raw 대비 ~37% 부풀어 더
  빨리 한도에 닿는다(316KB → 직렬화 후 ~430KB).
- 콘솔 증상: `WebSocket ... /prod?...&pageId=v4:... failed: The network connection
  was lost` 반복, Network 탭 `prod` WS 가 Connect/Close Frame 으로 반복 재연결.

### 큰 메시지 발생 지점

| # | 방향 | 위치 | 발생 |
|---|------|------|------|
| 1 | 클라→서버 | `QnWsProvider.ts:136-139` sv-reply | 첫 sync, doc 전체 delta (가장 큼) |
| 2 | 클라→서버 | `QnWsProvider.ts:154-158` update | seed 가 연결 후 단일 적용 시 |
| 3 | 서버→클라 | `sync.ts:76-81` sync.update | 서버 룸에 큰 상태 |
| 4 | 서버→클라 | `sync.ts:96-97` update broadcast | 큰 update 릴레이 |

청킹/분할 로직 전무: 클라 `QnWsProvider.ts:118-124`, 서버 `sync.ts:46-58`.

## 설계: 트랜스포트 레벨 청킹 (양방향)

**시드 게이트(에디터 바인딩 3원칙)는 건드리지 않는다** — 검증된 사고 방지선이라
재설계 위험이 크다. 대신 메시지 전송 계층만 robust 하게 만든다.

직렬화된 문자열이 임계(`CHUNK_THRESHOLD_BYTES`, 예 96KB)를 넘으면 여러 `chunk`
프레임으로 분할 송신하고 수신측에서 재조립한다. Yjs update 바이트를 쪼개는 게
아니라 **직렬화 문자열(base64)을 쪼개므로** 재조립 후 원본이 정확히 복원된다.

### chunk 프레임 포맷 (wsProtocol.ts / protocol.ts 공유)

```
{ t: "chunk", id: string, i: number, n: number, body: string }
```
- `id`: 메시지 식별자(원본 메시지마다 고유). 클라는 `crypto.randomUUID`,
  서버는 connectionId+timestamp+seq 등.
- `i`: 청크 인덱스(0-based), `n`: 총 청크 수, `body`: 직렬화 문자열 조각.
- 임계 이하 메시지는 **기존 그대로** 전송(하위 호환·오버헤드 0).

### 클라이언트 변경 (`QnWsProvider.ts`, `wsProtocol.ts`)

- `send(data)`: `data.length ≤ 임계`면 그대로 `ws.send`; 초과면 청크 분할해 순차 send.
- `handleMessage(raw)`: `chunk` 프레임이면 메모리 `Map<id, {parts, n}>`에 누적,
  마지막 청크 도착 시 `parts.join("")` → 기존 `parseServerMessage` 경로.
  (수신 재조립은 단일 클라 메모리라 stateful·단순.)

### 서버 변경 (`sync.ts`, `protocol.ts`)

- `post(target, data)`: 임계 초과면 청크로 분할해 여러 `PostToConnection` 순차 전송.
- **수신 재조립(stateless 난점)**: 클라→서버 청크는 메시지마다 별도 Lambda 호출이라
  외부 버퍼가 필요하다. `rt-connections` 항목에 `chunkBuf`(id별 parts) 누적 또는
  신규 `rt-chunks` 테이블(TTL 60s). 마지막 청크에서 재조립 후 기존 처리(append/
  broadcast), 버퍼 삭제. WebSocket 순서 보장 + `i` 정렬로 정합성 확보.

### epoch bump (v4 → v5)

프로토콜 변경이라 과도기에 구/신 버전이 섞이면 `chunk`를 못 읽는다. `chunk`는 큰
메시지에서만 쓰므로 작은 페이지는 하위 호환되지만, 큰 페이지는 양쪽이 신버전이 될
때까지 깨진다. **epoch v5 bump 로 신세대 룸을 격리**하면 과도기 오염을 피한다
(서버 본문은 `page.doc`에 있어 재시드됨). `collabConfig.ts` 기본값 +
`VITE_COLLAB_ROOM_EPOCH`.

## 배포 순서

1. develop 에서 클라(QnWsProvider/wsProtocol) + 서버(sync/protocol/CDK) + epoch v5 구현.
2. dev 빌드에서 큰 import 페이지로 재현·검증(끊김 없음, 본문/블록링크 정상).
3. 승인 후 라이브: **Lambda(CDK) 먼저 또는 동시** + 웹(Vercel) + 데스크톱(Publish).
   epoch v5 로 격리되므로 배포 순서 race 는 무해.

## 검증 시나리오 (dev)

- 316KB+ import 페이지 열기 → WS 끊김 0, 본문 완전 표시, 블록링크 이동 정상.
- 작은 페이지(기존) → chunk 미사용, 정상 동작 회귀 없음.
- 두 클라 동시 진입(시드 race) / 연속 새로고침 4~5회 / 동시 편집 후 본문 일치.
- 데스크톱↔웹 양방향 본문/삭제/parentId 동기화.

## 한도 상수

- `CHUNK_THRESHOLD_BYTES = 96 * 1024` (직렬화 후 기준, 128KB 한도에 안전마진).
- 청크 본문 크기도 동일 임계 이하. base64 는 ASCII 라 char length == byte length.
