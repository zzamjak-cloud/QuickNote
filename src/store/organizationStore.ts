import { create } from "zustand";
import type { Member } from "./memberStore";

/** 조직(실) 엔티티 */
export type Organization = {
  organizationId: string;
  name: string;
  members: Member[];
  createdAt?: string;
  removedAt?: string;
};

type OrganizationStoreState = {
  organizations: Organization[];
};

type OrganizationStoreActions = {
  setOrganizations: (orgs: Organization[]) => void;
  upsertOrganization: (org: Organization) => void;
  removeOrganization: (organizationId: string) => void;
  getOrganizationMembers: (organizationId: string) => Member[];
  clear: () => void;
};

export type OrganizationStore = OrganizationStoreState & OrganizationStoreActions;

export const useOrganizationStore = create<OrganizationStore>()((set, get) => ({
  organizations: [],

  setOrganizations: (organizations) => set({ organizations }),

  upsertOrganization: (org) =>
    set((state) => {
      const exists = state.organizations.some((o) => o.organizationId === org.organizationId);
      return {
        organizations: exists
          ? state.organizations.map((o) => (o.organizationId === org.organizationId ? org : o))
          : [...state.organizations, org],
      };
    }),

  removeOrganization: (organizationId) =>
    set((state) => ({
      organizations: state.organizations.filter((o) => o.organizationId !== organizationId),
    })),

  getOrganizationMembers: (organizationId) =>
    get().organizations.find((o) => o.organizationId === organizationId)?.members ?? [],

  clear: () => set({ organizations: [] }),
}));
