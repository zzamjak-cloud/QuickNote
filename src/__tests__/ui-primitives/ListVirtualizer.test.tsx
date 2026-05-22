// ListVirtualizer 기본 동작 smoke 테스트.
// jsdom 환경에서 getBoundingClientRect/scroll 동작이 제한적이라
// 본 테스트는 마운트 + 일부 행 렌더 + totalSize 자리 잡힘만 확인.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ListVirtualizer } from "../../lib/ui-primitives/ListVirtualizer";

describe("ListVirtualizer", () => {
  it("count 만큼 가상 영역을 만들고 일부 행만 DOM 에 그린다", () => {
    const { container } = render(
      <ListVirtualizer count={1000} estimateSize={() => 40} overscan={3}>
        {({ index, style }) => (
          <div key={index} style={style} data-testid={`row-${index}`}>
            row {index}
          </div>
        )}
      </ListVirtualizer>,
    );
    // 전체 1000개가 DOM 에 그려져선 안 됨 (가상화 동작 확인)
    const rendered = container.querySelectorAll("[data-testid^=row-]");
    expect(rendered.length).toBeLessThan(1000);
    // 내부 sizer div 는 가상 전체 높이를 미리 잡아 둔다 (1000 * 40 = 40000)
    const sizer = container.querySelector("[style*='height: 40000px']");
    expect(sizer).not.toBeNull();
  });

  it("count=0 에서도 에러 없이 렌더된다", () => {
    const { container } = render(
      <ListVirtualizer count={0} estimateSize={() => 40}>
        {({ index, style }) => (
          <div key={index} style={style}>
            row {index}
          </div>
        )}
      </ListVirtualizer>,
    );
    const rendered = container.querySelectorAll("[data-testid^=row-]");
    expect(rendered.length).toBe(0);
  });
});
