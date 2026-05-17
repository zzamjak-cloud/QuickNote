import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Member } from "./memberStore";

export type Team = {
  teamId: string;
  name: string;
  leaderMemberIds: string[];
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

function normalizeTeam(team: Team): Team {
  return { ...team, leaderMemberIds: team.leaderMemberIds ?? [] };
}

export const useTeamStore = create<TeamStore>()(
  persist(
    (set, get) => ({
      teams: [],
      cacheWorkspaceId: null,

      setTeams: (teams, workspaceId) => set((state) => ({
        teams: teams.map(normalizeTeam),
        cacheWorkspaceId: workspaceId ?? state.cacheWorkspaceId,
      })),

      upsertTeam: (team) =>
        set((state) => {
          const normalized = normalizeTeam(team);
          const exists = state.teams.some((t) => t.teamId === normalized.teamId);
          return {
            teams: exists
              ? state.teams.map((t) => (t.teamId === normalized.teamId ? normalized : t))
              : [...state.teams, normalized],
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
