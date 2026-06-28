import { describe, expect, it } from "vitest";
import { reconnectStrategyForGap } from "../offlineGap";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

describe("reconnectStrategyForGap", () => {
  it("짧은 갭(<10분)은 delta", () => {
    expect(reconnectStrategyForGap(0)).toBe("delta");
    expect(reconnectStrategyForGap(5 * MIN)).toBe("delta");
    expect(reconnectStrategyForGap(10 * MIN - 1)).toBe("delta");
  });

  it("10분~24h 갭은 meta-baseline", () => {
    expect(reconnectStrategyForGap(10 * MIN)).toBe("meta-baseline");
    expect(reconnectStrategyForGap(3 * HOUR)).toBe("meta-baseline");
    expect(reconnectStrategyForGap(24 * HOUR - 1)).toBe("meta-baseline");
  });

  it("24h 이상 갭은 full", () => {
    expect(reconnectStrategyForGap(24 * HOUR)).toBe("full");
    expect(reconnectStrategyForGap(72 * HOUR)).toBe("full");
  });
});
