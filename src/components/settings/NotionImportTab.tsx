import { useEffect, useMemo, useState } from "react";
import { parseNotionZipFile, type NotionZipPreview } from "../../lib/notionImport/zipParser";
import { scanNotionFolder, isFolderPickerSupported } from "../../lib/notionImport/folderScanner";
import { notionMarkdownToDoc } from "../../lib/notionImport/markdownToDoc";
import { notionHtmlToDoc, type NotionCollectionTable } from "../../lib/notionImport/htmlToDoc";
import {
  collectNotionAssetRefsFromHtml,
  createNotionAssetResolver,
  failedNotionAsset,
  uploadedAssetToDocNode,
  uploadNotionAsset,
  type UploadedNotionAsset,
} from "../../lib/notionImport/assetUpload";
import { NotionCsvFolderSection } from "./NotionCsvFolderSection";
import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";
import type { ColumnType } from "../../types/database";
import type { JSONContent } from "@tiptap/react";
import { Loader2 } from "lucide-react";

type ImportStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; preview: NotionZipPreview; sourceName: string };

type ImportProgress = {
  label: string;
  done: number;
  total: number;
  current?: string;
};

function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export function NotionImportTab() {
  const createPage = usePageStore((s) => s.createPage);
  const updateDoc = usePageStore((s) => s.updateDoc);
  const setIcon = usePageStore((s) => s.setIcon);
  const renamePage = usePageStore((s) => s.renamePage);
  const createDatabase = useDatabaseStore((s) => s.createDatabase);
  const addColumn = useDatabaseStore((s) => s.addColumn);
  const updateColumn = useDatabaseStore((s) => s.updateColumn);
  const removeColumn = useDatabaseStore((s) => s.removeColumn);
  const addRow = useDatabaseStore((s) => s.addRow);
  const updateCell = useDatabaseStore((s) => s.updateCell);
  const [status, setStatus] = useState<ImportStatus>({ kind: "idle" });
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [importMessage, setImportMessage] = useState<string>("");
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [previewContent, setPreviewContent] = useState<string>("");

  const pages = useMemo(
    () => (status.kind === "ready" ? status.preview.pages : []),
    [status],
  );

  const selectedPage = useMemo(() => {
    if (!pages.length) return null;
    if (selectedPath) return pages.find((p) => p.path === selectedPath) ?? null;
    return pages[0] ?? null;
  }, [pages, selectedPath]);

  // 선택된 페이지 미리보기 컨텐츠를 지연 로드 (스캔 단계에서 전체 내용을 메모리에 올리지 않음)
  useEffect(() => {
    setPreviewContent("");
    if (!selectedPage) return;
    let cancelled = false;
    selectedPage.readContent().then((c) => {
      if (!cancelled) setPreviewContent(c);
    }).catch(() => {
      if (!cancelled) setPreviewContent("");
    });
    return () => { cancelled = true; };
  }, [selectedPage]);
  const importingLabel = importProgress
    ? `${importProgress.label}${importProgress.total > 0 ? ` ${Math.min(importProgress.done + 1, importProgress.total)}/${importProgress.total}` : ""}`
    : "페이지 구성중";

  const onPickZip = async (file: File | null) => {
    if (!file) return;
    setImportMessage("");
    setStatus({ kind: "loading" });
    try {
      const preview = await parseNotionZipFile(file);
      setStatus({ kind: "ready", preview, sourceName: file.name });
      const preferred = preview.pages.find((p) => p.format === "html") ?? preview.pages[0];
      setSelectedPath(preferred?.path ?? "");
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "ZIP 분석 중 오류가 발생했습니다.",
      });
    }
  };

  const onPickFolder = async () => {
    setImportMessage("");
    setStatus({ kind: "loading" });
    try {
      const dir = await window.showDirectoryPicker({ mode: "read" });
      const preview = await scanNotionFolder(dir);
      setStatus({ kind: "ready", preview, sourceName: dir.name });
      const preferred = preview.pages.find((p) => p.format === "html") ?? preview.pages[0];
      setSelectedPath(preferred?.path ?? "");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus({ kind: "idle" });
        return;
      }
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "폴더 분석 중 오류가 발생했습니다.",
      });
    }
  };

  const onImportSelectedPage = async () => {
    const currentStatus = status;
    if (!selectedPage || currentStatus.kind !== "ready" || isImporting) return;
    setImportMessage("");
    setImportProgress({ label: "페이지 구성 준비중", done: 0, total: 1 });
    setIsImporting(true);
    await yieldToPaint();

    try {
      const pageByPath = new Map(currentStatus.preview.pages.map((p) => [p.path, p]));
      const importedPageIdByPath = new Map<string, string>();
      const importedDocByPath = new Set<string>();
      const importingPath = new Set<string>();
      const assetResolver = createNotionAssetResolver(currentStatus.preview);
      const uploadedAssetByPath = new Map<string, UploadedNotionAsset>();
      const contentByPath = new Map<string, string>();

      const normalizeNotionSegment = (value: string): string =>
        value
          .replace(/^\.\/+/, "")
          .replace(/\.[^.]+$/, "")
          .replace(/\s+[0-9a-f]{32}$/i, "")
          .trim()
          .toLowerCase();

      const normalizeNotionPath = (value: string): string =>
        value
          .replace(/^\.\/+/, "")
          .replace(/\\/g, "/")
          .split("/")
          .filter(Boolean)
          .map((segment) => normalizeNotionSegment(segment))
          .join("/");

      const pathDirname = (path: string): string => {
        const idx = path.lastIndexOf("/");
        return idx >= 0 ? path.slice(0, idx) : "";
      };

      const pathBasename = (path: string): string => {
        const idx = path.lastIndexOf("/");
        return idx >= 0 ? path.slice(idx + 1) : path;
      };

      const parentSourcePathByPath = new Map<string, string | null>();
      const findParentSourcePath = (sourcePath: string): string | null => {
        const cached = parentSourcePathByPath.get(sourcePath);
        if (cached !== undefined) return cached;
        const currentDir = pathDirname(sourcePath);
        if (!currentDir) {
          parentSourcePathByPath.set(sourcePath, null);
          return null;
        }
        const parentDir = pathDirname(currentDir);
        const containerName = normalizeNotionSegment(pathBasename(currentDir));
        const found =
          Array.from(pageByPath.values()).find((p) => {
            if (p.path === sourcePath) return false;
            if (pathDirname(p.path) !== parentDir) return false;
            return normalizeNotionSegment(pathBasename(p.path)) === containerName;
          })?.path ?? null;
        parentSourcePathByPath.set(sourcePath, found);
        return found;
      };

      const resolveExternalImageSrc = (src: string): string | null =>
        /^https?:\/\//i.test(src) || src.startsWith("data:") ? src : null;

      const resolveImageNodeForPage = (currentPagePath: string) =>
        (src: string, element: HTMLElement): JSONContent | null => {
          const asset = assetResolver.resolve(src, currentPagePath);
          if (!asset) return null;
          const uploaded = uploadedAssetByPath.get(asset.path);
          if (!uploaded) return null;
          return uploadedAssetToDocNode(uploaded, element.getAttribute("alt") ?? "");
        };

      const inferColumnType = (header: string, values: string[]): ColumnType => {
        const normalized = header.toLowerCase();
        if (normalized.includes("직군")) return "status";
        if (normalized.includes("날짜") || normalized.includes("date")) return "date";
        if (normalized.includes("상태") || normalized.includes("status")) return "status";
        if (normalized.includes("멘토") || normalized.includes("담당") || normalized.includes("person")) return "person";
        if (values.length > 0 && values.every((v) => /^-?\d+([.,]\d+)?$/.test(v.trim()))) return "number";
        return "text";
      };

      const notionStatusColorToQuickNote = (token: string | null): string | undefined => {
        if (!token) return undefined;
        const normalized = token.trim().toLowerCase();
        const map: Record<string, string> = {
          gray: "#6b7280",
          brown: "#a16207",
          orange: "#ea580c",
          yellow: "#ca8a04",
          green: "#16a34a",
          blue: "#2563eb",
          purple: "#9333ea",
          pink: "#db2777",
          red: "#dc2626",
        };
        return map[normalized];
      };

      const parseDateCell = (raw: string): string | null => {
        const text = raw.trim();
        if (!text) return null;
        const ymd = text.match(/(\d{4})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})/);
        if (ymd) {
          const y = ymd[1];
          const m = ymd[2]?.padStart(2, "0");
          const d = ymd[3]?.padStart(2, "0");
          return `${y}-${m}-${d}`;
        }
        const short = text.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
        if (short) {
          const year = String(new Date().getFullYear());
          const m = short[1]?.padStart(2, "0");
          const d = short[2]?.padStart(2, "0");
          return `${year}-${m}-${d}`;
        }
        return null;
      };

      const ensurePageIdForSource = (sourcePath: string, forcedParentPageId?: string | null): string | null => {
        const source = pageByPath.get(sourcePath);
        if (!source) return null;
        const exists = importedPageIdByPath.get(source.path);
        if (exists) return exists;

        const parentSourcePath = findParentSourcePath(source.path);
        const structuralParentPageId = parentSourcePath
          ? ensurePageIdForSource(parentSourcePath)
          : null;
        const parentPageId = forcedParentPageId ?? structuralParentPageId ?? null;
        const pageId = createPage(source.title, parentPageId);
        importedPageIdByPath.set(source.path, pageId);
        return pageId;
      };

      const resolveImportedPageMention = (
        href: string,
        sourcePath: string,
        ownerPageId: string,
      ): { pageId: string; label?: string } | null => {
        const hrefNoHash = href.split("#")[0]?.split("?")[0] ?? href;
        const normalizedHref = decodeURIComponent(hrefNoHash).replace(/^\.\/+/, "");
        const resolvedPath = href.startsWith(".") || href.startsWith("/")
          ? (() => {
            const baseParts = sourcePath.split("/").slice(0, -1);
            for (const part of normalizedHref.split("/")) {
              if (!part || part === ".") continue;
              if (part === "..") baseParts.pop();
              else baseParts.push(part);
            }
            return baseParts.join("/");
          })()
          : normalizedHref;
        const normalizedResolvedPath = normalizeNotionPath(resolvedPath);
        const linked = Array.from(pageByPath.values()).find((p) => {
          const normalizedCandidatePath = normalizeNotionPath(p.path);
          if (normalizedCandidatePath === normalizedResolvedPath) return true;
          if (normalizedCandidatePath.endsWith(`/${normalizedResolvedPath}`)) return true;
          const candidateBase = normalizeNotionSegment(pathBasename(p.path));
          const targetBase = normalizeNotionSegment(pathBasename(resolvedPath));
          return candidateBase.length > 0 && candidateBase === targetBase;
        });
        if (!linked) return null;
        const linkedPageId = ensurePageIdForSource(linked.path, ownerPageId);
        if (!linkedPageId) return null;
        return { pageId: linkedPageId, label: linked.title };
      };

      const importPageFromSource = (sourcePath: string): string | null => {
        const source = pageByPath.get(sourcePath);
        if (!source) return null;
        const pageId = ensurePageIdForSource(source.path);
        if (!pageId) return null;
        if (importedDocByPath.has(source.path) || importingPath.has(source.path)) return pageId;
        importingPath.add(source.path);

        const doc: JSONContent = source.format === "html"
          ? notionHtmlToDoc(contentByPath.get(source.path) ?? "", {
            currentPagePath: source.path,
            resolveImageSrc: resolveExternalImageSrc,
            resolveImageNode: resolveImageNodeForPage(source.path),
            resolveMediaNode: resolveImageNodeForPage(source.path),
            iconReplacementText: "▪︎",
            resolvePageMentionByHref: (href) => resolveImportedPageMention(href, source.path, pageId),
            onCollectionTable: (table: NotionCollectionTable) => {
              const dbTitle = table.headers[0] || "Notion 데이터베이스";
              const dbId = createDatabase(dbTitle);
              const bundle = useDatabaseStore.getState().databases[dbId];
              const cols = bundle?.columns ?? [];
              const titleCol = cols.find((c) => c.type === "title");
              if (titleCol) {
                updateColumn(dbId, titleCol.id, { name: table.headers[0] || "제목" });
              }

              for (const c of cols) {
                if (c.type !== "title") removeColumn(dbId, c.id);
              }

              const extraColumnMeta: Array<{ id: string; type: ColumnType }> = [];
              for (let idx = 1; idx < table.headers.length; idx += 1) {
                const header = table.headers[idx] || `컬럼 ${idx + 1}`;
                const values = table.rows.map((row) => row.cells[idx] ?? "").filter((v) => v.trim().length > 0);
                const columnMeta = table.rows
                  .map((row) => row.cellMeta[idx])
                  .filter((meta): meta is { hasTimeTag: boolean; statusColorToken: string | null; statusLike: boolean } => !!meta);
                const hasTimeLike = columnMeta.some((meta) => meta.hasTimeTag);
                const hasStatusLike = columnMeta.some((meta) => meta.statusLike || !!meta.statusColorToken);
                const inferredType = inferColumnType(header, values);
                const colType: ColumnType = hasTimeLike
                  ? "date"
                  : hasStatusLike
                    ? "status"
                    : inferredType;
                const colId = addColumn(dbId, { name: header, type: colType });
                extraColumnMeta.push({ id: colId, type: colType });
                if (colType === "status") {
                  const optionByLabel = new Map<string, { label: string; color?: string }>();
                  table.rows.forEach((row) => {
                    const label = (row.cells[idx] ?? "").trim();
                    if (!label || optionByLabel.has(label)) return;
                    const color = notionStatusColorToQuickNote(row.cellMeta[idx]?.statusColorToken ?? null);
                    optionByLabel.set(label, { label, color });
                  });
                  const uniq = Array.from(optionByLabel.values());
                  updateColumn(dbId, colId, {
                    config: {
                      options: uniq.map((opt, optIdx) => ({
                        id: `${colId}-opt-${optIdx}`,
                        label: opt.label,
                        color: opt.color,
                      })),
                    },
                  });
                }
              }

              table.rows.forEach((row, rowIdx) => {
                const rowPageId =
                  rowIdx === 0
                    ? (useDatabaseStore.getState().databases[dbId]?.rowPageOrder[0] ?? addRow(dbId))
                    : addRow(dbId);
                renamePage(rowPageId, row.cells[0] || `항목 ${rowIdx + 1}`);
                for (let colIdx = 1; colIdx < row.cells.length; colIdx += 1) {
                  const colMeta = extraColumnMeta[colIdx - 1];
                  if (!colMeta) continue;
                  const rawCell = row.cells[colIdx] ?? "";
                  if (colMeta.type === "date") {
                    const parsed = parseDateCell(rawCell);
                    updateCell(dbId, rowPageId, colMeta.id, parsed ? { start: parsed } : rawCell);
                    continue;
                  }
                  updateCell(dbId, rowPageId, colMeta.id, rawCell);
                }

                if (row.titleLinkPath) {
                  const rowSource = pageByPath.get(row.titleLinkPath)
                    ?? Array.from(pageByPath.values()).find((p) => p.path.endsWith(row.titleLinkPath ?? ""));
                  const rowContent = rowSource?.format === "html" ? contentByPath.get(rowSource.path) : undefined;
                  if (rowSource && rowContent) {
                    const rowDoc = notionHtmlToDoc(rowContent, {
                      currentPagePath: rowSource.path,
                      resolveImageSrc: resolveExternalImageSrc,
                      resolveImageNode: resolveImageNodeForPage(rowSource.path),
                      resolveMediaNode: resolveImageNodeForPage(rowSource.path),
                      iconReplacementText: "▪︎",
                      resolvePageMentionByHref: (href) => resolveImportedPageMention(href, rowSource.path, rowPageId),
                    });
                    updateDoc(rowPageId, rowDoc);
                    setIcon(rowPageId, "📝");
                  }
                }
              });

              return dbId;
            },
          })
          : notionMarkdownToDoc(contentByPath.get(source.path) ?? "", { pageTitle: source.title });

        updateDoc(pageId, doc);
        setIcon(pageId, "📝");
        importedDocByPath.add(source.path);
        importingPath.delete(source.path);
        return pageId;
      };

      const isDescendantOfSelected = (candidatePath: string): boolean => {
        if (candidatePath === selectedPage.path) return true;
        let cursor = findParentSourcePath(candidatePath);
        let guard = 0;
        while (cursor && guard < 200) {
          if (cursor === selectedPage.path) return true;
          cursor = findParentSourcePath(cursor);
          guard += 1;
        }
        return false;
      };

      const subtreePaths = Array.from(pageByPath.values())
        .filter((p) => isDescendantOfSelected(p.path))
        .sort((a, b) => a.depth - b.depth)
        .map((p) => p.path);

      // 페이지 구조 먼저 생성 (컨텐츠 없이 빈 페이지 트리 구성)
      setImportProgress({ label: "페이지 구조 생성중", done: 0, total: subtreePaths.length });
      await yieldToPaint();
      subtreePaths.forEach((path) => { void ensurePageIdForSource(path); });

      // 1페이지씩 순차 처리: 컨텐츠 로드 → 에셋 업로드 → 문서 변환 → 메모리 해제
      const diagImportMem = (label: string) => {
        const m = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
        if (m) console.log(`[임포트진단] ${label} | 힙 ${(m.usedJSHeapSize / 1048576).toFixed(0)}MB / 한도 ${(m.jsHeapSizeLimit / 1048576).toFixed(0)}MB`);
        else console.log(`[임포트진단] ${label}`);
      };
      diagImportMem(`시작 — 서브트리 ${subtreePaths.length}페이지`);
      for (let idx = 0; idx < subtreePaths.length; idx += 1) {
        const path = subtreePaths[idx];
        if (!path) continue;
        const source = pageByPath.get(path);
        if (!source) continue;

        setImportProgress({ label: "임포트중", done: idx, total: subtreePaths.length, current: source.title ?? path });
        await yieldToPaint();

        diagImportMem(`[${idx + 1}/${subtreePaths.length}] 컨텐츠 로드 전: ${source.title}`);
        contentByPath.set(path, await source.readContent());
        const contentKb = ((contentByPath.get(path)?.length ?? 0) / 1024).toFixed(0);
        diagImportMem(`[${idx + 1}/${subtreePaths.length}] 컨텐츠 로드 후: ${contentKb}KB`);

        if (source.format === "html") {
          for (const asset of collectNotionAssetRefsFromHtml(contentByPath.get(path) ?? "", path, assetResolver)) {
            if (!uploadedAssetByPath.has(asset.path)) {
              try {
                uploadedAssetByPath.set(asset.path, await uploadNotionAsset(asset));
              } catch (error) {
                uploadedAssetByPath.set(asset.path, failedNotionAsset(asset, error));
              }
            }
          }
        }

        void importPageFromSource(path);

        // 처리 완료 후 컨텐츠 해제 → 다음 페이지 전 GC 대상
        contentByPath.delete(path);
        diagImportMem(`[${idx + 1}/${subtreePaths.length}] 페이지 완료`);
      }

      const newPageId = importedPageIdByPath.get(selectedPage.path) ?? null;
      if (!newPageId) return;
      const failedAssets = Array.from(uploadedAssetByPath.values()).filter((asset) => asset.kind === "failed");
      setImportMessage(
        failedAssets.length > 0
          ? `페이지 가져오기 완료: ${selectedPage.title} (첨부 ${failedAssets.length}개 실패)`
          : `페이지 가져오기 완료: ${selectedPage.title}`,
      );
      setStatus({ kind: "idle" });
      setSelectedPath("");
    } catch (error) {
      setImportMessage(
        `가져오기 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setImportProgress(null);
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
        <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Notion 가져오기</h3>
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
          ZIP을 미리 압축 해제한 뒤 폴더를 선택하면 메모리 문제 없이 대용량도 처리됩니다.
        </p>
        {isFolderPickerSupported() && (
          <button
            type="button"
            onClick={() => void onPickFolder()}
            className="mb-3 inline-flex items-center rounded bg-zinc-900 px-3 py-1.5 text-xs text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            압축 해제 폴더 선택
          </button>
        )}
        <div className="text-xs text-zinc-400 dark:text-zinc-500 mb-1">또는 ZIP 파일 직접 선택 (대용량은 크래시 위험)</div>
        <input
          type="file"
          accept=".zip,application/zip"
          onChange={(e) => void onPickZip(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-zinc-700 file:mr-3 file:rounded file:border-0 file:bg-zinc-900 file:px-3 file:py-1.5 file:text-xs file:text-white hover:file:bg-zinc-700 dark:text-zinc-200 dark:file:bg-zinc-100 dark:file:text-zinc-900"
        />
      </div>

      {status.kind === "loading" ? (
        <p className="text-sm text-zinc-500">ZIP 분석 중...</p>
      ) : null}

      {status.kind === "error" ? (
        <p className="text-sm text-red-500">{status.message}</p>
      ) : null}

      {status.kind === "ready" ? (
        <div className="relative space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            파일: {status.sourceName} | 총 파일 {status.preview.totalFiles}개 | MD {status.preview.markdownFileCount}개 | HTML {status.preview.htmlFileCount}개 | CSV {status.preview.csvFileCount}개 | 첨부 {status.preview.assetFileCount}개
          </div>

          {status.preview.pages.length === 0 ? (
            <p className="text-sm text-amber-600 dark:text-amber-400">페이지(.md)를 찾지 못했습니다. 내보내기 형식을 확인해 주세요.</p>
          ) : (
            <>
              <label className="block space-y-1 text-sm">
                <span className="text-zinc-700 dark:text-zinc-200">가져올 페이지 선택</span>
                <select
                  value={selectedPage?.path ?? ""}
                  onChange={(e) => setSelectedPath(e.target.value)}
                  className="w-full rounded border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                >
                  {status.preview.pages.map((page) => (
                    <option key={page.path} value={page.path}>
                      [{page.format.toUpperCase()}] {page.title} ({page.parentTitle ?? "root"})
                    </option>
                  ))}
                </select>
              </label>

              {selectedPage ? (
                <div className="rounded border border-zinc-100 bg-zinc-50 p-3 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-200">
                  <div>path: {selectedPage.path}</div>
                  <div>depth: {selectedPage.depth}</div>
                  <div>parent: {selectedPage.parentTitle ?? "(root)"}</div>
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-white p-2 text-[11px] dark:bg-zinc-950">
                    {previewContent
                      ? previewContent.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 600)
                      : "(로드 중...)"}
                  </pre>
                </div>
              ) : null}

              <div className="relative inline-flex">
                <button
                  type="button"
                  onClick={() => void onImportSelectedPage()}
                  disabled={isImporting}
                  className={`inline-flex items-center rounded px-3 py-1.5 text-sm text-white ${
                    isImporting
                      ? "cursor-not-allowed bg-zinc-400"
                      : "bg-blue-600 hover:bg-blue-700"
                  }`}
                >
                  {isImporting ? importingLabel : "선택 페이지 가져오기"}
                </button>
                {isImporting ? (
                  <div
                    className="absolute left-0 top-[calc(100%+6px)] z-[420] inline-flex max-w-[16rem] items-center gap-2 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-700 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                    aria-live="polite"
                  >
                    <Loader2 size={13} className="shrink-0 animate-spin text-blue-500" />
                    <span className="truncate">
                      {importingLabel}
                      {importProgress?.current ? ` · ${importProgress.current}` : ""}
                    </span>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>
      ) : null}

      {importMessage ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{importMessage}</p> : null}

      <NotionCsvFolderSection />
    </div>
  );
}
