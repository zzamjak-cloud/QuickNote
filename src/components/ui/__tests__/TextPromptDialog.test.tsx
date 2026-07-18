import { act, render, screen } from "@testing-library/react";
import { TextPromptDialog } from "../TextPromptDialog";
import { useUiStore } from "../../../store/uiStore";

describe("TextPromptDialog", () => {
  afterEach(() => {
    act(() => {
      useUiStore.getState().completeTextPrompt(null);
    });
  });

  it("텍스트 선택 툴바보다 높은 z-index 계층에 렌더링한다", async () => {
    act(() => {
      void useUiStore
        .getState()
        .requestTextPrompt("URL 또는 복사한 블록 링크를 입력하세요", {
          placeholder: "https://…",
        });
    });

    render(<TextPromptDialog />);

    const dialog = await screen.findByRole("dialog");
    const overlay = dialog.parentElement;
    expect(overlay).toHaveClass("z-[900]");
  });
});
