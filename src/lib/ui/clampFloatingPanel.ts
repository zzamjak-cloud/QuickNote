/** 툴팁·댓글 패널 등 앵커 근처 floating UI를 뷰포트 안에 넣는다 */

const MARGIN = 8;

export type ViewportRect = {
  top: number;
  left: number;
  right: number;
  bottom: number;
};

/**
 * 앵커(버튼 등) 기준으로 패널 좌상단 위치 계산.
 * 우선 앵커 오른쪽 → 안 되면 왼쪽 → 좁으면 아래 → 안 되면 위.
 */
export function computeFloatingPanelPosition(options: {
  anchor: ViewportRect;
  panelWidth: number;
  panelHeight: number;
  vw?: number;
  vh?: number;
}): { top: number; left: number } {
  const vw = options.vw ?? (typeof window !== "undefined" ? window.innerWidth : 1024);
  const vh = options.vh ?? (typeof window !== "undefined" ? window.innerHeight : 768);
  const { anchor, panelWidth: pw, panelHeight: ph } = options;

  let left = anchor.right + MARGIN;
  let top = anchor.top;

  const fitsRight = left + pw <= vw - MARGIN;
  if (!fitsRight) {
    left = anchor.left - pw - MARGIN;
  }
  left = Math.min(Math.max(MARGIN, left), vw - MARGIN - pw);

  if (top + ph > vh - MARGIN) {
    top = Math.max(MARGIN, vh - MARGIN - ph);
  }

  // 매우 좁은 화면: 앵커 아래에 가로 중앙에 붙임
  if (pw > vw - 2 * MARGIN) {
    left = MARGIN;
    top = anchor.bottom + MARGIN;
    if (top + ph > vh - MARGIN) {
      top = Math.max(MARGIN, anchor.top - ph - MARGIN);
    }
    top = Math.min(Math.max(MARGIN, top), vh - MARGIN - ph);
  }

  top = Math.min(Math.max(MARGIN, top), Math.max(MARGIN, vh - MARGIN - ph));
  left = Math.min(Math.max(MARGIN, left), Math.max(MARGIN, vw - MARGIN - pw));

  return { top, left };
}

/** 알림 드롭다운: 벨 아래 우측 정렬, 넘치면 위로 띄움 */
export function computeDropdownBelowAnchor(options: {
  anchor: ViewportRect;
  panelWidth: number;
  panelHeight: number;
  vw?: number;
  vh?: number;
}): { top: number; left: number } {
  const vw = options.vw ?? (typeof window !== "undefined" ? window.innerWidth : 1024);
  const vh = options.vh ?? (typeof window !== "undefined" ? window.innerHeight : 768);
  const { anchor, panelWidth: pw, panelHeight: ph } = options;

  let left = anchor.left;
  if (left + pw > vw - MARGIN) left = vw - MARGIN - pw;
  if (left < MARGIN) left = MARGIN;

  let top = anchor.bottom + MARGIN;
  if (top + ph > vh - MARGIN) {
    top = anchor.top - ph - MARGIN;
  }
  if (top < MARGIN) top = MARGIN;
  if (top + ph > vh - MARGIN) {
    top = Math.max(MARGIN, vh - MARGIN - ph);
  }

  return { top, left };
}
