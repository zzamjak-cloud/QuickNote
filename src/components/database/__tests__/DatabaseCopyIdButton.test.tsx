import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUiStore } from "../../../store/uiStore";
import { DatabaseCopyIdButton } from "../DatabaseCopyIdButton";

describe("DatabaseCopyIdButton", () => {
  const showToast = vi.fn();

  beforeEach(() => {
    showToast.mockReset();
    useUiStore.setState({ showToast });
  });

  it("클릭하면 데이터베이스 ID 를 클립보드에 복사하고 성공 토스트를 띄운다", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<DatabaseCopyIdButton databaseId="db-123" />);
    fireEvent.click(screen.getByRole("button", { name: "데이터베이스 ID 복사" }));

    expect(writeText).toHaveBeenCalledWith("db-123");
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith("데이터베이스 ID 복사 완료!", { kind: "success" }),
    );
  });

  it("클립보드 쓰기가 실패하면 오류 토스트를 띄운다", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });

    render(<DatabaseCopyIdButton databaseId="db-123" />);
    fireEvent.click(screen.getByRole("button", { name: "데이터베이스 ID 복사" }));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith("데이터베이스 ID 복사에 실패했습니다.", { kind: "error" }),
    );
  });

  it("ID 가 비어 있으면 복사하지 않고 오류 토스트를 띄운다", () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });

    render(<DatabaseCopyIdButton databaseId="" />);
    fireEvent.click(screen.getByRole("button", { name: "데이터베이스 ID 복사" }));

    expect(writeText).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("복사할 데이터베이스 ID가 없습니다.", { kind: "error" });
  });
});
