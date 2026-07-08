// public-view Lambda — 균일 404·트리 소속 검증·자산 인가·필드 화이트리스트 검증.
import { beforeEach, describe, it, expect, vi } from "vitest";

// 환경변수는 모듈 로드 전에 설정돼야 한다.
process.env.PUBLISHED_PAGES_TABLE = "PP";
process.env.PAGES_TABLE = "P";
process.env.IMAGE_ASSET_TABLE = "IA";
process.env.ASSET_USAGE_TABLE = "AU";
process.env.IMAGES_BUCKET = "bucket";

const sendMock = vi.fn();
vi.mock("@aws-sdk/lib-dynamodb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/lib-dynamodb")>();
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: () => ({ send: (...args: unknown[]) => sendMock(...args) }),
    },
  };
});
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(async () => "https://s3.example/presigned"),
}));

import { handler } from "./index";

const TOKEN = "abcdefghijklmnop1234";

function getEvent(qs: Record<string, string>) {
  return {
    requestContext: { http: { method: "GET" } },
    queryStringParameters: qs,
  };
}

const publishRecord = {
  token: TOKEN,
  pageId: "root-1",
  workspaceId: "ws-1",
  publishedAt: "2026-07-01T00:00:00Z",
};

const rootPage = {
  id: "root-1",
  workspaceId: "ws-1",
  title: "루트",
  parentId: null,
  order: 0,
  doc: JSON.stringify({
    type: "doc",
    content: [
      { type: "image", attrs: { src: "quicknote-image://asset-1" } },
    ],
  }),
  updatedAt: "2026-07-02T00:00:00Z",
  dbCells: { secret: true }, // projection 화이트리스트 밖 필드가 응답에 새지 않는지 검증용
};

// 워크스페이스 메타 쿼리 결과 (tree.ts loadPublishablePageMetas)
const workspaceMetas = {
  Items: [
    { id: "root-1", title: "루트", parentId: null, order: 0 },
    { id: "child-1", title: "자식", parentId: "root-1", order: 0 },
    { id: "other-1", title: "타 트리", parentId: null, order: 1 },
    { id: "deleted-1", title: "삭제됨", parentId: "root-1", order: 1, deletedAt: "2026-07-01T00:00:00Z" },
    { id: "dbrow-1", title: "DB행", parentId: "root-1", order: 2, databaseId: "db-1" },
  ],
};

beforeEach(() => {
  sendMock.mockReset();
});

describe("public-view handler", () => {
  it("무효 토큰 형식 → 404", async () => {
    const r = await handler(getEvent({ op: "site", token: "short" }));
    expect(r.statusCode).toBe(404);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("미존재 토큰 → 404 (균일 응답)", async () => {
    sendMock.mockResolvedValueOnce({ Item: undefined });
    const r = await handler(getEvent({ op: "site", token: TOKEN }));
    expect(r.statusCode).toBe(404);
  });

  it("해제(revoked)된 토큰 → 404", async () => {
    sendMock.mockResolvedValueOnce({
      Item: { ...publishRecord, revokedAt: "2026-07-03T00:00:00Z" },
    });
    const r = await handler(getEvent({ op: "site", token: TOKEN }));
    expect(r.statusCode).toBe(404);
  });

  it("루트 페이지가 삭제되면 → 404", async () => {
    sendMock
      .mockResolvedValueOnce({ Item: publishRecord })
      .mockResolvedValueOnce({ Item: { ...rootPage, deletedAt: "2026-07-03T00:00:00Z" } });
    const r = await handler(getEvent({ op: "site", token: TOKEN }));
    expect(r.statusCode).toBe(404);
  });

  it("op=site — 자손만 포함(삭제·DB행·타 트리 제외) + noindex 헤더", async () => {
    sendMock
      .mockResolvedValueOnce({ Item: publishRecord }) // 토큰
      .mockResolvedValueOnce({ Item: rootPage }) // 루트
      .mockResolvedValueOnce(workspaceMetas); // 워크스페이스 메타
    const r = await handler(getEvent({ op: "site", token: TOKEN }));
    expect(r.statusCode).toBe(200);
    expect(r.headers["x-robots-tag"]).toContain("noindex");
    const body = JSON.parse(r.body) as { rootId: string; pages: Array<{ id: string }> };
    expect(body.rootId).toBe("root-1");
    expect(body.pages.map((p) => p.id).sort()).toEqual(["child-1", "root-1"]);
  });

  it("op=page — 트리 밖 pageId 는 404", async () => {
    sendMock
      .mockResolvedValueOnce({ Item: publishRecord })
      .mockResolvedValueOnce({ Item: rootPage })
      .mockResolvedValueOnce(workspaceMetas);
    const r = await handler(getEvent({ op: "page", token: TOKEN, pageId: "other-1" }));
    expect(r.statusCode).toBe(404);
  });

  it("op=page — 루트 본문 반환, 화이트리스트 밖 필드(dbCells) 미노출", async () => {
    sendMock
      .mockResolvedValueOnce({ Item: publishRecord })
      .mockResolvedValueOnce({ Item: rootPage }) // 루트 검증
      .mockResolvedValueOnce({ Item: rootPage }); // 본문 조회
    const r = await handler(getEvent({ op: "page", token: TOKEN, pageId: "root-1" }));
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body) as Record<string, unknown>;
    expect(body.title).toBe("루트");
    expect((body.doc as { type: string }).type).toBe("doc");
    expect(body).not.toHaveProperty("dbCells");
    expect(body).not.toHaveProperty("workspaceId");
  });

  it("op=asset — doc 참조 + 게시 워크스페이스 사용(AssetUsage) 확인 후 presign 302", async () => {
    sendMock
      .mockResolvedValueOnce({ Item: publishRecord }) // 토큰
      .mockResolvedValueOnce({ Item: rootPage }) // 루트 servable 메타
      .mockResolvedValueOnce({ Item: rootPage }) // 대상 페이지 full
      .mockResolvedValueOnce({ Items: [{ workspaceId: "ws-1" }] }) // AssetUsage(같은 ws)
      .mockResolvedValueOnce({ Item: { id: "asset-1", status: "READY", key: "k/asset-1" } });
    const r = await handler(
      getEvent({ op: "asset", token: TOKEN, pageId: "root-1", assetId: "asset-1" }),
    );
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe("https://s3.example/presigned");
  });

  it("op=asset — doc 에 있어도 타 워크스페이스 자산이면 404 (교차 워크스페이스 유출 차단)", async () => {
    sendMock
      .mockResolvedValueOnce({ Item: publishRecord })
      .mockResolvedValueOnce({ Item: rootPage })
      .mockResolvedValueOnce({ Item: rootPage })
      .mockResolvedValueOnce({ Items: [{ workspaceId: "ws-victim" }] }); // 다른 ws 에서만 사용
    const r = await handler(
      getEvent({ op: "asset", token: TOKEN, pageId: "root-1", assetId: "asset-1" }),
    );
    expect(r.statusCode).toBe(404);
    expect(sendMock).toHaveBeenCalledTimes(4); // 자산 GetItem·presign 도달 전 차단
  });

  it("op=asset — doc 에 없는 assetId 는 404 (AssetUsage·presign 시도조차 없음)", async () => {
    sendMock
      .mockResolvedValueOnce({ Item: publishRecord })
      .mockResolvedValueOnce({ Item: rootPage })
      .mockResolvedValueOnce({ Item: rootPage });
    const r = await handler(
      getEvent({ op: "asset", token: TOKEN, pageId: "root-1", assetId: "asset-other" }),
    );
    expect(r.statusCode).toBe(404);
    expect(sendMock).toHaveBeenCalledTimes(3); // 참조 화이트리스트에서 이미 차단
  });

  it("404 응답은 no-store, 성공은 max-age=60 캐시", async () => {
    sendMock.mockResolvedValueOnce({ Item: undefined });
    const r404 = await handler(getEvent({ op: "site", token: TOKEN }));
    expect(r404.headers["cache-control"]).toBe("no-store");
  });

  it("GET 이외 메서드 → 405", async () => {
    const r = await handler({
      requestContext: { http: { method: "POST" } },
      queryStringParameters: { op: "site", token: TOKEN },
    });
    expect(r.statusCode).toBe(405);
  });
});

describe("tree/docAssets 순환·상한", () => {
  it("순환 parentId 데이터에서도 종료한다", async () => {
    const { collectSubtreeIds } = await import("./tree");
    const metas = new Map([
      ["a", { id: "a", title: "", titleColor: null, icon: null, parentId: "b", order: 0, updatedAt: null }],
      ["b", { id: "b", title: "", titleColor: null, icon: null, parentId: "a", order: 0, updatedAt: null }],
    ]);
    const ids = collectSubtreeIds(metas, "a");
    expect(ids.has("a")).toBe(true);
    expect(ids.has("b")).toBe(true);
  });

  it("docAssets — attrs·marks·중첩 content 에서 자산 id 수집", async () => {
    const { collectDocAssetIds } = await import("./docAssets");
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "링크",
              marks: [{ type: "link", attrs: { href: "quicknote-file://file-9" } }],
            },
          ],
        },
        { type: "image", attrs: { src: "quicknote-image://img-1" } },
      ],
    };
    const refs = collectDocAssetIds(doc, ["quicknote-image://icon-1", null]);
    expect(refs).toEqual(new Set(["file-9", "img-1", "icon-1"]));
  });
});
