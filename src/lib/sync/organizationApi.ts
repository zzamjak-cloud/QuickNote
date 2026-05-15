// 조직(실) AppSync API — teamApi.ts 와 동일 패턴

import { appsyncClient } from "./graphql/client";
import {
  ARCHIVE_ORGANIZATION,
  ASSIGN_MEMBER_TO_ORGANIZATION,
  CREATE_ORGANIZATION,
  DELETE_ORGANIZATION,
  LIST_ORGANIZATIONS,
  RESTORE_ORGANIZATION,
  UNASSIGN_MEMBER_FROM_ORGANIZATION,
  UPDATE_ORGANIZATION,
} from "./queries/organization";
import type { Organization } from "../../store/organizationStore";
import { GqlOrganizationSchema, parseGqlList } from "./schemas";
import {
  type GqlMember,
  normalizeMemberFields,
} from "./memberNormalize";

type GqlOrganization = Omit<Organization, "members"> & {
  members: GqlMember[];
};

function normalizeOrganization(org: GqlOrganization): Organization {
  return { ...org, members: org.members.map(normalizeMemberFields) };
}

export async function listOrganizationsApi(): Promise<Organization[]> {
  const result = (await appsyncClient().graphql({
    query: LIST_ORGANIZATIONS,
  })) as { data?: { listOrganizations?: unknown } };
  const parsed = parseGqlList(
    result.data?.listOrganizations ?? [],
    GqlOrganizationSchema,
    "listOrganizations",
  );
  return parsed.map((o) => normalizeOrganization(o as unknown as GqlOrganization));
}

export async function createOrganizationApi(name: string): Promise<Organization> {
  const result = (await appsyncClient().graphql({
    query: CREATE_ORGANIZATION,
    variables: { name },
  })) as { data?: { createOrganization?: GqlOrganization } };
  const org = result.data?.createOrganization;
  if (!org) throw new Error("createOrganization 응답이 비어 있습니다.");
  return normalizeOrganization(org);
}

export async function updateOrganizationApi(organizationId: string, name: string): Promise<Organization> {
  const result = (await appsyncClient().graphql({
    query: UPDATE_ORGANIZATION,
    variables: { organizationId, name },
  })) as { data?: { updateOrganization?: GqlOrganization } };
  const org = result.data?.updateOrganization;
  if (!org) throw new Error("updateOrganization 응답이 비어 있습니다.");
  return normalizeOrganization(org);
}

export async function deleteOrganizationApi(organizationId: string): Promise<boolean> {
  const result = (await appsyncClient().graphql({
    query: DELETE_ORGANIZATION,
    variables: { organizationId },
  })) as { data?: { deleteOrganization?: boolean } };
  return Boolean(result.data?.deleteOrganization);
}

export async function assignMemberToOrganizationApi(
  memberId: string,
  organizationId: string,
): Promise<boolean> {
  const result = (await appsyncClient().graphql({
    query: ASSIGN_MEMBER_TO_ORGANIZATION,
    variables: { memberId, organizationId },
  })) as { data?: { assignMemberToOrganization?: boolean } };
  return Boolean(result.data?.assignMemberToOrganization);
}

export async function unassignMemberFromOrganizationApi(
  memberId: string,
  organizationId: string,
): Promise<boolean> {
  const result = (await appsyncClient().graphql({
    query: UNASSIGN_MEMBER_FROM_ORGANIZATION,
    variables: { memberId, organizationId },
  })) as { data?: { unassignMemberFromOrganization?: boolean } };
  return Boolean(result.data?.unassignMemberFromOrganization);
}

export async function archiveOrganizationApi(
  organizationId: string,
): Promise<Organization | null> {
  const result = (await appsyncClient().graphql({
    query: ARCHIVE_ORGANIZATION,
    variables: { organizationId },
  })) as { data?: { archiveOrganization?: GqlOrganization } };
  const org = result.data?.archiveOrganization;
  return org ? normalizeOrganization(org) : null;
}

export async function restoreOrganizationApi(
  organizationId: string,
): Promise<Organization | null> {
  const result = (await appsyncClient().graphql({
    query: RESTORE_ORGANIZATION,
    variables: { organizationId },
  })) as { data?: { restoreOrganization?: GqlOrganization } };
  const org = result.data?.restoreOrganization;
  return org ? normalizeOrganization(org) : null;
}
