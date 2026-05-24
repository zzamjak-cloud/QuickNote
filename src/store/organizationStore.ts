import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Member } from "./memberStore";
import { zustandStorage } from "../lib/storage/index";

/** 조직(실) 엔티티 */
export type Organization = {
  organizationId: string;
  name: string;
  leaderMemberIds: string[];
  members: Member[];
  createdAt?: string;
  removedAt?: string;
};

type OrganizationStoreState = {
  organizations: Organization[];
  cacheWorkspaceId: string | null;
  /** 마지막으로 서버에서 페치한 시점(ms). null=미페치 */
  lastFetchedAt: number | null;
};

type OrganizationStoreActions = {
  setOrganizations: (orgs: Organization[], workspaceId?: string | null) => void;
  upsertOrganization: (org: Organization) => void;
  removeOrganization: (organizationId: string) => void;
  getOrganizationMembers: (organizationId: string) => Member[];
  clear: () => void;
};

export type OrganizationStore = OrganizationStoreState & OrganizationStoreActions;

function normalizeOrganization(org: Organization): Organization {
  return { ...org, leaderMemberIds: org.leaderMemberIds ?? [] };
}

export const useOrganizationStore = create<OrganizationStore>()(
  persist(
    (set, get) => ({
      organizations: [],
      cacheWorkspaceId: null,
      lastFetchedAt: null,

      setOrganizations: (organizations, workspaceId) => set((state) => ({
        organizations: organizations.map(normalizeOrganization),
        cacheWorkspaceId: workspaceId ?? state.cacheWorkspaceId,
        lastFetchedAt: Date.now(),
      })),

      upsertOrganization: (org) =>
        set((state) => {
          const normalized = normalizeOrganization(org);
          const exists = state.organizations.some((o) => o.organizationId === normalized.organizationId);
          return {
            organizations: exists
              ? state.organizations.map((o) => (o.organizationId === normalized.organizationId ? normalized : o))
              : [...state.organizations, normalized],
          };
        }),

      removeOrganization: (organizationId) =>
        set((state) => ({
          organizations: state.organizations.filter((o) => o.organizationId !== organizationId),
        })),

      getOrganizationMembers: (organizationId) =>
        get().organizations.find((o) => o.organizationId === organizationId)?.members ?? [],

      clear: () => set({ organizations: [], cacheWorkspaceId: null, lastFetchedAt: null }),
    }),
    {
      name: "quicknote.organizations.cache.v1",
      storage: createJSONStorage(() => zustandStorage),
      partialize: (state) => ({
        organizations: state.organizations,
        cacheWorkspaceId: state.cacheWorkspaceId,
        lastFetchedAt: state.lastFetchedAt,
      }),
    },
  ),
);
