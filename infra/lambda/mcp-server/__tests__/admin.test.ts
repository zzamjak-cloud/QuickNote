import { describe, expect, it } from "vitest";
import { NOT_ACCESSIBLE } from "../access";
import { ASSET_NOT_USABLE, createCustomIconTool, getAssetUsagesTool, listCustomIconsTool, listMyAssetsTool } from "../tools/admin/assets";
import { addFavoriteTool, listFavoritesTool, removeFavoriteTool } from "../tools/admin/favorites";
import { deleteNotificationTool, listNotificationsTool, markNotificationReadTool } from "../tools/admin/notifications";
import { SCOPED_TOKEN_CREATE_ERROR, createWorkspaceTool, updateWorkspaceTool } from "../tools/admin/workspaces";
import { requireWorkspace } from "../access";
import { EDIT_ACCESS_ERROR, WRITE_SCOPE_ERROR } from "../writeAccess";
import type { Item } from "./fakeDdb";
import { baseTables, makeCtx, member } from "./fixtures";

const WRITE = { scopes: ["read", "write"] as ("read" | "write")[] };
const READ = { scopes: ["read"] as ("read" | "write")[] };
const T0 = "2026-01-01T00:00:00.000Z";

function setup(token: object = WRITE, mutate?: (t: Record<string, Item[]>) => void) {
  const tables = baseTables();
  tables.pages = [
    { id: "p1", workspaceId: "ws-a", title: "Alpha page", icon: "📄", createdAt: T0, updatedAt: T0 },
    { id: "p2", workspaceId: "ws-b", title: "Beta page", createdAt: T0, updatedAt: T0 },
    { id: "p3", workspaceId: "ws-c", title: "Secret page", createdAt: T0, updatedAt: T0 },
  ];
  mutate?.(tables);
  return makeCtx(tables, token as never);
}

function notification(id: string, workspaceId: string, extra: Item = {}): Item {
  return {
    recipientMemberId: "m1", notificationId: id, workspaceId, kind: "mention", source: "comment",
    fromMemberId: "m2", pageId: "p1", previewBody: `hi ${id}`, read: false, createdAt: id, ...extra,
  };
}

function withNotifications(t: Record<string, Item[]>) {
  t.notifications = [
    notification("2026-01-01#n1", "ws-a"),
    notification("2026-01-02#n2", "ws-c"),
    notification("2026-01-03#n3", "ws-b", { read: true }),
    notification("2026-01-04#other", "ws-a", { recipientMemberId: "m2" }),
  ];
}

describe("알림", () => {
  it("본인 알림 중 토큰이 읽을 수 있는 워크스페이스 것만 최신순으로 보인다", async () => {
    const { ctx } = setup(READ, withNotifications);
    const r = await listNotificationsTool(ctx, {});
    expect(r.notifications.map((n) => n.notificationId)).toEqual(["2026-01-03#n3", "2026-01-01#n1"]);
    expect(r.unreadCount).toBe(1);
    expect((await listNotificationsTool(ctx, { unreadOnly: true })).notifications).toHaveLength(1);
  });

  it("토큰 workspaceIds 범위 밖 알림은 숨긴다", async () => {
    const { ctx } = setup({ ...READ, workspaceIds: ["ws-b"] }, withNotifications);
    const r = await listNotificationsTool(ctx, {});
    expect(r.notifications.map((n) => n.notificationId)).toEqual(["2026-01-03#n3"]);
  });

  it("읽음 처리 — id 지정·all", async () => {
    const { ctx, fake } = setup(WRITE, withNotifications);
    await markNotificationReadTool(ctx, { notificationIds: ["2026-01-01#n1"] });
    expect(fake.tables.notifications.find((n) => n.notificationId === "2026-01-01#n1")?.read).toBe(true);

    const { ctx: ctx2, fake: fake2 } = setup(WRITE, withNotifications);
    const r = await markNotificationReadTool(ctx2, { all: true });
    expect(r.markedRead).toEqual(["2026-01-01#n1"]);
    // 범위 밖(ws-c)·타인 알림은 건드리지 않는다.
    expect(fake2.tables.notifications.find((n) => n.notificationId === "2026-01-02#n2")?.read).toBe(false);
  });

  it("읽음·삭제 거부 — read 토큰, 없는 id(가짜 행 생성 없음), 접근 불가 워크스페이스, 타인 알림", async () => {
    const { ctx: readCtx } = setup(READ, withNotifications);
    await expect(markNotificationReadTool(readCtx, { all: true })).rejects.toThrow(WRITE_SCOPE_ERROR);
    await expect(deleteNotificationTool(readCtx, { notificationIds: ["2026-01-01#n1"] })).rejects.toThrow(WRITE_SCOPE_ERROR);

    const { ctx, fake } = setup(WRITE, withNotifications);
    const before = fake.tables.notifications.length;
    await expect(markNotificationReadTool(ctx, { notificationIds: ["missing"] })).rejects.toThrow(NOT_ACCESSIBLE);
    await expect(markNotificationReadTool(ctx, { notificationIds: ["2026-01-02#n2"] })).rejects.toThrow(NOT_ACCESSIBLE);
    await expect(deleteNotificationTool(ctx, { notificationIds: ["2026-01-04#other"] })).rejects.toThrow(NOT_ACCESSIBLE);
    await expect(markNotificationReadTool(ctx, {})).rejects.toThrow("Pass notificationIds or all: true");
    expect(fake.tables.notifications).toHaveLength(before);
  });

  it("삭제", async () => {
    const { ctx, fake } = setup(WRITE, withNotifications);
    const r = await deleteNotificationTool(ctx, { notificationIds: ["2026-01-01#n1", "2026-01-03#n3"] });
    expect(r.deleted).toHaveLength(2);
    expect(fake.tables.notifications.map((n) => n.notificationId)).toEqual(["2026-01-02#n2", "2026-01-04#other"]);
  });
});

describe("워크스페이스 생성·수정", () => {
  function managerCtx(token: object = WRITE) {
    const { ctx, fake } = setup(token);
    return { ctx: { ...ctx, caller: member({ workspaceRole: "manager" }) }, fake };
  }

  it("생성 — 생성자 본인 edit 엔트리를 항상 넣고, 토큰이 바로 그 워크스페이스를 쓸 수 있다", async () => {
    const { ctx, fake } = managerCtx();
    const r = await createWorkspaceTool(ctx, {
      name: "  New WS ",
      access: [{ subjectType: "team", subjectId: "t1", level: "view" }, { subjectType: "member", subjectId: "m1", level: "view" }],
    });
    expect(r.name).toBe("New WS");
    expect(r.type).toBe("shared");
    const access = fake.tables["workspace-access"].filter((a) => a.workspaceId === r.workspaceId);
    expect(access.map((a) => `${a.subjectKey}:${a.level}`).sort()).toEqual(["member#m1:edit", "team#t1:view"]);
    await expect(requireWorkspace(ctx, String(r.workspaceId))).resolves.toBeUndefined();
  });

  it("생성 거부 — 범위 한정 토큰, read 토큰, 매니저 미만 역할", async () => {
    await expect(createWorkspaceTool(managerCtx({ ...WRITE, workspaceIds: ["ws-a"] }).ctx, { name: "x" })).rejects.toThrow(SCOPED_TOKEN_CREATE_ERROR);
    await expect(createWorkspaceTool(managerCtx(READ).ctx, { name: "x" })).rejects.toThrow(WRITE_SCOPE_ERROR);
    const { ctx, fake } = setup(WRITE);
    await expect(createWorkspaceTool(ctx, { name: "x" })).rejects.toMatchObject({ errorType: "Forbidden" });
    expect(fake.tables.workspaces).toHaveLength(3);
  });

  it("수정 — 이름·직무 옵션", async () => {
    const { ctx, fake } = managerCtx();
    const r = await updateWorkspaceTool(ctx, { workspaceId: "ws-a", name: "Alpha 2", jobTitles: ["Lead"] });
    expect(r).toMatchObject({ workspaceId: "ws-a", name: "Alpha 2", jobTitles: ["Lead"] });
    expect(fake.tables.workspaces.find((w) => w.workspaceId === "ws-a")?.name).toBe("Alpha 2");
  });

  it("수정 거부 — view 권한, 접근 불가·스케줄러 워크스페이스, 매니저 미만, 빈 변경", async () => {
    const { ctx } = managerCtx();
    await expect(updateWorkspaceTool(ctx, { workspaceId: "ws-b", name: "x" })).rejects.toThrow(EDIT_ACCESS_ERROR);
    await expect(updateWorkspaceTool(ctx, { workspaceId: "ws-c", name: "x" })).rejects.toThrow(NOT_ACCESSIBLE);
    await expect(updateWorkspaceTool(ctx, { workspaceId: "lc-scheduler-global", name: "x" })).rejects.toThrow(NOT_ACCESSIBLE);
    await expect(updateWorkspaceTool(ctx, { workspaceId: "ws-a" })).rejects.toThrow("Nothing to update");
    const { ctx: memberCtx, fake } = setup(WRITE);
    await expect(updateWorkspaceTool(memberCtx, { workspaceId: "ws-a", name: "x" })).rejects.toMatchObject({ errorType: "Forbidden" });
    expect(fake.tables.workspaces.find((w) => w.workspaceId === "ws-a")?.name).toBe("Alpha");
  });
});

describe("즐겨찾기", () => {
  function prefsOf(fake: { tables: Record<string, Item[]> }): Item {
    return JSON.parse(String(fake.tables.members.find((m) => m.memberId === "m1")?.clientPrefs));
  }

  function withPrefs(prefs: Item) {
    return (t: Record<string, Item[]>) => {
      t.members = t.members.map((m) => (m.memberId === "m1" ? { ...m, clientPrefs: JSON.stringify(prefs) } : m));
    };
  }

  const EXISTING = { v: 1, favoritePageIds: ["p3", "p2"], favoritePageIdsUpdatedAt: 5, fullWidth: true, fullWidthUpdatedAt: 7, pageFullWidthById: { p2: true } };

  it("추가 — 끝에 붙이고 메타를 채우며 다른 prefs 는 보존한다", async () => {
    const { ctx, fake } = setup(WRITE, withPrefs(EXISTING));
    const r = await addFavoriteTool(ctx, { pageId: "p1" });
    expect(r).toMatchObject({ added: true, count: 3 });
    const prefs = prefsOf(fake);
    expect(prefs.favoritePageIds).toEqual(["p3", "p2", "p1"]);
    expect(Number(prefs.favoritePageIdsUpdatedAt)).toBeGreaterThan(5);
    expect((prefs.favoritePageMetaById as Item).p1).toMatchObject({ workspaceId: "ws-a", workspaceName: "Alpha", pageTitle: "Alpha page", pageIcon: "📄" });
    expect(prefs).toMatchObject({ fullWidth: true, fullWidthUpdatedAt: 7, pageFullWidthById: { p2: true } });
    expect(await addFavoriteTool(ctx, { pageId: "p1" })).toMatchObject({ alreadyFavorite: true });
    // Members 쓰기 IAM 이 dynamodb:Attributes 로 제한되므로 ALL_NEW 반환을 요구하면 안 된다.
    const updates = fake.calls.filter((c) => c.constructor.name === "UpdateCommand" && (c.input as Item).TableName === "members");
    expect(updates.length).toBeGreaterThan(0);
    for (const u of updates) expect((u.input as Item).ReturnValues).toBe("NONE");
  });

  it("목록 — 토큰이 읽을 수 없는 워크스페이스의 즐겨찾기는 숨긴다", async () => {
    const { ctx } = setup(READ, withPrefs({ ...EXISTING, favoritePageIds: ["p3", "p2", "p1", "gone"] }));
    expect((await listFavoritesTool(ctx)).favorites.map((f) => f.pageId)).toEqual(["p2", "p1"]);
    const { ctx: scoped } = setup({ ...READ, workspaceIds: ["ws-a"] }, withPrefs({ ...EXISTING, favoritePageIds: ["p2", "p1"] }));
    expect((await listFavoritesTool(scoped)).favorites.map((f) => f.pageId)).toEqual(["p1"]);
  });

  it("제거 — 범위 안 페이지·영구 삭제된 페이지", async () => {
    const { ctx, fake } = setup(WRITE, withPrefs({ ...EXISTING, favoritePageIds: ["p3", "p2", "gone"] }));
    await removeFavoriteTool(ctx, { pageId: "p2" });
    await removeFavoriteTool(ctx, { pageId: "gone" });
    expect(prefsOf(fake).favoritePageIds).toEqual(["p3"]);
  });

  it("거부 — read 토큰, 접근 불가 페이지 추가, 범위 밖 즐겨찾기 제거, 목록에 없는 항목", async () => {
    const { ctx: readCtx } = setup(READ);
    await expect(addFavoriteTool(readCtx, { pageId: "p1" })).rejects.toThrow(WRITE_SCOPE_ERROR);
    const { ctx, fake } = setup(WRITE, withPrefs(EXISTING));
    await expect(addFavoriteTool(ctx, { pageId: "p3" })).rejects.toThrow(NOT_ACCESSIBLE);
    await expect(addFavoriteTool(ctx, { pageId: "missing" })).rejects.toThrow(NOT_ACCESSIBLE);
    await expect(removeFavoriteTool(ctx, { pageId: "p3" })).rejects.toThrow(NOT_ACCESSIBLE);
    await expect(removeFavoriteTool(ctx, { pageId: "p1" })).rejects.toThrow("not in favorites");
    expect(prefsOf(fake).favoritePageIds).toEqual(["p3", "p2"]);
  });
});

describe("자산·커스텀 아이콘", () => {
  function withAssets(t: Record<string, Item[]>) {
    t["image-assets"] = [
      { id: "img1", ownerId: "sub-1", mimeType: "image/png", size: 100, sha256: "a", status: "READY", createdAt: T0, name: "logo" },
      { id: "file1", ownerId: "sub-1", mimeType: "application/pdf", size: 900, sha256: "b", status: "READY", createdAt: T0 },
      { id: "img2", ownerId: "sub-2", mimeType: "image/png", size: 5, sha256: "c", status: "READY", createdAt: T0 },
    ];
    t["asset-usage"] = [
      { assetId: "img1", sk: "PAGE#p1#BLOCK#b1", ownerId: "sub-1", pageId: "p1", workspaceId: "ws-a", blockId: "b1", blockType: "image" },
      { assetId: "img1", sk: "PAGE#p3#BLOCK#b2", ownerId: "sub-1", pageId: "p3", workspaceId: "ws-c", blockId: "b2", blockType: "image" },
    ];
    t["custom-icons"] = [
      { id: "ci1", workspaceId: "ws-a", src: "quicknote-image://img1", label: "Logo", createdAt: T0, createdByMemberId: "m1" },
      { id: "ci2", workspaceId: "ws-c", src: "quicknote-image://img9", label: "Hidden", createdAt: T0 },
    ];
  }

  it("내 자산 목록 — 본인 것만, ref·사용 수 포함", async () => {
    const { ctx } = setup(READ, withAssets);
    const r = await listMyAssetsTool(ctx, {});
    expect(r.assets.map((a) => a.id)).toEqual(["file1", "img1"]);
    expect(r.assets.find((a) => a.id === "img1")).toMatchObject({ ref: "quicknote-image://img1", usageCount: 2, name: "logo" });
    expect(r.assets.find((a) => a.id === "file1")?.ref).toBe("quicknote-file://file1");
    expect((await listMyAssetsTool(ctx, { mimePrefix: "image/" })).assets.map((a) => a.id)).toEqual(["img1"]);
  });

  it("내 자산 목록 — 범위 한정 토큰은 범위 안 워크스페이스에서 쓰이는 자산만, 사용 수도 범위 안만", async () => {
    const { ctx } = setup({ ...READ, workspaceIds: ["ws-a"] }, withAssets);
    const r = await listMyAssetsTool(ctx, {});
    expect(r.assets.map((a) => a.id)).toEqual(["img1"]);
    expect(r.assets[0]).toMatchObject({ usageCount: 1 });
    const { ctx: other } = setup({ ...READ, workspaceIds: ["ws-b"] }, withAssets);
    expect((await listMyAssetsTool(other, {})).assets).toEqual([]);
  });

  it("자산 사용처 — 토큰이 읽을 수 있는 워크스페이스만, 타인 자산은 빈 목록", async () => {
    const { ctx } = setup(READ, withAssets);
    const r = await getAssetUsagesTool(ctx, { assetId: "img1" });
    expect(r.usages).toEqual([{ workspaceId: "ws-a", pageId: "p1", pageTitle: "Alpha page", blockId: "b1", blockType: "image" }]);
    expect((await getAssetUsagesTool(ctx, { assetId: "img2" })).usages).toEqual([]);
  });

  it("커스텀 아이콘 목록 — 접근 가능한 워크스페이스만", async () => {
    const { ctx } = setup(READ, withAssets);
    expect((await listCustomIconsTool(ctx, { workspaceId: "ws-a" })).icons.map((i) => i.id)).toEqual(["ci1"]);
    await expect(listCustomIconsTool(ctx, { workspaceId: "ws-c" })).rejects.toThrow(NOT_ACCESSIBLE);
  });

  it("커스텀 아이콘 생성 — 본인 이미지 자산 ref 만", async () => {
    const { ctx, fake } = setup(WRITE, withAssets);
    const r = await createCustomIconTool(ctx, { workspaceId: "ws-a", src: "quicknote-image://img1", label: "Brand" });
    expect(r).toMatchObject({ workspaceId: "ws-a", src: "quicknote-image://img1", label: "Brand" });
    expect(fake.tables["custom-icons"].some((i) => i.id === r.id && i.createdByMemberId === "m1")).toBe(true);
  });

  it("커스텀 아이콘 생성 거부 — 타인·비이미지 자산, 외부 URL, view 권한, read 토큰", async () => {
    const { ctx, fake } = setup(WRITE, withAssets);
    await expect(createCustomIconTool(ctx, { workspaceId: "ws-a", src: "quicknote-image://img2" })).rejects.toThrow(ASSET_NOT_USABLE);
    await expect(createCustomIconTool(ctx, { workspaceId: "ws-a", src: "quicknote-image://file1" })).rejects.toThrow(ASSET_NOT_USABLE);
    await expect(createCustomIconTool(ctx, { workspaceId: "ws-a", src: "https://evil.example/x.png" })).rejects.toThrow();
    await expect(createCustomIconTool(ctx, { workspaceId: "ws-b", src: "quicknote-image://img1" })).rejects.toThrow(EDIT_ACCESS_ERROR);
    const { ctx: readCtx } = setup(READ, withAssets);
    await expect(createCustomIconTool(readCtx, { workspaceId: "ws-a", src: "quicknote-image://img1" })).rejects.toThrow(WRITE_SCOPE_ERROR);
    expect(fake.tables["custom-icons"]).toHaveLength(2);
  });
});
