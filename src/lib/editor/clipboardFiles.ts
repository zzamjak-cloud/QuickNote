const IMAGE_FILE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "heic",
  "heif",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
]);

export type ClipboardFileEntry = {
  file: File;
  clipboardType: string;
  isImage: boolean;
};

function fileKey(file: File): string {
  return `${file.name}\u0000${file.size}\u0000${file.type}\u0000${file.lastModified}`;
}

export function isClipboardImageFile(
  file: File,
  clipboardType = "",
): boolean {
  if (file.type.startsWith("image/") || clipboardType.startsWith("image/")) {
    return true;
  }
  const ext = file.name.split(".").pop()?.toLowerCase();
  return !!ext && IMAGE_FILE_EXTENSIONS.has(ext);
}

export function extractClipboardFiles(
  data: Pick<DataTransfer, "files" | "items"> | null | undefined,
): ClipboardFileEntry[] {
  if (!data) return [];
  const entries: ClipboardFileEntry[] = [];
  const seen = new Set<string>();

  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (!file) continue;
    const key = fileKey(file);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      file,
      clipboardType: item.type,
      isImage: isClipboardImageFile(file, item.type),
    });
  }

  for (const file of Array.from(data.files ?? [])) {
    const key = fileKey(file);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      file,
      clipboardType: file.type,
      isImage: isClipboardImageFile(file, file.type),
    });
  }

  return entries;
}
