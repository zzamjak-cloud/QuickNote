import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScrollToTopButton } from "../ScrollToTopButton";

function setWindowScrollY(value: number) {
  Object.defineProperty(window, "scrollY", {
    configurable: true,
    value,
  });
}

describe("ScrollToTopButton", () => {
  beforeEach(() => {
    setWindowScrollY(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("scrollRef가 없으면 window scroll을 기준으로 표시하고 최상단으로 이동한다", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    render(<ScrollToTopButton label="Top으로 이동" />);

    expect(screen.queryByLabelText("Top으로 이동")).toBeNull();

    setWindowScrollY(24);
    fireEvent.scroll(window);

    const button = await screen.findByLabelText("Top으로 이동");
    fireEvent.click(button);

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });
});
