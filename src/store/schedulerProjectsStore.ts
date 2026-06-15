// LC 스케줄러 프로젝트 스토어 — persist 미들웨어로 로컬 캐시 유지.
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { zustandStorage } from "../lib/storage/index";
import { type GqlProject } from "../lib/sync/graphql/operations";
import {
  listProjectsApi,
  createProjectApi,
  updateProjectApi,
  deleteProjectApi,
} from "../lib/sync/schedulerProjectsApi";

export type SchedulerProject = {
  id: string;
  workspaceId: string;
  name: string;
  color: string;
  description?: string | null;
  memberIds: string[];
  leaderMemberIds: string[];
  isHidden: boolean;
  createdByMemberId: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateProjectInput = {
  workspaceId: string;
  name: string;
  color: string;
  description?: string | null;
  memberIds?: string[];
  leaderMemberIds?: string[];
  isHidden?: boolean;
};

export type UpdateProjectInput = {
  id: string;
  workspaceId: string;
  name?: string | null;
  color?: string | null;
  description?: string | null;
  memberIds?: string[] | null;
  leaderMemberIds?: string[] | null;
  isHidden?: boolean | null;
};

type SchedulerProjectsStore = {
  projects: SchedulerProject[];
  loading: boolean;
  /** 마지막으로 fetch한 workspaceId — 워크스페이스 전환 시 캐시 무효화에 사용 */
  workspaceId: string | null;
  /** 마지막으로 서버에서 프로젝트 메타를 가져온 시점(ms). */
  lastFetchedAt: number | null;
  setProjects: (projects: SchedulerProject[], workspaceId: string) => void;
  fetchProjects: (workspaceId: string) => Promise<void>;
  createProject: (input: CreateProjectInput) => Promise<SchedulerProject>;
  updateProject: (input: UpdateProjectInput) => Promise<SchedulerProject>;
  deleteProject: (id: string, workspaceId: string) => Promise<void>;
  applyRemote: (project: SchedulerProject) => void;
  removeLocal: (id: string) => void;
};

function normalizeProject(project: GqlProject): SchedulerProject {
  return {
    ...(project as SchedulerProject),
    leaderMemberIds: project.leaderMemberIds ?? [],
    memberIds: project.memberIds ?? [],
  };
}

export const useSchedulerProjectsStore = create<SchedulerProjectsStore>()(
  persist(
    (set, get) => ({
      projects: [],
      loading: false,
      workspaceId: null,
      lastFetchedAt: null,

      setProjects: (projects, workspaceId) => {
        set({
          projects: projects.map((project) => ({
            ...project,
            memberIds: project.memberIds ?? [],
            leaderMemberIds: project.leaderMemberIds ?? [],
          })),
          workspaceId,
          lastFetchedAt: Date.now(),
          loading: false,
        });
      },

      fetchProjects: async (workspaceId) => {
        // 워크스페이스가 다르면 캐시를 비우고 시작 (다른 워크스페이스 데이터 노출 방지)
        if (get().workspaceId !== workspaceId) {
          set({ projects: [], workspaceId });
        }
        // loading을 true로 올리지 않음 — 기존 캐시로 화면이 이미 그려진 상태 유지
        try {
          const list = await listProjectsApi(workspaceId);
          set({
            projects: list.map(normalizeProject),
            workspaceId,
            lastFetchedAt: Date.now(),
          });
        } finally {
          set({ loading: false });
        }
      },

      createProject: async (input) => {
        const p = normalizeProject(await createProjectApi(input));
        set((st) => ({
          projects: [...st.projects, p],
          workspaceId: p.workspaceId,
          lastFetchedAt: Date.now(),
        }));
        return p;
      },

      updateProject: async (input) => {
        const p = normalizeProject(await updateProjectApi(input));
        set((st) => ({
          projects: st.projects.map((x) => (x.id === p.id ? p : x)),
          workspaceId: p.workspaceId,
          lastFetchedAt: Date.now(),
        }));
        return p;
      },

      deleteProject: async (id, workspaceId) => {
        await deleteProjectApi(id, workspaceId);
        set((st) => ({
          projects: st.projects.filter((x) => x.id !== id),
          workspaceId,
          lastFetchedAt: Date.now(),
        }));
      },

      applyRemote: (project) => {
        set((st) => {
          const exists = st.projects.find((x) => x.id === project.id);
          if (exists) {
            return {
              projects: st.projects.map((x) => (x.id === project.id ? project : x)),
              workspaceId: project.workspaceId,
              lastFetchedAt: Date.now(),
            };
          }
          return {
            projects: [...st.projects, project],
            workspaceId: project.workspaceId,
            lastFetchedAt: Date.now(),
          };
        });
      },

      removeLocal: (id) => {
        set((st) => ({
          projects: st.projects.filter((x) => x.id !== id),
          lastFetchedAt: Date.now(),
        }));
      },
    }),
    {
      name: "quicknote.scheduler.cache.projects.v1",
      storage: createJSONStorage(() => zustandStorage),
      // 휘발성 상태(loading)는 제외하고 데이터 배열과 workspaceId만 저장
      partialize: (st) => ({
        projects: st.projects,
        workspaceId: st.workspaceId,
        lastFetchedAt: st.lastFetchedAt,
      }),
    },
  ),
);
