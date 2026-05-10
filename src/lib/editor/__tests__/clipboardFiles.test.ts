import { describe, expect, it } from "vitest";
import {
  extractClipboardFiles,
  isClipboardImageFile,
} from "../clipboardFiles";

function file(name: string, type = "", content = "x"): File {
  return new File([content], name, { type });
}

function fileList(files: File[]): FileList {
  return {
    length: files.length,
    item: (index: number) => files[index] ?? null,
    ...Object.fromEntries(files.map((f, i) => [i, f])),
  } as unknown as FileList;
}

describe("clipboardFiles", () => {
  it("clipboardData.files 만 있는 OS 파일 붙여넣기도 추출한다", () => {
    const pasted = file("report.pdf", "application/pdf");
    const entries = extractClipboardFiles({
      items: [] as unknown as DataTransferItemList,
      files: fileList([pasted]),
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.file).toBe(pasted);
    expect(entries[0]?.isImage).toBe(false);
  });

  it("MIME 이 비어 있어도 이미지 확장자면 이미지로 처리한다", () => {
    expect(isClipboardImageFile(file("photo.png"))).toBe(true);
    expect(isClipboardImageFile(file("archive.zip"))).toBe(false);
  });

  it("items 와 files 에 같은 파일이 동시에 있어도 중복하지 않는다", () => {
    const pasted = file("photo.png", "image/png");
    const item = {
      kind: "file",
      type: "image/png",
      getAsFile: () => pasted,
    } as DataTransferItem;
    const entries = extractClipboardFiles({
      items: [item] as unknown as DataTransferItemList,
      files: fileList([pasted]),
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.isImage).toBe(true);
  });
});
