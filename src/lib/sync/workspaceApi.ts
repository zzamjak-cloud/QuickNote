import { appsyncClient } from "./graphql/client";
import {
  CREATE_WORKSPACE,
  DELETE_WORKSPACE,
  GET_WORKSPACE,
  LIST_MY_WORKSPACES,
  SET_WORKSPACE_ACCESS,
  UPDATE_WORKSPACE,
} from "./queries/workspace";
import type { WorkspaceSummary } from "../../store/workspaceStore";

export type WorkspaceAccessInput = {
  subjectType: "TEAM" | "MEMBER" | "EVERYONE";
  subjectId?: string;
  level: "EDIT" | "VIEW";
};

type WorkspaceResponse = Omit<WorkspaceSummary, "type" | "myEffectiveLevel"> & {
  type: "PERSONAL" | "SHARED" | "personal" | "shared";
  myEffectiveLevel: "EDIT" | "VIEW" | "edit" | "view";
  access?: WorkspaceAccessInput[];
};

export type WorkspaceDetail = WorkspaceSummary & {
  access: WorkspaceAccessInput[];
};

function normalizeWorkspace(ws: WorkspaceResponse): WorkspaceSummary {
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

export async function listMyWorkspacesApi(): Promise<WorkspaceSummary[]> {
  const result = (await appsyncClient().graphql({
    query: LIST_MY_WORKSPACES,
  })) as { data?: { listMyWorkspaces?: WorkspaceResponse[] } };
  return (result.data?.listMyWorkspaces ?? []).map(normalizeWorkspace);
}

export async function getWorkspaceApi(workspaceId: string): Promise<WorkspaceDetail> {
  const result = (await appsyncClient().graphql({
    query: GET_WORKSPACE,
    variables: { workspaceId },
  })) as { data?: { getWorkspace?: WorkspaceResponse | null } };
  const ws = result.data?.getWorkspace;
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
  const result = (await appsyncClient().graphql({
    query: CREATE_WORKSPACE,
    variables: { input },
  })) as { data?: { createWorkspace?: WorkspaceResponse } };
  const ws = result.data?.createWorkspace;
  if (!ws) throw new Error("createWorkspace 응답이 비어 있습니다.");
  return normalizeWorkspace(ws);
}

export async function updateWorkspaceApi(input: {
  workspaceId: string;
  name?: string;
}): Promise<WorkspaceSummary> {
  const result = (await appsyncClient().graphql({
    query: UPDATE_WORKSPACE,
    variables: { input },
  })) as { data?: { updateWorkspace?: WorkspaceResponse } };
  const ws = result.data?.updateWorkspace;
  if (!ws) throw new Error("updateWorkspace 응답이 비어 있습니다.");
  return normalizeWorkspace(ws);
}

export async function setWorkspaceAccessApi(input: {
  workspaceId: string;
  entries: WorkspaceAccessInput[];
}): Promise<WorkspaceSummary> {
  const result = (await appsyncClient().graphql({
    query: SET_WORKSPACE_ACCESS,
    variables: { workspaceId: input.workspaceId, entries: input.entries },
  })) as { data?: { setWorkspaceAccess?: WorkspaceResponse } };
  const ws = result.data?.setWorkspaceAccess;
  if (!ws) throw new Error("setWorkspaceAccess 응답이 비어 있습니다.");
  return normalizeWorkspace(ws);
}

export async function deleteWorkspaceApi(workspaceId: string): Promise<boolean> {
  const result = (await appsyncClient().graphql({
    query: DELETE_WORKSPACE,
    variables: { workspaceId },
  })) as { data?: { deleteWorkspace?: boolean } };
  return Boolean(result.data?.deleteWorkspace);
}
