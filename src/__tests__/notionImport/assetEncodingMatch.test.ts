import { describe, expect, it } from "vitest";
import { createNotionAssetResolver } from "../../lib/notionImport/assetUpload";
import type { NotionZipPreview } from "../../lib/notionImport/zipParser";

function previewWith(paths: string[]): NotionZipPreview {
  return {
    totalFiles: paths.length,
    markdownFileCount: 0,
    htmlFileCount: 0,
    csvFileCount: 0,
    assetFileCount: paths.length,
    assets: paths.map((path) => ({
      path,
      name: path.split("/").pop() ?? path,
      mimeType: "image/jpeg",
      size: 1,
      readAsFile: async () => new File([], path),
    })),
    assetByPath: {},
    pages: [],
  };
}

describe("자산 경로 인코딩 불일치 매칭", () => {
  it("디스크 파일명(1회 인코딩 리터럴) vs href(2회 인코딩) 을 매칭한다", () => {
    // 디스크 파일명: 폴더는 실제 한글, 파일명은 %EB.. 가 리터럴로 박힘
    const diskPath = "치키 체이스/%EB%A1%9C%EB%93%9C%EC%BB%B4%ED%94%8C%EB%A6%BF_%EC%B5%9C%EC%A7%84%ED%8F%89%EB%8B%98.jpg";
    const resolver = createNotionAssetResolver(previewWith([diskPath]));
    // HTML href: 파일명부가 2회 인코딩됨
    const href = "%EC%B9%98%ED%82%A4%20%EC%B2%B4%EC%9D%B4%EC%8A%A4/%25EB%25A1%259C%25EB%2593%259C%25EC%25BB%25B4%25ED%2594%258C%25EB%25A6%25BF_%25EC%25B5%259C%25EC%25A7%2584%25ED%258F%2589%25EB%258B%2598.jpg";
    expect(resolver.resolve(href)?.path).toBe(diskPath);
  });

  it("정상 1회 인코딩 경로는 그대로 매칭한다", () => {
    const diskPath = "ACECRAFT/ACECRAFT.png";
    const resolver = createNotionAssetResolver(previewWith([diskPath]));
    expect(resolver.resolve("ACECRAFT/ACECRAFT.png")?.path).toBe(diskPath);
  });
});
