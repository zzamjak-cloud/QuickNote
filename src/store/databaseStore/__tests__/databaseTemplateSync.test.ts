import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type { DatabaseBundle } from "../../../types/database";
import type { Page } from "../../../types/page";
import { registerDbCollab, unregisterDbCollab } from "../../../lib/collab/dbCollabRegistry";
import { readDbStructure, seedDbStructure } from "../../../lib/collab/dbBundleYjs";
import { ensurePageInDatabaseRowOrder } from "../../../lib/sync/storeApply/rowOrder";
import {
  applyRemoteDatabaseToStore,
  applyRemoteDatabasesToStore,
  applyRemotePageMetasToStore,
  applyRemotePagesToStore,
  applyRemotePageToStore,
} from "../../../lib/sync/storeApply";
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

function remoteTemplatePage(pageId = "orphan-template-page") {
  return {
    id: pageId,
    workspaceId: "ws-1",
    title: "복구 템플릿",
    icon: null,
    doc: JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "보존할 본문" }] }],
    }),
    parentId: null,
    order: 1,
    databaseId: "db-1",
    dbCells: JSON.stringify({ _qn_isTemplate: "1", status: "todo" }),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    deletedAt: null,
  };
}

function remoteDatabaseSnapshot() {
  return {
    id: "db-1",
    workspaceId: "ws-1",
    title: "작업 DB",
    columns: JSON.stringify(database.columns),
    presets: "[]",
    panelState: "{}",
    templates: "[]",
    templatesUpdatedAt: "2026-01-01T00:00:01.500Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:02.000Z",
    deletedAt: null,
  };
}

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

  it("템플릿 페이지 제목 변경을 템플릿 목록과 서버 payload에 즉시 반영한다", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100);
    const pageId = useDatabaseStore.getState().addTemplate("db-1");

    nowSpy.mockReturnValue(200);
    expect(usePageStore.getState().renamePage(pageId, "주간 회고")).toBe(true);

    expect(useDatabaseStore.getState().dbTemplates["db-1"]?.[0]).toMatchObject({
      pageId,
      title: "주간 회고",
    });
    expect(useDatabaseStore.getState().databases["db-1"]?.meta).toMatchObject({
      updatedAt: 1,
      templatesUpdatedAt: 200,
    });
    const databasePayload = enqueueAsync.mock.calls
      .filter(([kind]) => kind === "upsertDatabase")
      .at(-1)?.[1] as Record<string, unknown> | undefined;
    expect(databasePayload?.templatesUpdatedAt).toBe(new Date(200).toISOString());
    expect(JSON.parse(String(databasePayload?.templates))).toEqual([
      expect.objectContaining({ pageId, title: "주간 회고" }),
    ]);
  });

  it("full page의 orphan 템플릿 마커를 기존 registry와 본문을 보존해 복원한다", () => {
    vi.spyOn(Date, "now").mockReturnValue(500);
    const existingTemplate = {
      id: "existing",
      title: "기존 템플릿",
      cells: {},
      pageId: "existing-page",
    };
    useDatabaseStore.setState({
      databases: {
        "db-1": {
          ...structuredClone(database),
          rowPageOrder: ["orphan-template-page", "second-orphan-template-page"],
        },
      },
      dbTemplates: {
        "db-1": [existingTemplate],
      },
    });

    applyRemotePagesToStore([
      remoteTemplatePage(),
      { ...remoteTemplatePage("second-orphan-template-page"), title: "두 번째 복구 템플릿" },
    ]);
    expect(useDatabaseStore.getState().dbTemplates["db-1"]).toEqual([existingTemplate]);

    const remoteDatabase = {
      ...remoteDatabaseSnapshot(),
      templates: JSON.stringify([existingTemplate]),
    };
    applyRemoteDatabaseToStore(remoteDatabase);
    applyRemoteDatabaseToStore(remoteDatabase);

    const templates = useDatabaseStore.getState().dbTemplates["db-1"] ?? [];
    expect(templates).toHaveLength(3);
    expect(templates[0]).toEqual(existingTemplate);
    expect(templates[1]).toEqual({
      id: "recovered-template:orphan-template-page",
      title: "복구 템플릿",
      cells: {},
      pageId: "orphan-template-page",
    });
    expect(templates[2]).toEqual({
      id: "recovered-template:second-orphan-template-page",
      title: "두 번째 복구 템플릿",
      cells: {},
      pageId: "second-orphan-template-page",
    });
    expect(
      useDatabaseStore.getState().databases["db-1"]?.meta.templatesUpdatedAt,
    ).toBeGreaterThan(Date.parse(remoteDatabase.templatesUpdatedAt));
    expect(useDatabaseStore.getState().databases["db-1"]?.meta.updatedAt).toBe(
      Date.parse(remoteDatabase.updatedAt),
    );
    expect(usePageStore.getState().pages["orphan-template-page"]?.doc).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "보존할 본문" }] }],
    });
    expect(useDatabaseStore.getState().databases["db-1"]?.rowPageOrder).toEqual([]);
    const databaseUpserts = enqueueAsync.mock.calls.filter(
      ([kind]) => kind === "upsertDatabase",
    );
    expect(databaseUpserts).toHaveLength(1);
    const databasePayload = databaseUpserts[0]?.[1] as Record<string, unknown> | undefined;
    expect(JSON.parse(String(databasePayload?.templates))).toEqual([
      expect.objectContaining({ pageId: "existing-page" }),
      expect.objectContaining({ pageId: "orphan-template-page", title: "복구 템플릿" }),
      expect.objectContaining({
        pageId: "second-orphan-template-page",
        title: "두 번째 복구 템플릿",
      }),
    ]);
  });

  it("meta-only 이벤트에서는 기다렸다가 full page 로드 후 orphan을 복원한다", () => {
    vi.spyOn(Date, "now").mockReturnValue(600);
    const fullPage = remoteTemplatePage("meta-first-template-page");
    applyRemotePageMetasToStore([
      {
        id: fullPage.id,
        workspaceId: fullPage.workspaceId,
        title: fullPage.title,
        icon: fullPage.icon,
        parentId: fullPage.parentId,
        order: fullPage.order,
        databaseId: fullPage.databaseId,
        createdAt: fullPage.createdAt,
        updatedAt: fullPage.updatedAt,
        deletedAt: fullPage.deletedAt,
      },
    ]);

    expect(useDatabaseStore.getState().dbTemplates["db-1"]).toBeUndefined();
    expect(useDatabaseStore.getState().databases["db-1"]?.rowPageOrder).toEqual([
      "meta-first-template-page",
    ]);

    applyRemoteDatabaseToStore(remoteDatabaseSnapshot());
    expect(useDatabaseStore.getState().dbTemplates["db-1"]).toEqual([]);

    applyRemotePageToStore(fullPage);

    expect(useDatabaseStore.getState().dbTemplates["db-1"]).toEqual([
      expect.objectContaining({ pageId: "meta-first-template-page" }),
    ]);
    expect(useDatabaseStore.getState().databases["db-1"]?.rowPageOrder).toEqual([]);
  });

  it("full page가 DB snapshot보다 먼저 도착해도 DB 적용 시 orphan을 복원한다", () => {
    vi.spyOn(Date, "now").mockReturnValue(700);
    useDatabaseStore.setState({ databases: {}, dbTemplates: {} });

    applyRemotePageToStore(remoteTemplatePage("page-first-template-page"));
    expect(useDatabaseStore.getState().dbTemplates["db-1"]).toBeUndefined();

    const remoteDatabase = remoteDatabaseSnapshot();
    applyRemoteDatabaseToStore(remoteDatabase);

    expect(useDatabaseStore.getState().dbTemplates["db-1"]).toEqual([
      expect.objectContaining({ pageId: "page-first-template-page", title: "복구 템플릿" }),
    ]);
    expect(
      useDatabaseStore.getState().databases["db-1"]?.meta.templatesUpdatedAt,
    ).toBeGreaterThan(Date.parse(remoteDatabase.templatesUpdatedAt));
  });

  it("legacy persist에 삭제 표시가 남은 full marker는 orphan으로 복원하지 않는다", () => {
    usePageStore.setState({
      pages: {
        "deleted-template-page": {
          id: "deleted-template-page",
          workspaceId: "ws-1",
          title: "삭제된 템플릿",
          icon: null,
          doc: { type: "doc", content: [{ type: "paragraph" }] },
          contentLoaded: true,
          parentId: null,
          order: 1,
          databaseId: "db-1",
          dbCells: { _qn_isTemplate: "1" },
          createdAt: 1,
          updatedAt: 1,
          deletedAt: "2026-01-01T00:00:01.000Z",
        } as Page & { deletedAt: string },
      },
    });

    applyRemoteDatabaseToStore(remoteDatabaseSnapshot());

    expect(useDatabaseStore.getState().dbTemplates["db-1"]).toEqual([]);
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

  it("최신 원격 속성 타입 snapshot을 활성 협업 Y.Doc에도 반영한다", () => {
    const staleColumns: DatabaseBundle["columns"] = [
      ...database.columns,
      { id: "status", name: "상태", type: "text" },
    ];
    const remoteColumns: DatabaseBundle["columns"] = [
      ...database.columns,
      {
        id: "status",
        name: "상태",
        type: "select",
        config: { options: [{ id: "todo", label: "대기", color: "gray" }] },
      },
    ];
    const doc = new Y.Doc();
    seedDbStructure(doc, {
      columns: staleColumns,
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
    useDatabaseStore.setState({
      databases: {
        "db-1": {
          ...structuredClone(database),
          columns: staleColumns,
        },
      },
      dbTemplates: {},
      cacheWorkspaceId: "ws-1",
    });

    applyRemoteDatabaseToStore({
      ...remoteDatabaseSnapshot(),
      columns: JSON.stringify(remoteColumns),
      updatedAt: "2026-01-01T00:00:03.000Z",
    });

    expect(useDatabaseStore.getState().databases["db-1"]?.columns).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "status", type: "select" })]),
    );
    expect(readDbStructure(doc).columns).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "status", type: "select" })]),
    );

    useDatabaseStore.getState().applyCollabDbStructure("db-1", readDbStructure(doc));

    expect(useDatabaseStore.getState().databases["db-1"]?.columns).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "status", type: "select" })]),
    );
    const materializedPayload = enqueueAsync.mock.calls
      .filter(([kind]) => kind === "upsertDatabase")
      .at(-1)?.[1] as Record<string, unknown> | undefined;
    expect(JSON.parse(String(materializedPayload?.columns))).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "status", type: "select" })]),
    );
  });

  it("배치 원격 snapshot 적용도 활성 협업 Y.Doc의 속성 타입을 최신화한다", () => {
    const staleColumns: DatabaseBundle["columns"] = [
      ...database.columns,
      { id: "status", name: "상태", type: "text" },
    ];
    const remoteColumns: DatabaseBundle["columns"] = [
      ...database.columns,
      { id: "status", name: "상태", type: "status" },
    ];
    const doc = new Y.Doc();
    seedDbStructure(doc, {
      columns: staleColumns,
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
    useDatabaseStore.setState({
      databases: {
        "db-1": {
          ...structuredClone(database),
          columns: staleColumns,
        },
      },
      dbTemplates: {},
      cacheWorkspaceId: "ws-1",
    });

    applyRemoteDatabasesToStore([
      {
        ...remoteDatabaseSnapshot(),
        columns: JSON.stringify(remoteColumns),
        updatedAt: "2026-01-01T00:00:03.000Z",
      },
    ]);

    expect(readDbStructure(doc).columns).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "status", type: "status" })]),
    );

    useDatabaseStore.getState().applyCollabDbStructure("db-1", readDbStructure(doc));

    expect(useDatabaseStore.getState().databases["db-1"]?.columns).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "status", type: "status" })]),
    );
  });
});
