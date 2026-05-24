import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import {
  parseCsv,
  detectCsvDbPairsRecursive,
  buildFileMap,
  buildPreviewFromFileMap,
  findHtmlForRow,
  findChildHtmlPaths,
  type CsvDbPair,
} from "../../lib/notionImport/csvFolderImporter";
import { createZipVirtualDir } from "../../lib/notionImport/zipVirtualFs";
import { prepareImageFileForUpload } from "../../lib/images/compressImage";
import { uploadImage } from "../../lib/images/upload";
import {
  createNotionAssetResolver,
  collectNotionAssetRefsFromHtml,
  uploadNotionAsset,
  failedNotionAsset,
  uploadedAssetToDocNode,
  type UploadedNotionAsset,
} from "../../lib/notionImport/assetUpload";
import { notionHtmlToDoc, extractNotionPageIcon, type NotionCollectionTable } from "../../lib/notionImport/htmlToDoc";
import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";
import type { ColumnType } from "../../types/database";
import type { JSONContent } from "@tiptap/react";
import {
  inferNotionColumnType,
  mapNotionColorToQuickNote,
  normalizeImportedCellValue,
} from "../../lib/notionImport/columnInference";
import type { NotionImportSource } from "../../lib/notionImport/importSource";
import { useBlockCommentStore } from "../../store/blockCommentStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useMemberStore } from "../../store/memberStore";
import {
  extractNotionInlineComments,
  ensureCommentAnchorBlockIds,
  resolveImportedCommentAuthorMemberId,
  resolveNotionCommentBlockId,
} from "../../lib/notionImport/commentImport";
import { pauseStorageWrites, resumeStorageWrites } from "../../lib/storage/index";

type SectionStatus =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "ready"; pairs: CsvDbPair[]; dirName: string }
  | { kind: "importing" }
  | { kind: "done"; rowsImported: number; failed: number }
  | { kind: "error"; message: string };

type ImportProgress = {
  pairIdx: number;
  pairTotal: number;
  pairLabel: string;
  rowIdx: number;
  rowTotal: number;
  rowTitle: string;
  phase: "파일맵 구성" | "DB 생성" | "항목 처리" | "에셋 업로드" | "중첩 DB 처리" | "완료";
  assetIdx?: number;
  assetTotal?: number;
};

function yieldToPaint(): Promise<void> {
  // setTimeout(0)으로 마이크로태스크 큐를 비우고 GC 기회를 제공
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function runConcurrent<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      await fn(items[current] as T);
    }
  });
  await Promise.all(workers);
}

function stripNotionId(value: string): string {
  return value.replace(/\s+[0-9a-f]{32}$/i, "").trim();
}

function titleFromImportedHtmlPath(path: string): string {
  const fileName = path.split("/").pop() ?? "";
  return stripNotionId(fileName.replace(/\.html$/i, "")) || "자식 페이지";
}

function importedPathDepth(path: string): number {
  return path.split("/").filter(Boolean).length;
}

function safeDecodeImportHref(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(0, idx) : "";
}

function findParentHtmlPath(childPath: string, candidates: Set<string>): string | null {
  let dir = dirname(childPath);
  while (dir) {
    const exact = `${dir}.html`;
    if (candidates.has(exact)) return exact;
    const stripped = `${stripNotionId(dir)}.html`;
    if (candidates.has(stripped)) return stripped;
    dir = dirname(dir);
  }
  return null;
}

type NotionCsvFolderSectionProps = {
  compact?: boolean;
  sharedSource?: NotionImportSource | null;
};

export function NotionCsvFolderSection({ compact = false, sharedSource = null }: NotionCsvFolderSectionProps) {
  const createPage = usePageStore((s) => s.createPage);
  const updateDoc = usePageStore((s) => s.updateDoc);
  const setIcon = usePageStore((s) => s.setIcon);

  const createDatabase = useDatabaseStore((s) => s.createDatabase);
  const addColumn = useDatabaseStore((s) => s.addColumn);
  const updateColumn = useDatabaseStore((s) => s.updateColumn);
  const removeColumn = useDatabaseStore((s) => s.removeColumn);
  const importRowsBatch = useDatabaseStore((s) => s.importRowsBatch);

  const [status, setStatus] = useState<SectionStatus>({ kind: "idle" });
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const isImporting = status.kind === "importing";
  const addComment = useBlockCommentStore((s) => s.addMessage);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const me = useMemberStore((s) => s.me);

  const updateProgress = (update: Partial<ImportProgress>) => {
    setProgress((prev) => prev ? { ...prev, ...update } : null);
  };
  const usingSharedSource = sharedSource != null;

  const onPickFolder = async () => {
    setStatus({ kind: "scanning" });
    try {
      const dir = await window.showDirectoryPicker({ mode: "read" });
      const pairs = await detectCsvDbPairsRecursive(dir);
      if (pairs.length === 0) {
        setStatus({
          kind: "error",
          message: `"${dir.name}" 에서 CSV + 동명 폴더 쌍을 찾지 못했습니다. Notion HTML 내보내기 폴더를 선택해 주세요.`,
        });
        return;
      }
      setStatus({ kind: "ready", pairs, dirName: dir.name });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus({ kind: "idle" });
        return;
      }
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "폴더 스캔 중 오류가 발생했습니다.",
      });
    }
  };

  // ZIP 파일을 가상 디렉터리로 변환해 폴더 모드와 동일한 파이프라인으로 처리
  const onPickZip = async (file: File | null) => {
    if (!file) return;
    setStatus({ kind: "scanning" });
    try {
      const dir = await createZipVirtualDir(file);
      const pairs = await detectCsvDbPairsRecursive(dir);
      if (pairs.length === 0) {
        setStatus({
          kind: "error",
          message: `"${file.name}" 에서 CSV + 동명 폴더 쌍을 찾지 못했습니다. Notion HTML 내보내기 ZIP인지 확인해 주세요.`,
        });
        return;
      }
      setStatus({ kind: "ready", pairs, dirName: file.name });
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "ZIP 분석 중 오류가 발생했습니다.",
      });
    }
  };

  useEffect(() => {
    if (!sharedSource || isImporting) return;
    // 가져오기 완료/오류 상태에서는 재탐지 금지
    if (status.kind === "done" || status.kind === "error") return;
    if (sharedSource.kind === "folder-handle") {
      setStatus({ kind: "scanning" });
      void detectCsvDbPairsRecursive(sharedSource.dir)
        .then((pairs) => {
          if (pairs.length === 0) {
            setStatus({ kind: "idle" });
            return;
          }
          setStatus({ kind: "ready", pairs, dirName: sharedSource.label });
        })
        .catch((error) => {
          setStatus({
            kind: "error",
            message: error instanceof Error ? error.message : "폴더 스캔 중 오류가 발생했습니다.",
          });
        });
      return;
    }
    if (sharedSource.kind === "zip-file") {
      setStatus({ kind: "scanning" });
      void createZipVirtualDir(sharedSource.file)
        .then((dir) => detectCsvDbPairsRecursive(dir))
        .then((pairs) => {
          if (pairs.length === 0) {
            setStatus({ kind: "idle" });
            return;
          }
          setStatus({ kind: "ready", pairs, dirName: sharedSource.label });
        })
        .catch((error) => {
          setStatus({
            kind: "error",
            message: error instanceof Error ? error.message : "ZIP 분석 중 오류가 발생했습니다.",
          });
        });
      return;
    }
    // folder-files 는 DB 가져오기 파이프라인에서 가상 디렉터리 재구성이 필요해 현재는 미지원.
    setStatus({
      kind: "error",
      message: "선택한 폴더 형식은 DB 가져오기에서 아직 지원되지 않습니다. 폴더 선택(권장) 또는 ZIP 파일 선택을 사용해 주세요.",
    });
  }, [isImporting, sharedSource, status.kind]);

  const onImport = async () => {
    if (status.kind !== "ready") return;
    const { pairs } = status;
    setStatus({ kind: "importing" });
    // import 중 Zustand persist 직렬화를 차단 — 완료 시 한 번에 flush
    pauseStorageWrites();

    let totalRowsImported = 0;
    let totalFailed = 0;
    const dbIdByFolderPath = new Map<string, string>();
    const dbPageIdByFolderPath = new Map<string, string>();
    const pageIdByImportedPath = new Map<string, string>();
    const pageIdByComparablePath = new Map<string, string>();
    const ambiguousComparablePaths = new Set<string>();
    const knownDbFolderPaths = new Set(pairs.map((p) => p.folderPath));
    const knownDbFolderPathList = Array.from(knownDbFolderPaths).sort((a, b) => b.length - a.length);
    const normalizeImportPath = (path: string): string => {
      const parts: string[] = [];
      for (const part of path.replace(/\\/g, "/").replace(/^\.\/+/, "").split("/")) {
        if (!part || part === ".") continue;
        if (part === "..") parts.pop();
        else parts.push(part);
      }
      return parts.join("/");
    };
    const comparableImportedPath = (path: string): string => {
      const normalized = normalizeImportPath(path.replace(/\.html$/i, ""));
      return normalized
        .split("/")
        .map((part) => stripNotionId(part).toLowerCase())
        .join("/");
    };
    const registerImportedPagePath = (path: string, pageId: string): void => {
      const exact = normalizeImportPath(path);
      if (!exact) return;
      pageIdByImportedPath.set(exact, pageId);
      const comparable = comparableImportedPath(exact);
      const existing = pageIdByComparablePath.get(comparable);
      if (existing && existing !== pageId) {
        ambiguousComparablePaths.add(comparable);
        return;
      }
      if (!ambiguousComparablePaths.has(comparable)) pageIdByComparablePath.set(comparable, pageId);
    };
    const registerImportedPageId = (folderPath: string, localPath: string, pageId: string): void => {
      registerImportedPagePath(localPath, pageId);
      registerImportedPagePath(`${folderPath}/${localPath}`, pageId);
    };
    const resolveImportedPageId = (path: string): string | null => {
      const exact = pageIdByImportedPath.get(normalizeImportPath(path));
      if (exact) return exact;
      const comparable = comparableImportedPath(path);
      if (ambiguousComparablePaths.has(comparable)) return null;
      return pageIdByComparablePath.get(comparable) ?? null;
    };
    const resolveRelativeImportPath = (basePath: string, href: string): string => {
      const baseParts = basePath.split("/").slice(0, -1);
      for (const part of href.split("/")) {
        if (!part || part === ".") continue;
        if (part === "..") baseParts.pop();
        else baseParts.push(part);
      }
      return normalizeImportPath(baseParts.join("/"));
    };

    try {
      for (const pair of pairs) {
        if (!dbIdByFolderPath.has(pair.folderPath)) {
          dbIdByFolderPath.set(pair.folderPath, createDatabase(pair.folderBase));
        }
        if (!dbPageIdByFolderPath.has(pair.folderPath)) {
          const dbPageId = createPage(pair.folderBase, null, { activate: false });
          dbPageIdByFolderPath.set(pair.folderPath, dbPageId);
          registerImportedPagePath(`${pair.folderPath}.html`, dbPageId);
        }
      }

      for (let pairIdx = 0; pairIdx < pairs.length; pairIdx++) {
        const pair = pairs[pairIdx];
        if (!pair) continue;

        setProgress({
          pairIdx,
          pairTotal: pairs.length,
          pairLabel: pair.folderBase,
          rowIdx: 0,
          rowTotal: 0,
          rowTitle: "",
          phase: "파일맵 구성",
        });
        await yieldToPaint();

        // DB 폴더 내 파일 맵 구축
        const fileMap = new Map<string, FileSystemFileHandle>();
        await buildFileMap(pair.folderHandle, "", fileMap);
        const allPaths = Array.from(fileMap.keys());
        const localDbFolderRoots = new Set<string>();
        for (const p of allPaths) {
          if (!p.toLowerCase().endsWith(".csv")) continue;
          const withoutExt = p.replace(/\.[^.]+$/, "");
          const baseName = withoutExt.split("/").pop() ?? "";
          const base = baseName.replace(/\s+[0-9a-f]{32}$/i, "").trim();
          const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
          const root = dir ? `${dir}/${base}` : base;
          if (allPaths.some((candidate) => candidate.startsWith(`${root}/`))) {
            localDbFolderRoots.add(root);
          }
        }
        const preview = buildPreviewFromFileMap(fileMap);
        const assetResolver = createNotionAssetResolver(preview);

        const resolveDbFolderPathFromSampleLink = (sampleLink: string | null): string | null => {
          if (!sampleLink) return null;
          const localPath = normalizeImportPath(sampleLink);
          const globalPath = normalizeImportPath(`${pair.folderPath}/${localPath}`);
          return knownDbFolderPathList.find((root) =>
            globalPath === root ||
            globalPath.startsWith(`${root}/`) ||
            localPath === root ||
            localPath.startsWith(`${root}/`),
          ) ?? null;
        };

        // CSV 읽기
        updateProgress({ phase: "DB 생성" });
        await yieldToPaint();
        const csvFile = await pair.csvHandle.getFile();
        const csvData = parseCsv(await csvFile.text());
        if (csvData.headers.length === 0 || csvData.rows.length === 0) continue;
        const rowPlans = csvData.rows.map((row, rowIdx) => {
          const rowTitle = (row[0] ?? "").trim() || `항목 ${rowIdx + 1}`;
          const htmlRelPath = findHtmlForRow(rowTitle, allPaths);
          const childHtmlPaths = htmlRelPath
            ? findChildHtmlPaths(htmlRelPath, allPaths).sort((a, b) => a.localeCompare(b))
            : [];
          return { row, rowIdx, rowTitle, htmlRelPath, childHtmlPaths };
        });

        // 메인 DB HTML이 있으면 cellMeta(시간/상태 색)를 추출해 컬럼 타입 정확도 향상
        let collectionMeta: NotionCollectionTable | null = null;
        if (pair.mainHtmlHandle) {
          try {
            const mainFile = await pair.mainHtmlHandle.getFile();
            const mainHtml = await mainFile.text();
            // onCollectionTable 콜백으로 메타데이터 캡처 (DB 자체는 만들지 않고 정보만 추출)
            notionHtmlToDoc(mainHtml, {
              onCollectionTable: (table) => {
                collectionMeta = table;
                console.log(`[CSV가져오기] "${pair.folderBase}" 메인 HTML 메타 추출: 헤더 ${table.headers.length}개, 행 ${table.rows.length}개`, table.headers);
                return "";
              },
            });
            if (!collectionMeta) {
              console.warn(`[CSV가져오기] "${pair.folderBase}" 메인 HTML 에 collection-content 테이블이 없음 — 휴리스틱 사용`);
            }
          } catch (err) {
            console.warn(`[CSV가져오기] 메인 HTML 파싱 실패 — 휴리스틱 사용`, err);
          }
        } else {
          console.warn(`[CSV가져오기] "${pair.folderBase}" 메인 HTML 미발견 — 휴리스틱 사용`);
        }

        // QuickNote 데이터베이스 생성
        const dbId = dbIdByFolderPath.get(pair.folderPath);
        if (!dbId) continue;
        const bundle = useDatabaseStore.getState().databases[dbId];
        const cols = bundle?.columns ?? [];
        const titleCol = cols.find((c) => c.type === "title");
        if (titleCol) updateColumn(dbId, titleCol.id, { name: csvData.headers[0] || "제목" });
        for (const c of cols) {
          if (c.type !== "title") removeColumn(dbId, c.id);
        }

        // 추가 컬럼 생성 — cellMeta가 있으면 우선 사용, 없으면 휴리스틱
        const extraColIds: Array<{ id: string; type: ColumnType }> = [];
        for (let colIdx = 1; colIdx < csvData.headers.length; colIdx++) {
          const header = csvData.headers[colIdx] || `컬럼 ${colIdx + 1}`;
          const values = csvData.rows.map((r) => r[colIdx] ?? "").filter((v) => v.trim());

          // 메인 HTML에서 동일 헤더의 cellMeta 추출
          let colType: ColumnType;
          let inferSource = "휴리스틱";
          let metaColIdx = -1;
          if (collectionMeta) {
            const meta: NotionCollectionTable = collectionMeta;
            metaColIdx = meta.headers.findIndex((h) => h.trim() === header.trim());
            if (metaColIdx >= 0) {
              const cellMetas = meta.rows.map((r) => r.cellMeta[metaColIdx]).filter((m): m is NonNullable<typeof m> => !!m);
              colType = inferNotionColumnType({ header, values, meta: cellMetas });
              inferSource = "cellMeta+휴리스틱";
            } else {
              colType = inferNotionColumnType({ header, values });
              inferSource = "휴리스틱(헤더불일치)";
            }
          } else {
            colType = inferNotionColumnType({ header, values });
          }
          console.log(`[CSV가져오기] 컬럼 "${header}" → ${colType} (${inferSource})`);

          const colId = addColumn(dbId, { name: header, type: colType });
          extraColIds.push({ id: colId, type: colType });

          if (colType === "status" || colType === "multiSelect" || colType === "select") {
            // 선택/상태/다중선택 옵션 — cellMeta 의 selectedOptions(라벨+색) 우선 사용
            const labelToColor = new Map<string, string | undefined>();
            if (collectionMeta && metaColIdx >= 0) {
              const meta: NotionCollectionTable = collectionMeta;
              meta.rows.forEach((r) => {
                const cm = r.cellMeta[metaColIdx];
                if (!cm) return;
                if (cm.selectedOptions.length > 0) {
                  for (const opt of cm.selectedOptions) {
                    if (!labelToColor.has(opt.label)) {
                      labelToColor.set(opt.label, mapNotionColorToQuickNote(opt.colorToken));
                    }
                  }
                } else {
                  const label = (r.cells[metaColIdx] ?? "").trim();
                  if (label && !labelToColor.has(label)) {
                    labelToColor.set(label, mapNotionColorToQuickNote(cm.statusColorToken));
                  }
                }
              });
            }
            // CSV에 있지만 메타에 없는 라벨도 포함 (CSV는 콤마 구분 가능)
            for (const row of csvData.rows) {
              const raw = (row[colIdx] ?? "").trim();
              if (!raw) continue;
              const parts =
                colType === "multiSelect"
                  ? raw.split(/[;,/|]/).map((p) => p.trim()).filter(Boolean)
                  : [raw];
              for (const label of parts) {
                if (!labelToColor.has(label)) labelToColor.set(label, undefined);
              }
            }
            updateColumn(dbId, colId, {
              config: {
                options: Array.from(labelToColor.entries()).map(([label, color], i) => ({
                  id: `${colId}-opt-${i}`,
                  label,
                  color,
                })),
              },
            });
          }
        }

        // DB를 담을 부모 페이지 생성
        const dbPageId = dbPageIdByFolderPath.get(pair.folderPath) ?? createPage(pair.folderBase, null, { activate: false });
        dbPageIdByFolderPath.set(pair.folderPath, dbPageId);
        updateDoc(dbPageId, {
          type: "doc",
          content: [{ type: "databaseBlock", attrs: { databaseId: dbId } }],
        });

        // 아이콘 자산을 업로드해 image ref 로 변환 (실패시 null)
        const uploadIconImage = async (file: File): Promise<string | null> => {
          try {
            const prepared = await prepareImageFileForUpload(file);
            if (!prepared) return null;
            if (!["image/png", "image/jpeg", "image/webp"].includes(prepared.type)) return null;
            return await uploadImage(prepared);
          } catch (err) {
            console.warn("[CSV가져오기] 아이콘 업로드 실패", err);
            return null;
          }
        };

        // HTML 본문을 페이지에 채워넣는 공용 처리 — row/child/nested-row 페이지에서 재사용
        const memMB = (): string => {
          const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
          return m ? ` [heap ${(m.usedJSHeapSize / 1_048_576).toFixed(1)}MB]` : "";
        };

        const fillPageFromHtml = async (
          targetPageId: string,
          html: string,
          htmlRelPathParam: string,
          label: string,
        ): Promise<void> => {
          console.log(`[IMPORT-DBG] ▶ fillPageFromHtml 시작: "${label}" html=${(html.length/1024).toFixed(1)}KB${memMB()}`);
          updateProgress({ phase: "에셋 업로드" });
          // HTML을 1번만 파싱해 재사용 — 함수마다 별도 파싱하면 33행×4회=132회로 OOM 발생
          console.log(`[IMPORT-DBG]   [1/5] DOMParser.parseFromString${memMB()}`);
          const parsedDoc = typeof DOMParser !== "undefined"
            ? new DOMParser().parseFromString(html, "text/html")
            : null;
          console.log(`[IMPORT-DBG]   [2/5] collectNotionAssetRefsFromHtml${memMB()}`);
          const uploadedAssetByPath = new Map<string, UploadedNotionAsset>();
          const assetsToUpload = collectNotionAssetRefsFromHtml(parsedDoc ?? html, htmlRelPathParam, assetResolver);
          const uniqueAssets = assetsToUpload.filter(
            (a, i, arr) => a && arr.findIndex((b) => b?.path === a.path) === i,
          );
          console.log(`[CSV가져오기] "${label}" 에셋 ${uniqueAssets.length}개 (병렬 업로드)`);
          updateProgress({ phase: "에셋 업로드", assetIdx: 0, assetTotal: uniqueAssets.length });
          await Promise.all(uniqueAssets.map(async (asset) => {
            if (!asset) return;
            try {
              uploadedAssetByPath.set(asset.path, await uploadNotionAsset(asset));
            } catch (err) {
              console.warn(`[CSV가져오기] 에셋 업로드 실패: ${asset.name}`, err);
              uploadedAssetByPath.set(asset.path, failedNotionAsset(asset, err));
              totalFailed++;
            }
          }));
          const resolveImageNode = (src: string, element: HTMLElement): JSONContent | null => {
            const ast = assetResolver.resolve(src, htmlRelPathParam);
            if (!ast) return null;
            const up = uploadedAssetByPath.get(ast.path);
            if (!up) return null;
            return uploadedAssetToDocNode(up, element.getAttribute("alt") ?? "");
          };
          console.log(`[IMPORT-DBG]   [3/5] notionHtmlToDoc${memMB()}`);
          const doc = notionHtmlToDoc(parsedDoc ?? html, {
            currentPagePath: htmlRelPathParam,
            resolveImageSrc: (src) => /^https?:\/\//i.test(src) || src.startsWith("data:") ? src : null,
            resolveImageNode,
            resolveMediaNode: resolveImageNode,
            iconReplacementText: "▪︎",
            resolvePageMentionByHref: (href) => {
              if (/^(https?:|mailto:|tel:|data:|blob:|quicknote-)/i.test(href)) return null;
              const normalizedHref = safeDecodeImportHref(href.split("#")[0]?.split("?")[0] ?? href).replace(/^\.\/+/, "");
              if (!normalizedHref || normalizedHref.startsWith("#")) return null;
              const resolvedLocalPath = resolveRelativeImportPath(htmlRelPathParam, normalizedHref);
              const resolvedGlobalPath = resolveRelativeImportPath(`${pair.folderPath}/${htmlRelPathParam}`, normalizedHref);
              const linkedPageId =
                resolveImportedPageId(resolvedGlobalPath) ??
                resolveImportedPageId(resolvedLocalPath);
              if (!linkedPageId) return null;
              return { pageId: linkedPageId };
            },
            onCollectionTable: (table: NotionCollectionTable) => {
              const sampleLink = table.rows.find((r) => !!r.titleLinkPath)?.titleLinkPath ?? null;
              const matchedFolderPath = resolveDbFolderPathFromSampleLink(sampleLink);
              if (matchedFolderPath) {
                const existingDbId = dbIdByFolderPath.get(matchedFolderPath);
                if (existingDbId) {
                  // 이미 생성된 DB는 즉시 연결
                  return existingDbId;
                }
              }
              console.warn(`[CSV가져오기] CSV 쌍을 찾지 못한 인라인 DB는 건너뜀: ${htmlRelPathParam}`);
              return null;
            },
          });
          const docWithAnchorIds = ensureCommentAnchorBlockIds(doc);
          updateDoc(targetPageId, docWithAnchorIds);
          console.log(`[IMPORT-DBG]   [4/5] extractNotionInlineComments${memMB()}`);
          const comments = extractNotionInlineComments(parsedDoc ?? html);
          comments.forEach((comment) => {
            const mappedBlockId =
              resolveNotionCommentBlockId(docWithAnchorIds as { content?: Array<unknown> }, comment.blockText)
              ?? "__page__";
            const authorMemberId = resolveImportedCommentAuthorMemberId(
              comment.authorName,
              useMemberStore.getState().members,
              me?.memberId ?? "notion-import",
            );
            const authorPrefix = authorMemberId === (me?.memberId ?? "notion-import")
              ? `${comment.authorName ? `${comment.authorName}: ` : ""}`
              : "";
            addComment({
              workspaceId: currentWorkspaceId,
              pageId: targetPageId,
              blockId: mappedBlockId,
              authorMemberId,
              bodyText: `${authorPrefix}${comment.bodyText}`.trim(),
              mentionMemberIds: [],
              parentId: null,
            });
          });

          console.log(`[IMPORT-DBG]   [5/5] extractNotionPageIcon${memMB()}`);
          const iconInfo = extractNotionPageIcon(parsedDoc ?? html);
          if (iconInfo?.imagePath) {
            const iconAsset = assetResolver.resolve(iconInfo.imagePath, htmlRelPathParam);
            if (iconAsset) {
              try {
                const iconFile = await iconAsset.readAsFile();
                const ref = await uploadIconImage(iconFile);
                if (ref) {
                  setIcon(targetPageId, ref);
                  return;
                }
              } catch (err) {
                console.warn(`[CSV가져오기] 아이콘 처리 실패: ${label}`, err);
              }
            }
          }
          if (iconInfo?.emoji) {
            setIcon(targetPageId, iconInfo.emoji);
            return;
          }
          setIcon(targetPageId, "📝");
        };

        const localDbRootList = Array.from(localDbFolderRoots);
        const isNestedDbPath = (path: string): boolean =>
          localDbRootList.some((root) => path === `${root}.html` || path.startsWith(`${root}/`));
        const rowPageIdByIndex = new Map<number, string>();
        const childPageIdsByPath = new Map<string, string>();
        const childPagePathsByRowIndex = new Map<number, string[]>();

        // 1단계: 모든 행을 단일 importRowsBatch 호출로 생성 (setState 횟수 최소화)
        console.log(`[IMPORT-DBG] ▶ 1단계: importRowsBatch (${rowPlans.length}개)${memMB()}`);
        setProgress({
          pairIdx,
          pairTotal: pairs.length,
          pairLabel: pair.folderBase,
          rowIdx: 0,
          rowTotal: csvData.rows.length,
          rowTitle: rowPlans[0]?.rowTitle ?? "",
          phase: "항목 처리",
        });
        await yieldToPaint();

        const batchRowData = rowPlans.map(({ row, rowTitle }) => {
          const cells: Record<string, import("../../types/database").CellValue> = {};
          for (let colIdx = 1; colIdx < row.length; colIdx++) {
            const colMeta = extraColIds[colIdx - 1];
            if (!colMeta) continue;
            cells[colMeta.id] = normalizeImportedCellValue(colMeta.type, row[colIdx] ?? "");
          }
          return { title: rowTitle, cells };
        });

        const seedPageId = useDatabaseStore.getState().databases[dbId]?.rowPageOrder[0] ?? null;
        const allRowPageIds = importRowsBatch(dbId, seedPageId, batchRowData);
        console.log(`[IMPORT-DBG] ◀ importRowsBatch 완료 (${allRowPageIds.length}개)${memMB()}`);

        // 페이지 ID 등록 및 자식 페이지 생성 (별도 루프)
        for (const rowPlan of rowPlans) {
          const { row, rowIdx, htmlRelPath, childHtmlPaths } = rowPlan;
          if (!row) continue;
          const rowPageId = allRowPageIds[rowIdx];
          if (!rowPageId) continue;

          rowPageIdByIndex.set(rowIdx, rowPageId);
          if (htmlRelPath) registerImportedPageId(pair.folderPath, htmlRelPath, rowPageId);

          if (htmlRelPath) {
            const childPagePaths = childHtmlPaths
              .filter((childPath) => !isNestedDbPath(childPath))
              .sort((a, b) => importedPathDepth(a) - importedPathDepth(b) || a.localeCompare(b));
            childPagePathsByRowIndex.set(rowIdx, childPagePaths);
            const candidates = new Set([htmlRelPath, ...childPagePaths]);
            const childIdByPathInRow = new Map<string, string>();
            for (const childPath of childPagePaths) {
              const parentHtmlPath = findParentHtmlPath(childPath, candidates);
              const parentPageId =
                parentHtmlPath && parentHtmlPath !== htmlRelPath
                  ? (childIdByPathInRow.get(parentHtmlPath) ?? rowPageId)
                  : rowPageId;
              const childPageId = createPage(titleFromImportedHtmlPath(childPath), parentPageId, { activate: false });
              childIdByPathInRow.set(childPath, childPageId);
              childPageIdsByPath.set(childPath, childPageId);
              registerImportedPageId(pair.folderPath, childPath, childPageId);
            }
          }

          totalRowsImported++;
        }
        console.log(`[IMPORT-DBG] ◀ 1단계 완료${memMB()}`);

        // 페이지 ID 등록 이후 실제 HTML 본문과 에셋을 채운다.
        const totalHtmlFiles = allPaths.filter((p) => p.toLowerCase().endsWith(".html")).length;
        const matchedRowCount = rowPlans.filter((r) => r.htmlRelPath).length;
        console.log(
          `[CSV가져오기] 본문 매칭 결과: 행 ${rowPlans.length}개, HTML 파일 ${totalHtmlFiles}개, 매칭 ${matchedRowCount}개 (나머지는 빈 페이지)`,
        );
        console.log(`[IMPORT-DBG] ▶ 2단계: HTML 본문 채우기 루프 시작${memMB()}`);
        await runConcurrent(rowPlans, 3, async (rowPlan) => {
          const { rowIdx, rowTitle, htmlRelPath } = rowPlan;
          const rowPageId = rowPageIdByIndex.get(rowIdx);
          if (!rowPageId) return;

          setProgress({
            pairIdx,
            pairTotal: pairs.length,
            pairLabel: pair.folderBase,
            rowIdx,
            rowTotal: csvData.rows.length,
            rowTitle,
            phase: "항목 처리",
          });
          await yieldToPaint();

          // 매칭 HTML 파일 처리 — htmlRelPath 없으면 Notion 에서 빈 페이지로 export 된 경우.
          // (Notion 은 본문이 비어있는 행에 대해 HTML 파일을 생성하지 않는다.)
          // 행 자체는 1단계에서 이미 생성됐고 본문만 비어있는 것이므로 실패가 아니다.
          if (!htmlRelPath) {
            // 디버깅 편의를 위해 매칭 후보가 있었는지 한 번만 알려줌 (totalFailed 카운트는 하지 않음)
            console.debug(`[CSV가져오기] 본문 HTML 없음(빈 페이지): "${rowTitle}"`);
          } else {
            const htmlHandle = fileMap.get(htmlRelPath);
            if (htmlHandle) {
              try {
                const htmlFile = await htmlHandle.getFile();
                console.log(`[IMPORT-DBG] 행 [${rowIdx+1}/${csvData.rows.length}] "${rowTitle}" HTML 로드: ${(htmlFile.size/1024).toFixed(1)}KB${memMB()}`);
                const html = await htmlFile.text();
                await fillPageFromHtml(rowPageId, html, htmlRelPath, rowTitle);
                console.log(`[IMPORT-DBG] 행 [${rowIdx+1}/${csvData.rows.length}] "${rowTitle}" 완료${memMB()}`);

                // 자식 페이지(서브 폴더 내 HTML) 처리
                const childPagePaths = childPagePathsByRowIndex.get(rowIdx) ?? [];
                if (childPagePaths.length > 0) {
                  console.log(`[CSV가져오기] "${rowTitle}" 자식 페이지 ${childPagePaths.length}개`);
                }
                for (const childPath of childPagePaths) {
                  const childHandle = fileMap.get(childPath);
                  if (!childHandle) continue;
                  const childPageId = childPageIdsByPath.get(childPath);
                  if (!childPageId) continue;
                  try {
                    const childFile = await childHandle.getFile();
                    const childHtml = await childFile.text();
                    const childTitle = titleFromImportedHtmlPath(childPath);
                    updateProgress({ rowTitle: `${rowTitle} › ${childTitle}` });
                    await yieldToPaint();
                    await fillPageFromHtml(childPageId, childHtml, childPath, `${rowTitle} > ${childTitle}`);
                  } catch (err) {
                    console.warn(`[CSV가져오기] 자식 페이지 처리 실패: ${childPath}`, err);
                    totalFailed++;
                  }
                }
              } catch (err) {
                console.warn(`[CSV가져오기] HTML 처리 실패: ${rowTitle}`, err);
                totalFailed++;
              }
            }
          }
        });
      }

      setStatus({ kind: "done", rowsImported: totalRowsImported, failed: totalFailed });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[CSV가져오기] 오류:", error);
      setStatus({ kind: "error", message: `가져오기 실패: ${msg}` });
    } finally {
      setProgress(null);
      // import 완료 — 차단된 쓰기를 한 번에 flush
      await resumeStorageWrites();
    }
  };

  return (
    <div className={compact ? "space-y-3" : "rounded-lg border border-zinc-200 p-4 dark:border-zinc-700"}>
      {!compact && (
        <>
          <h3 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            CSV 기반 DB 가져오기 (ZIP 또는 폴더)
          </h3>
          <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
            Notion HTML 내보내기 ZIP을 그대로 선택하거나, 압축 해제한 폴더를 선택합니다. CSV + 동명 서브폴더를 재귀 탐색해 데이터베이스 항목을 1개씩 순차 처리합니다.
          </p>
        </>
      )}

      {!usingSharedSource && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void onPickFolder()}
            disabled={isImporting || status.kind === "scanning"}
            className="inline-flex items-center rounded bg-zinc-900 px-3 py-1.5 text-xs text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-400 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {status.kind === "scanning" && <Loader2 size={12} className="mr-1.5 animate-spin" />}
            {status.kind === "scanning" ? "스캔 중..." : "폴더 선택"}
          </button>

          <label className={`inline-flex cursor-pointer items-center rounded border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800 ${(isImporting || status.kind === "scanning") ? "pointer-events-none opacity-50" : ""}`}>
            ZIP 파일 선택
            <input
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                e.target.value = "";
                void onPickZip(file);
              }}
              disabled={isImporting || status.kind === "scanning"}
            />
          </label>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {status.kind === "ready" && (
          <button
            type="button"
            onClick={() => void onImport()}
            className="inline-flex items-center rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700"
          >
            가져오기 시작 ({status.pairs.length}개 DB)
          </button>
        )}
      </div>

      {/* 발견된 쌍 목록 */}
      {status.kind === "ready" && (
        <div className="mt-3 space-y-1.5">
          <p className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
            {status.dirName} — CSV+폴더 쌍 {status.pairs.length}개 발견
          </p>
          <ul className="max-h-36 overflow-y-auto rounded border border-zinc-100 bg-zinc-50 px-3 py-2 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300">
            {status.pairs.map((pair) => (
              <li key={pair.folderPath} className="truncate py-0.5">
                📊 {pair.folderBase}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 진행 패널 */}
      {isImporting && progress && (
        <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/40">
          {/* DB 진행 */}
          <div className="mb-2 flex items-center justify-between text-xs text-blue-700 dark:text-blue-300">
            <span className="font-medium truncate max-w-[70%]">📊 {progress.pairLabel}</span>
            <span className="shrink-0 tabular-nums">{progress.pairIdx + 1} / {progress.pairTotal} DB</span>
          </div>

          {/* DB 진행 바 */}
          <div className="mb-2.5 h-1.5 w-full overflow-hidden rounded-full bg-blue-200 dark:bg-blue-800">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-300"
              style={{ width: `${progress.pairTotal > 0 ? ((progress.pairIdx) / progress.pairTotal) * 100 : 0}%` }}
            />
          </div>

          {/* 행 진행 */}
          {progress.rowTotal > 0 && (
            <>
              <div className="mb-1.5 flex items-center gap-2 text-xs">
                <Loader2 size={12} className="shrink-0 animate-spin text-blue-500" />
                <span className="truncate text-zinc-700 dark:text-zinc-200">
                  {progress.rowTitle || "준비중"}
                  <span className="ml-1.5 text-zinc-400">
                    ({progress.phase}
                    {progress.phase === "에셋 업로드" && progress.assetTotal != null
                      ? ` ${(progress.assetIdx ?? 0) + 1}/${progress.assetTotal}`
                      : ""})
                  </span>
                </span>
                <span className="ml-auto shrink-0 tabular-nums text-zinc-500">
                  {progress.rowIdx + 1} / {progress.rowTotal}
                </span>
              </div>

              {/* 행 진행 바 */}
              <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                <div
                  className="h-full rounded-full bg-zinc-500 transition-all duration-150"
                  style={{ width: `${progress.rowTotal > 0 ? ((progress.rowIdx + 1) / progress.rowTotal) * 100 : 0}%` }}
                />
              </div>
            </>
          )}

          {progress.rowTotal === 0 && (
            <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <Loader2 size={12} className="animate-spin" />
              <span>{progress.phase}...</span>
            </div>
          )}
        </div>
      )}

      {/* 완료 메시지 */}
      {status.kind === "done" && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs dark:border-emerald-800 dark:bg-emerald-950/40">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-500" />
          <span className="text-emerald-700 dark:text-emerald-300">
            가져오기 완료: {status.rowsImported}개 항목
            {status.failed > 0 && ` (첨부 ${status.failed}개 실패)`}
          </span>
        </div>
      )}

      {/* 오류 메시지 */}
      {status.kind === "error" && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs dark:border-red-800 dark:bg-red-950/40">
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-500" />
          <span className="text-red-700 dark:text-red-300">{status.message}</span>
        </div>
      )}
    </div>
  );
}
