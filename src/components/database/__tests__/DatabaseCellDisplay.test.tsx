import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { ColumnDef } from "../../../types/database";
import { useDatabaseStore } from "../../../store/databaseStore";
import { useMemberStore } from "../../../store/memberStore";
import { usePageStore } from "../../../store/pageStore";
import { DatabaseCellDisplay } from "../DatabaseCellDisplay";

describe("DatabaseCellDisplay", () => {
  beforeEach(() => {
    useDatabaseStore.setState({
      databases: {},
      cacheWorkspaceId: null,
    });
    usePageStore.setState({
      pages: {},
      activePageId: null,
    });
    useMemberStore.setState({
      members: [],
      cacheWorkspaceId: null,
      lastFetchedAt: null,
      mentionCandidates: [],
      mentionQuery: "",
    });
  });

  it("sourceFromDb가 pageLink 값을 가져와도 ID 대신 연결 페이지 제목을 표시한다", () => {
    const mirroredColumn: ColumnDef = {
      id: "mirrored-link",
      name: "연관작업",
      type: "text",
      config: {
        sourceFromDb: {
          databaseId: "source-db",
          columnId: "source-page-link",
          viaPageLinkColumnId: "source-row-link",
        },
      },
    };

    useDatabaseStore.setState({
      databases: {
        "current-db": {
          meta: { id: "current-db", title: "현재 DB", createdAt: 1, updatedAt: 1 },
          columns: [
            { id: "title", name: "이름", type: "title" },
            { id: "source-row-link", name: "소스", type: "pageLink" },
            mirroredColumn,
          ],
          rowPageOrder: ["current-row"],
        },
        "source-db": {
          meta: { id: "source-db", title: "소스 DB", createdAt: 1, updatedAt: 1 },
          columns: [
            { id: "title", name: "이름", type: "title" },
            { id: "source-page-link", name: "연결", type: "pageLink" },
          ],
          rowPageOrder: ["source-row"],
        },
      },
      cacheWorkspaceId: "ws-1",
    });
    usePageStore.setState({
      pages: {
        "current-row": {
          id: "current-row",
          workspaceId: "ws-1",
          title: "현재 행",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 1,
          createdAt: 1,
          updatedAt: 1,
          databaseId: "current-db",
          dbCells: { "source-row-link": ["source-row"] },
        },
        "source-row": {
          id: "source-row",
          workspaceId: "ws-1",
          title: "소스 행",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 2,
          createdAt: 1,
          updatedAt: 1,
          databaseId: "source-db",
          dbCells: { "source-page-link": ["linked-page-id"] },
        },
        "linked-page-id": {
          id: "linked-page-id",
          workspaceId: "ws-1",
          title: "연결된 작업",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 3,
          createdAt: 1,
          updatedAt: 1,
          dbCells: {},
        },
      },
      activePageId: null,
    });

    render(<DatabaseCellDisplay column={mirroredColumn} value={null} rowId="current-row" />);

    expect(screen.queryByText("연결된 작업")).not.toBeNull();
    expect(screen.queryByText("linked-page-id")).toBeNull();
  });

  it("sourceFromDb가 page ID 배열을 가져와도 원본 ID 대신 페이지 제목을 표시한다", () => {
    const mirroredColumn: ColumnDef = {
      id: "mirrored-link-title",
      name: "연관작업",
      type: "text",
      config: {
        sourceFromDb: {
          databaseId: "source-db",
          columnId: "source-text-with-page-id",
          viaPageLinkColumnId: "source-row-link",
        },
      },
    };

    useDatabaseStore.setState({
      databases: {
        "current-db": {
          meta: { id: "current-db", title: "현재 DB", createdAt: 1, updatedAt: 1 },
          columns: [
            { id: "title", name: "이름", type: "title" },
            { id: "source-row-link", name: "소스", type: "pageLink" },
            mirroredColumn,
          ],
          rowPageOrder: ["current-row"],
        },
        "source-db": {
          meta: { id: "source-db", title: "소스 DB", createdAt: 1, updatedAt: 1 },
          columns: [
            { id: "title", name: "이름", type: "title" },
            { id: "source-text-with-page-id", name: "연결", type: "text" },
          ],
          rowPageOrder: ["source-row"],
        },
      },
      cacheWorkspaceId: "ws-1",
    });
    usePageStore.setState({
      pages: {
        "current-row": {
          id: "current-row",
          workspaceId: "ws-1",
          title: "현재 행",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 1,
          createdAt: 1,
          updatedAt: 1,
          databaseId: "current-db",
          dbCells: { "source-row-link": ["source-row"] },
        },
        "source-row": {
          id: "source-row",
          workspaceId: "ws-1",
          title: "소스 행",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 2,
          createdAt: 1,
          updatedAt: 1,
          databaseId: "source-db",
          dbCells: { "source-text-with-page-id": ["linked-page-id"] },
        },
        "linked-page-id": {
          id: "linked-page-id",
          workspaceId: "ws-1",
          title: "연결된 작업",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 3,
          createdAt: 1,
          updatedAt: 1,
          dbCells: {},
        },
      },
      activePageId: null,
    });

    render(<DatabaseCellDisplay column={mirroredColumn} value={null} rowId="current-row" />);

    expect(screen.queryByText("연결된 작업")).not.toBeNull();
    expect(screen.queryByText("linked-page-id")).toBeNull();
  });

  it("일반 표시 컬럼 값이 page ID 배열이면 원본 ID 대신 페이지 제목을 표시한다", () => {
    const column: ColumnDef = {
      id: "linked-text",
      name: "연관작업",
      type: "text",
    };

    usePageStore.setState({
      pages: {
        "linked-page-id": {
          id: "linked-page-id",
          workspaceId: "ws-1",
          title: "연결된 작업",
          icon: null,
          doc: { type: "doc", content: [] },
          parentId: null,
          order: 1,
          createdAt: 1,
          updatedAt: 1,
          dbCells: {},
        },
      },
      activePageId: null,
    });

    render(<DatabaseCellDisplay column={column} value={["linked-page-id"]} />);

    expect(screen.queryByText("연결된 작업")).not.toBeNull();
    expect(screen.queryByText("linked-page-id")).toBeNull();
  });

  it("person 값은 구성원 ID 대신 이름을 표시한다", () => {
    const memberId = "5c3609fc-e169-445b-a6ae-c74154d50b46";
    const column: ColumnDef = {
      id: "assignee",
      name: "담당자",
      type: "person",
    };

    useMemberStore.setState({
      members: [
        {
          memberId,
          email: "member@example.com",
          name: "홍길동",
          jobRole: "개발",
          workspaceRole: "member",
          status: "active",
          personalWorkspaceId: "ws-personal",
        },
      ],
      cacheWorkspaceId: "ws-1",
    });

    render(<DatabaseCellDisplay column={column} value={[memberId]} />);

    expect(screen.queryByText("홍길동")).not.toBeNull();
    expect(screen.queryByText(memberId)).toBeNull();
  });
});
