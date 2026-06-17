import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isPublicCrossWorkspace,
  loadCrossWorkspacePageCandidates,
} from "../crossWorkspaceSearch";
import type { WorkspaceSummary } from "../../store/workspaceStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { usePageStore } from "../../store/pageStore";

const fetchPagesByWorkspace = vi.fn();

vi.mock("../sync/bootstrap", () => ({
  fetchPagesByWorkspace: (...args: unknown[]) => fetchPagesByWorkspace(...args),
  fetchDatabasesByWorkspace: vi.fn(async () => []),
  fetchDatabaseRowIndexBatch: vi.fn(async () => ({ items: [], nextToken: null })),
}));

function workspace(partial: Partial<WorkspaceSummary>): WorkspaceSummary {
  return {
    workspaceId: partial.workspaceId ?? "ws-public",
    name: partial.name ?? "공개 워크스페이스",
    type: partial.type ?? "shared",
    ownerMemberId: partial.ownerMemberId ?? "member-1",
    myEffectiveLevel: partial.myEffectiveLevel ?? "view",
    access: partial.access ?? [{ subjectType: "everyone", subjectId: null, level: "view" }],
    removedAt: partial.removedAt,
  };
}

describe("isPublicCrossWorkspace", () => {
  it("everyone 접근이 열린 공유 워크스페이스만 공개 연결 후보로 본다", () => {
    expect(isPublicCrossWorkspace(workspace({}))).toBe(true);
    expect(
      isPublicCrossWorkspace(
        workspace({
          access: [{ subjectType: "team", subjectId: "team-1", level: "view" }],
        }),
      ),
    ).toBe(false);
    expect(isPublicCrossWorkspace(workspace({ type: "personal" }))).toBe(false);
    expect(isPublicCrossWorkspace(workspace({ removedAt: "2026-06-17T00:00:00.000Z" }))).toBe(false);
  });
});

describe("loadCrossWorkspacePageCandidates 복원력", () => {
  beforeEach(() => {
    fetchPagesByWorkspace.mockReset();
    usePageStore.setState({ pages: {} });
  });

  it("외부 워크스페이스 한 곳이 실패해도 로컬·성공한 외부 후보는 유지된다", async () => {
    useWorkspaceStore.setState({
      currentWorkspaceId: "ws-current",
      workspaces: [
        workspace({ workspaceId: "ws-current" }),
        workspace({ workspaceId: "ws-ok" }),
        workspace({ workspaceId: "ws-fail" }),
      ],
    });
    usePageStore.setState({
      pages: {
        "local-1": {
          id: "local-1",
          workspaceId: "ws-current",
          title: "로컬 페이지",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 0,
          createdAt: 0,
          updatedAt: 0,
        },
      },
    });

    fetchPagesByWorkspace.mockImplementation(async (workspaceId: string) => {
      if (workspaceId === "ws-fail") throw new Error("권한 없음");
      if (workspaceId === "ws-ok") {
        return [
          {
            id: "ext-1",
            workspaceId: "ws-ok",
            title: "외부 페이지",
            createdAt: "2026-06-17T00:00:00.000Z",
            updatedAt: "2026-06-17T00:00:00.000Z",
            createdByMemberId: "m-1",
          },
        ];
      }
      return [];
    });

    const pages = await loadCrossWorkspacePageCandidates();
    const ids = pages.map((p) => p.id);
    expect(ids).toContain("local-1");
    expect(ids).toContain("ext-1");
  });
});
