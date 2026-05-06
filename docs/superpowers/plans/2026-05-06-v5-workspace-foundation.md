# v5.0.0 Workspace Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** v4 단일 사용자 노트 도구를 워크스페이스 기반 멀티 유저 협업 도구(v5.0)로 확장한다. CRDT 는 v5.1, 본 plan 은 데이터 모델·권한·UI 만 다룬다.

**Architecture:** AppSync USER_POOL + DynamoDB. 신규 테이블 5종 (Members/Teams/MemberTeams/Workspaces/WorkspaceAccess) + Pages/Databases 에 workspaceId 스코핑. PreSignUp Lambda 가 Members 테이블로 allowlist 검증. PostConfirmation Lambda 가 cognitoSub 매핑. 모든 GraphQL 리졸버는 pipeline 첫 단계에서 권한 검증.

**Tech Stack:** AWS CDK (TypeScript), AppSync JS resolvers (esbuild bundle), DynamoDB, Cognito User Pool + PostConfirmation/PreSignUp Lambda, React + Zustand + TipTap (frontend), aws-amplify GraphQL client.

**Spec:** `docs/superpowers/specs/2026-05-06-v5-workspace-foundation-design.md`

---

## 진행 트랙·의존성

```
Phase A (인프라 스캐폴딩) ─┬─ Phase B (리졸버) ─┐
                            │                     ├─ Phase D (UI) ─ Phase E (마이그/배포)
Phase C (프론트 스토어/쿼리)─┘─────────────────────┘
```

- A → B: 테이블/람다 없이 리졸버 작성 불가
- A,B 완료 후 C 시작 가능 (실제 백엔드 호출은 mock 으로 시작 → 실제 endpoint 로 전환)
- C → D: 스토어 없이 UI 못 그림
- A,B,C,D 모두 완료 후 E (단일 마이그레이션 Lambda 1회 실행)

## 개발 규약 (모든 Task 공통)

- **TDD 강제**: 실제 코드 변경 전 실패 테스트 먼저 작성. 단, 인프라(CDK) Task 는 `cdk synth` / `cdk diff` 검증으로 대체.
- **모든 코드 주석은 한국어**, 식별자는 영어 (CLAUDE.md 규약).
- **커밋 단위**: Task 1 개 = 커밋 1 개. 실패 시 fix 커밋 추가하지 말고 동일 task 내에서 amend 금지 (skill 규약).
- **타입 안정성**: TypeScript strict. `any` 금지 (단, Amplify 타입 폭발은 기존 패턴 유지).
- **린트**: `npm run lint` 통과해야 commit.
- **테스트**: 추가된 모든 유닛은 `npm test -- --run` 통과해야 commit.

---

# Phase A — 인프라 스캐폴딩 (테이블 + 람다 + 스키마)

## Task A1: CDK 의존성 점검 + 신규 디렉터리 준비

**Files:**
- Modify: `infra/package.json`
- Create: `infra/lib/sync/migrations/` (디렉터리)
- Create: `infra/lambda/post-confirmation/` (디렉터리)
- Create: `infra/lambda/v5-migration/` (디렉터리)

- [ ] **Step 1: 디렉터리 생성 확인**

```bash
mkdir -p infra/lib/sync/migrations infra/lambda/post-confirmation infra/lambda/v5-migration
ls infra/lambda
```
Expected: `image-gc image-presign post-confirmation pre-signup v5-migration`

- [ ] **Step 2: post-confirmation, v5-migration 의 package.json 추가**

`infra/lambda/post-confirmation/package.json`:
```json
{
  "name": "post-confirmation-lambda",
  "version": "1.0.0",
  "type": "module",
  "main": "index.ts",
  "dependencies": {
    "@aws-sdk/client-dynamodb": "^3.0.0",
    "@aws-sdk/lib-dynamodb": "^3.0.0"
  }
}
```

`infra/lambda/v5-migration/package.json`:
```json
{
  "name": "v5-migration-lambda",
  "version": "1.0.0",
  "type": "module",
  "main": "index.ts",
  "dependencies": {
    "@aws-sdk/client-dynamodb": "^3.0.0",
    "@aws-sdk/lib-dynamodb": "^3.0.0",
    "uuid": "^9.0.0"
  }
}
```

- [ ] **Step 3: CDK 의존성 확인 (필요 시 추가)**

`cd infra && npm ls aws-cdk-lib @aws-sdk/client-cognito-identity-provider 2>&1 | head -5`

cognito-identity-provider 가 없으면 추가:
```bash
cd infra && npm i @aws-sdk/client-cognito-identity-provider
```

- [ ] **Step 4: 커밋**

```bash
git add infra/lambda/post-confirmation infra/lambda/v5-migration infra/package.json infra/package-lock.json
git commit -m "chore(infra): scaffold post-confirmation and v5-migration lambda dirs"
```

---

## Task A2: 신규 5개 테이블 정의 (Members, Teams, MemberTeams, Workspaces, WorkspaceAccess)

**Files:**
- Modify: `infra/lib/sync-stack.ts` (테이블 추가)

- [ ] **Step 1: sync-stack.ts 의 테이블 팩토리 영역에 신규 테이블 추가**

`infra/lib/sync-stack.ts` 의 imports 옆에:

```typescript
// v5 신규 테이블 5종
const membersTable = new dynamodb.Table(this, "MembersTable", {
  tableName: "quicknote-members",
  partitionKey: { name: "memberId", type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: cdk.RemovalPolicy.RETAIN,
});
membersTable.addGlobalSecondaryIndex({
  indexName: "byEmail",
  partitionKey: { name: "email", type: dynamodb.AttributeType.STRING },
});
membersTable.addGlobalSecondaryIndex({
  indexName: "byCognitoSub",
  partitionKey: { name: "cognitoSub", type: dynamodb.AttributeType.STRING },
});

const teamsTable = new dynamodb.Table(this, "TeamsTable", {
  tableName: "quicknote-teams",
  partitionKey: { name: "teamId", type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: cdk.RemovalPolicy.RETAIN,
});

const memberTeamsTable = new dynamodb.Table(this, "MemberTeamsTable", {
  tableName: "quicknote-member-teams",
  partitionKey: { name: "memberId", type: dynamodb.AttributeType.STRING },
  sortKey: { name: "teamId", type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: cdk.RemovalPolicy.RETAIN,
});
memberTeamsTable.addGlobalSecondaryIndex({
  indexName: "byTeam",
  partitionKey: { name: "teamId", type: dynamodb.AttributeType.STRING },
  sortKey: { name: "memberId", type: dynamodb.AttributeType.STRING },
});

const workspacesTable = new dynamodb.Table(this, "WorkspacesTable", {
  tableName: "quicknote-workspaces",
  partitionKey: { name: "workspaceId", type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: cdk.RemovalPolicy.RETAIN,
});
workspacesTable.addGlobalSecondaryIndex({
  indexName: "byOwnerAndType",
  partitionKey: { name: "ownerMemberId", type: dynamodb.AttributeType.STRING },
  sortKey: { name: "type", type: dynamodb.AttributeType.STRING },
});

const workspaceAccessTable = new dynamodb.Table(this, "WorkspaceAccessTable", {
  tableName: "quicknote-workspace-access",
  partitionKey: { name: "workspaceId", type: dynamodb.AttributeType.STRING },
  sortKey: { name: "subjectKey", type: dynamodb.AttributeType.STRING }, // "team#<id>" / "member#<id>" / "everyone#*"
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: cdk.RemovalPolicy.RETAIN,
});
workspaceAccessTable.addGlobalSecondaryIndex({
  indexName: "bySubject",
  partitionKey: { name: "subjectKey", type: dynamodb.AttributeType.STRING },
  sortKey: { name: "workspaceId", type: dynamodb.AttributeType.STRING },
});

// CfnOutput 추가
new cdk.CfnOutput(this, "MembersTableName", { value: membersTable.tableName });
new cdk.CfnOutput(this, "TeamsTableName", { value: teamsTable.tableName });
new cdk.CfnOutput(this, "MemberTeamsTableName", { value: memberTeamsTable.tableName });
new cdk.CfnOutput(this, "WorkspacesTableName", { value: workspacesTable.tableName });
new cdk.CfnOutput(this, "WorkspaceAccessTableName", { value: workspaceAccessTable.tableName });

// 인스턴스 변수 노출 (다른 메서드에서 쓰기 위해)
this.membersTable = membersTable;
this.teamsTable = teamsTable;
this.memberTeamsTable = memberTeamsTable;
this.workspacesTable = workspacesTable;
this.workspaceAccessTable = workspaceAccessTable;
```

`SyncStack` 클래스 필드 선언부에 추가:
```typescript
public readonly membersTable: dynamodb.Table;
public readonly teamsTable: dynamodb.Table;
public readonly memberTeamsTable: dynamodb.Table;
public readonly workspacesTable: dynamodb.Table;
public readonly workspaceAccessTable: dynamodb.Table;
```

- [ ] **Step 2: cdk synth 검증**

```bash
cd infra && npx cdk synth QuicknoteSyncStack 2>&1 | grep -E "MembersTable|TeamsTable|MemberTeams|Workspaces|WorkspaceAccess" | head -10
```
Expected: 5 개 테이블 + GSI 모두 출력에 포함.

- [ ] **Step 3: cdk diff 로 신규 리소스만 추가됨 확인**

```bash
cd infra && npx cdk diff QuicknoteSyncStack 2>&1 | grep -E "^\[\+\]" | wc -l
```
Expected: 신규 추가 항목만 (테이블 5 + GSI 4 + Output 5 + 보조 리소스). 기존 리소스 변경 없어야 함.

- [ ] **Step 4: 커밋**

```bash
git add infra/lib/sync-stack.ts
git commit -m "feat(infra): add v5 tables (Members/Teams/MemberTeams/Workspaces/WorkspaceAccess)"
```

---

## Task A3: Pages, Databases 테이블에 workspaceId GSI 추가

**Files:**
- Modify: `infra/lib/sync-stack.ts` (기존 pages/databases 테이블 정의에 GSI 추가)

- [ ] **Step 1: 기존 Pages 테이블 정의 부근에 GSI 추가**

기존 pagesTable 정의를 찾아 그 아래에:

```typescript
pagesTable.addGlobalSecondaryIndex({
  indexName: "byWorkspaceAndUpdatedAt",
  partitionKey: { name: "workspaceId", type: dynamodb.AttributeType.STRING },
  sortKey: { name: "updatedAt", type: dynamodb.AttributeType.STRING },
});

databasesTable.addGlobalSecondaryIndex({
  indexName: "byWorkspaceAndUpdatedAt",
  partitionKey: { name: "workspaceId", type: dynamodb.AttributeType.STRING },
  sortKey: { name: "updatedAt", type: dynamodb.AttributeType.STRING },
});
```

> 기존 owner 기반 GSI 는 마이그레이션 완료 후 제거 (Phase E 에서 별도 처리). 지금은 둘 다 유지.

- [ ] **Step 2: cdk diff 로 GSI 만 추가됨 확인**

```bash
cd infra && npx cdk diff QuicknoteSyncStack 2>&1 | grep -i "byWorkspaceAndUpdatedAt"
```
Expected: 2 개 GSI 추가만 표시.

- [ ] **Step 3: 커밋**

```bash
git add infra/lib/sync-stack.ts
git commit -m "feat(infra): add workspaceId GSI to pages/databases tables"
```

---

## Task A4: Contacts 테이블 제거 (CDK 정의에서 삭제)

**Files:**
- Modify: `infra/lib/sync-stack.ts` (contacts 정의 삭제)
- Modify: `infra/lib/sync/schema.graphql` (Contact 타입 + 리졸버 제거 — 다음 Task)

> ⚠️ DDB 데이터 자체는 Phase E 마이그레이션 단계에서 백업 후 dropTable. 여기서는 CDK 정의만 제거 (RemovalPolicy.RETAIN 이라 데이터는 안전).

- [ ] **Step 1: contactsTable 정의와 그 GSI, datasource, 리졸버 wiring 모두 주석/삭제**

`infra/lib/sync-stack.ts` 에서 다음 패턴 모두 제거:
- `const contactsTable = new dynamodb.Table(...)`
- `contactsTable.addGlobalSecondaryIndex(...)`
- `new cdk.CfnOutput(this, "ContactsTableName", ...)`
- `contactsDataSource = api.addDynamoDbDataSource("ContactsDataSource", contactsTable)`
- contacts 관련 resolver 정의 (upsertContact, softDeleteContact, listContactsByOwner 등)

- [ ] **Step 2: cdk diff 가 contacts 관련 리소스 제거만 표시하는지 확인**

```bash
cd infra && npx cdk diff QuicknoteSyncStack 2>&1 | grep -i "contact"
```
Expected: `[-]` 로 표시되는 contacts 관련 리소스. 다른 변경은 없어야 함.

- [ ] **Step 3: 커밋**

```bash
git add infra/lib/sync-stack.ts
git commit -m "feat(infra): remove Contacts table from CDK (data drop in Phase E)"
```

---

## Task A5: GraphQL 스키마 v5 작성

**Files:**
- Replace: `infra/lib/sync/schema.graphql`

- [ ] **Step 1: 신규 schema.graphql 작성 (전체 교체)**

`infra/lib/sync/schema.graphql`:

```graphql
schema {
  query: Query
  mutation: Mutation
  subscription: Subscription
}

# ========== Enums ==========
enum WorkspaceRole { OWNER MANAGER MEMBER }
enum WorkspaceType { PERSONAL SHARED }
enum AccessLevel  { EDIT VIEW }
enum AccessSubjectType { TEAM MEMBER EVERYONE }
enum MemberStatus { ACTIVE REMOVED }
enum PageStatus { ACTIVE DELETED }

# ========== Domain Types ==========
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

type MemberMini {
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
  title: String!
  doc: AWSJSON!
  parentPageId: ID
  status: PageStatus!
  updatedAt: AWSDateTime!
  createdAt: AWSDateTime!
}

type Database {
  databaseId: ID!
  workspaceId: ID!
  createdByMemberId: ID!
  name: String!
  schema: AWSJSON!
  rows: AWSJSON!
  status: PageStatus!
  updatedAt: AWSDateTime!
  createdAt: AWSDateTime!
}

# ========== Inputs ==========
input CreateMemberInput {
  email: String!
  name: String!
  jobRole: String!
  workspaceRole: WorkspaceRole = MEMBER
  teamIds: [ID!]
}

input UpdateMemberInput {
  memberId: ID!
  name: String
  jobRole: String
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

input UpdateWorkspaceInput {
  workspaceId: ID!
  name: String
}

input UpsertPageInput {
  pageId: ID!
  workspaceId: ID!
  title: String!
  doc: AWSJSON!
  parentPageId: ID
  updatedAt: AWSDateTime!
}

input UpsertDatabaseInput {
  databaseId: ID!
  workspaceId: ID!
  name: String!
  schema: AWSJSON!
  rows: AWSJSON!
  updatedAt: AWSDateTime!
}

input MemberFilter {
  status: MemberStatus
  teamId: ID
  workspaceRole: WorkspaceRole
}

# ========== Query ==========
type Query {
  me: Member!

  listMembers(filter: MemberFilter): [Member!]!
  getMember(memberId: ID!): Member
  listTeams: [Team!]!
  getTeam(teamId: ID!): Team

  searchMembersForMention(query: String, limit: Int = 20): [MemberMini!]!

  listMyWorkspaces: [Workspace!]!
  getWorkspace(workspaceId: ID!): Workspace

  listPages(workspaceId: ID!): [Page!]!
  listDatabases(workspaceId: ID!): [Database!]!
}

# ========== Mutation ==========
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

# ========== Subscription ==========
type Subscription {
  onPageChanged(workspaceId: ID!): Page
    @aws_subscribe(mutations: ["upsertPage", "softDeletePage"])
  onDatabaseChanged(workspaceId: ID!): Database
    @aws_subscribe(mutations: ["upsertDatabase", "softDeleteDatabase"])
}
```

- [ ] **Step 2: cdk synth 가 스키마 검증 통과하는지 확인**

```bash
cd infra && npx cdk synth QuicknoteSyncStack 2>&1 | tail -5
```
Expected: 에러 없이 종료. (단, 리졸버 미작성 → 합성은 되지만 deploy 시 실패할 것)

- [ ] **Step 3: 커밋**

```bash
git add infra/lib/sync/schema.graphql
git commit -m "feat(infra): v5 GraphQL schema (workspace + member + team types)"
```

---

## Task A6: PreSignUp Lambda 변경 (Members 테이블 조회로 전환)

**Files:**
- Modify: `infra/lambda/pre-signup/index.ts`
- Modify: `infra/lib/sync-stack.ts` (Lambda 환경변수에 MEMBERS_TABLE_NAME 추가, 기존 ALLOWED_EMAILS 제거)

- [ ] **Step 1: 실패 테스트 작성** (단순 입력/검증이라 통합 테스트로 갈음)

`infra/lambda/pre-signup/index.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { handler } from "./index";

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: { from: () => ({ send: vi.fn() }) },
  QueryCommand: vi.fn(),
}));

describe("PreSignUp Lambda", () => {
  beforeEach(() => {
    process.env.MEMBERS_TABLE_NAME = "quicknote-members";
  });

  it("active 멤버면 autoConfirmUser=true 로 통과시킨다", async () => {
    const mockSend = vi.fn().mockResolvedValueOnce({
      Items: [{ memberId: "m1", email: "x@x.com", status: "active" }],
    });
    // ...mock wiring (실제 import 와 매핑)
    const event = {
      request: { userAttributes: { email: "x@x.com" } },
      response: {},
    } as any;
    const out = await handler(event, mockSend);
    expect(out.response.autoConfirmUser).toBe(true);
  });

  it("Member 가 없으면 throw", async () => {
    const mockSend = vi.fn().mockResolvedValueOnce({ Items: [] });
    const event = { request: { userAttributes: { email: "noone@x.com" } } } as any;
    await expect(handler(event, mockSend)).rejects.toThrow(/등록된 멤버가 아닙니다/);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
cd infra && npx vitest run lambda/pre-signup
```
Expected: 모두 실패 (handler 가 아직 변경 안 됨)

- [ ] **Step 3: index.ts 변경**

`infra/lambda/pre-signup/index.ts`:
```typescript
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// PreSignUp Lambda v5: ALLOWED_EMAILS env 매칭 → Members 테이블 GSI(byEmail) 조회로 전환.
// 등록된 active 멤버만 가입을 허용하고 자동 confirm 처리한다.
export async function handler(event: any, sendOverride?: typeof ddb.send): Promise<any> {
  const send = sendOverride ?? ddb.send.bind(ddb);
  const email: string = event.request.userAttributes.email;
  const tableName = process.env.MEMBERS_TABLE_NAME!;

  const result: any = await send(
    new QueryCommand({
      TableName: tableName,
      IndexName: "byEmail",
      KeyConditionExpression: "email = :e",
      ExpressionAttributeValues: { ":e": email },
      Limit: 1,
    }),
  );
  const member = result.Items?.[0];
  if (!member || member.status !== "active") {
    throw new Error(`PreSignUp denied: 등록된 멤버가 아닙니다 (${email})`);
  }

  event.response.autoConfirmUser = true;
  event.response.autoVerifyEmail = true;
  return event;
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

```bash
cd infra && npx vitest run lambda/pre-signup
```
Expected: 모두 통과.

- [ ] **Step 5: sync-stack.ts 에서 Lambda 환경변수 변경**

기존 PreSignUp Lambda 정의에서:
- `ALLOWED_EMAILS` env 제거
- `MEMBERS_TABLE_NAME: this.membersTable.tableName` 추가
- `this.membersTable.grantReadData(preSignUpFn)` 추가

- [ ] **Step 6: cdk synth 확인**

```bash
cd infra && npx cdk synth QuicknoteSyncStack 2>&1 | grep -A 3 PreSignUp | head -10
```

- [ ] **Step 7: 커밋**

```bash
git add infra/lambda/pre-signup infra/lib/sync-stack.ts
git commit -m "feat(infra): PreSignUp Lambda checks Members table instead of ALLOWED_EMAILS env"
```

---

## Task A7: PostConfirmation Lambda 신규 작성 (cognitoSub 매핑)

**Files:**
- Create: `infra/lambda/post-confirmation/index.ts`
- Create: `infra/lambda/post-confirmation/index.test.ts`
- Modify: `infra/lib/sync-stack.ts` (Lambda 정의 + Cognito trigger 연결)

- [ ] **Step 1: 실패 테스트 작성**

`infra/lambda/post-confirmation/index.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { handler } from "./index";

describe("PostConfirmation Lambda", () => {
  it("Member 가 있으면 cognitoSub 를 채운다", async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ Items: [{ memberId: "m1", email: "x@x.com" }] }) // Query
      .mockResolvedValueOnce({}); // Update
    process.env.MEMBERS_TABLE_NAME = "quicknote-members";

    const event = {
      request: { userAttributes: { email: "x@x.com", sub: "cognito-sub-123" } },
    } as any;
    const out = await handler(event, send);
    expect(send).toHaveBeenCalledTimes(2);
    expect(out).toBe(event);
  });

  it("Member 가 없으면 throw (가입은 PreSignUp 에서 막혀야 정상)", async () => {
    const send = vi.fn().mockResolvedValueOnce({ Items: [] });
    const event = { request: { userAttributes: { email: "x@x.com", sub: "s" } } } as any;
    await expect(handler(event, send)).rejects.toThrow(/PostConfirmation: Member not found/);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
cd infra && npx vitest run lambda/post-confirmation
```

- [ ] **Step 3: index.ts 작성**

`infra/lambda/post-confirmation/index.ts`:
```typescript
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// PostConfirmation Lambda: Cognito 가입 완료 직후 Member.cognitoSub 를 매핑한다.
// PreSignUp 에서 Member 존재를 이미 확인했으므로 여기서 Member 가 없으면 시스템 에러.
export async function handler(event: any, sendOverride?: typeof ddb.send): Promise<any> {
  const send = sendOverride ?? ddb.send.bind(ddb);
  const email: string = event.request.userAttributes.email;
  const sub: string = event.request.userAttributes.sub;
  const tableName = process.env.MEMBERS_TABLE_NAME!;

  const found: any = await send(
    new QueryCommand({
      TableName: tableName,
      IndexName: "byEmail",
      KeyConditionExpression: "email = :e",
      ExpressionAttributeValues: { ":e": email },
      Limit: 1,
    }),
  );
  const member = found.Items?.[0];
  if (!member) {
    throw new Error(`PostConfirmation: Member not found for ${email}`);
  }

  await send(
    new UpdateCommand({
      TableName: tableName,
      Key: { memberId: member.memberId },
      UpdateExpression: "SET cognitoSub = :s",
      ExpressionAttributeValues: { ":s": sub },
    }),
  );
  return event;
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd infra && npx vitest run lambda/post-confirmation
```

- [ ] **Step 5: sync-stack.ts 에 PostConfirmation Lambda 추가 + Cognito trigger 연결**

```typescript
const postConfirmationFn = new lambda.Function(this, "PostConfirmationFn", {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: "index.handler",
  code: lambda.Code.fromAsset(path.join(__dirname, "../lambda/post-confirmation"), {
    bundling: { /* 기존 image-presign 패턴 동일 */ },
  }),
  environment: {
    MEMBERS_TABLE_NAME: this.membersTable.tableName,
  },
});
this.membersTable.grantReadWriteData(postConfirmationFn);

// Cognito trigger 연결 (CognitoStack 에서 export 한 userPool 사용)
props.userPool.addTrigger(cognito.UserPoolOperation.POST_CONFIRMATION, postConfirmationFn);
```

> CognitoStack 의 PreSignUp 패턴 그대로 따라가면 됨.

- [ ] **Step 6: cdk synth 확인**

```bash
cd infra && npx cdk synth QuicknoteSyncStack 2>&1 | grep -i postconfirmation | head -5
```

- [ ] **Step 7: 커밋**

```bash
git add infra/lambda/post-confirmation infra/lib/sync-stack.ts
git commit -m "feat(infra): PostConfirmation Lambda maps cognitoSub to Member on first sign-in"
```

---

# Phase B — AppSync 리졸버

## Task B1: 공통 인증/권한 헬퍼 (auth.ts)

**Files:**
- Create: `infra/lib/sync/resolvers/auth.ts`
- Create: `infra/lib/sync/resolvers/auth.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

`infra/lib/sync/resolvers/auth.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import {
  computeEffectiveLevel,
  type AccessEntry,
} from "./auth";

describe("computeEffectiveLevel", () => {
  it("멤버 직접 매칭 (edit) 우선", () => {
    const entries: AccessEntry[] = [
      { subjectType: "member", subjectId: "m1", level: "edit" },
      { subjectType: "everyone", subjectId: null, level: "view" },
    ];
    expect(computeEffectiveLevel(entries, "m1", [])).toBe("edit");
  });

  it("팀 매칭 (edit) + everyone(view) → edit", () => {
    const entries: AccessEntry[] = [
      { subjectType: "team", subjectId: "t1", level: "edit" },
      { subjectType: "everyone", subjectId: null, level: "view" },
    ];
    expect(computeEffectiveLevel(entries, "m1", ["t1"])).toBe("edit");
  });

  it("everyone view 만 매칭 → view", () => {
    const entries: AccessEntry[] = [
      { subjectType: "team", subjectId: "t1", level: "edit" },
      { subjectType: "everyone", subjectId: null, level: "view" },
    ];
    expect(computeEffectiveLevel(entries, "m1", ["t9"])).toBe("view");
  });

  it("매칭 없음 → null", () => {
    const entries: AccessEntry[] = [
      { subjectType: "team", subjectId: "t1", level: "edit" },
    ];
    expect(computeEffectiveLevel(entries, "m1", ["t9"])).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

```bash
cd infra && npx vitest run lib/sync/resolvers/auth
```

- [ ] **Step 3: auth.ts 구현**

`infra/lib/sync/resolvers/auth.ts`:
```typescript
// AppSync JS 리졸버 공용 인증/권한 헬퍼.
// 모든 mutation/query 리졸버는 첫 단계에서 이 모듈의 함수 중 하나 이상을 호출해야 한다.

export type AccessLevel = "edit" | "view";
export type AccessEntry = {
  subjectType: "team" | "member" | "everyone";
  subjectId: string | null;
  level: AccessLevel;
};

const LEVEL_RANK: Record<AccessLevel, number> = { edit: 2, view: 1 };

// 워크스페이스 access entries + 사용자 멤버십 → effective level (없으면 null).
export function computeEffectiveLevel(
  entries: AccessEntry[],
  memberId: string,
  memberTeamIds: string[],
): AccessLevel | null {
  let best: AccessLevel | null = null;
  const teamSet = new Set(memberTeamIds);
  for (const e of entries) {
    let match = false;
    if (e.subjectType === "everyone") match = true;
    else if (e.subjectType === "member") match = e.subjectId === memberId;
    else if (e.subjectType === "team") match = e.subjectId !== null && teamSet.has(e.subjectId);
    if (!match) continue;
    if (best === null || LEVEL_RANK[e.level] > LEVEL_RANK[best]) best = e.level;
  }
  return best;
}

export function isAtLeast(actual: AccessLevel | null, required: AccessLevel): boolean {
  if (actual === null) return false;
  return LEVEL_RANK[actual] >= LEVEL_RANK[required];
}

// AppSync 리졸버에서 throw — 클라이언트에는 errorType 으로 분류 노출.
export function unauthorized(message: string): never {
  const err: any = new Error(message);
  err.errorType = "Unauthorized";
  throw err;
}

export function forbidden(message: string): never {
  const err: any = new Error(message);
  err.errorType = "Forbidden";
  throw err;
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd infra && npx vitest run lib/sync/resolvers/auth
```

- [ ] **Step 5: 커밋**

```bash
git add infra/lib/sync/resolvers/auth.ts infra/lib/sync/resolvers/auth.test.ts
git commit -m "feat(infra): auth helpers (computeEffectiveLevel, isAtLeast, error throws)"
```

---

## Task B2: Member CRUD 리졸버 (createMember + listMembers + getMember)

**Files:**
- Create: `infra/lib/sync/resolvers/member.ts`
- Create: `infra/lib/sync/resolvers/member.test.ts`
- Modify: `infra/lib/sync/sync-stack.ts` (resolver wiring)

- [ ] **Step 1: 실패 테스트 (단위 테스트는 권한 검증 + ID 생성 + 트랜잭션 형태에 집중)**

`infra/lib/sync/resolvers/member.test.ts`: createMember 의 핵심 → DDB transactWriteItems 4개 항목(Members + MemberTeams[] + Workspaces + WorkspaceAccess) 발급 검증.

```typescript
import { describe, it, expect } from "vitest";
import { buildCreateMemberTransaction } from "./member";

describe("buildCreateMemberTransaction", () => {
  it("Members + Workspaces + WorkspaceAccess + MemberTeams[] 항목을 만든다", () => {
    const items = buildCreateMemberTransaction({
      input: {
        email: "alice@x.com",
        name: "Alice",
        jobRole: "Engineer",
        workspaceRole: "MEMBER",
        teamIds: ["t1", "t2"],
      },
      tableNames: {
        Members: "quicknote-members",
        Teams: "quicknote-teams",
        MemberTeams: "quicknote-member-teams",
        Workspaces: "quicknote-workspaces",
        WorkspaceAccess: "quicknote-workspace-access",
      },
      now: "2026-05-06T00:00:00Z",
    });
    expect(items).toHaveLength(5); // 1 Member + 1 Workspace + 1 WSAccess + 2 MemberTeam
    expect(items.find((i) => i.Put?.TableName === "quicknote-members")).toBeDefined();
    expect(items.filter((i) => i.Put?.TableName === "quicknote-member-teams")).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

- [ ] **Step 3: member.ts 구현 (대표 구조; 전체 코드는 길어서 핵심만 — 실행자가 채움)**

`infra/lib/sync/resolvers/member.ts`:
```typescript
// AppSync JS 리졸버: Member CRUD.
// 모든 mutation 의 첫 단계는 권한 검증, 그 다음 DDB 작업.

import { util } from "@aws-appsync/utils";

// Pure helper: 트랜잭션 항목 생성 (테스트하기 쉽게 분리).
export function buildCreateMemberTransaction(args: {
  input: {
    email: string;
    name: string;
    jobRole: string;
    workspaceRole: "OWNER" | "MANAGER" | "MEMBER";
    teamIds?: string[] | null;
  };
  tableNames: {
    Members: string;
    Teams: string;
    MemberTeams: string;
    Workspaces: string;
    WorkspaceAccess: string;
  };
  now: string;
}) {
  const memberId = util.autoId();
  const personalWorkspaceId = util.autoId();
  const items: any[] = [];

  items.push({
    Put: {
      TableName: args.tableNames.Members,
      Item: {
        memberId,
        email: args.input.email,
        name: args.input.name,
        jobRole: args.input.jobRole,
        workspaceRole: args.input.workspaceRole.toLowerCase(),
        status: "active",
        personalWorkspaceId,
        cognitoSub: null,
        createdAt: args.now,
      },
      ConditionExpression: "attribute_not_exists(memberId)",
    },
  });

  items.push({
    Put: {
      TableName: args.tableNames.Workspaces,
      Item: {
        workspaceId: personalWorkspaceId,
        name: `${args.input.name}의 개인 워크스페이스`,
        type: "personal",
        ownerMemberId: memberId,
        createdAt: args.now,
      },
    },
  });

  items.push({
    Put: {
      TableName: args.tableNames.WorkspaceAccess,
      Item: {
        workspaceId: personalWorkspaceId,
        subjectKey: `member#${memberId}`,
        subjectType: "member",
        subjectId: memberId,
        level: "edit",
      },
    },
  });

  for (const teamId of args.input.teamIds ?? []) {
    items.push({
      Put: {
        TableName: args.tableNames.MemberTeams,
        Item: { memberId, teamId },
      },
    });
  }

  return items;
}

// AppSync 리졸버 entrypoint (createMember).
// pipeline resolver 권장 — 1단계 auth check, 2단계 transaction.
export function request(ctx: any) {
  // ctx.identity.sub 로 caller member 조회 → workspaceRole 검사 (manager 이상)
  // 권한 OK 면 buildCreateMemberTransaction 호출.
  // 자세한 구현은 pipeline 의 별도 함수로 분리하는 게 깔끔하지만 본 plan 에서는 단순화.
  // ... (실행자가 AppSync JS resolver 형태로 채움)
}

export function response(ctx: any) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.errorType);
  return ctx.result;
}
```

> 본 plan 에서는 핵심 helper 만 자세히 보여주고, AppSync JS resolver 의 보일러플레이트 (request/response 함수)는 기존 v4 page resolver 의 패턴(`infra/lib/sync/resolvers/upsert.ts`)을 참고.

- [ ] **Step 4: 테스트 통과 확인**

- [ ] **Step 5: listMembers, getMember resolver 작성 (Owner/Manager 만)**

기존 v4 list resolver 패턴 동일.

- [ ] **Step 6: sync-stack.ts 에 resolver wiring**

- [ ] **Step 7: cdk synth 확인**

- [ ] **Step 8: 커밋**

```bash
git add infra/lib/sync/resolvers/member.ts infra/lib/sync/resolvers/member.test.ts infra/lib/sync-stack.ts
git commit -m "feat(infra): Member resolvers (create/list/get) with role-based auth"
```

---

## Task B3: Member 라이프사이클 mutation (update / promote / demote / remove / transferOwnership / assignTeam)

**Files:**
- Modify: `infra/lib/sync/resolvers/member.ts`
- Modify: `infra/lib/sync/resolvers/member.test.ts`

각 mutation 에 대해:
- [ ] **권한 테스트 (Owner only / preventOwnerMutation 검증)**
- [ ] **트랜잭션 테스트 (필요한 항목 모두 포함되는지)**
- [ ] **구현**
- [ ] **통과 확인**
- [ ] **마지막에 한 번 커밋**

```bash
git commit -m "feat(infra): Member lifecycle mutations (promote/demote/transfer/remove/team)"
```

> `removeMember` 트랜잭션 항목 (가장 복잡):
> 1. Members.status = "removed"
> 2. 기존 personal Workspace.ownerMemberId = Owner.memberId, name prefix 변경
> 3. WorkspaceAccess `member#<removedId>` PK=personalWorkspaceId entry 제거
> 4. WorkspaceAccess `member#<ownerId>` PK=personalWorkspaceId edit entry 추가
> 5. MemberTeams 의 memberId=removedId 모두 제거 (Query → Batch Delete; 25 한계 시 chunk)
> 6. WorkspaceAccess GSI(bySubject) 로 subjectType=member,subjectId=removedId entry 모두 제거
> 7. Cognito.AdminDisableUser 호출 (별도 Lambda 또는 AppSync HTTP datasource 필요)

> Cognito 비활성화는 transaction 외 별도 Lambda call (실패 시 보상 처리). DDB 트랜잭션 25 항목 한계 → MemberTeams/Access entries 가 많으면 batch 분리.

---

## Task B4: Team CRUD (create/update/delete + assign/unassign)

**Files:**
- Create: `infra/lib/sync/resolvers/team.ts`
- Create: `infra/lib/sync/resolvers/team.test.ts`
- Modify: `infra/lib/sync-stack.ts`

- [ ] **권한 테스트 (Owner/Manager 만)**
- [ ] **deleteTeam 시 관련 WorkspaceAccess `team#<deletedId>` 모두 제거하는 cascade 테스트**
- [ ] **구현 + cdk synth + 커밋**

```bash
git commit -m "feat(infra): Team resolvers (CRUD + cascade access cleanup on delete)"
```

---

## Task B5: Workspace CRUD (createWorkspace + updateWorkspace + setWorkspaceAccess + deleteWorkspace)

**Files:**
- Create: `infra/lib/sync/resolvers/workspace.ts`
- Create: `infra/lib/sync/resolvers/workspace.test.ts`

- [ ] **테스트: setWorkspaceAccess 가 기존 entries 모두 삭제 + 신규 삽입**
- [ ] **테스트: deleteWorkspace cascade (Pages/Databases) — 큰 워크스페이스는 batch (25 한계)**
- [ ] **테스트: 권한 검증 (Owner/Manager 만 모든 mutation)**
- [ ] **구현 + 커밋**

```bash
git commit -m "feat(infra): Workspace resolvers (CRUD + access entries + cascade delete)"
```

---

## Task B6: Workspace Query (listMyWorkspaces + getWorkspace)

**Files:**
- Modify: `infra/lib/sync/resolvers/workspace.ts`
- Modify: `infra/lib/sync/resolvers/workspace.test.ts`

- [ ] **테스트: listMyWorkspaces 가 다음 union 을 반환**
  - 본인 personal workspace
  - WorkspaceAccess GSI (subjectKey = `member#<callerId>`)
  - WorkspaceAccess GSI (subjectKey = `team#<each of caller's teams>`)
  - WorkspaceAccess GSI (subjectKey = `everyone#*`)
  - 중복 제거 + 각 워크스페이스의 myEffectiveLevel 계산
- [ ] **getWorkspace: 본인 access 없으면 null 반환 또는 forbidden**
- [ ] **구현 + 커밋**

```bash
git commit -m "feat(infra): listMyWorkspaces/getWorkspace with effectiveLevel"
```

---

## Task B7: Page / Database resolver 에 workspaceId + workspace 권한 주입

**Files:**
- Modify: `infra/lib/sync/resolvers/upsert.ts`, `softDelete.ts`, `list.ts`, `subscribe.ts`
- Modify: 관련 테스트

- [ ] **테스트: upsertPage 가 view 권한만 있는 사용자에게는 forbidden**
- [ ] **테스트: listPages 가 access 없는 워크스페이스에 unauthorized**
- [ ] **테스트: 기존 테스트의 owner 필드를 createdByMemberId 로 변경**
- [ ] **구현: 모든 page/database resolver 에 권한 검사 추가**
- [ ] **커밋**

```bash
git commit -m "feat(infra): scope page/database resolvers by workspaceId + access check"
```

---

## Task B8: searchMembersForMention resolver

**Files:**
- Create: `infra/lib/sync/resolvers/mention.ts`

- [ ] **테스트: query string prefix 매칭, 최대 limit, MemberMini 만 반환 (email 제외)**
- [ ] **구현 (Members 테이블 Scan 또는 GSI)** — 본 v5 에선 멤버 수 적으므로 Scan + 메모리 필터로 시작. 향후 OpenSearch 가능.
- [ ] **커밋**

```bash
git commit -m "feat(infra): searchMembersForMention resolver (org-wide mention autocomplete)"
```

---

## Task B9: 리졸버 빌드 스크립트 + esbuild 출력 확인

**Files:**
- Modify: `infra/package.json` (build:resolvers 스크립트에 신규 파일 추가)

```json
"build:resolvers": "esbuild lib/sync/resolvers/upsert.ts lib/sync/resolvers/softDelete.ts lib/sync/resolvers/list.ts lib/sync/resolvers/subscribe.ts lib/sync/resolvers/auth.ts lib/sync/resolvers/member.ts lib/sync/resolvers/team.ts lib/sync/resolvers/workspace.ts lib/sync/resolvers/mention.ts --bundle --platform=neutral --format=esm --target=esnext --external:@aws-appsync/utils --outdir=lib/sync/resolvers/dist"
```

- [ ] **`npm run build:resolvers` 실행 → dist/*.js 생성 확인**
- [ ] **cdk synth 통과**
- [ ] **커밋**

```bash
git commit -m "build(infra): include v5 resolvers in esbuild bundle"
```

---

# Phase C — 프론트엔드 스토어 + GraphQL 쿼리

## Task C1: 신규 스토어 — workspaceStore

**Files:**
- Create: `src/store/workspaceStore.ts`
- Create: `src/store/__tests__/workspaceStore.test.ts`

- [ ] **테스트: 현재 활성 워크스페이스 ID 보유, 전환 시 변경, 목록 캐시**
- [ ] **구현 (zustand, persist 옵션은 currentWorkspaceId 만)**
- [ ] **커밋**

```bash
git commit -m "feat(store): workspaceStore (current ws + cached list)"
```

---

## Task C2: 신규 스토어 — memberStore (현재 멤버 + 멤버 캐시)

**Files:**
- Create: `src/store/memberStore.ts`
- Create: `src/store/__tests__/memberStore.test.ts`

- [ ] **테스트: me 정보, 멤버 목록 캐시, 멘션 자동완성용 검색**
- [ ] **구현**
- [ ] **커밋**

```bash
git commit -m "feat(store): memberStore (current member, mention search)"
```

---

## Task C3: 신규 스토어 — teamStore

**Files:**
- Create: `src/store/teamStore.ts`
- Create: `src/store/__tests__/teamStore.test.ts`

- [ ] **테스트: 팀 목록 캐시, 팀 멤버 lookup**
- [ ] **구현**
- [ ] **커밋**

```bash
git commit -m "feat(store): teamStore"
```

---

## Task C4: GraphQL 쿼리/뮤테이션 정의 (서버 스키마와 1:1)

**Files:**
- Create: `src/lib/sync/queries/member.ts`
- Create: `src/lib/sync/queries/team.ts`
- Create: `src/lib/sync/queries/workspace.ts`
- Modify: `src/lib/sync/queries/page.ts` (workspaceId 추가)
- Modify: `src/lib/sync/queries/database.ts`
- Delete: `src/lib/sync/queries/contact.ts` (있다면)

- [ ] **각 파일에 GQL 문자열 + TypeScript 타입 export**
- [ ] **타입 검증 테스트는 unnecessary (컴파일러가 잡음)**
- [ ] **커밋**

```bash
git commit -m "feat(sync): v5 GraphQL queries (member/team/workspace), drop contact"
```

---

## Task C5: sync runtime 에 workspaceId 스코핑 적용

**Files:**
- Modify: `src/lib/sync/runtime.ts`
- Modify: `src/lib/sync/index.ts` (fetchAllPages → fetchPagesByWorkspace 등)
- Modify: `src/Bootstrap.tsx` (currentWorkspaceId 변경 시 sync 재시작)

- [ ] **테스트: workspaceId 변경 시 outbox/구독 재초기화**
- [ ] **구현**
- [ ] **커밋**

```bash
git commit -m "feat(sync): scope sync runtime by current workspaceId"
```

---

## Task C6: contactsStore + 관련 컴포넌트 제거

**Files:**
- Delete: `src/store/contactsStore.ts`
- Delete: `src/components/contacts/*`
- Modify: 모든 import 정리

- [ ] **타입체크 통과**
- [ ] **테스트 통과**
- [ ] **커밋**

```bash
git commit -m "refactor: drop Contacts UI/store/sync (replaced by admin member list in v5)"
```

---

# Phase D — 프론트엔드 UI

## Task D1: 사이드바 헤더 (워크스페이스 드롭다운 + ⚙ 버튼)

**Files:**
- Create: `src/components/sidebar/SidebarHeader.tsx`
- Create: `src/components/sidebar/WorkspaceSwitcher.tsx`
- Modify: `src/components/sidebar/Sidebar.tsx`

- [ ] **컴포넌트 테스트 (RTL): 워크스페이스 목록 렌더, 클릭 시 currentWorkspaceId 변경, view-only 항목에 자물쇠**
- [ ] **구현**
- [ ] **시각 검증 (npm run dev 로 브라우저 확인) — 사이드바 헤더에 드롭다운 + 좌측 ⚙ 보임**
- [ ] **커밋**

```bash
git commit -m "feat(sidebar): SidebarHeader with workspace switcher and settings button"
```

---

## Task D2: 사이드바 본문 단순화 (페이지 + DB 트리만)

**Files:**
- Modify: `src/components/sidebar/Sidebar.tsx` (Contacts 섹션 제거)

- [ ] **컴포넌트 테스트: Contacts 노드 없음**
- [ ] **구현**
- [ ] **커밋**

```bash
git commit -m "refactor(sidebar): show only pages/databases, remove contacts section"
```

---

## Task D3: SettingsModal 컴포넌트 + 역할 분기

**Files:**
- Create: `src/components/settings/SettingsModal.tsx`
- Create: `src/components/settings/MyProfileSection.tsx`
- Modify: `src/components/sidebar/SidebarHeader.tsx` (⚙ → SettingsModal 열기)

- [ ] **테스트: Member 는 [내 프로필 / 로그아웃] 만, Owner/Manager 는 추가 탭 노출**
- [ ] **구현 (탭 전환은 zustand 또는 React state)**
- [ ] **커밋**

```bash
git commit -m "feat(settings): SettingsModal with role-based section toggle"
```

---

## Task D4: 관리 — 구성원 탭

**Files:**
- Create: `src/components/settings/AdminMembersTab.tsx`
- Create: `src/components/settings/CreateMemberModal.tsx`

- [ ] **테스트: 구성원 테이블 렌더, 필터 동작, 추가 모달이 createMember 호출**
- [ ] **구현 (검증: 이메일 형식, 중복 — 백엔드 에러 핸들링)**
- [ ] **커밋**

```bash
git commit -m "feat(admin): members tab (list/filter/add modal)"
```

---

## Task D5: 관리 — 구성원 행 액션 (역할 변경 / 팀 변경 / 제거)

**Files:**
- Create: `src/components/settings/MemberRowActions.tsx`

- [ ] **테스트: Owner 만 보이는 액션 (제거/승격/강등) vs Manager 만 (팀 변경)**
- [ ] **테스트: confirmation 모달**
- [ ] **구현**
- [ ] **커밋**

```bash
git commit -m "feat(admin): member row actions (promote/demote/remove/team)"
```

---

## Task D6: 관리 — 팀 탭

**Files:**
- Create: `src/components/settings/AdminTeamsTab.tsx`
- Create: `src/components/settings/TeamDetailPanel.tsx`

- [ ] **테스트: 팀 목록, 팀 클릭 시 멤버 목록, 팀 추가/삭제**
- [ ] **구현**
- [ ] **커밋**

```bash
git commit -m "feat(admin): teams tab (list/create/delete + members panel)"
```

---

## Task D7: 관리 — 워크스페이스 탭

**Files:**
- Create: `src/components/settings/AdminWorkspacesTab.tsx`

- [ ] **테스트: 모든 공유 ws 목록, 행 클릭 시 설정 모달**
- [ ] **구현 + 커밋**

```bash
git commit -m "feat(admin): workspaces tab"
```

---

## Task D8: 워크스페이스 생성 모달 + 접근 권한 편집기

**Files:**
- Create: `src/components/workspace/CreateWorkspaceModal.tsx`
- Create: `src/components/workspace/AccessEntriesEditor.tsx`

- [ ] **테스트: edit/view 두 섹션, 같은 subject 중복 시 edit 우선 + 토스트, 저장 시 createWorkspace 호출**
- [ ] **구현**
- [ ] **시각 검증**
- [ ] **커밋**

```bash
git commit -m "feat(workspace): create modal + access entries editor"
```

---

## Task D9: 워크스페이스 설정 모달 (편집 + 삭제)

**Files:**
- Create: `src/components/workspace/WorkspaceSettingsModal.tsx`

- [ ] **테스트: 이름 변경 / setWorkspaceAccess 호출 / 삭제 confirmation 후 deleteWorkspace 호출**
- [ ] **구현 + 커밋**

```bash
git commit -m "feat(workspace): settings modal (rename + access edit + delete)"
```

---

## Task D10: View-only 모드 적용

**Files:**
- Modify: `src/App.tsx` (현재 ws 의 effectiveLevel 에 따라 ReadOnlyContext provide)
- Modify: `src/components/editor/Editor.tsx` (TipTap editable=false)
- Modify: `src/components/sidebar/Sidebar.tsx` (배너 + + 새 페이지 버튼 비활성)
- Modify: 페이지/DB 액션 버튼들

- [ ] **테스트: effectiveLevel === "view" 인 ws 에서 편집 UI 모두 비활성**
- [ ] **시각 검증 (DevTools 로 임의 ws 의 level 강제 변경)**
- [ ] **커밋**

```bash
git commit -m "feat: view-only mode UI (banner + disabled actions + readonly editor)"
```

---

## Task D11: 멘션 (@) — 자동완성 + 접근 권한 표시

**Files:**
- Modify: `src/components/editor/MentionExtension.ts` (TipTap 확장)
- Create: `src/components/editor/MentionRenderer.tsx`
- Modify: `src/lib/sync/queries/member.ts` (searchMembersForMention 호출 helper)

- [ ] **테스트: @ 입력 시 자동완성 노출 (MemberMini, email 제외)**
- [ ] **테스트: 렌더 시 접근 권한 분기 (active / no-access / removed)**
- [ ] **구현 (TipTap suggestion plugin + 비동기 검색)**
- [ ] **커밋**

```bash
git commit -m "feat(editor): mention autocomplete with workspace access check"
```

---

## Task D12: 첫 로그인 흐름 (개인 워크스페이스 자동 진입)

**Files:**
- Modify: `src/Bootstrap.tsx` (인증 완료 직후 me 조회 → personalWorkspaceId 를 currentWorkspaceId 로 세팅)
- Modify: `src/store/workspaceStore.ts`

- [ ] **테스트: authStatus → authenticated 시 me 조회 + personalWorkspaceId 로 currentWorkspaceId 초기화**
- [ ] **구현 + 커밋**

```bash
git commit -m "feat: auto-enter personal workspace on first sign-in"
```

---

# Phase E — 마이그레이션 + 배포

## Task E1: v5 마이그레이션 Lambda 작성

**Files:**
- Create: `infra/lambda/v5-migration/index.ts`
- Create: `infra/lambda/v5-migration/index.test.ts`
- Modify: `infra/lib/sync-stack.ts` (Lambda + Custom Resource trigger)

- [ ] **테스트: idempotent (이미 Member 존재하면 abort)**
- [ ] **테스트: Owner Member + personal Workspace + WorkspaceAccess 생성**
- [ ] **테스트: 모든 기존 Pages/Databases 의 workspaceId, createdByMemberId 채움**
- [ ] **구현 (CDK Custom Resource — onCreate 시 1회 trigger)**
- [ ] **커밋**

```bash
git commit -m "feat(infra): v5 migration Lambda (Owner bootstrap + Pages/DBs workspaceId backfill)"
```

---

## Task E2: 스테이징 deploy 후 e2e 검증

- [ ] **`cd infra && npm run diff` — 변경 미리보기**
- [ ] **`cd infra && npm run deploy` — 스테이징(혹은 단일) 환경 배포**
- [ ] **AWS 콘솔에서 마이그레이션 Lambda 로그 확인 (Owner Member 생성 + Pages 마이그레이션 카운트)**
- [ ] **수동 e2e 시나리오 6개 실행 (spec 8.3 시나리오 참고)**
- [ ] **각 시나리오 결과 stdout/스크린샷 첨부 (AGENTS 작업이므로 결과 텍스트로 보고)**
- [ ] **이슈 발견 시 task 추가**

> 배포는 destructive 작업 — Auto mode 라도 사용자 명시 승인 후에만 실행.

---

## Task E3: Contacts 테이블 dropTable (수동)

- [ ] **AWS DDB 콘솔에서 quicknote-contacts 백업 (on-demand backup)**
- [ ] **CDK 에서 contactsTable RemovalPolicy.DESTROY 변경 + 정의 완전 삭제**
- [ ] **`npm run deploy` 로 drop**
- [ ] **커밋 (dropTable 변경 사항)**

```bash
git commit -m "feat(infra): drop Contacts table after data backup"
```

> 사용자 데이터 삭제이므로 Auto mode 라도 명시 승인 필수.

---

## Task E4: 프론트엔드 v5 배포

- [ ] **`npm run build` 로컬 빌드 통과 확인**
- [ ] **`git push origin main` (사용자 승인 후) → Vercel 자동 배포**
- [ ] **배포 후 https://quick-note-khaki.vercel.app 에서 Owner 로그인 → 본인 페이지 정상 노출 확인**
- [ ] **마이그레이션 검증 시나리오 1번 (Owner 첫 로그인) 통과 후 PR 머지/태그 릴리스**

---

## Task E5: 버전 bump + CHANGELOG + 태그

**Files:**
- Modify: `package.json` (`"version": "5.0.0"`)
- Modify: `src-tauri/tauri.conf.json` (`"version": "5.0.0"`)
- Modify: `src-tauri/Cargo.toml` (`version = "5.0.0"`)
- Modify: `CHANGELOG.md`
- Modify: `README.md` (로드맵에서 v5.0 → 완료, 동기화 섹션에 v5 워크스페이스 설명 추가)

- [ ] **세 군데 버전 일치 확인**
- [ ] **CHANGELOG 작성 (Breaking Changes: Contacts 제거, ALLOWED_EMAILS 폐지, Pages/DBs workspaceId 필수)**
- [ ] **README 업데이트**
- [ ] **커밋 + 태그 push**

```bash
git tag v5.0.0
git push origin main --tags
git commit -m "release: v5.0.0 workspace foundation"
```

---

# 부록: 권한 검사 패턴 치트시트

각 mutation/query 의 첫 줄:

```typescript
const me = await callerMember(ctx);  // status=active 검증 포함, 없으면 unauthorized
// 그 다음 케이스별:
requireRole(me, "manager");          // manager 이상
requireOwnerOnly(me);                // owner 만
requireWorkspaceAccess(me, ctx.args.workspaceId, "view");   // listPages, getWorkspace
requireWorkspaceAccess(me, ctx.args.workspaceId, "edit");   // upsertPage 등
preventOwnerMutation(me, target);    // promote/demote/transfer/remove 의 target 검증
```

# 부록: 트랜잭션 25 항목 한계 회피

- `setWorkspaceAccess` entries > 23 → frontend validation 으로 차단 + UI 메시지 ("최대 24개")
- `removeMember` 의 MemberTeams/WorkspaceAccess cleanup > 24 → 별도 chunk batch (transaction 외 BatchWrite)
- `deleteWorkspace` 의 Pages/Databases cascade > 24 → BatchWrite (이상적이진 않지만 v5.0 수용)

# 부록: 시각 검증 체크리스트 (Phase D 완료 시)

`npm run dev` 로 로컬에서 다음 모두 동작 확인:
- 사이드바 헤더 ⚙ + 워크스페이스 드롭다운 보임
- Member 로 로그인 시 ⚙ 모달에 [내 프로필 / 로그아웃] 만
- Owner/Manager 로 로그인 시 [내 프로필 / 구성원 / 팀 / 워크스페이스 / 로그아웃]
- 워크스페이스 드롭다운 클릭 → 전환 시 사이드바 페이지 트리 변경
- View-only 워크스페이스에 노란 배너 + 편집 버튼 비활성
- 멘션 자동완성 + 접근 권한 표시
- 사이드바에 Contacts 항목 없음
