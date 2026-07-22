import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type { DatabaseBundle } from "../../../types/database";
import { registerDbCollab, unregisterDbCollab } from "../../../lib/collab/dbCollabRegistry";
import { readDbStructure, seedDbStructure } from "../../../lib/collab/dbBundleYjs";
import { ensurePageInDatabaseRowOrder } from "../../../lib/sync/storeApply/rowOrder";
import { useDatabaseStore } from "../../databaseStore";
import { usePageStore } from "../../pageStore";
import { useWorkspaceStore } from "../../workspaceStore";

const { enqueueAsync } = vi.hoisted(() => ({ enqueueAsync: vi.fn() }));

vi.mock("../../../lib/sync/runtime", () => ({ enqueueAsync }));

const database: DatabaseBundle = {
  meta: {
    id: "db-1",
    workspaceId: "ws-1",
    title: "작업 DB",
    createdAt: 1,
    updatedAt: 1,
  },
  columns: [{ id: "title", name: "제목", type: "title" }],
  presets: [],
  panelState: {},
  rowPageOrder: [],
};

describe("데이터베이스 템플릿 즉시 동기화", () => {
  beforeEach(() => {
    enqueueAsync.mockClear();
    useWorkspaceStore.setState({ currentWorkspaceId: "ws-1" });
    usePageStore.setState({
      pages: {},
      activePageId: null,
      cacheWorkspaceId: "ws-1",
    });
    useDatabaseStore.setState({
      databases: { "db-1": structuredClone(database) },
      dbTemplates: {},
      cacheWorkspaceId: "ws-1",
    });
  });

  afterEach(() => {
    unregisterDbCollab("db-1");
    vi.restoreAllMocks();
  });

  it("생성 즉시 템플릿 목록에 등록하고 모든 페이지 업서트에 마커를 포함한다", async () => {
    const pageId = useDatabaseStore.getState().addTemplate("db-1");

    expect(useDatabaseStore.getState().dbTemplates["db-1"]).toEqual([
      expect.objectContaining({ pageId, title: "새 템플릿" }),
    ]);
    expect(usePageStore.getState().pages[pageId]?.dbCells?._qn_isTemplate).toBe("1");
    expect(useDatabaseStore.getState().databases["db-1"]?.rowPageOrder).not.toContain(pageId);
    const meta = useDatabaseStore.getState().databases["db-1"]?.meta;
    expect(meta?.updatedAt).toBe(1);
    expect(meta?.templatesUpdatedAt).toBeGreaterThan(meta?.updatedAt ?? 0);

    await Promise.resolve();

    const pagePayloads = enqueueAsync.mock.calls
      .filter(([kind, payload]) => kind === "upsertPage" && payload.id === pageId)
      .map(([, payload]) => payload as Record<string, unknown>);
    expect(pagePayloads.length).toBeGreaterThan(0);
    for (const payload of pagePayloads) {
      expect(JSON.parse(String(payload.dbCells))).toMatchObject({ _qn_isTemplate: "1" });
    }
    const databasePayload = enqueueAsync.mock.calls
      .filter(([kind]) => kind === "upsertDatabase")
      .at(-1)?.[1] as Record<string, unknown> | undefined;
    expect(databasePayload?.templatesUpdatedAt).toBe(
      new Date(meta?.templatesUpdatedAt ?? 0).toISOString(),
    );
  });

  it("구독 순서 때문에 행 목록에 먼저 들어간 템플릿 페이지를 즉시 제거한다", () => {
    const pageId = useDatabaseStore.getState().addTemplate("db-1");
    useDatabaseStore.setState((state) => ({
      databases: {
        ...state.databases,
        "db-1": {
          ...state.databases["db-1"]!,
          rowPageOrder: [pageId],
        },
      },
    }));

    ensurePageInDatabaseRowOrder("db-1", pageId);

    expect(useDatabaseStore.getState().databases["db-1"]?.rowPageOrder).toEqual([]);
  });

  it("템플릿 편집·삭제마다 독립 버전을 올리고 빈 배열 삭제를 즉시 전송한다", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100);
    useDatabaseStore.getState().addTemplate("db-1");
    const templateId = useDatabaseStore.getState().dbTemplates["db-1"]?.[0]?.id;
    expect(templateId).toBeTruthy();

    nowSpy.mockReturnValue(200);
    useDatabaseStore.getState().updateTemplate("db-1", templateId!, { title: "편집됨" });
    expect(useDatabaseStore.getState().databases["db-1"]?.meta).toMatchObject({
      updatedAt: 1,
      templatesUpdatedAt: 200,
    });

    nowSpy.mockReturnValue(300);
    useDatabaseStore.getState().deleteTemplate("db-1", templateId!);
    expect(useDatabaseStore.getState().dbTemplates["db-1"]).toEqual([]);
    expect(useDatabaseStore.getState().databases["db-1"]?.meta).toMatchObject({
      updatedAt: 1,
      templatesUpdatedAt: 300,
    });
    const deletePayload = enqueueAsync.mock.calls
      .filter(([kind]) => kind === "upsertDatabase")
      .at(-1)?.[1] as Record<string, unknown> | undefined;
    expect(deletePayload?.templates).toBe("[]");
    expect(deletePayload?.templatesUpdatedAt).toBe(new Date(300).toISOString());
  });

  it("meta-only 페이지도 dbTemplates의 pageId로 템플릿임을 판별한다", () => {
    useDatabaseStore.setState({
      dbTemplates: {
        "db-1": [
          { id: "template-1", title: "템플릿", cells: {}, pageId: "template-page" },
        ],
      },
      databases: {
        "db-1": { ...structuredClone(database), rowPageOrder: ["template-page"] },
      },
    });
    usePageStore.setState({
      pages: {
        "template-page": {
          id: "template-page",
          workspaceId: "ws-1",
          title: "템플릿",
          icon: null,
          doc: { type: "doc", content: [{ type: "paragraph" }] },
          contentLoaded: false,
          parentId: null,
          order: 1,
          databaseId: "db-1",
          createdAt: 1,
          updatedAt: 1,
        },
      },
    });

    ensurePageInDatabaseRowOrder("db-1", "template-page");

    expect(useDatabaseStore.getState().databases["db-1"]?.rowPageOrder).toEqual([]);
  });

  it("독립 버전이 없는 legacy 캐시의 빈 목록을 협업 materialize가 전송하지 않는다", () => {
    const doc = new Y.Doc();
    seedDbStructure(doc, {
      columns: database.columns,
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

    useDatabaseStore.getState().applyCollabDbStructure("db-1", readDbStructure(doc));

    const materializedPayload = enqueueAsync.mock.calls
      .filter(([kind]) => kind === "upsertDatabase")
      .at(-1)?.[1] as Record<string, unknown> | undefined;
    expect(materializedPayload).toBeDefined();
    expect(materializedPayload).not.toHaveProperty("templates");
    expect(materializedPayload).not.toHaveProperty("templatesUpdatedAt");
  });

  it("협업 DB에서도 templates payload를 서버 업서트에 포함한다", () => {
    const doc = new Y.Doc();
    const collabOnlyColumn = { id: "remote", name: "원격 컬럼", type: "text" } as const;
    seedDbStructure(doc, {
      columns: [...database.columns, collabOnlyColumn],
      presets: [],
      panelState: {},
      rowPageOrder: [],
      rows: {},
      rowMembers: [],
    });
    registerDbCollab("db-1", {
      doc,
      baseline: {
        columns: database.columns,
        presets: [],
        panelState: {},
        rowPageOrder: [],
        rows: {},
        rowMembers: [],
      },
    });

    useDatabaseStore.getState().addTemplate("db-1");

    const directPayload = enqueueAsync.mock.calls
      .filter(([kind]) => kind === "upsertDatabase")
      .at(-1)?.[1] as Record<string, unknown> | undefined;
    expect(JSON.parse(String(directPayload?.columns))).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "remote" })]),
    );
    expect(directPayload?.templates).toEqual(expect.any(String));
    expect(directPayload?.templatesUpdatedAt).toEqual(expect.any(String));
    expect(JSON.parse(String(directPayload?.templates))).toEqual([
      expect.objectContaining({ title: "새 템플릿" }),
    ]);

    useDatabaseStore.getState().applyCollabDbStructure("db-1", readDbStructure(doc));

    const materializedPayload = enqueueAsync.mock.calls
      .filter(([kind]) => kind === "upsertDatabase")
      .at(-1)?.[1] as Record<string, unknown> | undefined;
    expect(JSON.parse(String(materializedPayload?.templates))).toEqual([
      expect.objectContaining({ title: "새 템플릿" }),
    ]);
  });
});
