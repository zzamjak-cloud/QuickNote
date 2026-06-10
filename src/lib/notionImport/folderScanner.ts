import type { NotionImportedAsset, NotionImportedPage, NotionZipPreview } from "./zipParser";

function isMarkdownFile(name: string) { return name.toLowerCase().endsWith(".md"); }
function isHtmlFile(name: string) { return name.toLowerCase().endsWith(".html"); }
function isCsvFile(name: string) { return name.toLowerCase().endsWith(".csv"); }

function assetMimeFromName(name: string): string | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".mp4") || lower.endsWith(".m4v")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".ogv")) return "video/ogg";
  if (lower.endsWith(".avi")) return "video/x-msvideo";
  if (lower.endsWith(".mkv")) return "video/x-matroska";
  if (lower.endsWith(".mpg") || lower.endsWith(".mpeg")) return "video/mpeg";
  if (lower.endsWith(".3gp")) return "video/3gpp";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".ppt")) return "application/vnd.ms-powerpoint";
  if (lower.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (lower.endsWith(".zip")) return "application/zip";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".xml")) return "application/xml";
  if (lower.endsWith(".txt")) return "text/plain";
  return null;
}

function trimExtension(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

function normalizeNotionName(name: string): string {
  const withoutExt = trimExtension(name);
  const noIdSuffix = withoutExt.replace(/\s+[0-9a-f]{32}$/i, "");
  return noIdSuffix.trim() || "제목 없음";
}

function buildPageMeta(path: string) {
  const parts = path.split("/").filter(Boolean);
  const fileName = parts[parts.length - 1] ?? path;
  const title = normalizeNotionName(fileName);
  const depth = Math.max(parts.length - 1, 0);
  const parentSegment = parts.length > 1 ? parts[parts.length - 2] : null;
  return {
    title,
    depth,
    parentTitle: parentSegment ? normalizeNotionName(parentSegment) : null,
  };
}

type CollectedFile = {
  path: string;
  name: string;
  handle: FileSystemFileHandle;
};

async function collectFiles(
  dir: FileSystemDirectoryHandle,
  basePath: string,
  out: CollectedFile[],
): Promise<void> {
  for await (const [name, handle] of dir.entries()) {
    const entryPath = basePath ? `${basePath}/${name}` : name;
    if (handle.kind === "directory") {
      await collectFiles(handle as FileSystemDirectoryHandle, entryPath, out);
    } else {
      out.push({ path: entryPath, name, handle: handle as FileSystemFileHandle });
    }
  }
}

export async function scanNotionFolder(dir: FileSystemDirectoryHandle): Promise<NotionZipPreview> {
  const allFiles: CollectedFile[] = [];
  await collectFiles(dir, "", allFiles);

  const markdownFiles = allFiles.filter((f) => isMarkdownFile(f.name));
  const htmlFiles = allFiles.filter((f) => isHtmlFile(f.name));
  const csvFiles = allFiles.filter((f) => isCsvFile(f.name));
  const assetFiles = allFiles.filter(
    (f) => !isMarkdownFile(f.name) && !isHtmlFile(f.name) && !isCsvFile(f.name),
  );

  const pages: NotionImportedPage[] = [];

  for (const f of markdownFiles) {
    const meta = buildPageMeta(f.path);
    pages.push({
      path: f.path,
      title: meta.title,
      depth: meta.depth,
      parentTitle: meta.parentTitle,
      format: "markdown",
      readContent: async () => {
        const file = await f.handle.getFile();
        return file.text();
      },
    });
  }

  for (const f of htmlFiles) {
    const meta = buildPageMeta(f.path);
    pages.push({
      path: f.path,
      title: meta.title,
      depth: meta.depth,
      parentTitle: meta.parentTitle,
      format: "html",
      readContent: async () => {
        const file = await f.handle.getFile();
        return file.text();
      },
    });
  }

  pages.sort((a, b) => {
    const pathOrder = a.path.localeCompare(b.path);
    if (pathOrder !== 0) return pathOrder;
    if (a.format === b.format) return 0;
    return a.format === "html" ? -1 : 1;
  });

  const assets: NotionImportedAsset[] = [];
  for (const f of assetFiles) {
    const mime = assetMimeFromName(f.name);
    if (!mime) continue;
    // FileSystemFileHandle 은 스캔 시점에 크기를 알 수 없어 실제 size 를 getFile() 로 채운다.
    // size 를 0 으로 두면 업로드 단계의 "빈 파일" 사전 차단(uploadNotionAsset)에 걸려
    // 폴더 가져오기에서 모든 에셋이 누락된다. (getFile 의 .size 는 메타데이터라 본문을 읽지 않음)
    let size = 0;
    try {
      size = (await f.handle.getFile()).size;
    } catch {
      size = 0;
    }
    assets.push({
      path: f.path,
      name: f.name,
      mimeType: mime,
      size,
      readAsFile: async () => {
        const file = await f.handle.getFile();
        return new File([file], f.name, { type: mime });
      },
    });
  }

  return {
    totalFiles: allFiles.length,
    markdownFileCount: markdownFiles.length,
    htmlFileCount: htmlFiles.length,
    csvFileCount: csvFiles.length,
    assetFileCount: assetFiles.length,
    assets,
    assetByPath: {},
    pages,
  };
}

export async function scanNotionFolderFiles(files: File[]): Promise<NotionZipPreview> {
  const allFiles = files
    .map((file) => {
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? file.name;
      const path = rel.replace(/^\/+/, "");
      return { path, name: file.name, file };
    })
    .filter((entry) => entry.path.length > 0);

  const markdownFiles = allFiles.filter((f) => isMarkdownFile(f.name));
  const htmlFiles = allFiles.filter((f) => isHtmlFile(f.name));
  const csvFiles = allFiles.filter((f) => isCsvFile(f.name));
  const assetFiles = allFiles.filter(
    (f) => !isMarkdownFile(f.name) && !isHtmlFile(f.name) && !isCsvFile(f.name),
  );

  const pages: NotionImportedPage[] = [];

  for (const f of markdownFiles) {
    const meta = buildPageMeta(f.path);
    pages.push({
      path: f.path,
      title: meta.title,
      depth: meta.depth,
      parentTitle: meta.parentTitle,
      format: "markdown",
      readContent: async () => f.file.text(),
    });
  }

  for (const f of htmlFiles) {
    const meta = buildPageMeta(f.path);
    pages.push({
      path: f.path,
      title: meta.title,
      depth: meta.depth,
      parentTitle: meta.parentTitle,
      format: "html",
      readContent: async () => f.file.text(),
    });
  }

  pages.sort((a, b) => {
    const pathOrder = a.path.localeCompare(b.path);
    if (pathOrder !== 0) return pathOrder;
    if (a.format === b.format) return 0;
    return a.format === "html" ? -1 : 1;
  });

  const assets: NotionImportedAsset[] = [];
  for (const f of assetFiles) {
    const mime = assetMimeFromName(f.name);
    if (!mime) continue;
    assets.push({
      path: f.path,
      name: f.name,
      mimeType: mime,
      size: f.file.size,
      readAsFile: async () => new File([f.file], f.name, { type: mime }),
    });
  }

  return {
    totalFiles: allFiles.length,
    markdownFileCount: markdownFiles.length,
    htmlFileCount: htmlFiles.length,
    csvFileCount: csvFiles.length,
    assetFileCount: assetFiles.length,
    assets,
    assetByPath: {},
    pages,
  };
}

export function isFolderPickerSupported(): boolean {
  return "showDirectoryPicker" in window;
}
