# v5.0.0 — 워크스페이스 기반 멀티 유저 (CRDT 미포함)

작성일: 2026-05-06
버전 범위: v5.0.0
후속 버전: v5.1.0 (Yjs CRDT 실시간 동시 편집 + presence)

## 1. 목표 (Goal)

QuickNote 를 단일 사용자 멀티 디바이스 노트 도구(v4)에서 **단일 organization 내 다중 사용자 협업 도구**로 확장한다. 관리자(Owner / Manager)가 구성원을 등록하면, 각 구성원은 본인 개인 워크스페이스와 권한이 부여된 공유 워크스페이스를 함께 사용할 수 있다. 워크스페이스 단위로 편집(edit) / 읽기(view) 권한을 분리해 인사규정처럼 일부만 편집 가능한 공간도 지원한다.

실시간 동시 편집(CRDT/Yjs)·presence·이메일 초대·그룹 멘션은 **v5.1 이후로 분리**한다.

## 2. 비범위 (Out of Scope)

- 실시간 동시 편집(CRDT/Yjs) → v5.1
- Presence (커서·아바타·"○○가 보고 있음") → v5.1
- 그룹 멘션 (Google Groups 연동 포함) → v5.x or v6
- 페이지 단위 권한 오버라이드 (워크스페이스 안 일부 페이지만 read-only) → v5.x
- 코멘트, 변경 내역 attribution UI → v5.x
- 이메일 초대 / 알림 (SES 등) → v5.x
- 모바일 네이티브 → 별도 트랙
- 조직 인명록 (멤버 디렉터리 화면) → v5.x

## 3. 개념 모델

```
Organization (앱 전체 1개)
│
├─ Member (N명)
│   ├─ name, email, jobRole(직군), workspaceRole (Owner | Manager | Member)
│   ├─ teams: M:N → Team[]
│   ├─ personalWorkspace: 1:1 (자동 생성)
│   └─ cognitoSub: 첫 로그인 시 매핑
│
├─ Team (N개)
│   └─ name (예: Engineering, Design, PM)
│
├─ Workspace
│   ├─ type: personal | shared
│   └─ ownerMemberId
│
├─ WorkspaceAccess (공유 워크스페이스에 access entries 다수)
│   ├─ subjectType: team | member | everyone
│   ├─ subjectId
│   └─ level: edit | view
│
└─ Page / Database
    └─ workspaceId (어느 워크스페이스 소속)
```

### 3.1 역할 (workspaceRole)

| 역할 | 권한 |
|---|---|
| **Owner** | 1명 고정. 모든 권한. 다른 누구도 제거·강등 불가. transferOwnership 으로만 양도 가능 |
| **Manager** | N명. Owner 와 동일 권한. 단 Owner 를 건드리는 어떤 mutation 도 거부. Owner 가 임명/해임 |
| **Member** | 일반 멤버. 본인 개인 워크스페이스 + 부여된 공유 워크스페이스만 사용. 콘텐츠 read/write/delete 가능 |

### 3.2 워크스페이스 접근 결정 알고리즘

특정 멤버 M이 워크스페이스 W에 대해 가지는 effective level:

```
entries = WorkspaceAccess[workspaceId=W] 중 M 에게 적용되는 항목 수집
  - {subjectType: "everyone"} → 모두 매칭
  - {subjectType: "team", subjectId: T} → M ∈ T 면 매칭
  - {subjectType: "member", subjectId: M} → 직접 매칭

effectiveLevel = max(entry.level for entry in entries)  // edit > view
if effectiveLevel == None: 접근 거부
```

권한별 동작:

| 동작 | edit | view |
|---|---|---|
| 페이지·DB 목록 보기 / 페이지 내용 보기 | ✅ | ✅ |
| 페이지·DB 생성·수정·삭제 | ✅ | ❌ |
| 워크스페이스 자체 메타(이름·접근권한·삭제) 변경 | ❌ (Owner / Manager 만) | ❌ |

> Owner / Manager 라도 본인이 access entry 에 등록되지 않은 워크스페이스의 콘텐츠는 자동으론 안 보임. 관리 권한을 활용해 본인을 access 에 추가 가능.

## 4. 데이터 스키마 (DynamoDB)

### 4.1 신규 테이블

#### Members
- **PK**: `memberId` (uuid)
- **GSI1**: `email` (sign-in 시 lookup)
- **GSI2**: `cognitoSub` (현재 로그인 사용자 lookup, 첫 로그인 시 채워짐)
- **Attrs**:
  - `name`, `email`, `jobRole` (string)
  - `workspaceRole`: "owner" | "manager" | "member"
  - `personalWorkspaceId` (FK → Workspaces)
  - `cognitoSub`: string | null
  - `status`: "active" | "removed"
  - `createdAt`, `removedAt`

#### Teams
- **PK**: `teamId` (uuid)
- **Attrs**: `name`, `createdAt`

#### MemberTeams (M:N)
- **PK**: `memberId`
- **SK**: `teamId`
- **GSI1**: `teamId` → memberId (팀의 멤버 목록 조회용)

#### Workspaces
- **PK**: `workspaceId` (uuid)
- **GSI1**: `ownerMemberId#type` (개인 워크스페이스 lookup)
- **Attrs**: `name`, `type` ("personal" | "shared"), `ownerMemberId`, `createdAt`

#### WorkspaceAccess
- **PK**: `workspaceId`
- **SK**: `subjectType#subjectId` (예: `team#hr-uuid`, `member#alice-uuid`, `everyone#*`)
- **GSI1**: `subjectType#subjectId` (특정 멤버/팀이 접근 가능한 워크스페이스 역조회)
- **Attrs**: `level` ("edit" | "view")

### 4.2 기존 테이블 수정

#### Pages, Databases
- 신규 컬럼 `workspaceId`
- 기존 `owner` → `createdByMemberId` 로 의미 변경 (작성자 attribution)
- 신규 GSI `workspaceId#updatedAt` (워크스페이스의 페이지 목록 + 정렬)
- 기존 owner 기반 GSI 폐기

#### Contacts
- v5.0 에서 **테이블 자체 폐기**. 관리 화면의 구성원 리스트가 디렉터리 역할. 향후 조직 인명록이 필요하면 별도 설계.

### 4.3 액세스 패턴 ↔ 인덱스 매핑

| 패턴 | 사용 인덱스 |
|---|---|
| 첫 로그인 시 email → Member | Members.GSI1(email) |
| 현재 로그인 멤버 (cognitoSub) | Members.GSI2(cognitoSub) |
| 팀의 멤버 목록 | MemberTeams.GSI1(teamId) |
| 멤버의 팀 목록 | MemberTeams.PK(memberId) |
| 멤버가 접근 가능한 워크스페이스 | WorkspaceAccess.GSI1(subjectType#subjectId) + Workspaces.GSI1 (개인 ws) |
| 워크스페이스의 페이지 목록 | Pages.GSI(workspaceId#updatedAt) |
| 워크스페이스의 access entry 목록 | WorkspaceAccess.PK |

### 4.4 권한 검사 시 DDB 호출 비용

매 요청에 약 4~5회의 작은 lookup. v5.0 에선 그대로 두고, 메트릭 모니터링 후 v5.x 에서 denormalized `MemberWorkspaceLevel` 테이블 또는 Lambda warm cache 로 최적화. **YAGNI**.

## 5. 인증 + 멤버 등록 흐름

### 5.1 Cognito PreSignUp Lambda

기존 `ALLOWED_EMAILS` env 매칭 → **Members 테이블 GSI1(email) 조회**로 전환.

```ts
async function handler(event) {
  const email = event.request.userAttributes.email;
  const member = await ddb.query(Members.GSI1, { email, status: "active" });
  if (!member) {
    throw new Error("PreSignUp denied: 등록된 멤버가 아닙니다.");
  }
  event.response.autoConfirmUser = true;
  event.response.autoVerifyEmail = true;
  return event;
}
```

→ Owner/Manager 가 등록한 이메일만 가입 가능. `ALLOWED_EMAILS` env 폐지.

### 5.2 PostConfirmation Lambda (신규)

Cognito 가입 완료 시 자동 트리거 → email 로 Member 조회 → `cognitoSub` 채움. `personalWorkspaceId` 가 비어 있으면 personal Workspace 생성 (등록 시점에 이미 만들어졌어야 정상이므로 보통 skip).

### 5.3 Owner Bootstrap (최초 1회)

CDK 배포 직후 1회 실행 마이그레이션 Lambda:

1. `OWNER_EMAIL` (CDK context) 입력
2. Members 에 row 가 이미 있으면 abort (idempotent)
3. Member 생성 (name="Owner" 기본, email=OWNER_EMAIL, workspaceRole="owner", status="active", cognitoSub=null)
4. personal Workspace 생성 + WorkspaceAccess `{member: ownerId, level: edit}` 자동 삽입
5. (마이그레이션과 합쳐서) 기존 v4 Pages/Databases 의 `workspaceId` 채움

이후 Owner 가 일반 로그인 → PostConfirmation 이 cognitoSub 매핑.

### 5.4 멤버 등록 흐름 (Owner / Manager)

1. 관리 화면 → "구성원 추가"
2. 입력: name, email, jobRole, teams[], workspaceRole (default = member)
3. `createMember` mutation
   - 검증: 이메일 중복 불가
   - DDB TransactWriteItems: Members + MemberTeams + Workspaces (personal) + WorkspaceAccess (`{member: id, level: edit}`)
4. 등록자가 등록된 사람에게 **out-of-band** 알림 (Slack, 메일 등)
5. 등록된 사람이 Google 로그인 → PreSignUp 통과 → PostConfirmation 이 cognitoSub 매핑

### 5.5 역할 변경

| 동작 | 권한 | 검증 |
|---|---|---|
| Member → Manager 승격 | Owner only | preventOwnerMutation |
| Manager → Member 강등 | Owner only | preventOwnerMutation |
| Manager → Owner 양도 (transferOwnership) | Owner only | toMemberId !== self, target 이 active Manager |
| 직군·팀·이름 변경 | Owner / Manager | preventOwnerMutation |

### 5.6 멤버 제거

1. Owner 만 가능
2. DDB Transaction:
   - Members.status = "removed", removedAt 채움
   - 그 멤버의 personal Workspace.ownerMemberId = Owner, name prefix 변경 ("{X}의 개인 노트 (제거됨)")
   - 기존 personal WorkspaceAccess (member entry) 제거 + Owner edit entry 삽입
   - MemberTeams 의 그 memberId 항목 제거
   - WorkspaceAccess 의 subjectType=member, subjectId=removed 항목 제거
3. Cognito: AdminDisableUser (계정 비활성, 데이터 보존)

공유 워크스페이스에 그 멤버가 만든 페이지는 그대로 (createdByMemberId 유지, UI 에서 "Removed user" 표시).

## 6. UI / UX 구조

### 6.1 사이드바

```
┌─────────────────────────────────┐
│ ⚙           ▼ [WS Name]    ⌄  │  ← 헤더 (고정)
├─────────────────────────────────┤
│ 📄 페이지 1                      │
│ 📄 페이지 2                      │
│   ▸ 하위 페이지                  │
│ 📊 데이터베이스 페이지           │
├─────────────────────────────────┤
│ + 새 페이지                      │
└─────────────────────────────────┘
```

- 본문은 현재 워크스페이스의 페이지·DB 트리만
- 헤더 좌측 ⚙ 버튼 + 우측 워크스페이스 드롭다운
- View-only 워크스페이스인 경우 노란 배너 "🔒 읽기 전용 워크스페이스" 표시

### 6.2 ⚙ 설정 팝업 — 역할 분기

| 역할 | 팝업 메뉴 |
|---|---|
| **Member** | 내 프로필 / 로그아웃 |
| **Owner / Manager** | 내 프로필 / 🛠 구성원 관리 / 🛠 팀 관리 / 🛠 워크스페이스 관리 / 로그아웃 |

단일 SettingsModal 컴포넌트 + 역할 기반 conditional sections.

### 6.3 워크스페이스 드롭다운

```
✓ 내 개인 워크스페이스
  디자인팀 회의록
🔒 사내 규정 (인사팀)        ← 본인이 view-only 시 자물쇠
  임원 전용
─────────────────────────
+ 새 워크스페이스 만들기      ← Owner / Manager 만 노출
```

### 6.4 워크스페이스 생성 모달

- 이름 입력
- 접근 권한 두 섹션 (편집 가능 / 읽기 전용)
- 각 섹션에 "+ 추가 ▼" → 팀 / 멤버 / 모든 사람 선택
- 같은 subject 가 양쪽에 들어가면 edit 가 우선, UI 에서 자동 제거 + 토스트 안내

### 6.5 멘션 (@)

1. 에디터에서 `@` → 전체 Members 자동완성 (이름 prefix 검색, MemberMini 만 노출 — email 제외)
2. 선택 시 mention 노드 삽입 (memberId 보유)
3. 렌더 시점에 워크스페이스 접근 권한 확인:

| 상태 | 렌더 |
|---|---|
| 접근 있음 (edit/view 무관) | `@홍길동` 클릭 시 프로필 미니카드 |
| 접근 없음 | `@홍길동 ⚠` + tooltip "해당 인원은 워크스페이스 접근 권한이 없습니다." |
| 멤버 제거됨 | `(제거된 사용자)` 회색 |

그룹 멘션 v5.0 미포함.

### 6.6 라우팅

- `/` — 현재 활성 워크스페이스의 첫 페이지 / 빈 상태
- 워크스페이스 전환 시 URL 미변경, zustand 상태로 관리
- `/auth/callback` — OIDC 콜백 (변경 없음)
- `/admin` 별도 라우트 없음 — 모두 ⚙ 모달 안

### 6.7 첫 로그인 onboarding

별도 가이드 없음. 본인 개인 워크스페이스로 자동 진입 + 사이드바 드롭다운에 권한 부여된 공유 워크스페이스 즉시 노출.

## 7. GraphQL API

### 7.1 타입

```graphql
enum WorkspaceRole { OWNER MANAGER MEMBER }
enum WorkspaceType { PERSONAL SHARED }
enum AccessLevel  { EDIT VIEW }
enum AccessSubjectType { TEAM MEMBER EVERYONE }
enum MemberStatus { ACTIVE REMOVED }

type Member {
  memberId: ID!
  email: String!
  name: String!
  jobRole: String!
  workspaceRole: WorkspaceRole!
  status: MemberStatus!
  personalWorkspaceId: ID!
  cognitoSub: String
  teams: [Team!]!
  createdAt: AWSDateTime!
  removedAt: AWSDateTime
}

type MemberMini {  # 멘션 자동완성용 (email 미노출)
  memberId: ID!
  name: String!
  jobRole: String!
}

type Team {
  teamId: ID!
  name: String!
  members: [Member!]!
  createdAt: AWSDateTime!
}

type Workspace {
  workspaceId: ID!
  name: String!
  type: WorkspaceType!
  ownerMemberId: ID!
  access: [WorkspaceAccessEntry!]!
  myEffectiveLevel: AccessLevel!
  createdAt: AWSDateTime!
}

type WorkspaceAccessEntry {
  subjectType: AccessSubjectType!
  subjectId: ID
  level: AccessLevel!
}

type Page {
  pageId: ID!
  workspaceId: ID!
  createdByMemberId: ID!
  # 기타 v4 필드 그대로
}

type Database {
  databaseId: ID!
  workspaceId: ID!
  createdByMemberId: ID!
  # 기타 v4 필드 그대로
}
```

### 7.2 Query

```graphql
type Query {
  me: Member!

  listMembers(filter: MemberFilter): [Member!]!     # Owner/Manager
  getMember(memberId: ID!): Member                   # Owner/Manager
  listTeams: [Team!]!                                # Owner/Manager
  getTeam(teamId: ID!): Team                         # Owner/Manager

  searchMembersForMention(query: String, limit: Int = 20): [MemberMini!]!  # 모두

  listMyWorkspaces: [Workspace!]!                    # 호출자가 접근 가능한 ws 만
  getWorkspace(workspaceId: ID!): Workspace          # 접근 권한 검증

  listPages(workspaceId: ID!): [Page!]!              # view 이상
  listDatabases(workspaceId: ID!): [Database!]!      # view 이상
}
```

### 7.3 Mutation

```graphql
type Mutation {
  createMember(input: CreateMemberInput!): Member!
  updateMember(input: UpdateMemberInput!): Member!
  promoteToManager(memberId: ID!): Member!
  demoteToMember(memberId: ID!): Member!
  transferOwnership(toMemberId: ID!): Member!
  removeMember(memberId: ID!): Member!
  assignMemberToTeam(memberId: ID!, teamId: ID!): Boolean!
  unassignMemberFromTeam(memberId: ID!, teamId: ID!): Boolean!

  createTeam(name: String!): Team!
  updateTeam(teamId: ID!, name: String!): Team!
  deleteTeam(teamId: ID!): Boolean!

  createWorkspace(input: CreateWorkspaceInput!): Workspace!
  updateWorkspace(input: UpdateWorkspaceInput!): Workspace!
  setWorkspaceAccess(workspaceId: ID!, entries: [WorkspaceAccessInput!]!): Workspace!
  deleteWorkspace(workspaceId: ID!): Boolean!

  upsertPage(input: UpsertPageInput!): Page!
  softDeletePage(pageId: ID!, workspaceId: ID!): Page!
  upsertDatabase(input: UpsertDatabaseInput!): Database!
  softDeleteDatabase(databaseId: ID!, workspaceId: ID!): Database!
}

input CreateMemberInput {
  email: String!
  name: String!
  jobRole: String!
  workspaceRole: WorkspaceRole = MEMBER
  teamIds: [ID!]
}

input WorkspaceAccessInput {
  subjectType: AccessSubjectType!
  subjectId: ID
  level: AccessLevel!
}

input CreateWorkspaceInput {
  name: String!
  access: [WorkspaceAccessInput!]!
}
```

### 7.4 Subscription

```graphql
type Subscription {
  onPageChanged(workspaceId: ID!): Page
    @aws_subscribe(mutations: ["upsertPage", "softDeletePage"])
  onDatabaseChanged(workspaceId: ID!): Database
    @aws_subscribe(mutations: ["upsertDatabase", "softDeleteDatabase"])
}
```

> 관리 이벤트(member/team/workspace 변경)는 v5.0 에서 subscription 미제공. 관리 화면은 manual refetch.

### 7.5 인증 헬퍼 (각 리졸버 첫 단계)

- `callerMember(ctx)` — cognitoSub 로 Members.GSI2 조회 + status=active 검증
- `requireRole(ctx, "owner" | "manager")` — workspaceRole 검사
- `requireWorkspaceAccess(ctx, workspaceId, "edit" | "view")` — §3.2 알고리즘
- `requireOwnerOnly(ctx)` — Owner 만 통과
- `preventOwnerMutation(ctx, target)` — target.role === "owner" && caller !== target 면 throw

| 작업 | 인증 체크 |
|---|---|
| `me`, `searchMembersForMention` | callerMember |
| `listMembers`, `getMember`, 팀 관리, `createMember`, `updateMember`, 팀 assign | requireRole("manager") |
| `removeMember`, `promoteToManager`, `demoteToMember`, `transferOwnership` | requireOwnerOnly + preventOwnerMutation |
| 워크스페이스 관리 (`createWorkspace`, `updateWorkspace`, `setWorkspaceAccess`, `deleteWorkspace`) | requireRole("manager") |
| `listMyWorkspaces`, `getWorkspace` | callerMember (반환 시 access 필터) |
| `listPages`, `listDatabases` | requireWorkspaceAccess(workspaceId, "view") |
| `upsertPage`, `softDeletePage`, `upsertDatabase`, `softDeleteDatabase` | requireWorkspaceAccess(workspaceId, "edit") |

Subscription `onPageChanged(workspaceId)` 는 호출 시점 mapping template 에서 `requireWorkspaceAccess("view")` 검증.

### 7.6 트랜잭션 필요 mutation

DDB TransactWriteItems 사용:
- `createMember` (Members + MemberTeams + Workspaces + WorkspaceAccess)
- `removeMember` (Members 상태 + personal Workspace 양도 + MemberTeams + WorkspaceAccess)
- `transferOwnership` (두 멤버 role 동시 변경)
- `setWorkspaceAccess` (entries 교체)
- `createWorkspace` (Workspaces + WorkspaceAccess[])
- `deleteWorkspace` (Workspaces + WorkspaceAccess[] + Pages/Databases cascade)

Transaction 25 항목 한계: WorkspaceAccess entries 는 24개로 제한 (frontend validation), 초과 시 batch split.

## 8. 테스트 전략

### 8.1 유닛 테스트 (Vitest)

- `computeEffectiveLevel(member, workspace)` — §3.2 알고리즘
  - 개인 워크스페이스 매칭
  - team-edit + everyone-view 조합
  - 매칭 없음 → 거부
  - edit + view 동시 매칭 → edit 우선
- 멘션 렌더 분기 (active / no-access / removed / not-found)
- `listMyWorkspaces` 의 union 로직

### 8.2 통합 테스트 (DDB Local 또는 LocalStack)

- `createMember` 트랜잭션 부분 실패 시 rollback
- `removeMember` cascade 검증
- `setWorkspaceAccess` 가 기존 entries 교체
- `deleteWorkspace` 가 Pages/Databases 까지 cascade
- 모든 mutation 에 권한 부족 시 `Unauthorized` throw 검증
- `preventOwnerMutation` 이 Manager 의 Owner 변경 시도 차단

### 8.3 E2E 시나리오 (수동 또는 Playwright)

1. Owner 첫 로그인 → 본인 v4 데이터 그대로 보임 (마이그레이션 검증)
2. Owner 가 Member 등록 → Member 가 Google 로그인 → 본인 개인 워크스페이스 진입
3. Owner 가 공유 워크스페이스 생성 (팀 단위 edit) → 그 팀 멤버가 페이지 생성/편집
4. everyone view 추가 → 외부 멤버가 view-only 모드, 편집 차단 확인
5. Owner 가 Manager 승격 → Manager 가 멤버 추가 가능, Owner 강등 시도 거부
6. Owner 가 Member 제거 → personal ws 가 Owner 에게 양도, Cognito 비활성 확인

## 9. v4 → v5 마이그레이션

전제: 현재 사용자 1명 (jinpyoung@loadcomplete.com), 데이터는 본인 페이지·DB 일부 + 테스트용 Contacts.

1. **CDK 배포** — 신규 테이블 + GSI + Pages/Databases 의 workspaceId GSI 추가
2. **마이그레이션 Lambda 1회 실행** (idempotent)
   - `OWNER_EMAIL` env 에서 email 읽기
   - Members row + personal Workspace + WorkspaceAccess (member edit) 생성
   - 기존 Pages/Databases 모든 row 의 `workspaceId` ← Owner.personalWorkspaceId, `createdByMemberId` ← Owner.memberId
3. **Contacts 폐기** — 테이블 + GSI drop. 백업은 console.log (현재 테스트 데이터)
4. **앱 코드 v5 배포**
   - contactsStore 등 제거, sync 코드 정리
   - 신규 workspace store 추가
5. **Owner 가 일반 로그인** → PostConfirmation 이 cognitoSub 매핑

### 롤백 전략

- 마이그레이션 Lambda 는 idempotent
- v5 배포 직전 DDB on-demand backup 생성
- 문제 발생 시 frontend 만 v4 로 Vercel rollback + DDB 복원

## 10. 위험 요소

| 위험 | 영향 | 완화 |
|---|---|---|
| 권한 검사 4-5회 DDB 호출 | API 응답 지연 | 메트릭 모니터링 후 v5.x 에서 denormalized table |
| `setWorkspaceAccess` transaction 25 한계 초과 | 일부 변경 실패 | entries ≤ 24 (frontend), 초과 시 batch split |
| Owner cognitoSub 미매핑 상태 마이그레이션 | 기존 페이지 매칭 실패 | OWNER_EMAIL 기반 + 1인 1:1 매핑이라 안전 |
| 멘션 자동완성으로 정보 노출 | email 누설 | MemberMini 타입에 email 미포함 |
| 빈 워크스페이스 상태 UX 혼란 | 사용자 진입 후 멘붕 | listMyWorkspaces 가 personal + 부여된 ws 모두 반환 + 빈 상태 가이드 |
| Owner 가 본인을 강등/제거 시도 | Owner 없는 상태 | Validation: target self 거부 |
| Personal Workspace cascade 실패 | orphan 데이터 | TransactWriteItems + 통합 테스트 |
| 동일 페이지 동시 편집 시 LWW 손실 | 협업 UX 한계 | 알려진 한계. v5.0 changelog 명시. v5.1 (CRDT) 까지 권장 안 함 |

## 11. 환경 변수 변경

| 변수 | 변경 |
|---|---|
| `ALLOWED_EMAILS` (Cognito PreSignUp Lambda) | **폐지** — Members 테이블로 대체 |
| `OWNER_EMAIL` | **신규** — Owner bootstrap 용 (CDK context, 1회) |

## 12. 이상적 결과 (v5.0.0 출시 시점)

> "관리자가 회사 구성원을 등록하면, 각 구성원은 본인 노트와 권한이 부여된 팀 노트를 함께 사용할 수 있다. 인사규정처럼 일부만 편집 가능한 공간도 만들 수 있다."

후속 v5.1.0 에서 동일 페이지 동시 편집 안전성(CRDT)과 presence 가 추가된다.
