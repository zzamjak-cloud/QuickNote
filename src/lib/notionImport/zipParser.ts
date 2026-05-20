import JSZip from "jszip";

export type NotionImportedPage = {
  path: string;
  title: string;
  depth: number;
  parentTitle: string | null;
  format: "markdown" | "html";
  content: string;
};

export type NotionImportedAsset = {
  path: string;
  name: string;
  mimeType: string;
  size: number;
  readAsFile: () => Promise<File>;
};

export type NotionZipPreview = {
  totalFiles: number;
  markdownFileCount: number;
  htmlFileCount: number;
  csvFileCount: number;
  assetFileCount: number;
  assets: NotionImportedAsset[];
  assetByPath: Record<string, string>;
  pages: NotionImportedPage[];
};

type ZipFileEntry = {
  name: string;
  size: number;
  readAsString: () => Promise<string>;
  readAsBlob: (mimeType?: string) => Promise<Blob>;
};

type ZipInput = ArrayBuffer | Blob;

function isMarkdownFile(path: string): boolean {
  return path.toLowerCase().endsWith(".md");
}

function isCsvFile(path: string): boolean {
  return path.toLowerCase().endsWith(".csv");
}

function isHtmlFile(path: string): boolean {
  return path.toLowerCase().endsWith(".html");
}

function isZipFile(path: string): boolean {
  return path.toLowerCase().endsWith(".zip");
}

function shouldExpandNestedZip(basePath: string, entryName: string, siblingCount: number): boolean {
  if (basePath) return false;
  if (entryName.includes("/")) return false;
  if (/^ExportBlock-/i.test(entryName) || /Part-\d+\.zip$/i.test(entryName)) return true;
  return siblingCount === 1;
}

function assetMimeFromPath(path: string): string | null {
  const lower = path.toLowerCase();
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

function splitPath(path: string): string[] {
  return path.split("/").filter(Boolean);
}

function buildPageMeta(path: string): {
  title: string;
  depth: number;
  parentTitle: string | null;
} {
  const parts = splitPath(path);
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

export async function parseNotionZipBuffer(input: ArrayBuffer): Promise<NotionZipPreview> {
  return parseNotionZipInput(input);
}

export async function parseNotionZipFile(file: Blob): Promise<NotionZipPreview> {
  return parseNotionZipInput(file);
}

async function parseNotionZipInput(input: ZipInput): Promise<NotionZipPreview> {
  const fileEntries: ZipFileEntry[] = [];
  const queue: Array<{ basePath: string; data: ZipInput }> = [{ basePath: "", data: input }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const zip = await JSZip.loadAsync(current.data);
    const currentFiles = Object.values(zip.files).filter((entry) => !entry.dir);

    for (const entry of currentFiles) {
      const entryName = current.basePath ? `${current.basePath}/${entry.name}` : entry.name;
      if (isZipFile(entry.name) && shouldExpandNestedZip(current.basePath, entry.name, currentFiles.length)) {
        const nested = await readZipEntryAsBlob(entry, "application/zip");
        const nestedBase = trimExtension(entryName);
        queue.push({ basePath: nestedBase, data: nested });
        continue;
      }
      const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
      fileEntries.push({
        name: entryName,
        size,
        readAsString: () => entry.async("string"),
        readAsBlob: (mimeType) => readZipEntryAsBlob(entry, mimeType),
      });
    }
  }

  const markdownEntries = fileEntries.filter((entry) => isMarkdownFile(entry.name));
  const htmlEntries = fileEntries.filter((entry) => isHtmlFile(entry.name));
  const csvEntries = fileEntries.filter((entry) => isCsvFile(entry.name));
  const assetEntries = fileEntries.filter(
    (entry) => !isMarkdownFile(entry.name) && !isHtmlFile(entry.name) && !isCsvFile(entry.name),
  );

  const pages: NotionImportedPage[] = [];
  for (const entry of markdownEntries) {
    const content = await entry.readAsString();
    const meta = buildPageMeta(entry.name);
    pages.push({
      path: entry.name,
      title: meta.title,
      depth: meta.depth,
      parentTitle: meta.parentTitle,
      format: "markdown",
      content,
    });
  }

  for (const entry of htmlEntries) {
    const content = await entry.readAsString();
    const meta = buildPageMeta(entry.name);
    pages.push({
      path: entry.name,
      title: meta.title,
      depth: meta.depth,
      parentTitle: meta.parentTitle,
      format: "html",
      content,
    });
  }

  pages.sort((a, b) => {
    const pathOrder = a.path.localeCompare(b.path);
    if (pathOrder !== 0) return pathOrder;
    if (a.format === b.format) return 0;
    return a.format === "html" ? -1 : 1;
  });

  const assets: NotionImportedAsset[] = [];
  for (const entry of assetEntries) {
    const mime = assetMimeFromPath(entry.name);
    if (!mime) continue;
    const name = splitPath(entry.name).at(-1) ?? entry.name;
    assets.push({
      path: entry.name,
      name,
      mimeType: mime,
      size: entry.size,
      readAsFile: async () => new File([await entry.readAsBlob(mime)], name, { type: mime }),
    });
  }

  return {
    totalFiles: fileEntries.length,
    markdownFileCount: markdownEntries.length,
    htmlFileCount: htmlEntries.length,
    csvFileCount: csvEntries.length,
    assetFileCount: assetEntries.length,
    assets,
    assetByPath: {},
    pages,
  };
}

async function readZipEntryAsBlob(entry: JSZip.JSZipObject, mimeType = ""): Promise<Blob> {
  const blob = await entry.async("blob");
  return mimeType && blob.type !== mimeType ? blob.slice(0, blob.size, mimeType) : blob;
}
