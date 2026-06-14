import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IconPickerPanel } from "../IconPickerPanel";

describe("IconPickerPanel", () => {
  it("단축어 탭에서 지원 키워드를 확인하고 이모지를 선택한다", () => {
    const onPickEmoji = vi.fn();

    render(
      <IconPickerPanel
        onPickEmoji={onPickEmoji}
        onPickLucide={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "단축어" }));
    const shortcutButton = screen.getByRole("button", { name: "✅ :체크 또는 :check" });

    expect(shortcutButton).toBeInTheDocument();
    fireEvent.click(shortcutButton);
    expect(onPickEmoji).toHaveBeenCalledWith("✅");
  });
});
