import { create } from "zustand";
import { persist } from "zustand/middleware";

export type MemberRole = "developer" | "owner" | "leader" | "manager" | "member";
export type MemberStatus = "active" | "removed";
/** CSV 상태 컬럼 — 재직 여부 표시 (기존 status 와 별개) */
export type EmploymentStatus = "재직중" | "휴직" | "병가" | "퇴사";

export type Member = {
  memberId: string;
  email: string;
  name: string;
  jobRole: string;
  workspaceRole: MemberRole;
  status: MemberStatus;
  jobTitle?: string;
  phone?: string;
  avatarUrl?: string;
  thumbnailUrl?: string;
  personalWorkspaceId: string;
  /** 재직 상태 (CSV 상태 컬럼) */
  employmentStatus?: EmploymentStatus;
  /** 사번 */
  employeeNumber?: string;
  /** 소속(실) */
  department?: string;
  /** 소속(팀) */
  team?: string;
  /** 직무 카테고리 */
  jobCategory?: string;
  /** 상세직무 */
  jobDetail?: string;
  /** 입사일 (YYYY-MM-DD) */
  joinedAt?: string;
  /** 구성원별 타임라인 행 개수 */
  rowCount?: number;
};

export type MemberMini = {
  memberId: string;
  name: string;
  jobRole: string;
};

type MemberStoreState = {
  me: Member | null;
  members: Member[];
  cacheWorkspaceId: string | null;
  mentionCandidates: MemberMini[];
  mentionQuery: string;
};

type MemberStoreActions = {
  setMe: (member: Member | null) => void;
  setMembers: (members: Member[], workspaceId?: string | null) => void;
  upsertMember: (member: Member) => void;
  removeMemberFromCache: (memberId: string) => void;
  setMentionCandidates: (query: string, candidates: MemberMini[]) => void;
  clearMentions: () => void;
  clear: () => void;
};

export type MemberStore = MemberStoreState & MemberStoreActions;

export const useMemberStore = create<MemberStore>()(
  persist(
    (set) => ({
      me: null,
      members: [],
      cacheWorkspaceId: null,
      mentionCandidates: [],
      mentionQuery: "",

      setMe: (member) => set({ me: member }),
      setMembers: (members, workspaceId) => set((state) => ({
        members,
        cacheWorkspaceId: workspaceId ?? state.cacheWorkspaceId,
      })),

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
          cacheWorkspaceId: null,
          mentionCandidates: [],
          mentionQuery: "",
        }),
    }),
    {
      name: "quicknote.members.cache.v1",
      partialize: (state) => ({
        me: state.me,
        members: state.members,
        cacheWorkspaceId: state.cacheWorkspaceId,
      }),
    },
  ),
);
