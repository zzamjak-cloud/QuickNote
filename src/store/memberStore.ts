import { create } from "zustand";

export type MemberRole = "owner" | "manager" | "member";
export type MemberStatus = "active" | "removed";

export type Member = {
  memberId: string;
  email: string;
  name: string;
  jobRole: string;
  workspaceRole: MemberRole;
  status: MemberStatus;
  personalWorkspaceId: string;
};

export type MemberMini = {
  memberId: string;
  name: string;
  jobRole: string;
};

type MemberStoreState = {
  me: Member | null;
  members: Member[];
  mentionCandidates: MemberMini[];
  mentionQuery: string;
};

type MemberStoreActions = {
  setMe: (member: Member | null) => void;
  setMembers: (members: Member[]) => void;
  upsertMember: (member: Member) => void;
  removeMemberFromCache: (memberId: string) => void;
  setMentionCandidates: (query: string, candidates: MemberMini[]) => void;
  clearMentions: () => void;
  clear: () => void;
};

export type MemberStore = MemberStoreState & MemberStoreActions;

export const useMemberStore = create<MemberStore>()((set) => ({
  me: null,
  members: [],
  mentionCandidates: [],
  mentionQuery: "",

  setMe: (member) => set({ me: member }),
  setMembers: (members) => set({ members }),

  upsertMember: (member) =>
    set((state) => {
      const exists = state.members.some((m) => m.memberId === member.memberId);
      return {
        members: exists
          ? state.members.map((m) => (m.memberId === member.memberId ? member : m))
          : [...state.members, member],
        me:
          state.me?.memberId === member.memberId
            ? member
            : state.me,
      };
    }),

  removeMemberFromCache: (memberId) =>
    set((state) => ({
      members: state.members.filter((m) => m.memberId !== memberId),
      me: state.me?.memberId === memberId ? null : state.me,
      mentionCandidates: state.mentionCandidates.filter((m) => m.memberId !== memberId),
    })),

  setMentionCandidates: (query, candidates) =>
    set({
      mentionQuery: query,
      mentionCandidates: candidates,
    }),

  clearMentions: () =>
    set({
      mentionQuery: "",
      mentionCandidates: [],
    }),

  clear: () =>
    set({
      me: null,
      members: [],
      mentionCandidates: [],
      mentionQuery: "",
    }),
}));
