import { create } from "zustand";
import type { Member } from "./memberStore";

export type Team = {
  teamId: string;
  name: string;
  members: Member[];
  createdAt?: string;
};

type TeamStoreState = {
  teams: Team[];
};

type TeamStoreActions = {
  setTeams: (teams: Team[]) => void;
  upsertTeam: (team: Team) => void;
  removeTeam: (teamId: string) => void;
  getTeamMembers: (teamId: string) => Member[];
  clear: () => void;
};

export type TeamStore = TeamStoreState & TeamStoreActions;

export const useTeamStore = create<TeamStore>()((set, get) => ({
  teams: [],

  setTeams: (teams) => set({ teams }),

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

  clear: () => set({ teams: [] }),
}));
