import { beforeEach, describe, expect, it, vi } from "vitest";
import { pushSharedBlockApi } from "../sharedBlockApi";
import type { SharedBlockRecord } from "../../../types/sharedBlock";

const mocks = vi.hoisted(() => ({ graphql: vi.fn() }));

vi.mock("../graphql/client", () => ({
  appsyncClient: () => ({ graphql: mocks.graphql }),
}));

describe("pushSharedBlockApi", () => {
  beforeEach(() => {
    mocks.graphql.mockReset();
  });

  it("서버 LWW 승자 레코드를 호출자에게 반환한다", async () => {
    const local: SharedBlockRecord = {
      id: "shared-1",
      workspaceId: "workspace-1",
      kind: "dropdown-menu",
      data: {
        kind: "dropdown-menu",
        items: [{ id: "local", label: "로컬", pageId: "page-local" }],
      },
      updatedAt: Date.parse("2026-07-18T00:00:00.000Z"),
      deletedAt: null,
    };
    mocks.graphql.mockResolvedValue({
      data: {
        upsertSharedBlock: {
          id: local.id,
          workspaceId: local.workspaceId,
          kind: local.kind,
          data: JSON.stringify({
            kind: "dropdown-menu",
            items: [{ id: "server", label: "서버 승자", pageId: "page-server" }],
          }),
          createdAt: "2026-07-17T00:00:00.000Z",
          updatedAt: "2026-07-18T00:00:01.000Z",
          deletedAt: null,
        },
      },
    });

    const winner = await pushSharedBlockApi(local);

    expect(winner?.updatedAt).toBe(Date.parse("2026-07-18T00:00:01.000Z"));
    expect(winner?.data).toMatchObject({
      items: [{ label: "서버 승자" }],
    });
  });

  it("서버 저장 실패를 null로 반환한다", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.graphql.mockRejectedValue(new Error("network"));
    await expect(pushSharedBlockApi({
      id: "shared-1",
      workspaceId: "workspace-1",
      kind: "gallery",
      data: { kind: "gallery", images: [], intervalMs: 5_000 },
      updatedAt: Date.now(),
      deletedAt: null,
    })).resolves.toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("이중 인코딩된 갤러리 AWSJSON 응답도 서버 승자로 복원한다", async () => {
    const local: SharedBlockRecord = {
      id: "shared-gallery",
      workspaceId: "workspace-1",
      kind: "gallery",
      data: { kind: "gallery", images: [], intervalMs: 5_000 },
      updatedAt: Date.parse("2026-07-18T00:00:00.000Z"),
      deletedAt: null,
    };
    const serverData = {
      kind: "gallery" as const,
      images: [
        {
          id: "banner-1",
          src: "quicknote-image://asset-banner-1",
          alt: "배너 1",
        },
      ],
      intervalMs: 5_000,
    };
    mocks.graphql.mockResolvedValue({
      data: {
        upsertSharedBlock: {
          id: local.id,
          workspaceId: local.workspaceId,
          kind: local.kind,
          data: JSON.stringify(JSON.stringify(serverData)),
          createdAt: "2026-07-18T00:00:00.000Z",
          updatedAt: "2026-07-18T00:00:01.000Z",
          deletedAt: null,
        },
      },
    });

    const winner = await pushSharedBlockApi(local);

    expect(winner?.data).toEqual(serverData);
  });
});
