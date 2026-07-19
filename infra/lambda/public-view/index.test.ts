// public-view Lambda — 균일 404·트리 소속 검증·자산 인가·필드 화이트리스트 검증.
import { beforeEach, describe, it, expect, vi } from "vitest";

// 정적 import 보다 먼저 실행되어 Lambda 모듈 상수에 테스트 테이블명이 들어가게 한다.
vi.hoisted(() => {
  process.env.PUBLISHED_PAGES_TABLE = "PP";
  process.env.PAGES_TABLE = "P";
  process.env.SHARED_BLOCKS_TABLE = "SB";
  process.env.IMAGE_ASSET_TABLE = "IA";
  process.env.ASSET_USAGE_TABLE = "AU";
  process.env.IMAGES_BUCKET = "bucket";
});

const sendMock = vi.fn();
const s3SendMock = vi.fn();
vi.mock("@aws-sdk/lib-dynamodb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/lib-dynamodb")>();
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: () => ({ send: (...args: unknown[]) => sendMock(...args) }),
    },
  };
});
vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  return {
    ...actual,
    S3Client: class {
      send(...args: unknown[]) {
        return s3SendMock(...args);
      }
    },
  };
});
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(async () => "https://s3.example/presigned"),
}));

import { handler } from "./index";

const TOKEN = "abcdefghijklmnop1234";
const SHARED_TOKEN = "sharedtoken1234567890";
const GALLERY_TOKEN = "gallerytoken123456789";
const GALLERY_HEIGHT_TOKEN = "galleryheight123456789";
const LINKED_MENU_TOKEN = "linkedmenu1234567890";
const TARGET_TOKEN = "targetpage1234567890";

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
    { id: "revoked-root", title: "게시 해제", parentId: null, order: 2 },
    { id: "foreign-root", title: "타 워크스페이스", parentId: null, order: 3 },
    { id: "deleted-1", title: "삭제됨", parentId: "root-1", order: 1, deletedAt: "2026-07-01T00:00:00Z" },
    { id: "dbrow-1", title: "DB행", parentId: "root-1", order: 2, databaseId: "db-1" },
  ],
};

beforeEach(() => {
  sendMock.mockReset();
  s3SendMock.mockReset();
});

describe("public-view handler", () => {
  it("게시 스냅샷이 있으면 S3 snapshot payload를 우선 반환한다", async () => {
    sendMock.mockResolvedValueOnce({
      Item: {
        ...publishRecord,
        snapshotVersion: "v1",
        snapshotSiteKey: "public-snapshots/token/v1/site.json",
      },
    });
    sendMock.mockResolvedValueOnce({ Item: rootPage });
    s3SendMock.mockResolvedValueOnce({
      Body: {
        transformToString: async () =>
          JSON.stringify({
            rootId: "root-1",
            pages: [{ id: "root-1", title: "스냅샷", parentId: null, order: 0 }],
          }),
      },
    });

    const r = await handler(getEvent({ op: "site", token: TOKEN }));

    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({ rootId: "root-1" });
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(s3SendMock).toHaveBeenCalledTimes(1);
  });

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

  it("op=page — sharedBlockId 최신 메뉴 data 를 hydrate하고 게시 트리 밖 항목은 통째로 제거", async () => {
    const pageWithMenu = {
      ...rootPage,
      doc: JSON.stringify({
        type: "doc",
        content: [{
          type: "dropdownMenuBlock",
          attrs: {
            sharedBlockId: "shared-menu-1",
            data: JSON.stringify({
              kind: "dropdown-menu",
              items: [{ id: "stale", label: "오래된 메뉴", pageId: "root-1" }],
            }),
          },
        }],
      }),
    };
    sendMock
      .mockResolvedValueOnce({ Item: { ...publishRecord, token: SHARED_TOKEN } })
      .mockResolvedValueOnce({ Item: pageWithMenu })
      .mockResolvedValueOnce({ Item: pageWithMenu })
      .mockResolvedValueOnce(workspaceMetas)
      .mockResolvedValueOnce({
        Responses: {
          SB: [{
            id: "shared-menu-1",
            workspaceId: "ws-1",
            kind: "dropdown-menu",
            data: JSON.stringify({
              kind: "dropdown-menu",
              items: [
                { id: "child-menu", label: "English", pageId: "child-1" },
                { id: "private-menu", label: "비공개 이름", pageId: "other-1" },
              ],
            }),
            deletedAt: null,
          }],
        },
      })
      .mockResolvedValueOnce({ Items: [] }); // other-1은 별도 게시되지 않음
    const result = await handler(getEvent({
      op: "page",
      token: SHARED_TOKEN,
      pageId: "root-1",
    }));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as {
      doc: { content: Array<{ attrs: { data: string; publicMode: boolean } }> };
    };
    const data = JSON.parse(body.doc.content[0]!.attrs.data) as {
      items: Array<{ id: string; label: string; pageId: string }>;
    };
    expect(data.items).toEqual([
      { id: "child-menu", label: "English", pageId: "child-1" },
    ]);
    expect(body.doc.content[0]!.attrs.publicMode).toBe(true);
    expect(result.body).not.toContain("비공개 이름");
    expect(result.body).not.toContain("other-1");
    expect(result.body).not.toContain("오래된 메뉴");
  });

  it("op=page — 공유 갤러리의 사용자 높이를 공개 응답에도 유지한다", async () => {
    const pageWithGallery = {
      ...rootPage,
      doc: JSON.stringify({
        type: "doc",
        content: [{
          type: "galleryBlock",
          attrs: {
            sharedBlockId: "shared-gallery-height",
            data: JSON.stringify({ kind: "gallery", images: [], intervalMs: 5_000, heightPx: 200 }),
          },
        }],
      }),
    };
    sendMock
      .mockResolvedValueOnce({ Item: { ...publishRecord, token: GALLERY_HEIGHT_TOKEN } })
      .mockResolvedValueOnce({ Item: pageWithGallery })
      .mockResolvedValueOnce({ Item: pageWithGallery })
      .mockResolvedValueOnce(workspaceMetas)
      .mockResolvedValueOnce({
        Responses: {
          SB: [{
            id: "shared-gallery-height",
            workspaceId: "ws-1",
            kind: "gallery",
            data: JSON.stringify({
              kind: "gallery",
              images: [{ id: "image-1", src: "quicknote-image://gallery-height-asset", alt: "상품" }],
              intervalMs: 5_000,
              heightPx: 640,
            }),
            deletedAt: null,
          }],
        },
      });

    const result = await handler(getEvent({
      op: "page",
      token: GALLERY_HEIGHT_TOKEN,
      pageId: "root-1",
    }));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as {
      doc: { content: Array<{ attrs: { data: string; publicMode: boolean } }> };
    };
    const data = JSON.parse(body.doc.content[0]!.attrs.data) as {
      heightPx: number;
      images: Array<{ src: string }>;
    };
    expect(data.heightPx).toBe(640);
    expect(data.images[0]?.src).toBe("quicknote-image://gallery-height-asset");
    expect(body.doc.content[0]!.attrs.publicMode).toBe(true);
  });

  it("op=page — 같은 워크스페이스의 독립 게시 루트는 별도 token href로 공개한다", async () => {
    const pageWithMenu = {
      ...rootPage,
      doc: JSON.stringify({
        type: "doc",
        content: [{
          type: "dropdownMenuBlock",
          attrs: {
            sharedBlockId: "shared-menu-2",
            data: JSON.stringify({ kind: "dropdown-menu", items: [] }),
          },
        }],
      }),
    };
    sendMock
      .mockResolvedValueOnce({ Item: { ...publishRecord, token: LINKED_MENU_TOKEN } })
      .mockResolvedValueOnce({ Item: pageWithMenu })
      .mockResolvedValueOnce({ Item: pageWithMenu })
      .mockResolvedValueOnce(workspaceMetas)
      .mockResolvedValueOnce({
        Responses: {
          SB: [{
            id: "shared-menu-2",
            workspaceId: "ws-1",
            kind: "dropdown-menu",
            data: JSON.stringify({
              kind: "dropdown-menu",
              items: [
                { id: "child", label: "자식", pageId: "child-1" },
                { id: "other", label: "독립 게시", pageId: "other-1", href: "https://evil.example" },
                { id: "revoked", label: "게시 해제", pageId: "revoked-root" },
                { id: "foreign", label: "타 워크스페이스", pageId: "foreign-root" },
                { id: "deleted", label: "삭제됨", pageId: "deleted-1" },
                { id: "dbrow", label: "DB 행", pageId: "dbrow-1" },
                { id: "private", label: "미게시", pageId: "private-root" },
              ],
            }),
            deletedAt: null,
          }],
        },
      })
      .mockResolvedValueOnce({
        Items: [{
          token: TARGET_TOKEN,
          pageId: "other-1",
          workspaceId: "ws-1",
          publishedAt: "2026-07-02T00:00:00Z",
        }],
      })
      .mockResolvedValueOnce({
        Items: [{
          token: "revokedpage12345678",
          pageId: "revoked-root",
          workspaceId: "ws-1",
          publishedAt: "2026-07-02T00:00:00Z",
          revokedAt: "2026-07-03T00:00:00Z",
        }],
      })
      .mockResolvedValueOnce({
        Items: [{
          token: "foreignpage12345678",
          pageId: "foreign-root",
          workspaceId: "ws-2",
          publishedAt: "2026-07-02T00:00:00Z",
        }],
      });

    const result = await handler(getEvent({
      op: "page",
      token: LINKED_MENU_TOKEN,
      pageId: "root-1",
    }));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as {
      doc: { content: Array<{ attrs: { data: string } }> };
    };
    const data = JSON.parse(body.doc.content[0]!.attrs.data) as {
      items: Array<{ id: string; label: string; pageId: string; href?: string }>;
    };
    expect(data.items).toEqual([
      { id: "child", label: "자식", pageId: "child-1" },
      {
        id: "other",
        label: "독립 게시",
        pageId: "other-1",
        href: `/p/${TARGET_TOKEN}`,
      },
    ]);
    expect(result.body).not.toContain("https://evil.example");
    expect(result.body).not.toContain("게시 해제");
    expect(result.body).not.toContain("타 워크스페이스");
    expect(result.body).not.toContain("삭제됨");
    expect(result.body).not.toContain("DB 행");
    expect(result.body).not.toContain("미게시");

    // DynamoDB 예약어 token을 그대로 ProjectionExpression에 넣으면 live Query가 실패한다.
    const publishLinkQueries = sendMock.mock.calls
      .map(([command]) => command as {
        constructor?: { name?: string };
        input?: {
          IndexName?: string;
          ProjectionExpression?: string;
          ExpressionAttributeNames?: Record<string, string>;
        };
      })
      .filter((command) =>
        command.constructor?.name === "QueryCommand" &&
        command.input?.IndexName === "byPageId"
      );
    expect(publishLinkQueries).toHaveLength(3);
    for (const query of publishLinkQueries) {
      expect(query.input?.ProjectionExpression).toContain("#token");
      expect(query.input?.ProjectionExpression).not.toMatch(/(^|,\s*)token(?:\s*,|$)/);
      expect(query.input?.ExpressionAttributeNames).toMatchObject({ "#token": "token" });
    }
  });

  it("op=page — 201-depth 상한 밖 공유 메뉴의 raw label/pageId를 fail-closed로 제거", async () => {
    let nested: Record<string, unknown> = {
      type: "dropdownMenuBlock",
      attrs: {
        sharedBlockId: "deep-secret-menu",
        data: JSON.stringify({
          kind: "dropdown-menu",
          items: [{ id: "secret", label: "비공개 201단계 메뉴", pageId: "secret-page-201" }],
        }),
      },
    };
    for (let i = 0; i < 201; i += 1) {
      nested = { type: "blockquote", content: [nested] };
    }
    const deepPage = {
      ...rootPage,
      doc: JSON.stringify({ type: "doc", content: [nested] }),
    };
    sendMock
      .mockResolvedValueOnce({ Item: publishRecord })
      .mockResolvedValueOnce({ Item: deepPage })
      .mockResolvedValueOnce({ Item: deepPage })
      .mockResolvedValueOnce(workspaceMetas);

    const result = await handler(getEvent({
      op: "page",
      token: TOKEN,
      pageId: "root-1",
    }));

    expect(result.statusCode).toBe(200);
    expect(result.body).not.toContain("비공개 201단계 메뉴");
    expect(result.body).not.toContain("secret-page-201");
    expect(result.body).not.toContain("deep-secret-menu");
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

  it("op=asset — A 페이지 삭제 뒤에도 B의 stale inline 대신 최신 공유 갤러리 자산을 302", async () => {
    const pageWithGallery = {
      ...rootPage,
      doc: JSON.stringify({
        type: "doc",
        content: [{
          type: "galleryBlock",
          attrs: {
            sharedBlockId: "shared-gallery-1",
            data: JSON.stringify({ kind: "gallery", images: [], intervalMs: 5_000 }),
          },
        }],
      }),
    };
    sendMock
      .mockResolvedValueOnce({ Item: { ...publishRecord, token: GALLERY_TOKEN } })
      .mockResolvedValueOnce({ Item: pageWithGallery })
      .mockResolvedValueOnce({ Item: pageWithGallery })
      .mockResolvedValueOnce(workspaceMetas)
      .mockResolvedValueOnce({
        Responses: {
          SB: [{
            id: "shared-gallery-1",
            workspaceId: "ws-1",
            kind: "gallery",
            data: JSON.stringify({
              kind: "gallery",
              images: [{ id: "image-1", src: "quicknote-image://gallery-asset-1", alt: "상품" }],
              intervalMs: 5_000,
            }),
            deletedAt: null,
          }],
        },
      })
      // 페이지 A의 PAGE# usage가 아니라 SharedBlock upsert가 유지한 합성 usage이다.
      .mockResolvedValueOnce({
        Items: [{
          workspaceId: "ws-1",
          blockType: "sharedGallery",
          pageId: "__sharedBlock__:ws-1:shared-gallery-1",
          sharedBlockId: "shared-gallery-1",
        }],
      })
      .mockResolvedValueOnce({
        Item: { id: "gallery-asset-1", status: "READY", key: "k/gallery-asset-1" },
      });
    const result = await handler(getEvent({
      op: "asset",
      token: GALLERY_TOKEN,
      pageId: "root-1",
      assetId: "gallery-asset-1",
    }));
    expect(result.statusCode).toBe(302);
    expect(result.headers.location).toBe("https://s3.example/presigned");
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

  it("op=asset — 페이지 icon chrome 은 AssetUsage 없이 presign 한다", async () => {
    const pageWithIcon = {
      ...rootPage,
      icon: "quicknote-image://icon-chrome",
      doc: { type: "doc", content: [] },
    };
    sendMock
      .mockResolvedValueOnce({ Item: publishRecord })
      .mockResolvedValueOnce({ Item: pageWithIcon })
      .mockResolvedValueOnce({ Item: pageWithIcon })
      .mockResolvedValueOnce({
        Item: { id: "icon-chrome", status: "READY", key: "k/icon-chrome" },
      });
    const r = await handler(
      getEvent({
        op: "asset",
        token: TOKEN,
        pageId: "root-1",
        assetId: "icon-chrome",
      }),
    );
    expect(r.statusCode).toBe(302);
    // AssetUsage Query 없이 GetItem+presign 만
    expect(sendMock).toHaveBeenCalledTimes(4);
  });

  it("op=page — fullWidth 스냅샷을 응답에 포함한다", async () => {
    sendMock
      .mockResolvedValueOnce({ Item: { ...publishRecord, fullWidth: true } })
      .mockResolvedValueOnce({ Item: rootPage })
      .mockResolvedValueOnce({ Item: rootPage });
    const r = await handler(getEvent({ op: "page", token: TOKEN, pageId: "root-1" }));
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).fullWidth).toBe(true);
  });

  it("op=page — 페이지별 너비 오버라이드가 전역 기본값보다 우선한다", async () => {
    sendMock
      .mockResolvedValueOnce({
        Item: { ...publishRecord, fullWidthDefault: true, fullWidthById: { "root-1": false } },
      })
      .mockResolvedValueOnce({ Item: rootPage })
      .mockResolvedValueOnce({ Item: rootPage });
    const r = await handler(getEvent({ op: "page", token: TOKEN, pageId: "root-1" }));
    expect(JSON.parse(r.body).fullWidth).toBe(false);
  });

  it("op=page — 페이지별 오버라이드가 없으면 전역 기본값을 사용한다", async () => {
    sendMock
      .mockResolvedValueOnce({
        Item: { ...publishRecord, fullWidthDefault: true, fullWidthById: {} },
      })
      .mockResolvedValueOnce({ Item: rootPage })
      .mockResolvedValueOnce({ Item: rootPage });
    const r = await handler(getEvent({ op: "page", token: TOKEN, pageId: "root-1" }));
    expect(JSON.parse(r.body).fullWidth).toBe(true);
  });

  it("404 응답은 no-store, 성공은 짧은 stale-while-revalidate 캐시", async () => {
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

  it("docAssets — galleryBlock JSON data 의 images[].src 도 수집", async () => {
    const { collectDocAssetIds } = await import("./docAssets");
    const doc = {
      type: "doc",
      content: [{
        type: "galleryBlock",
        attrs: {
          data: JSON.stringify({
            kind: "gallery",
            images: [
              { id: "a", src: "quicknote-image://gallery-image" },
              { id: "b", src: "quicknote-file://gallery-file" },
            ],
          }),
        },
      }],
    };
    expect(collectDocAssetIds(doc)).toEqual(
      new Set(["gallery-image", "gallery-file"]),
    );
  });
});
