import { assetMimeFromPath } from "./zipParser";
import type { NotionImportedAsset, NotionZipPreview } from "./zipParser";

// --- CSV 파서 (RFC 4180, BOM 지원) ---

export type CsvData = {
  headers: string[];
  rows: string[][];
};

export function parseCsv(raw: string): CsvData {
  const content = raw.startsWith("﻿") ? raw.slice(1) : raw;

  const parseRow = (line: string): string[] => {
    const fields: string[] = [];
    let field = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') { field += '"'; i++; }
        else quoted = !quoted;
      } else if (ch === "," && !quoted) {
        fields.push(field.trim());
        field = "";
      } else {
        field += ch;
      }
    }
    fields.push(field.trim());
    return fields;
  };

  const lines: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of content) {
    if (ch === '"') inQuotes = !inQuotes;
    else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (current.trim()) { lines.push(current); current = ""; }
      continue;
    }
    current += ch;
  }
  if (current.trim()) lines.push(current);

  const [headerLine, ...dataLines] = lines;
  return {
    headers: parseRow(headerLine ?? ""),
    rows: dataLines.filter((l) => l.trim()).map(parseRow),
  };
}

// --- 폴더명 추출 (hex ID 제거) ---

export function csvNameToFolderBase(csvName: string): string {
  const withoutExt = csvName.replace(/\.[^.]+$/, "");
  return withoutExt.replace(/\s+[0-9a-f]{32}$/i, "").trim();
}

// --- CSV 행 제목 → HTML 파일명 매칭 ---

function normalizeForMatch(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function pathDepth(path: string): number {
  if (!path) return 0;
  return path.split("/").length - 1;
}

export function findHtmlForRow(rowTitle: string, allPaths: string[]): string | null {
  const needle = normalizeForMatch(rowTitle);
  const htmlPaths = allPaths
    .filter((p) => p.toLowerCase().endsWith(".html"))
    .sort((a, b) => pathDepth(a) - pathDepth(b) || a.localeCompare(b));

  // 1차: 베이스 이름(hex 제거) 정확 일치
  const exact = htmlPaths.find((p) => {
    const base = p.replace(/\s+[0-9a-f]{32}\.html$/i, "").split("/").pop()?.replace(/\.html$/i, "");
    return base && normalizeForMatch(base) === needle;
  });
  if (exact) return exact;

  // 2차: URL-디코드 후 비교 (한글/공백 인코딩 케이스)
  const decoded = htmlPaths.find((p) => {
    try {
      const fileName = decodeURIComponent(p.split("/").pop() ?? "");
      const base = fileName.replace(/\s+[0-9a-f]{32}\.html$/i, "").replace(/\.html$/i, "");
      return normalizeForMatch(base) === needle;
    } catch {
      return false;
    }
  });
  if (decoded) return decoded;

  // 3차: 영숫자만 비교 (특수문자 차이 무시 — 슬래시/언더스코어/하이픈 등)
  const alnum = (s: string) => s.replace(/[^a-z0-9가-힣]/gi, "").toLowerCase();
  const needleAlnum = alnum(needle);
  if (needleAlnum.length >= 3) {
    // 파일 경로의 leaf 만 비교(URL 인코딩 포함, hex suffix 제거)
    const candidate = (p: string) => {
      const leafRaw = p.split("/").pop() ?? "";
      let leaf = leafRaw.replace(/\.html$/i, "");
      try { leaf = decodeURIComponent(leaf); } catch { /* noop */ }
      return leaf.replace(/\s+[0-9a-f]{32}$/i, "");
    };
    const fuzzy = htmlPaths.find((p) => alnum(candidate(p)) === needleAlnum);
    if (fuzzy) return fuzzy;
    // 4차: 부분 포함 — 양방향 substring (제목이 줄여졌거나 prefix 가 잘린 경우)
    const partial = htmlPaths.find((p) => {
      const baseAlnum = alnum(candidate(p));
      return baseAlnum.length >= 3 && (baseAlnum.includes(needleAlnum) || needleAlnum.includes(baseAlnum));
    });
    if (partial) return partial;
  }

  return null;
}

// 행 HTML 옆 동명 서브폴더에서 자식 페이지 HTML 들 찾기
// rowHtmlPath: "DB Name/Row hexID.html" → 자식 후보: "DB Name/Row hexID/...html" 또는 "DB Name/Row/...html"
export function findChildHtmlPaths(rowHtmlPath: string, allPaths: string[]): string[] {
  const withId = rowHtmlPath.replace(/\.html$/i, ""); // "DB Name/Row hexID"
  const noId = withId.replace(/\s+[0-9a-f]{32}$/i, ""); // "DB Name/Row"
  const prefixes = Array.from(new Set([`${withId}/`, `${noId}/`]));
  return allPaths.filter((p) =>
    p !== rowHtmlPath &&
    p.toLowerCase().endsWith(".html") &&
    prefixes.some((prefix) => p.startsWith(prefix)),
  );
}

// --- CSV + 매칭 서브폴더 쌍 탐지 ---

export type CsvDbPair = {
  folderBase: string;
  folderPath: string;
  csvHandle: FileSystemFileHandle;
  folderHandle: FileSystemDirectoryHandle;
  // CSV 옆에 같은 base 이름으로 존재하는 DB 메인 렌더 HTML (collection-content 테이블 포함)
  // 컬럼 타입 추론 강화에 사용
  mainHtmlHandle?: FileSystemFileHandle;
};

export async function detectCsvDbPairs(dir: FileSystemDirectoryHandle): Promise<CsvDbPair[]> {
  const csvMap = new Map<string, FileSystemFileHandle>();
  const dirMap = new Map<string, FileSystemDirectoryHandle>();

  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === "file" && name.toLowerCase().endsWith(".csv")) {
      csvMap.set(csvNameToFolderBase(name), handle as FileSystemFileHandle);
    } else if (handle.kind === "directory") {
      dirMap.set(name, handle as FileSystemDirectoryHandle);
    }
  }

  const pairs: CsvDbPair[] = [];
  for (const [base, csvHandle] of csvMap) {
    const folderHandle = dirMap.get(base);
    if (folderHandle) pairs.push({ folderBase: base, folderPath: base, csvHandle, folderHandle });
  }
  return pairs;
}

// 하위 폴더까지 재귀적으로 CSV+동명폴더 쌍 탐지.
// Notion 내보내기는 DB 항목 페이지 안에 또 다른 CSV+동명폴더 DB를 둘 수 있으므로,
// 이미 DB로 매칭된 폴더도 계속 스캔해야 한다.
export async function detectCsvDbPairsRecursive(
  dir: FileSystemDirectoryHandle,
): Promise<CsvDbPair[]> {
  const results: CsvDbPair[] = [];
  await _scanForPairs(dir, results, "");
  return results.sort((a, b) => {
    const depth = pathDepth(a.folderPath) - pathDepth(b.folderPath);
    return depth !== 0 ? depth : a.folderPath.localeCompare(b.folderPath);
  });
}

async function _scanForPairs(
  dir: FileSystemDirectoryHandle,
  out: CsvDbPair[],
  currentPath: string,
): Promise<void> {
  const csvMap = new Map<string, FileSystemFileHandle>();
  const htmlMap = new Map<string, FileSystemFileHandle>();
  const dirMap = new Map<string, FileSystemDirectoryHandle>();

  for await (const [name, handle] of dir.entries()) {
    const lower = name.toLowerCase();
    if (handle.kind === "file" && lower.endsWith(".csv")) {
      csvMap.set(csvNameToFolderBase(name), handle as FileSystemFileHandle);
    } else if (handle.kind === "file" && lower.endsWith(".html")) {
      // CSV와 같은 베이스 이름의 HTML 을 짝지을 수 있도록 보관
      const base = name
        .replace(/\.[^.]+$/, "")
        .replace(/\s+[0-9a-f]{32}$/i, "")
        .trim();
      htmlMap.set(base, handle as FileSystemFileHandle);
    } else if (handle.kind === "directory") {
      dirMap.set(name, handle as FileSystemDirectoryHandle);
    }
  }

  for (const [base, csvHandle] of csvMap) {
    const folderHandle = dirMap.get(base);
    if (folderHandle) {
      out.push({
        folderBase: base,
        folderPath: currentPath ? `${currentPath}/${base}` : base,
        csvHandle,
        folderHandle,
        mainHtmlHandle: htmlMap.get(base),
      });
    }
  }

  for (const [name, handle] of dirMap) {
    await _scanForPairs(handle, out, currentPath ? `${currentPath}/${name}` : name);
  }
}

// --- DB 폴더 전체 파일맵 구축 (경로 → FileHandle) ---

export async function buildFileMap(
  dir: FileSystemDirectoryHandle,
  basePath: string,
  out: Map<string, FileSystemFileHandle>,
): Promise<void> {
  for await (const [name, handle] of dir.entries()) {
    const path = basePath ? `${basePath}/${name}` : name;
    if (handle.kind === "directory") {
      await buildFileMap(handle as FileSystemDirectoryHandle, path, out);
    } else {
      out.set(path, handle as FileSystemFileHandle);
    }
  }
}

// --- 파일맵으로 NotionZipPreview 에셋 빌드 (기존 assetUpload 인프라 재사용) ---

export function buildPreviewFromFileMap(
  fileMap: Map<string, FileSystemFileHandle>,
): NotionZipPreview {
  const assets: NotionImportedAsset[] = [];
  for (const [path, handle] of fileMap) {
    const mime = assetMimeFromPath(path);
    if (!mime) continue;
    const name = path.split("/").pop() ?? path;
    assets.push({
      path,
      name,
      mimeType: mime,
      // 폴더 핸들 모드에서는 사전 size 조회 비용을 줄이기 위해 미확정(-1)으로 둔다.
      // 실제 업로드 직전 readAsFile() 결과로 최종 크기를 검증한다.
      size: -1,
      readAsFile: async () => {
        const file = await handle.getFile();
        return new File([file], name, { type: mime });
      },
    });
  }

  return {
    totalFiles: fileMap.size,
    markdownFileCount: 0,
    htmlFileCount: 0,
    csvFileCount: 0,
    assetFileCount: assets.length,
    assets,
    assetByPath: {},
    pages: [],
  };
}
