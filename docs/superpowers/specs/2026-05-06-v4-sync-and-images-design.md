# v4.0.0 — AppSync 멀티 디바이스 동기화 + S3 이미지 업로드 설계

작성일: 2026-05-06
상태: Draft (구현 계획 작성 직전)
선행 버전: v3.0.0 (AWS Cognito + Google OAuth + 화이트리스트)
후속 버전: v5.0.0 (다중 사용자 실시간 협업, CRDT/Yjs 도입 예정)

---

## 1. 목표·범위

### 목표

1. 한 사용자가 여러 디바이스(웹·Tauri 데스크톱·향후 모바일)에서 **동일 페이지·DB·연락처를 자동으로 동기화**한다.
2. **오프라인에서도 편집 가능**하며, 온라인 복귀 시 outbox 큐가 자동으로 푸시한다.
3. **실시간 반영** — 한 디바이스에서 변경한 내용이 다른 활성 디바이스에 1~2초 내 반영된다.
4. **이미지를 S3로 업로드**하여 base64 인라인의 한계(5MB, 페이로드 비대화)를 제거한다.
5. v3 인프라(`CognitoStack`)는 무손상으로 재사용한다.

### 범위 밖 (Non-goals)

- **다중 사용자 동시 편집** — 동일 페이지를 여러 사용자가 동시에 편집하는 협업은 v5에서 CRDT(Yjs/Automerge)로 처리.
- **블록 단위 머지** — v4는 페이지 단위 LWW.
- **모바일 네이티브 앱** — v4 스키마·인프라는 모바일도 수용하도록 설계하되 실제 RN 앱은 v4.x 또는 v5에서.
- **기존 데이터 마이그레이션** — 현재 데이터는 개발 단계 테스트 데이터이므로 v4 첫 로그인 시 폐기.

### 동기화 대상 / 비대상

| 스토어 | 동기화 | 비고 |
|---|---|---|
| `pageStore` | ✅ | `Page` 모델 |
| `databaseStore` | ✅ | `Database` 모델 |
| `contactsStore` | ✅ | `Contact` 모델 |
| `historyStore` | ❌ | 디바이스 로컬, 비용·트래픽 폭증 우려 |
| `settingsStore` | ❌ | UI 상태(다크모드·사이드바·탭) 디바이스별 |
| `authStore` | ❌ | 토큰 보안상 절대 동기화 금지 |

---

## 2. 아키텍처 개요

```
┌──────────────────┐  Cognito JWT (v3)
│  Client          │ ─────────────────────────────────┐
│  (Web / Tauri)   │                                  │
│                  │  GraphQL over HTTPS + WebSocket  ▼
│  Zustand stores  │ ◀─────────────────────────────► AppSync API
│   ├─ pages       │   (queries / mutations / subs)   │
│   ├─ databases   │                                  │
│   ├─ contacts    │                  ┌───────────────┴──────────────┐
│                  │                  │                              │
│  Sync engine     │           DDB Direct Resolvers       Lambda (이미지)
│   ├─ outbox queue│         (VTL or APPSYNC_JS)        ├ getImageUploadUrl
│   ├─ LWW merger  │                  │                  ├ confirmImage
│   └─ subscriber  │                  │                  └ getImageDownloadUrl
│                  │                  ▼                              │
│  Local store     │           ┌──────────────┐                      │
│   ├─ Web: Dexie  │           │  DynamoDB    │                      │
│   └─ Tauri: SQL  │           │   Page       │                      │
└──────────────────┘           │   Database   │                      │
                               │   Contact    │              ┌───────▼──────┐
                               │   ImageAsset │              │   S3 bucket  │
                               └──────────────┘              │ users/{sub}/ │
                                       ▲                     │   images/    │
                                       │ (야간 GC Lambda)    └──────────────┘
                                       │ EventBridge cron     ▲
                                       └──────────────────────┘
```

### 새 CDK 스택

`infra/lib/sync-stack.ts` (`QuicknoteSyncStack`) 추가:

- AppSync GraphQL API (Cognito User Pool primary authorizer; v3 스택 import)
- DynamoDB 4 테이블 (Page, Database, Contact, ImageAsset) + 각 GSI
- S3 버킷 (CORS, IAM, lifecycle 정책)
- Lambda 2개: `image-presign` (PUT/GET URL 발급), `image-gc` (야간 GC)
- EventBridge 스케줄러 (이미지 GC 1일 1회)

`CognitoStack`은 그대로 두고 `QuicknoteSyncStack`이 cross-stack reference로 user pool ARN을 받아 authorizer로 사용.

---

## 3. 데이터 모델

### 3.1 GraphQL 스키마 (요약)

```graphql
type Page @aws_cognito_user_pools {
  id: ID!
  ownerId: ID!                # = Cognito sub
  title: String!
  icon: String                # emoji 또는 null
  parentId: ID                # 트리 부모 (null = root)
  order: String!              # fractional index (LexoRank-like)
  databaseId: ID              # 행 페이지일 때 소유 DB id
  doc: AWSJSON!               # TipTap JSONContent
  dbCells: AWSJSON            # 행 페이지의 cell 매핑
  createdAt: AWSDateTime!
  updatedAt: AWSDateTime!
  deletedAt: AWSDateTime      # soft delete tombstone
}

type Database @aws_cognito_user_pools {
  id: ID!
  ownerId: ID!
  title: String!
  columns: AWSJSON!           # ColumnDef[]
  createdAt: AWSDateTime!
  updatedAt: AWSDateTime!
  deletedAt: AWSDateTime
}

type Contact @aws_cognito_user_pools {
  id: ID!
  ownerId: ID!
  email: String!
  displayName: String!
  createdAt: AWSDateTime!
  updatedAt: AWSDateTime!
  deletedAt: AWSDateTime
}

type ImageAsset @aws_cognito_user_pools {
  id: ID!
  ownerId: ID!
  mimeType: String!
  size: Int!
  sha256: String!
  status: ImageStatus!        # PENDING | READY
  createdAt: AWSDateTime!
}

enum ImageStatus { PENDING READY }

# Queries — owner-scoped 조회만
type Query {
  listPages(updatedAfter: AWSDateTime, nextToken: String): PageConnection!
  listDatabases(updatedAfter: AWSDateTime, nextToken: String): DatabaseConnection!
  listContacts(nextToken: String): ContactConnection!
  getImageDownloadUrl(imageId: ID!): String!  # PreSigned GET, TTL 1h
}

# Mutations
type Mutation {
  upsertPage(input: PageInput!): Page!
  upsertDatabase(input: DatabaseInput!): Database!
  upsertContact(input: ContactInput!): Contact!
  softDeletePage(id: ID!, updatedAt: AWSDateTime!): Page!
  softDeleteDatabase(id: ID!, updatedAt: AWSDateTime!): Database!
  softDeleteContact(id: ID!): Contact!
  getImageUploadUrl(input: ImageUploadInput!): ImageUploadResult!
  confirmImage(imageId: ID!): ImageAsset!
}

# Subscriptions — 자기 ownerId만
type Subscription {
  onPageChanged(ownerId: ID!): Page
    @aws_subscribe(mutations: ["upsertPage", "softDeletePage"])
  onDatabaseChanged(ownerId: ID!): Database
    @aws_subscribe(mutations: ["upsertDatabase", "softDeleteDatabase"])
  onContactChanged(ownerId: ID!): Contact
    @aws_subscribe(mutations: ["upsertContact", "softDeleteContact"])
}
```

### 3.2 LWW 규칙

- 클라가 푸시할 때 mutation 입력에 `updatedAt`을 함께 보냄(클라 시계).
- 리졸버는 DDB 조건식 `attribute_not_exists(updatedAt) OR :new > updatedAt` 으로 **더 최신 본만 덮어씀**.
- 충돌 시(서버가 더 최신이면) `ConditionalCheckFailed` → 클라는 구독으로 도착한 서버 본을 채택.
- 클라 시계 신뢰성: oidc 갱신 시 서버와 비교해 30초 이상 차이면 경고 로그 + 서버 시각 보정. (구현은 v4 범위 안.)

### 3.3 DynamoDB 테이블

| 테이블 | PK | GSI | TTL |
|---|---|---|---|
| `Page` | `id` | `byOwner` (PK=`ownerId`, SK=`updatedAt`) | 없음 (soft delete + Lambda GC) |
| `Database` | `id` | `byOwner` (PK=`ownerId`, SK=`updatedAt`) | 없음 |
| `Contact` | `id` | `byOwner` (PK=`ownerId`, SK=`updatedAt`) | 없음 |
| `ImageAsset` | `id` | `byOwner` (PK=`ownerId`, SK=`createdAt`) | `pending` 상태 1일 후 자동 삭제 (DDB TTL) |

청구 모드: **on-demand**. 100명 트래픽 예측 시 provisioned보다 저렴.

---

## 4. 클라이언트 동기화 엔진

### 4.1 모듈 배치

```
src/lib/sync/
  index.ts              # SyncEngine 싱글톤
  outbox.ts             # 영속 큐 (Dexie 또는 tauri-plugin-sql 어댑터)
  outboxAdapter.web.ts  # Dexie 구현
  outboxAdapter.tauri.ts# SQLite 구현
  lww.ts               # 순수 함수: compareUpdatedAt, mergeRemote
  graphql.ts           # AppSync 클라이언트 (urql + ws-link)
  subscribers.ts       # onPageChanged 등 핸들러 → store 적용
  fractionalOrder.ts   # 순수 함수: between(a, b) midstring
  imageUrls.ts         # PreSigned URL 캐시 (TTL 50분)
src/lib/storage/
  imageScheme.ts        # quicknote-image://{id} 변환 유틸
```

### 4.2 outbox 큐 스키마

```ts
type OutboxEntry = {
  id: string;            // ULID
  op: "upsertPage" | "upsertDatabase" | "upsertContact"
    | "softDeletePage" | "softDeleteDatabase" | "softDeleteContact";
  payload: unknown;
  enqueuedAt: number;
  attempts: number;
  lastErrorAt?: number;
};
```

- 변경 발생 시 즉시 `outbox.append`.
- flush 워커가 100ms 내에 시작(throttle), 항목당 mutation 1회. 성공 시 제거, 실패 시 지수 백오프(1s → 2s → 4s … 최대 60s).
- 페이지 `doc` 변경은 **2초 디바운스** 후 enqueue (한 페이지에 대해 최신 1건만 유지). 메타·DB·Contact 변경은 즉시 enqueue.

### 4.3 LWW 머지 (`lww.ts`)

```ts
function isRemoteWinner<T extends { updatedAt: string }>(local: T, remote: T): boolean {
  return Date.parse(remote.updatedAt) > Date.parse(local.updatedAt);
}
```

구독으로 도착한 항목이 로컬 항목보다 신선하면 store 갱신, 아니면 무시. soft delete는 `deletedAt` 우선.

### 4.4 첫 로그인 부트스트랩

1. Cognito 로그인 성공 후 `SyncEngine.start()` 호출.
2. `listPages(updatedAfter: lastSyncAt)` → 모든 페이지 페치 → store 채움.
3. 동일 절차로 `listDatabases`, `listContacts`.
4. 3 구독 연결.
5. outbox flush 시작.

오프라인이면 단계 2~4 건너뛰고 outbox만 활성. 온라인 복귀 시 자동 재시도.

---

## 5. S3 이미지 업로드 흐름

### 5.1 키 구조 / 권한

- 버킷: `quicknote-images-{account}-{region}`.
- 키: `users/{ownerId}/images/{imageId}.{ext}`.
- IAM: 버킷 정책으로 **public access 차단**, 모든 접근은 PreSignedURL.
- CORS: `PUT` from `*` (S3 직접 PUT용), `GET`은 PreSignedURL이라 CORS 불필요.
- Lifecycle: `pending` 상태 객체는 1일 후 자동 삭제 (Lambda GC와 별개의 안전망).

### 5.2 업로드 시퀀스

```
1. 사용자 이미지 드롭/붙여넣기
2. 클라가 sha256 + size + mimeType 계산
3. mimeType이 image/{png|jpeg|webp|gif} 인지 확인, ≤ 20MB 인지 확인
4. mutation getImageUploadUrl(input)
   → Lambda가 ImageAsset 항목 PENDING 으로 생성, PreSigned PUT URL 발급
5. 클라가 PUT URL로 binary 업로드
6. mutation confirmImage(imageId)
   → Lambda가 S3 HEAD 호출로 객체 존재·크기·mime 검증, ImageAsset.status = READY
7. 에디터 doc 안 image 노드 src = "quicknote-image://{imageId}" 로 저장
8. doc 동기화는 정상 outbox 흐름을 따름
```

### 5.3 이미지 표시

```ts
// React 훅
useImageUrl(imageId): string | null
  → imageUrls 캐시(메모리) 조회
  → 만료(50분) 또는 미존재 시 query getImageDownloadUrl(imageId) 발급, 캐시
  → <img src={url} />
```

PreSigned GET URL TTL = 1시간. 캐시는 50분으로 보수적.

### 5.4 야간 GC

EventBridge cron (UTC 18:00 = KST 03:00) → Lambda `image-gc`:

1. 모든 사용자별로 doc·dbCells 안의 `quicknote-image://{id}` 추출 (도달 가능 set).
2. `ImageAsset.byOwner` GSI 스캔하여 `status=READY` 항목 중 도달 불가능한 id 추출.
3. 30일 이상 미참조면 S3 객체 삭제 + DDB 항목 삭제.

`pending` 항목은 DDB TTL이 자동 처리. 30일 grace는 멀티 디바이스에서 push 지연된 doc의 이미지 참조를 보호.

---

## 6. 인증·권한

- AppSync primary authorizer = **Cognito User Pool** (v3 `CognitoStack` 의 user pool ARN cross-stack reference).
- 클라는 `idToken`을 `Authorization` 헤더로 송출(`@aws-amplify/api-graphql` 기본 동작).
- 모든 모델에 `ownerId: ID!` 필드 + 리졸버 단계에서 `$ctx.identity.sub == ownerId` 강제.
  - mutation: 입력 `ownerId` 무시, `$ctx.identity.sub` 강제 주입.
  - query: GSI `byOwner` 의 PK를 `$ctx.identity.sub` 로 강제.
  - subscription: `ownerId` 인자가 `$ctx.identity.sub` 와 일치하지 않으면 거부.
- S3 PreSignedURL: Lambda가 `ownerId`(JWT의 `sub`)로 키 prefix 결정. 다른 사용자 prefix 로 발급 불가.

---

## 7. 마이그레이션·배포

### 7.1 기존 데이터

- 현재 `localStorage`/SQLite 데이터는 **폐기** (사용자 합의).
- v4 첫 빌드 부팅 시: 기존 키(`quicknote.pages.v1`, `quicknote.databases`, ...) 발견하면 콘솔 경고 + 삭제 후 빈 상태로 시작. 삭제 동의 다이얼로그 없음 (개발 단계).
- 데스크톱 SQLite 파일 삭제 절차는 첫 부트 시 자동.

### 7.2 환경 변수 추가

```env
VITE_APPSYNC_ENDPOINT=https://xxxxxx.appsync-api.ap-northeast-2.amazonaws.com/graphql
VITE_APPSYNC_REALTIME_ENDPOINT=wss://xxxxxx.appsync-realtime-api.ap-northeast-2.amazonaws.com/graphql
VITE_S3_REGION=ap-northeast-2
VITE_S3_BUCKET_NAME=quicknote-images-{account}-{region}
```

### 7.3 README 로드맵 갱신

```
- v4.0.0 — AWS AppSync (단일 사용자 멀티 디바이스 LWW 동기화) + S3 이미지 업로드
- v5.0.0 — 다중 사용자 실시간 협업 (CRDT/Yjs)
```

---

## 8. 비용 추정 (100 활성 사용자/월)

| 항목 | 단가 | 월간 사용량 추정 | 비용 |
|---|---|---|---|
| AppSync 요청 (query+mutation) | $4 / 1M | 3M (사용자당 1k/일) | $12 |
| AppSync 구독 메시지 | $2 / 1M | 1.5M | $3 |
| AppSync 연결 시간 | $0.08 / 1M conn-min | 1.4M conn-min (8h/일) | $0.11 |
| DynamoDB on-demand 쓰기 | $1.25 / 1M WRU | 3M | $3.75 |
| DynamoDB on-demand 읽기 | $0.25 / 1M RRU | 5M | $1.25 |
| Lambda (이미지 PreSign + GC) | 거의 0 | <100k 호출 | <$1 |
| S3 저장 | $0.023 / GB-월 | 100GB | $2.30 |
| S3 GET/PUT | $0.0004/$0.005 | 100k GET, 10k PUT | <$1 |
| **합계** | | | **~$25/월** |

Cognito MAU 는 50k 이하 무료(v3 그대로). 100명 → 1000명까지 선형 증가, AppSync 요청 단가가 가장 큰 비중.

---

## 9. 테스트·검증

### 9.1 단위(Vitest)

- `lww.ts`: `isRemoteWinner` 동치 케이스, deletedAt 우선 케이스
- `fractionalOrder.ts`: 두 키 사이 midstring 생성, 동시 삽입 시 충돌 없음 검증
- `imageScheme.ts`: `quicknote-image://...` ↔ imageId 변환
- `outbox.ts`: enqueue → flush → 실패 백오프 → 재시도 성공 시나리오 (어댑터 모킹)

### 9.2 통합

- AppSync 모의 서버(`@aws-amplify/api-graphql` 모킹) 위에서 “페이지 생성 → 다른 클라이언트가 구독으로 수신” 시나리오.
- 오프라인 → 온라인 토글 시나리오 (window event 모킹).

### 9.3 E2E (수동)

- 두 브라우저 창(혹은 웹+Tauri)에서 같은 계정 로그인 → 한쪽에서 페이지 생성·편집 → 다른 쪽에 1~2초 내 반영 확인.
- 비행기 모드(데스크톱) → 편집 → 복구 후 푸시 확인.
- 이미지 20MB 업로드, 6MB 이미지 페이지 reopens 후 표시 확인.
- soft delete된 페이지가 다른 디바이스에서 사라지는지.

### 9.4 검증 게이트

`superpowers:verification-before-completion` 규칙대로 모든 단위/통합 테스트 통과 + 위 E2E 시나리오 수동 통과 확인 후 v4.0.0 태그.

---

## 10. 위험·대응

| 위험 | 영향 | 대응 |
|---|---|---|
| AppSync 구독 연결 끊김(WebSocket idle) | 다른 디바이스 변경이 늦게 반영 | 클라가 60초마다 ping, 끊기면 5초 백오프로 재연결. 재연결 직후 `listPages(updatedAfter: lastSyncAt)` 백필 |
| 클라 시계 왜곡 → LWW 비교 오류 | 의도와 다른 본이 승리 | 로그인 시 서버 시각과 30초 이상 차이면 경고 + 보정 오프셋 store에 저장, 모든 `updatedAt` 생성 시 적용 |
| 이미지 업로드 중 네트워크 끊김 | PENDING 항목 남음 | DDB TTL 1일 + S3 lifecycle 1일로 자동 정리. 클라는 confirm 실패 시 재업로드 안내 |
| 큰 페이지 doc(>400KB) 푸시 실패 | AppSync 페이로드 한계 | 페이지 doc > 300KB이면 경고 토스트 + 페이지 분할 권장. v4.x에서 chunked sync 검토 |
| 멀티 디바이스 동시 편집 충돌 | 한쪽 변경 손실 | LWW 시멘틱 한계. 사용자 합의됨. v5에서 CRDT로 해결 |

---

## 11. 작업 분할 (구현 계획에서 상세화 예정)

다음 단계(`writing-plans`)에서 다음 트랙으로 나눠 상세 단계화:

- **T1. 인프라**: `QuicknoteSyncStack` CDK 작성, AppSync 스키마·리졸버, DDB·S3·Lambda 정의, 배포 파이프라인.
- **T2. 클라 SDK 통합**: `@aws-amplify/api-graphql` 의존성 추가, `src/lib/sync/graphql.ts` 작성, idToken 전달.
- **T3. 동기화 엔진**: outbox·lww·subscribers·fractionalOrder 구현 + Vitest.
- **T4. 스토어 연동**: pageStore·databaseStore·contactsStore 의 변경 훅이 `SyncEngine.enqueue` 호출하도록 개조. `zustandStorage` 비동기화 대상만 유지.
- **T5. 이미지 흐름**: TipTap image 노드 `src` 처리 변경, `useImageUrl` 훅, 업로드 핸들러, `quicknote-image://` 스킴 유틸.
- **T6. 마이그레이션 정리**: 부트 시 기존 키 폐기 로직.
- **T7. 환경·문서**: `.env.example`, README 로드맵, `infra/README.md` 갱신, CHANGELOG.

각 트랙은 외부 의존성을 최소화하여 일부 병렬화 가능 (T1과 T3는 독립).

---

## 12. 결정 요약 (Q&A 합의 사항)

| # | 결정 |
|---|---|
| Q1 | LWW (페이지·DB·연락처 단위) |
| Q2 | AppSync GraphQL + Cognito User Pool authorizer + DDB 직접 리졸버 + 이미지용 Lambda |
| Q3 | 단일화 — 기존 로컬 저장소 폐기 (마이그레이션 없음) |
| Q4 | 페이지 = 1 레코드, doc 통째 저장, 디바운스 2초 |
| Q5 | pages·databases·contacts만 동기화, history·settings·auth는 로컬 |
| Q6 | S3 PreSigned PUT/GET, `quicknote-image://` 스킴, 야간 GC, 20MB 한도 |
| Q7 | AppSync GraphQL + 자체 outbox 큐 (DataStore 비채택) |
| Q8 | 모델별 4 테이블 / soft delete / fractional order / Cognito JWT / 디바운스 / 새 CDK 스택 |
