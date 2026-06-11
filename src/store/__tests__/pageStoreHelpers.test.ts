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

  it("레거시 LC 스케줄러 DB ID도 전송 시 글로벌 스코프로 정규화한다", () => {
    useWorkspaceStore.setState({ currentWorkspaceId: "personal-ws", workspaces: [] });

    const payload = toGqlPage(
      page({
        databaseId: makeLCSchedulerDatabaseId("legacy-workspace"),
        dbCells: {},
      }),
      "member-1",
    );

    expect(payload.workspaceId).toBe(LC_SCHEDULER_WORKSPACE_ID);
    expect(payload.databaseId).toBe(makeLCSchedulerDatabaseId(LC_SCHEDULER_WORKSPACE_ID));
  });

  it("일반 페이지는 현재 워크스페이스로 전송한다", () => {
    useWorkspaceStore.setState({ currentWorkspaceId: "personal-ws", workspaces: [] });

    const payload = toGqlPage(page(), "member-1");

    expect(payload.workspaceId).toBe("personal-ws");
  });

  it("fullPageDatabaseId 태그가 있으면 페이로드에 실어 보낸다(유령 페이지 방지)", () => {
    useWorkspaceStore.setState({ currentWorkspaceId: "personal-ws", workspaces: [] });

    const payload = toGqlPage(page({ fullPageDatabaseId: "db-1" }), "member-1");

    expect(payload.fullPageDatabaseId).toBe("db-1");
  });

  it("fullPageDatabaseId 가 없으면 키 자체를 보내지 않는다(서버가 기존 태그 보존)", () => {
    useWorkspaceStore.setState({ currentWorkspaceId: "personal-ws", workspaces: [] });

    const payload = toGqlPage(page(), "member-1");

    expect("fullPageDatabaseId" in payload).toBe(false);
  });
});
