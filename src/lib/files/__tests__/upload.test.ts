import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { uploadFile } from "../upload";

const graphql = vi.fn();

vi.mock("../../sync/graphql/client", () => ({
  appsyncClient: () => ({ graphql }),
}));

describe("uploadFile", () => {
  beforeEach(() => {
    graphql.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("이미 업로드된 파일이면 PUT과 confirm을 생략하고 같은 ref를 반환한다", async () => {
    graphql.mockResolvedValueOnce({
      data: {
        getImageUploadUrl: {
          imageId: "asset-existing",
          uploadUrl: "https://upload.example.com/object",
          expiresAt: new Date().toISOString(),
          alreadyUploaded: true,
        },
      },
    });

    const uploaded = await uploadFile(
      ({
        name: "hello.txt",
        type: "text/plain",
        size: 5,
        arrayBuffer: async () => new TextEncoder().encode("hello").buffer,
      } as File),
      { alreadyPrepared: true },
    );

    expect(uploaded.ref).toBe("quicknote-file://asset-existing");
    expect(fetch).not.toHaveBeenCalled();
    expect(graphql).toHaveBeenCalledTimes(1);
  });
});
