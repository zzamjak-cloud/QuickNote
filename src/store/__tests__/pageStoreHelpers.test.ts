import { describe, expect, it } from "vitest";
import { makeLCSchedulerDatabaseId } from "../../lib/scheduler/database";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../lib/scheduler/scope";
import type { Page } from "../../types/page";
import { useWorkspaceStore } from "../workspaceStore";
import { toGqlPage } from "../pageStore/helpers";

function page(partial: Partial<Page> = {}): Page {
  return {
    id: partial.id ?? "page-1",
    title: partial.title ?? "일정",
    icon: null,
    doc: { type: "doc", content: [{ type: "paragraph" }] },
    parentId: null,
    order: 1,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...partial,
  };
}

describe("pageStore helpers", () => {
  it("LC 스케줄러 DB 행 페이지는 현재 워크스페이스가 아니라 LC 워크스페이스로 전송한다", () => {
    useWorkspaceStore.setState({ currentWorkspaceId: "personal-ws", workspaces: [] });

    const payload = toGqlPage(
      page({
        databaseId: makeLCSchedulerDatabaseId(LC_SCHEDULER_WORKSPACE_ID),
        dbCells: {},
      }),
      "member-1",
    );

    expect(payload.workspaceId).toBe(LC_SCHEDULER_WORKSPACE_ID);
  });

  it("일반 페이지는 현재 워크스페이스로 전송한다", () => {
    useWorkspaceStore.setState({ currentWorkspaceId: "personal-ws", workspaces: [] });

    const payload = toGqlPage(page(), "member-1");

    expect(payload.workspaceId).toBe("personal-ws");
  });
});
