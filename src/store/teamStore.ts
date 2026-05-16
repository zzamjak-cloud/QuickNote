import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Member } from "./memberStore";

export type Team = {
  teamId: string;
  name: string;
  members: Member[];
  createdAt?: string;
  removedAt?: string;
};

type TeamStoreState = {
  teams: Team[];
  cacheWorkspaceId: string | null;
};

type TeamStoreActions = {
  setTeams: (teams: Team[], workspaceId?: string | null) => void;
  upsertTeam: (team: Team) => void;
  removeTeam: (teamId: string) => void;
  getTeamMembers: (teamId: string) => Member[];
  clear: () => void;
};

export type TeamStore = TeamStoreState & TeamStoreActions;

export const useTeamStore = create<TeamStore>()(
  persist(
    (set, get) => ({
      teams: [],
      cacheWorkspaceId: null,

      setTeams: (teams, workspaceId) => set((state) => ({
        teams,
        cacheWorkspaceId: workspaceId ?? state.cacheWorkspaceId,
      })),

      upsertTeam: (team) =>
        set((state) => {
          const exists = state.teams.some((t) => t.teamId === team.teamId);
          return {
            teams: exists
              ? state.teams.map((t) => (t.teamId === team.teamId ? team : t))
              : [...state.teams, team],
          };
        }),

      removeTeam: (teamId) =>
        set((state) => ({ teams: state.teams.filter((t) => t.teamId !== teamId) })),

      getTeamMembers: (teamId) =>
        get().teams.find((t) => t.teamId === teamId)?.members ?? [],

      clear: () => set({ teams: [], cacheWorkspaceId: null }),
    }),
    {
      name: "quicknote.teams.cache.v1",
      partialize: (state) => ({
        teams: state.teams,
        cacheWorkspaceId: state.cacheWorkspaceId,
      }),
    },
  ),
);
