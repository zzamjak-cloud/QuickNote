import { describe, it, expect } from "vitest";
import { decideDropMode } from "../lib/blockDropMode";

describe("decideDropMode", () => {
  // 기본 임계값 0.2 — 좌·우 가장자리 20% 영역만 컬럼 분할 모드.
  // rect: left=100, width=200 → 좌(100~140), 중앙(140~260), 우(260~300)
  it("좌측 가장자리(<20%)에서는 column-left 반환", () => {
    expect(decideDropMode(100, 200, 110)).toBe("column-left");
    expect(decideDropMode(100, 200, 139)).toBe("column-left");
  });

  it("우측 가장자리(>80%)에서는 column-right 반환", () => {
    expect(decideDropMode(100, 200, 261)).toBe("column-right");
    expect(decideDropMode(100, 200, 295)).toBe("column-right");
  });

  it("중앙 영역에서는 list 반환 — 컬럼 모드와 상호 배타적", () => {
    expect(decideDropMode(100, 200, 150)).toBe("list");
    expect(decideDropMode(100, 200, 200)).toBe("list");
    expect(decideDropMode(100, 200, 250)).toBe("list");
  });

  it("rectWidth 가 0 이하인 비정상 입력은 list 로 안전 처리", () => {
    expect(decideDropMode(0, 0, 50)).toBe("list");
    expect(decideDropMode(0, -10, 50)).toBe("list");
  });

  it("edgeRatio 커스텀: 0.3 이면 좌·우 30% 가 컬럼 모드", () => {
    expect(decideDropMode(0, 100, 25, 0.3)).toBe("column-left");
    expect(decideDropMode(0, 100, 75, 0.3)).toBe("column-right");
    expect(decideDropMode(0, 100, 50, 0.3)).toBe("list");
  });
});
