import { gqlOptional } from "./graphqlRequest";
import {
  ARCHIVE_WORKSPACE,
  CREATE_WORKSPACE,
  DELETE_WORKSPACE,
  GET_WORKSPACE,
  LIST_MY_WORKSPACES,
  RESTORE_WORKSPACE,
  SET_WORKSPACE_ACCESS,
  UPDATE_WORKSPACE,
} from "./queries/workspace";
import type { WorkspaceSummary } from "../../store/workspaceStore";

export type WorkspaceAccessInput = {
  subjectType: "TEAM" | "MEMBER" | "EVERYONE";
  subjectId?: string;
  level: "EDIT" | "VIEW";
};

export type WorkspaceOptions = {
  jobFunctions: string[];
  jobTitles: string[];
};

type WorkspaceResponse = Omit<WorkspaceSummary, "type" | "myEffectiveLevel"> & {
  type: "PERSONAL" | "SHARED" | "personal" | "shared";
  myEffectiveLevel: "EDIT" | "VIEW" | "edit" | "view";
  access?: WorkspaceAccessInput[];
  options?: WorkspaceOptions;
};

export type WorkspaceDetail = WorkspaceSummary & {
  access: WorkspaceAccessInput[];
  options?: WorkspaceOptions;
};

function normalizeWorkspace(ws: WorkspaceResponse): WorkspaceSummary & { options?: WorkspaceOptions } {
  return {
    ...ws,
    type: ws.type === "PERSONAL" ? "personal" : ws.type === "SHARED" ? "shared" : ws.type,
    myEffectiveLevel:
      ws.myEffectiveLevel === "EDIT"
        ? "edit"
        : ws.myEffectiveLevel === "VIEW"
          ? "view"
          : ws.myEffectiveLevel,
  };
}

export async function listMyWorkspacesApi(): Promise<(WorkspaceSummary & { options?: WorkspaceOptions })[]> {
  const list = await gqlOptional<WorkspaceResponse[]>(
    LIST_MY_WORKSPACES,
    undefined,
    "listMyWorkspaces",
  );
  return (list ?? []).map(normalizeWorkspace);
}

export async function getWorkspaceApi(workspaceId: string): Promise<WorkspaceDetail> {
  const ws = await gqlOptional<WorkspaceResponse>(
    GET_WORKSPACE,
    { workspaceId },
    "getWorkspace",
  );
  if (!ws) throw new Error("getWorkspace 응답이 비어 있습니다.");
  return {
    ...normalizeWorkspace(ws),
    access: ws.access ?? [],
  };
}

export async function createWorkspaceApi(input: {
  name: string;
  access: WorkspaceAccessInput[];
}): Promise<WorkspaceSummary> {
  const ws = await gqlOptional<WorkspaceResponse>(
    CREATE_WORKSPACE,
    { input },
    "createWorkspace",
  );
  if (!ws) throw new Error("createWorkspace 응답이 비어 있습니다.");
  return normalizeWorkspace(ws);
}

export async function updateWorkspaceApi(input: {
  workspaceId: string;
  name?: string;
  options?: { jobFunctions?: string[]; jobTitles?: string[] };
}): Promise<WorkspaceSummary & { options?: WorkspaceOptions }> {
  const ws = await gqlOptional<WorkspaceResponse>(
    UPDATE_WORKSPACE,
    { input },
    "updateWorkspace",
  );
  if (!ws) throw new Error("updateWorkspace 응답이 비어 있습니다.");
  return normalizeWorkspace(ws);
}

export async function updateWorkspaceOptionsApi(
  workspaceId: string,
  options: { jobFunctions?: string[]; jobTitles?: string[] },
): Promise<void> {
  await updateWorkspaceApi({ workspaceId, options });
}

export async function setWorkspaceAccessApi(input: {
  workspaceId: string;
  entries: WorkspaceAccessInput[];
}): Promise<WorkspaceSummary> {
  const ws = await gqlOptional<WorkspaceResponse>(
    SET_WORKSPACE_ACCESS,
    { workspaceId: input.workspaceId, entries: input.entries },
    "setWorkspaceAccess",
  );
  if (!ws) throw new Error("setWorkspaceAccess 응답이 비어 있습니다.");
  return normalizeWorkspace(ws);
}

export async function deleteWorkspaceApi(workspaceId: string): Promise<boolean> {
  const ok = await gqlOptional<boolean>(DELETE_WORKSPACE, { workspaceId }, "deleteWorkspace");
  return Boolean(ok);
}

export async function archiveWorkspaceApi(workspaceId: string): Promise<WorkspaceSummary | null> {
  const ws = await gqlOptional<WorkspaceResponse>(
    ARCHIVE_WORKSPACE,
    { workspaceId },
    "archiveWorkspace",
  );
  return ws ? normalizeWorkspace(ws) : null;
}

export async function restoreWorkspaceApi(workspaceId: string): Promise<WorkspaceSummary | null> {
  const ws = await gqlOptional<WorkspaceResponse>(
    RESTORE_WORKSPACE,
    { workspaceId },
    "restoreWorkspace",
  );
  return ws ? normalizeWorkspace(ws) : null;
}
