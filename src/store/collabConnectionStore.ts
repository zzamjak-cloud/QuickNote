import { create } from "zustand";
import type { BadgeStatus } from "../lib/collab/collabConnectionStatus";

// "idle" = 협업 비활성(배지 미표시). 그 외는 toBadgeStatus 결과.
export type CollabConnectionState = {
  status: BadgeStatus | "idle";
  setStatus: (status: BadgeStatus | "idle") => void;
};

// useCollabSession 이 publish, TopBar(CollabConnectionBadge) 가 구독하는 단방향 브리지.
export const useCollabConnectionStore = create<CollabConnectionState>((set) => ({
  status: "idle",
  setStatus: (status) => set({ status }),
}));
