import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { parseNotionZipBuffer } from "../../lib/notionImport/zipParser";

describe("parseNotionZipBuffer", () => {
  it("마크다운/CSV/asset를 분리하고 페이지 메타를 추출한다", async () => {
    const zip = new JSZip();
    zip.file("Home 1234567890abcdef1234567890abcdef.md", "# 홈\n본문");
    zip.file("Home 1234567890abcdef1234567890abcdef/Sub 11111111111111111111111111111111.md", "서브 본문");
    zip.file("Database.csv", "name,status\na,done");
    zip.file("images/sample.png", "PNG", { binary: false });

    const buf = await zip.generateAsync({ type: "arraybuffer" });
    const parsed = await parseNotionZipBuffer(buf);

    expect(parsed.totalFiles).toBe(4);
    expect(parsed.markdownFileCount).toBe(2);
    expect(parsed.csvFileCount).toBe(1);
    expect(parsed.assetFileCount).toBe(1);
    expect(parsed.assetByPath).toEqual({});
    expect(parsed.assets[0]?.path).toBe("images/sample.png");
    expect(parsed.assets[0]?.mimeType).toBe("image/png");
    expect(parsed.pages[0]?.title).toBe("Home");
    expect(parsed.pages[1]?.title).toBe("Sub");
    expect(parsed.pages[1]?.parentTitle).toBe("Home");
    expect(parsed.pages[0]?.format).toBe("markdown");
  });

  it("중첩 zip 내부의 마크다운도 페이지로 인식한다", async () => {
    const innerZip = new JSZip();
    innerZip.file("Nested 22222222222222222222222222222222.md", "중첩 페이지");
    const innerBuf = await innerZip.generateAsync({ type: "arraybuffer" });

    const outerZip = new JSZip();
    outerZip.file("ExportPart.zip", innerBuf);
    const outerBuf = await outerZip.generateAsync({ type: "arraybuffer" });

    const parsed = await parseNotionZipBuffer(outerBuf);
    expect(parsed.totalFiles).toBe(1);
    expect(parsed.markdownFileCount).toBe(1);
    expect(parsed.pages[0]?.title).toBe("Nested");
    expect(parsed.pages[0]?.path).toContain("ExportPart/Nested");
  });

  it("export 내부의 첨부 zip은 다시 풀지 않고 파일 첨부로 유지한다", async () => {
    const attachmentZip = new JSZip();
    attachmentZip.file("asset.png", "PNG");
    const attachmentBuf = await attachmentZip.generateAsync({ type: "arraybuffer" });

    const exportZip = new JSZip();
    exportZip.file("Page.html", "<html><body><a href=\"files/Assets.zip\">asset</a></body></html>");
    exportZip.file("files/Assets.zip", attachmentBuf);
    const exportBuf = await exportZip.generateAsync({ type: "arraybuffer" });

    const outerZip = new JSZip();
    outerZip.file("ExportBlock-abc-Part-1.zip", exportBuf);
    const outerBuf = await outerZip.generateAsync({ type: "arraybuffer" });

    const parsed = await parseNotionZipBuffer(outerBuf);

    expect(parsed.totalFiles).toBe(2);
    expect(parsed.htmlFileCount).toBe(1);
    expect(parsed.assetFileCount).toBe(1);
    expect(parsed.assets[0]?.path).toBe("ExportBlock-abc-Part-1/files/Assets.zip");
    expect(parsed.assets[0]?.mimeType).toBe("application/zip");
  });

  it("html 페이지도 인식한다", async () => {
    const zip = new JSZip();
    zip.file("HTML Page 33333333333333333333333333333333.html", "<html><body>ok</body></html>");
    const buf = await zip.generateAsync({ type: "arraybuffer" });
    const parsed = await parseNotionZipBuffer(buf);
    expect(parsed.pages[0]?.format).toBe("html");
  });

  it("같은 경로면 html을 markdown보다 우선 정렬한다", async () => {
    const zip = new JSZip();
    zip.file("Same 44444444444444444444444444444444.md", "md");
    zip.file("Same 44444444444444444444444444444444.html", "<html>html</html>");
    const buf = await zip.generateAsync({ type: "arraybuffer" });
    const parsed = await parseNotionZipBuffer(buf);
    expect(parsed.pages[0]?.format).toBe("html");
  });
});
