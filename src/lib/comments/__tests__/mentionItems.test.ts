import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Page } from "../../../types/page";
import { useDatabaseStore } from "../../../store/databaseStore";
import { useMemberStore, type Member } from "../../../store/memberStore";
import { usePageStore } from "../../../store/pageStore";
import { useWorkspaceStore } from "../../../store/workspaceStore";
import { loadMergedMentionItems } from "../mentionItems";

const fetchPagesByWorkspace = vi.fn(async () => []);

vi.mock("../../sync/bootstrap", () => ({
  fetchPagesByWorkspace: (...args: unknown[]) => fetchPagesByWorkspace(...args),
  fetchDatabasesByWorkspace: vi.fn(async () => []),
  fetchDatabaseRowIndexBatch: vi.fn(async () => ({ items: [], nextToken: null })),
}));

vi.mock("../../../lib/storage/index", () => {
  const noopStorage = {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  };
  return {
    zustandStorage: noopStorage,
    deferredPageStorage: noopStorage,
    deferredDatabaseStorage: noopStorage,
    makeDeferredStorage: () => noopStorage,
    pauseStorageWrites: vi.fn(),
    resumeStorageWrites: vi.fn(),
  };
});

vi.mock("../../sync/memberApi", () => ({
  searchMembersForMentionApi: vi.fn(async () => []),
}));

function member(partial: Partial<Member> & { memberId: string; name: string }): Member {
  return {
    memberId: partial.memberId,
    email: partial.email ?? `${partial.memberId}@example.com`,
    name: partial.name,
    jobRole: partial.jobRole ?? "Engineer",
    workspaceRole: partial.workspaceRole ?? "member",
    status: partial.status ?? "active",
    personalWorkspaceId: partial.personalWorkspaceId ?? `ws-${partial.memberId}`,
  };
}

function page(partial: Partial<Page> & { id: string; title: string }): Page & { deletedAt?: string | null } {
  return {
    id: partial.id,
    title: partial.title,
    icon: partial.icon ?? null,
    doc: partial.doc ?? { type: "doc", content: [] },
    parentId: partial.parentId ?? null,
    order: partial.order ?? 0,
    createdAt: partial.createdAt ?? 1,
    updatedAt: partial.updatedAt ?? 1,
  };
}

describe("loadMergedMentionItems", () => {
  beforeEach(() => {
    useMemberStore.getState().clear();
    usePageStore.setState({ pages: {}, activePageId: null });
    useDatabaseStore.setState({ databases: {} });
    useWorkspaceStore.setState({ currentWorkspaceId: null, workspaces: [] });
    fetchPagesByWorkspace.mockReset();
    fetchPagesByWorkspace.mockResolvedValue([]);
  });

  it("삭제된 페이지와 보관된 구성원을 멘션 후보에서 제외한다", async () => {
    useMemberStore.getState().setMembers([
      member({ memberId: "m-active", name: "Alice", status: "active" }),
      member({ memberId: "m-removed", name: "Aaron", status: "removed" }),
    ]);
    const activePage = page({ id: "p-active", title: "Alpha" });
    const deletedPage = {
      ...page({ id: "p-deleted", title: "Archived Alpha" }),
      deletedAt: "2026-05-20T00:00:00.000Z",
    };
    usePageStore.setState({
      pages: {
        [activePage.id]: activePage,
        [deletedPage.id]: deletedPage,
      },
    });

    const rows = await loadMergedMentionItems("a", 20);
    expect(rows.map((row) => row.id)).toContain("m:m-active");
    expect(rows.map((row) => row.id)).toContain("p:p-active");
    expect(rows.map((row) => row.id)).not.toContain("m:m-removed");
    expect(rows.map((row) => row.id)).not.toContain("p:p-deleted");
  });

  it("데이터베이스는 멘션 후보에 포함하지 않는다", async () => {
    useDatabaseStore.setState({
      databases: {
        "db-alpha": {
          meta: { id: "db-alpha", title: "Alpha Database", createdAt: 1, updatedAt: 1 },
          columns: [],
          rowPageOrder: [],
        },
      },
    });

    const rows = await loadMergedMentionItems("Alpha", 20);

    expect(rows.map((row) => row.label)).not.toContain("Alpha Database");
  });

  it("다른 공개 워크스페이스의 페이지도 멘션 후보에 포함한다", async () => {
    useWorkspaceStore.setState({
      currentWorkspaceId: "ws-a",
      workspaces: [
        {
          workspaceId: "ws-a",
          name: "현재",
          type: "shared",
          ownerMemberId: "m-1",
          myEffectiveLevel: "edit",
          access: [{ subjectType: "everyone", subjectId: null, level: "edit" }],
        },
        {
          workspaceId: "ws-b",
          name: "공개",
          type: "shared",
          ownerMemberId: "m-1",
          myEffectiveLevel: "view",
          access: [{ subjectType: "everyone", subjectId: null, level: "view" }],
        },
      ],
    });
    usePageStore.setState({
      pages: { "p-local": { ...page({ id: "p-local", title: "로컬알파" }), workspaceId: "ws-a" } },
    });
    fetchPagesByWorkspace.mockImplementation(async (workspaceId: string) =>
      workspaceId === "ws-b"
        ? [
            {
              id: "ext-1",
              workspaceId: "ws-b",
              title: "외부알파",
              createdAt: "2026-06-17T00:00:00.000Z",
              updatedAt: "2026-06-17T00:00:00.000Z",
              createdByMemberId: "m-1",
            },
          ]
        : [],
    );

    const rows = await loadMergedMentionItems("알파", 20);
    expect(rows.map((row) => row.id)).toContain("p:ext-1");
    expect(rows.map((row) => row.id)).toContain("p:p-local");
  });
});
