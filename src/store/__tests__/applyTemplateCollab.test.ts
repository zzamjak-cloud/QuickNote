import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  registerDbCollab,
  unregisterDbCollab,
} from "../../lib/collab/dbCollabRegistry";
import {
  readDbStructure,
  seedDbStructure,
} from "../../lib/collab/dbBundleYjs";
import { useDatabaseStore } from "../databaseStore";
import { usePageStore } from "../pageStore";
import { useWorkspaceStore } from "../workspaceStore";

const { enqueueAsync } = vi.hoisted(() => ({ enqueueAsync: vi.fn() }));

vi.mock("../../lib/sync/runtime", () => ({ enqueueAsync }));

describe("템플릿 적용 행의 협업 셀 원자 저장", () => {
  beforeEach(() => {
    enqueueAsync.mockClear();
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-1" });
    usePageStore.setState({
      pages: {
        "template-page": {
          id: "template-page",
          workspaceId: "ws-1",
          title: "면접 템플릿",
          icon: null,
          doc: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "면접 기록" }],
              },
            ],
          },
          contentLoaded: true,
          parentId: null,
          order: 1,
          databaseId: "db-1",
          dbCells: { _qn_isTemplate: "1", status: "interview" },
          createdAt: 1,
          updatedAt: 1,
        },
      },
      activePageId: null,
      cacheWorkspaceId: "ws-1",
    });
    useDatabaseStore.setState({
      databases: {
        "db-1": {
          meta: {
            id: "db-1",
            workspaceId: "ws-1",
            title: "면접 DB",
            createdAt: 1,
            updatedAt: 1,
          },
          columns: [
            { id: "title", name: "이름", type: "title" },
            {
              id: "status",
              name: "상태",
              type: "status",
              config: {
                options: [{ id: "default", label: "대기" }],
              },
            },
          ],
          presets: [],
          panelState: {},
          rowPageOrder: [],
        },
      },
      dbTemplates: {
        "db-1": [
          {
            id: "template-1",
            title: "면접 템플릿",
            cells: { status: "interview" },
            pageId: "template-page",
          },
        ],
      },
      cacheWorkspaceId: "ws-1",
    });
  });

  afterEach(() => {
    unregisterDbCollab("db-1");
  });

  it("생성 시점부터 셀을 Y rows와 페이지 durable payload에 함께 포함한다", async () => {
    const doc = new Y.Doc();
    seedDbStructure(doc, {
      columns: useDatabaseStore.getState().databases["db-1"]!.columns,
      presets: [],
      panelState: {},
      rowPageOrder: [],
      rows: {},
      rowMembers: [],
    });
    registerDbCollab("db-1", {
      doc,
      baseline: readDbStructure(doc),
    });

    const pageId = useDatabaseStore
      .getState()
      .applyTemplate("db-1", "template-1");

    expect(usePageStore.getState().pages[pageId]?.dbCells).toMatchObject({
      status: "interview",
    });
    expect(usePageStore.getState().pages[pageId]?.dbCells).not.toHaveProperty(
      "_qn_isTemplate",
    );
    expect(readDbStructure(doc).rows[pageId]).toMatchObject({
      status: "interview",
    });

    await Promise.resolve();
    const pagePayloads = enqueueAsync.mock.calls
      .filter(([kind, payload]) => kind === "upsertPage" && payload.id === pageId)
      .map(([, payload]) => payload as Record<string, unknown>);
    expect(pagePayloads).toHaveLength(2);
    // 협업 활성 상태의 createPage 초기 upsert는 셀을 제외하지만, 최종 템플릿 payload가
    // 같은 dedupe key에 반드시 나중에 들어가 doc과 cells를 함께 보존해야 한다.
    expect(pagePayloads[0]?.dbCells).toBeNull();
    const finalPayload = pagePayloads.at(-1);
    expect(JSON.parse(String(finalPayload?.dbCells))).toMatchObject({
      status: "interview",
    });
    expect(JSON.parse(String(finalPayload?.doc))).toMatchObject({
      content: [
        {
          content: [{ text: "면접 기록" }],
        },
      ],
    });
  });
});
