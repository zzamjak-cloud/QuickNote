import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Member } from "./memberStore";

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

      setOrganizations: (organizations, workspaceId) => set((state) => ({
        organizations: organizations.map(normalizeOrganization),
        cacheWorkspaceId: workspaceId ?? state.cacheWorkspaceId,
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

      clear: () => set({ organizations: [], cacheWorkspaceId: null }),
    }),
    {
      name: "quicknote.organizations.cache.v1",
      partialize: (state) => ({
        organizations: state.organizations,
        cacheWorkspaceId: state.cacheWorkspaceId,
      }),
    },
  ),
);
