import { create } from "zustand";

// 미디어(이미지·GIF·동영상) 확대 미리보기 오버레이가 열려 있는지 전역 신호.
// 미리보기가 뜨면 부유 미디어 툴바(BubbleToolbar)를 숨겨 오버레이 위에 겹치지 않게 한다.
type MediaPreviewState = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

export const useMediaPreviewStore = create<MediaPreviewState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
