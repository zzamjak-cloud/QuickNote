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

  it("루시드 탭에서 세분화된 카테고리와 전체 목록을 노출한다", () => {
    render(
      <IconPickerPanel
        onPickEmoji={vi.fn()}
        onPickLucide={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "루시드" }));

    // 확장된 테마 카테고리(자연·생활)가 노출된다.
    expect(screen.getByRole("button", { name: "전체" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "자연" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "생활" })).toBeInTheDocument();
  });

  it("이모지 탭에서 세분화된 카테고리(스마일리·사람)를 노출한다", async () => {
    render(
      <IconPickerPanel
        onPickEmoji={vi.fn()}
        onPickLucide={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "이모지" }));

    expect(
      await screen.findByRole("button", { name: "스마일리 & 감정" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "사람 & 신체" }),
    ).toBeInTheDocument();
  });
});
