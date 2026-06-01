import {
  DynamoDBDocumentClient,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import type { Member, Tables } from "./member";
import type { Organization } from "./organization";
import type { ProjectRecord } from "./project";
import { listProjects } from "./project";
import type { Team } from "./team";

type MemberTeamLink = {
  memberId: string;
  teamId: string;
};

type MemberOrganizationLink = {
  memberId: string;
  organizationId: string;
};

export type WorkspaceMeta = {
  members: Member[];
  teams: Team[];
  organizations: Organization[];
  projects: ProjectRecord[];
};

async function scanAll<T>(
  doc: DynamoDBDocumentClient,
  tableName: string,
): Promise<T[]> {
  const out: T[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const result = await doc.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: startKey,
      }),
    );
    out.push(...((result.Items ?? []) as T[]));
    startKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);
  return out;
}

function activeMemberById(members: Member[]): Map<string, Member> {
  return new Map(
    members
      .filter((member) => member.status === "active")
      .map((member) => [member.memberId, member]),
  );
}

function membersForLinks(
  links: readonly string[],
  membersById: ReadonlyMap<string, Member>,
): Member[] {
  return links
    .map((memberId) => membersById.get(memberId))
    .filter((member): member is Member => Boolean(member));
}

export async function getWorkspaceMeta(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  workspaceId: string;
}): Promise<WorkspaceMeta> {
  const [
    members,
    teamRows,
    organizationRows,
    memberTeamLinks,
    memberOrganizationLinks,
    projects,
  ] = await Promise.all([
    scanAll<Member>(args.doc, args.tables.Members),
    scanAll<Omit<Team, "members">>(args.doc, args.tables.Teams),
    args.tables.Organizations
      ? scanAll<Omit<Organization, "members">>(args.doc, args.tables.Organizations)
      : Promise.resolve([]),
    scanAll<MemberTeamLink>(args.doc, args.tables.MemberTeams),
    args.tables.MemberOrganizations
      ? scanAll<MemberOrganizationLink>(args.doc, args.tables.MemberOrganizations)
      : Promise.resolve([]),
    listProjects({
      doc: args.doc,
      tables: args.tables,
      caller: args.caller,
      workspaceId: args.workspaceId,
    }),
  ]);

  const membersById = activeMemberById(members);
  const teamMemberIds = new Map<string, string[]>();
  for (const link of memberTeamLinks) {
    const prev = teamMemberIds.get(link.teamId) ?? [];
    prev.push(link.memberId);
    teamMemberIds.set(link.teamId, prev);
  }

  const organizationMemberIds = new Map<string, string[]>();
  for (const link of memberOrganizationLinks) {
    const prev = organizationMemberIds.get(link.organizationId) ?? [];
    prev.push(link.memberId);
    organizationMemberIds.set(link.organizationId, prev);
  }

  const teams = teamRows.map((team) => ({
    ...team,
    leaderMemberIds: team.leaderMemberIds ?? [],
    members: membersForLinks(teamMemberIds.get(team.teamId) ?? [], membersById),
  }));

  const organizations = organizationRows.map((organization) => ({
    ...organization,
    leaderMemberIds: organization.leaderMemberIds ?? [],
    members: membersForLinks(
      organizationMemberIds.get(organization.organizationId) ?? [],
      membersById,
    ),
  }));

  return {
    members,
    teams,
    organizations,
    projects,
  };
}
