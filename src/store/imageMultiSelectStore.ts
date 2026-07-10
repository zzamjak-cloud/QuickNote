// 이미지 다중 선택(Ctrl/Cmd+클릭) — 아웃라인·모서리 라운드 일괄 적용용.
// 선택은 현재 문서 위치(pos) 집합으로 보관하며, 편집·선택 변경 시 즉시 비운다(위치 stale 방지).
import { create } from "zustand";

type ImageMultiSelectState = {
  /** 선택된 이미지 노드 시작 위치들(오름차순, 중복 없음). */
  positions: number[];
  setPositions: (positions: number[]) => void;
  clear: () => void;
};

function normalize(positions: number[]): number[] {
  return [...new Set(positions)].sort((a, b) => a - b);
}

export const useImageMultiSelectStore = create<ImageMultiSelectState>((set) => ({
  positions: [],
  setPositions: (positions) => set({ positions: normalize(positions) }),
  clear: () => set((s) => (s.positions.length ? { positions: [] } : s)),
}));
