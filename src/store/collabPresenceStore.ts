import { create } from "zustand";

/** 현재 페이지의 원격 접속자 1명. memberId 가 있으면 표시상 dedupe 기준. */
export type RemoteUser = {
  clientId: number;
  memberId?: string;
  name: string;
  color: string;
  avatarUrl?: string | null;
};

type CollabPresenceState = {
  users: RemoteUser[];
  setUsers: (users: RemoteUser[]) => void;
  clear: () => void;
};

// Editor(useCollabPresence) 가 publish, TopBar(CollabPresenceAvatars) 가 구독하는 단방향 브리지.
export const useCollabPresenceStore = create<CollabPresenceState>((set) => ({
  users: [],
  setUsers: (users) => set({ users }),
  clear: () => set({ users: [] }),
}));
