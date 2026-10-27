import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminOrganizationsTab } from "../AdminOrganizationsTab";
import { useOrganizationStore } from "../../../store/organizationStore";

const archiveOrganizationApiMock = vi.fn();

vi.mock("../../../lib/sync/organizationApi", () => ({
  archiveOrganizationApi: (id: string) => archiveOrganizationApiMock(id),
  assignMemberToOrganizationApi: vi.fn(),
  createOrganizationApi: vi.fn(),
  deleteOrganizationApi: vi.fn(),
  restoreOrganizationApi: vi.fn(),
  unassignMemberFromOrganizationApi: vi.fn(),
  updateOrganizationApi: vi.fn(),
}));

describe("AdminOrganizationsTab 일괄 선택", () => {
  beforeEach(() => {
    archiveOrganizationApiMock.mockReset();
    useOrganizationStore.setState({
      organizations: [
        { organizationId: "o1", name: "개발실", leaderMemberIds: [], members: [] },
        { organizationId: "o2", name: "아트실", leaderMemberIds: [], members: [] },
      ],
    });
  });

  it("검색으로 가려진 조직은 제외하고 선택한 조직만 보관함 이동", async () => {
    archiveOrganizationApiMock.mockImplementation((id: string) =>
      Promise.resolve({ organizationId: id, name: "개발실", leaderMemberIds: [], members: [], removedAt: "2026-10-27T00:00:00.000Z" }),
    );
    render(<AdminOrganizationsTab />);

    fireEvent.click(screen.getByRole("checkbox", { name: "전체 선택" }));
    fireEvent.change(screen.getByPlaceholderText("조직 검색"), { target: { value: "개발" } });
    fireEvent.click(screen.getByRole("button", { name: "선택한 1개 보관함 이동" }));
    fireEvent.click(screen.getByRole("button", { name: "보관함 이동" }));

    await waitFor(() => expect(archiveOrganizationApiMock).toHaveBeenCalledTimes(1));
    expect(archiveOrganizationApiMock).toHaveBeenCalledWith("o1");
  });
});
