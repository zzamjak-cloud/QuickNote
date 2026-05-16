// GraphQL 응답 zod 스키마 — 서버 schema drift 시 silent corruption 방지.
// safeParse + reportNonFatal 패턴: 실패 시 해당 entity 만 skip, 앱은 계속 동작.

import { z } from "zod";
import { reportNonFatal } from "../../reportNonFatal";

const WorkspaceRoleSchema = z.union([
  z.literal("DEVELOPER"),
  z.literal("OWNER"),
  z.literal("LEADER"),
  z.literal("MANAGER"),
  z.literal("MEMBER"),
  // 정규화 전 소문자 케이스도 허용
  z.literal("developer"),
  z.literal("owner"),
  z.literal("leader"),
  z.literal("manager"),
  z.literal("member"),
]);

const MemberStatusSchema = z.union([
  z.literal("ACTIVE"),
  z.literal("REMOVED"),
  z.literal("active"),
  z.literal("removed"),
]);

/** 서버에서 새 필드가 추가돼도 깨지지 않도록 passthrough. */
export const GqlMemberSchema = z
  .object({
    memberId: z.string(),
    email: z.string(),
    name: z.string(),
    jobRole: z.string(),
    workspaceRole: WorkspaceRoleSchema,
    status: MemberStatusSchema,
    jobTitle: z.string().nullish(),
    phone: z.string().nullish(),
    avatarUrl: z.string().nullish(),
    thumbnailUrl: z.string().nullish(),
    personalWorkspaceId: z.string().nullish(),
    cognitoSub: z.string().nullish(),
    createdAt: z.string().nullish(),
    removedAt: z.string().nullish(),
    clientPrefs: z.unknown().nullish(),
    // 신규 7개 필드 — 서버 미배포 시점에도 깨지지 않도록 optional
    employmentStatus: z.string().nullish(),
    employeeNumber: z.string().nullish(),
    department: z.string().nullish(),
    team: z.string().nullish(),
    jobCategory: z.string().nullish(),
    jobDetail: z.string().nullish(),
    joinedAt: z.string().nullish(),
    rowCount: z.number().int().nullish(),
  })
  .passthrough();

export type GqlMemberParsed = z.infer<typeof GqlMemberSchema>;

export const GqlTeamSchema = z
  .object({
    teamId: z.string(),
    name: z.string(),
    members: z.array(GqlMemberSchema).default([]),
  })
  .passthrough();

export type GqlTeamParsed = z.infer<typeof GqlTeamSchema>;

export const GqlOrganizationSchema = z
  .object({
    organizationId: z.string(),
    name: z.string(),
    members: z.array(GqlMemberSchema).default([]),
  })
  .passthrough();

export type GqlOrganizationParsed = z.infer<typeof GqlOrganizationSchema>;

export const GqlPageSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    createdByMemberId: z.string(),
    title: z.string(),
    icon: z.string().nullish(),
    coverImage: z.string().nullish(),
    parentId: z.string().nullish(),
    // AppSync/구독 경로에서 number 로 내려오는 경우가 있어 문자열로 정규화
    order: z.coerce.string(),
    databaseId: z.string().nullish(),
    doc: z.unknown(),
    dbCells: z.unknown().nullish(),
    blockComments: z.unknown().nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
    deletedAt: z.string().nullish(),
  })
  .passthrough();

export type GqlPageParsed = z.infer<typeof GqlPageSchema>;

export const GqlDatabaseSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    createdByMemberId: z.string(),
    title: z.string(),
    columns: z.unknown(),
    presets: z.unknown().nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
    deletedAt: z.string().nullish(),
  })
  .passthrough();

export type GqlDatabaseParsed = z.infer<typeof GqlDatabaseSchema>;

export const GqlCommentSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    pageId: z.string(),
    blockId: z.string(),
    authorMemberId: z.string(),
    bodyText: z.string(),
    mentionMemberIds: z.unknown(),
    parentId: z.string().nullish(),
    createdAt: z.string(),
    updatedAt: z.string(),
    deletedAt: z.string().nullish(),
  })
  .passthrough();

export type GqlCommentParsed = z.infer<typeof GqlCommentSchema>;

/**
 * GraphQL 응답 배열을 검증하고 실패한 항목은 reportNonFatal 후 제외.
 * 부분 실패에도 나머지 정상 항목은 유지 — 앱 안 죽음.
 */
export function parseGqlList<T>(
  raw: unknown,
  schema: z.ZodType<T>,
  op: string,
): T[] {
  if (!Array.isArray(raw)) {
    reportNonFatal(
      new Error(`${op}: 응답이 배열이 아님`),
      "sync.schema.notArray",
    );
    return [];
  }
  const out: T[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = schema.safeParse(raw[i]);
    if (r.success) {
      out.push(r.data);
    } else {
      reportNonFatal(
        new Error(
          `${op}[${i}]: 스키마 불일치 — ${r.error.issues
            .slice(0, 3)
            .map((iss) => `${iss.path.join(".")}: ${iss.message}`)
            .join("; ")}`,
        ),
        "sync.schema.parseFailure",
      );
    }
  }
  return out;
}

/** 단일 응답 검증 — 실패 시 null 반환 + reportNonFatal. */
export function parseGqlOne<T>(
  raw: unknown,
  schema: z.ZodType<T>,
  op: string,
): T | null {
  const r = schema.safeParse(raw);
  if (r.success) return r.data;
  reportNonFatal(
    new Error(
      `${op}: 스키마 불일치 — ${r.error.issues
        .slice(0, 3)
        .map((iss) => `${iss.path.join(".")}: ${iss.message}`)
        .join("; ")}`,
    ),
    "sync.schema.parseFailure",
  );
  return null;
}
