// LC 스케줄러 프로젝트 AppSync 호출 — store 에서 분리(5.1).
// 호출 형태는 보존(직접 graphql, outbox 비경유). store 는 이 함수를 호출하고 캐시·정규화를 담당.
import { appsyncClient } from "./graphql/client";
import {
  LIST_PROJECTS,
  CREATE_PROJECT,
  UPDATE_PROJECT,
  DELETE_PROJECT,
  type GqlProject,
} from "./graphql/operations";
import type {
  CreateProjectInput,
  UpdateProjectInput,
} from "../../store/schedulerProjectsStore";
import { runSchedulerMutation } from "./schedulerMutationResilience";

export async function listProjectsApi(workspaceId: string): Promise<GqlProject[]> {
  const r = await (appsyncClient().graphql({
    query: LIST_PROJECTS,
    variables: { workspaceId },
  }) as Promise<{ data: { listProjects: GqlProject[] } }>);
  return r.data.listProjects;
}

export async function createProjectApi(input: CreateProjectInput): Promise<GqlProject> {
  // create 는 비멱등(서버가 id 할당) — 재시도 시 중복 생성 위험이라 관측만.
  return runSchedulerMutation(async () => {
    const r = await (appsyncClient().graphql({
      query: CREATE_PROJECT,
      variables: { input },
    }) as Promise<{ data: { createProject: GqlProject } }>);
    return r.data.createProject;
  }, { context: "schedulerProjectsApi.createProject", retryable: false });
}

export async function updateProjectApi(input: UpdateProjectInput): Promise<GqlProject> {
  return runSchedulerMutation(async () => {
    const r = await (appsyncClient().graphql({
      query: UPDATE_PROJECT,
      variables: { input },
    }) as Promise<{ data: { updateProject: GqlProject } }>);
    return r.data.updateProject;
  }, { context: "schedulerProjectsApi.updateProject", retryable: true });
}

export async function deleteProjectApi(id: string, workspaceId: string): Promise<void> {
  await runSchedulerMutation(async () => {
    await appsyncClient().graphql({
      query: DELETE_PROJECT,
      variables: { id, workspaceId },
    });
  }, { context: "schedulerProjectsApi.deleteProject", retryable: true });
}
