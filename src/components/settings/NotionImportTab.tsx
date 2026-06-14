import { useEffect, useMemo, useRef, useState } from "react";
import type { NotionZipPreview } from "../../lib/notionImport/zipParser";
import { detectCsvDbPairsRecursive } from "../../lib/notionImport/csvFolderImporter";
import {
  scanNotionFolder,
  isFolderPickerSupported,
} from "../../lib/notionImport/folderScanner";
import type { NotionImportSource } from "../../lib/notionImport/importSource";
import { notionMarkdownToDoc } from "../../lib/notionImport/markdownToDoc";
import {
  splitPersonTokens,
  resolveImportedPersonMemberId,
} from "../../lib/notionImport/personName";
import {
  notionHtmlToDoc,
  extractNotionPageIcon,
  type NotionCollectionTable,
} from "../../lib/notionImport/htmlToDoc";
import {
  collectNotionAssetRefsFromHtml,
  createNotionAssetResolver,
  failedNotionAsset,
  uploadedAssetToDocNode,
  uploadNotionAsset,
  type UploadedNotionAsset,
} from "../../lib/notionImport/assetUpload";
import { NotionCsvFolderSection } from "./NotionCsvFolderSection";
import { createFilesVirtualDir, createTauriVirtualDir } from "../../lib/notionImport/zipVirtualFs";
import { usePageStore } from "../../store/pageStore";
import { flushDebouncedKeys } from "../../lib/sync/debouncePerKey";
import { useDatabaseStore } from "../../store/databaseStore";
import type { ColumnType } from "../../types/database";
import type { JSONContent } from "@tiptap/react";
import { Loader2 } from "lucide-react";
import { useBlockCommentStore } from "../../store/blockCommentStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useMemberStore } from "../../store/memberStore";
import { useUiStore } from "../../store/uiStore";
import { hydrateStructuralChildPageMentions } from "../../lib/notionImport/hydrateChildPageMentions";
import { resolveNotionPageHref } from "../../lib/notionImport/resolveNotionPageHref";
import {
  extractNotionInlineComments,
  ensureCommentAnchorBlockIds,
  resolveImportedCommentAuthorMemberId,
  resolveNotionCommentBlockId,
} from "../../lib/notionImport/commentImport";
import {
  inferNotionColumnType,
  mapNotionColorToQuickNote,
  normalizeImportedCellValue,
} from "../../lib/notionImport/columnInference";

type ImportStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "done"; message: string }
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
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [previewContent, setPreviewContent] = useState<string>("");
  const showToast = useUiStore((s) => s.showToast);
  const addComment = useBlockCommentStore((s) => s.addMessage);
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const me = useMemberStore((s) => s.me);
  const [sharedSource, setSharedSource] = useState<NotionImportSource | null>(null);
  const [hasDetectedDbSource, setHasDetectedDbSource] = useState(false);
  const [importCompleted, setImportCompleted] = useState(false);
  const canUseNativeFolderPicker = isFolderPickerSupported();
  const isSourceLoading = status.kind === "loading";
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const isTauriRuntime = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

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
  const shouldShowDbSection =
    !!sharedSource &&
    (hasDetectedDbSource || (status.kind === "ready" && status.preview.csvFileCount > 0));

  const onPickFolder = async () => {
    setStatus({ kind: "loading" });
    setImportCompleted(false);
    setHasDetectedDbSource(false);
    try {
      const dir = await window.showDirectoryPicker({ mode: "read" });
      setSharedSource({ kind: "folder-handle", label: dir.name, dir });
      const pairs = await detectCsvDbPairsRecursive(dir);
      setHasDetectedDbSource(pairs.length > 0);
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

  const onPickFolderFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setStatus({ kind: "loading" });
    setImportCompleted(false);
    setHasDetectedDbSource(false);
    try {
      const dir = createFilesVirtualDir(files);
      const firstPath = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath ?? files[0]?.name ?? "Notion export";
      const label = firstPath.split("/").filter(Boolean)[0] ?? "Notion export";
      setSharedSource({ kind: "folder-handle", label, dir });
      const pairs = await detectCsvDbPairsRecursive(dir);
      setHasDetectedDbSource(pairs.length > 0);
      const preview = await scanNotionFolder(dir);
      setStatus({ kind: "ready", preview, sourceName: label });
      const preferred = preview.pages.find((p) => p.format === "html") ?? preview.pages[0];
      setSelectedPath(preferred?.path ?? "");
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "폴더 분석 중 오류가 발생했습니다.",
      });
    }
  };

  const onPickTauriFolder = async () => {
    setStatus({ kind: "loading" });
    setImportCompleted(false);
    setHasDetectedDbSource(false);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        title: "Notion 내보내기 폴더 선택",
        directory: true,
        multiple: false,
        recursive: true,
      });
      if (selected === null || Array.isArray(selected)) {
        setStatus({ kind: "idle" });
        return;
      }
      const dir = createTauriVirtualDir(selected);
      const label = selected.split(/[\\/]/).filter(Boolean).pop() ?? "Notion export";
      setSharedSource({ kind: "folder-handle", label, dir });
      const pairs = await detectCsvDbPairsRecursive(dir);
      setHasDetectedDbSource(pairs.length > 0);
      const preview = await scanNotionFolder(dir);
      setStatus({ kind: "ready", preview, sourceName: label });
      const preferred = preview.pages.find((p) => p.format === "html") ?? preview.pages[0];
      setSelectedPath(preferred?.path ?? "");
    } catch (error) {
      console.error("[NotionImport] Tauri 폴더 선택 실패", error);
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "폴더 분석 중 오류가 발생했습니다.",
      });
    }
  };

  const onImportSelectedPage = async () => {
    const currentStatus = status;
    if (!selectedPage || currentStatus.kind !== "ready" || isImporting) return;
    setImportProgress({ label: "페이지 구성 준비중", done: 0, total: 1 });
    setIsImporting(true);
    setImportCompleted(false);
    await yieldToPaint();

    try {
      const pageByPath = new Map(currentStatus.preview.pages.map((p) => [p.path, p]));
      const importedPageIdByPath = new Map<string, string>();
      const importedDocByPath = new Set<string>();
      const importingPath = new Set<string>();
      // standalone 행 페이지가 DB 행 pageId 로 병합될 때, 그 이전에 만들어진 멘션 노드들이
      // 옛 pageId 를 가리키지 않도록 remap 을 추적한다. 임포트 끝에서 docs 를 일괄 재작성.
      const pageIdRemap = new Map<string, string>();
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

      // 부모 탐색을 O(1) 로 만들기 위해 dirname → 페이지 인덱스를 사전 구축한다.
      // (기존: 호출마다 Array.from(values).find 로 O(N) 스캔 → 페이지가 많으면 트리 구성 자체가 O(N²) 로 블로킹)
      const pagesByDirname = new Map<string, Array<{ path: string; segment: string }>>();
      for (const p of pageByPath.values()) {
        const dir = pathDirname(p.path);
        const segment = normalizeNotionSegment(pathBasename(p.path));
        let bucket = pagesByDirname.get(dir);
        if (!bucket) {
          bucket = [];
          pagesByDirname.set(dir, bucket);
        }
        bucket.push({ path: p.path, segment });
      }

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
        const bucket = pagesByDirname.get(parentDir) ?? [];
        const found =
          bucket.find((entry) => entry.path !== sourcePath && entry.segment === containerName)?.path ?? null;
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

      const applyImportedPageIcon = async (
        targetPageId: string,
        sourcePath: string,
        htmlContent: string | undefined,
      ): Promise<void> => {
        const iconInfo = extractNotionPageIcon(htmlContent ?? "");
        if (iconInfo?.imagePath) {
          const iconAsset = assetResolver.resolve(iconInfo.imagePath, sourcePath);
          if (iconAsset) {
            let uploaded = uploadedAssetByPath.get(iconAsset.path);
            if (!uploaded) {
              uploaded = await uploadNotionAsset(iconAsset);
              uploadedAssetByPath.set(iconAsset.path, uploaded);
            }
            // 회귀 방지: 과거에는 kind:"image" 일 때만 아이콘을 적용했다.
            // GIF·SVG·큰 PNG 등 압축 경로를 안 타고 fileBlock 으로 업로드된 경우(kind:"file")
            // 자산은 서버에 올라가지만 페이지 아이콘이 끝내 적용되지 않아 항상 기본 📝 로 떨어졌다.
            // isImageLikePageIcon 은 quicknote-file:// 도 이미지로 표시하므로 둘 다 ref 로 그대로 세팅한다.
            if ((uploaded.kind === "image" || uploaded.kind === "file") && uploaded.src) {
              setIcon(targetPageId, uploaded.src);
              return;
            }
          }
        }
        if (iconInfo?.emoji) {
          setIcon(targetPageId, iconInfo.emoji);
          return;
        }
        setIcon(targetPageId, "📝");
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
        // 구조적 부모(Notion 폴더 계층)가 진실의 원천이므로 우선 적용.
        // 멘션을 통해 다른 페이지에서 먼저 참조되더라도, 폴더 계층상의 실제 부모를 사용해야
        // "자식의 자식" 깊은 계층이 평탄화되지 않고 트리로 유지된다.
        // 구조적 부모가 없을 때에만 멘션 소유자(forcedParentPageId) 를 부모로 사용.
        const parentPageId = structuralParentPageId ?? forcedParentPageId ?? null;
        // 협업 ON 환경에서 import 페이지를 즉시 활성화하면, 본문(updateDoc)이 서버에 올라가기 전에
        // 빈 협업 룸이 바인딩·잠겨 본문이 Y.Doc 에 영영 반영되지 않는다(웹앱 본문 공백 버그).
        // CSV 가져오기와 동일하게 활성화하지 않는다 — 본문 동기화 후 사용자가 직접 열면 정상 시드된다.
        const pageId = createPage(source.title, parentPageId, { activate: false });
        importedPageIdByPath.set(source.path, pageId);
        return pageId;
      };

      const notionPathNormalizer = {
        normalizePath: normalizeNotionPath,
        normalizeSegment: normalizeNotionSegment,
        pathDirname,
        pathBasename,
      };

      const resolveImportedPageMention = (
        href: string,
        sourcePath: string,
        ownerPageId: string,
      ): { pageId: string; label?: string; intraPage?: boolean } | null => {
        const linked = resolveNotionPageHref(
          href,
          sourcePath,
          Array.from(pageByPath.values()),
          notionPathNormalizer,
        );
        if (!linked) return null;
        const linkedPageId = ensurePageIdForSource(linked.path, ownerPageId);
        if (!linkedPageId) return null;
        // 해소된 페이지가 지금 임포트 중인 현재 페이지 자신이면 자기참조 링크 신호.
        const intraPage = linkedPageId === ownerPageId;
        return { pageId: linkedPageId, label: linked.title, intraPage };
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
              // 전체 페이지 호스트는 임포트 중 미리 만들지 않는다.
              // (사전 생성이 활성 페이지 전환/렌더 사이클과 얽혀 fullPage 진입 시 화면 먹통 회귀가 있었음)
              // 대신 인라인 헤더의 "전체 페이지로 이동" 버튼이 항상 노출되며 클릭 시점에 lazy-create 한다.
              const bundle = useDatabaseStore.getState().databases[dbId];
              const cols = bundle?.columns ?? [];
              const titleCol = cols.find((c) => c.type === "title");
              if (titleCol) {
                updateColumn(dbId, titleCol.id, { name: table.headers[0] || "제목" });
              }

              for (const c of cols) {
                if (c.type !== "title") removeColumn(dbId, c.id);
              }

              // 컬럼별 옵션 라벨 → 옵션 ID 매핑. 셀 값을 옵션 ID 로 정확히 저장하기 위해 필요.
              // (DatabaseCellDisplay 는 옵션 ID 로만 칩을 찾기 때문에, 라벨 그대로 저장하면 표시되지 않음)
              const labelToOptionIdByColId = new Map<string, Map<string, string>>();
              const extraColumnMeta: Array<{ id: string; type: ColumnType }> = [];
              for (let idx = 1; idx < table.headers.length; idx += 1) {
                const header = table.headers[idx] || `컬럼 ${idx + 1}`;
                const values = table.rows.map((row) => row.cells[idx] ?? "").filter((v) => v.trim().length > 0);
                const columnMeta = table.rows
                  .map((row) => row.cellMeta[idx])
                  .filter((meta) => meta != null);
                const colType: ColumnType = inferNotionColumnType({
                  header,
                  values,
                  meta: columnMeta,
                });
                const colId = addColumn(dbId, { name: header, type: colType });
                extraColumnMeta.push({ id: colId, type: colType });
                if (colType === "status" || colType === "select" || colType === "multiSelect") {
                  const optionByLabel = new Map<string, { label: string; color?: string }>();
                  table.rows.forEach((row) => {
                    const meta = row.cellMeta[idx];
                    if (meta?.selectedOptions?.length) {
                      for (const opt of meta.selectedOptions) {
                        if (!opt.label || optionByLabel.has(opt.label)) continue;
                        optionByLabel.set(opt.label, {
                          label: opt.label,
                          color: mapNotionColorToQuickNote(opt.colorToken),
                        });
                      }
                      return;
                    }
                    const raw = (row.cells[idx] ?? "").trim();
                    if (!raw) return;
                    const parts =
                      colType === "multiSelect"
                        ? raw.split(/[;,/|]/).map((s) => s.trim()).filter(Boolean)
                        : [raw];
                    parts.forEach((label) => {
                      if (!label || optionByLabel.has(label)) return;
                      optionByLabel.set(label, {
                        label,
                        color: mapNotionColorToQuickNote(meta?.statusColorToken ?? null),
                      });
                    });
                  });
                  const uniq = Array.from(optionByLabel.values());
                  const labelMap = new Map<string, string>();
                  const builtOptions = uniq.map((opt, optIdx) => {
                    const id = `${colId}-opt-${optIdx}`;
                    labelMap.set(opt.label, id);
                    return { id, label: opt.label, color: opt.color };
                  });
                  labelToOptionIdByColId.set(colId, labelMap);
                  updateColumn(dbId, colId, {
                    config: { options: builtOptions },
                  });
                }
              }

              for (const [rowIdx, row] of table.rows.entries()) {
                const rowPageId =
                  rowIdx === 0
                    ? (useDatabaseStore.getState().databases[dbId]?.rowPageOrder[0] ?? addRow(dbId))
                    : addRow(dbId);
                renamePage(rowPageId, row.cells[0] || `항목 ${rowIdx + 1}`);
                // 행 HTML 파일이 폴더 스캔으로 별도 페이지로 잡혀 있을 수 있다.
                // 그 path 를 이 DB 행 pageId 로 미리 등록해 두면, 이후 for-loop 가
                // 같은 path 를 다시 만나도 새 페이지를 만들지 않고 본문만 채워준다.
                // (이 등록을 빠뜨리면 행 페이지가 standalone + DB 행 으로 2개 생성됨)
                if (row.titleLinkPath) {
                  const rowSourceForMap = pageByPath.get(row.titleLinkPath)
                    ?? Array.from(pageByPath.values()).find((p) => p.path.endsWith(row.titleLinkPath ?? ""));
                  if (rowSourceForMap) {
                    const previousId = importedPageIdByPath.get(rowSourceForMap.path);
                    importedPageIdByPath.set(rowSourceForMap.path, rowPageId);
                    // 이미 mention 등으로 standalone 페이지가 먼저 만들어진 경우, 그 자식들만 DB 행 페이지로 이관한다.
                    // standalone 자체는 삭제하지 않는다 — 이미 변환된 다른 페이지들의 멘션 노드들이 그 pageId 를
                    // 가리키고 있어 삭제하면 dangling 으로 클릭 이동이 막힘. (페이지가 비어 보이는 잔재는
                    // 사용자가 수동 정리 가능하며, 데이터 손실보다 안전한 트레이드오프)
                    if (previousId && previousId !== rowPageId) {
                      const pagesNow = usePageStore.getState().pages;
                      const childrenOfPrev = Object.values(pagesNow).filter(
                        (p) => p.parentId === previousId,
                      );
                      const movePage = usePageStore.getState().movePage;
                      for (const child of childrenOfPrev) {
                        movePage(child.id, rowPageId, 0);
                      }
                      // 이전에 mention 으로 만들어진 standalone 의 pageId 를 가리키던 멘션 노드들이
                      // 클릭 시 빈 페이지로 떨어지지 않도록, 임포트 끝에서 docs 를 일괄 재작성하기 위해 remap 기록.
                      pageIdRemap.set(previousId, rowPageId);
                    }
                  }
                }
                for (let colIdx = 1; colIdx < row.cells.length; colIdx += 1) {
                  const colMeta = extraColumnMeta[colIdx - 1];
                  if (!colMeta) continue;
                  const rawCell = row.cells[colIdx] ?? "";

                  // select/status/multiSelect 는 옵션 ID 로 저장해야 셀 표시가 동작한다.
                  // 1) 셀 메타의 selectedOptions 라벨을 우선 사용 (Notion HTML 의 정확한 옵션 정보)
                  // 2) 메타가 없으면 rawCell 텍스트를 라벨로 간주
                  if (
                    colMeta.type === "select" ||
                    colMeta.type === "status" ||
                    colMeta.type === "multiSelect"
                  ) {
                    const labelMap = labelToOptionIdByColId.get(colMeta.id);
                    const meta = row.cellMeta[colIdx];
                    const labels: string[] = meta?.selectedOptions?.length
                      ? meta.selectedOptions.map((o) => o.label).filter(Boolean)
                      : colMeta.type === "multiSelect"
                        ? rawCell.split(/[;,/|]/).map((s) => s.trim()).filter(Boolean)
                        : rawCell.trim()
                          ? [rawCell.trim()]
                          : [];
                    const ids = labels
                      .map((label) => labelMap?.get(label))
                      .filter((id): id is string => !!id);
                    if (colMeta.type === "multiSelect") {
                      updateCell(dbId, rowPageId, colMeta.id, ids);
                    } else {
                      updateCell(dbId, rowPageId, colMeta.id, ids[0] ?? "");
                    }
                    continue;
                  }

                  // person 은 이름("최진평[CAT]" → "최진평")을 추출해 구성원과 매칭한 memberId 로 저장.
                  // 매칭 실패는 표시하지 않도록 제외한다.
                  if (colMeta.type === "person") {
                    const members = useMemberStore.getState().members;
                    const ids = splitPersonTokens(rawCell)
                      .map((token) => resolveImportedPersonMemberId(token, members, ""))
                      .filter((id): id is string => !!id);
                    updateCell(dbId, rowPageId, colMeta.id, Array.from(new Set(ids)));
                    continue;
                  }

                  updateCell(
                    dbId,
                    rowPageId,
                    colMeta.id,
                    normalizeImportedCellValue(colMeta.type, rawCell),
                  );
                }

                if (row.titleLinkPath) {
                  const rowSource = pageByPath.get(row.titleLinkPath)
                    ?? Array.from(pageByPath.values()).find((p) => p.path.endsWith(row.titleLinkPath ?? ""));
                  const rowContent = rowSource?.format === "html" ? contentByPath.get(rowSource.path) : undefined;
                  if (rowSource && rowContent) {
                    // DB 행 링크 페이지에 또 다른 collection-content(DB)가 있으면
                    // 여기서 즉시 변환하지 않고, 아래 일반 페이지 임포트 단계에서 1회만 처리한다.
                    // (중복 변환/중첩 변환으로 인한 메모리 급증 방지)
                    if (/class=["'][^"']*collection-content[^"']*["']/i.test(rowContent)) {
                      continue;
                    }
                    const rowDoc = notionHtmlToDoc(rowContent, {
                      currentPagePath: rowSource.path,
                      resolveImageSrc: resolveExternalImageSrc,
                      resolveImageNode: resolveImageNodeForPage(rowSource.path),
                      resolveMediaNode: resolveImageNodeForPage(rowSource.path),
                      iconReplacementText: "▪︎",
                      resolvePageMentionByHref: (href) => resolveImportedPageMention(href, rowSource.path, rowPageId),
                    });
                    updateDoc(rowPageId, rowDoc);
                    void applyImportedPageIcon(rowPageId, rowSource.path, rowContent);
                  }
                }
              }

              return dbId;
            },
          })
          : notionMarkdownToDoc(contentByPath.get(source.path) ?? "", { pageTitle: source.title });

        const docWithAnchorIds = ensureCommentAnchorBlockIds(doc);
        updateDoc(pageId, docWithAnchorIds);
        if (source.format === "html") {
          void applyImportedPageIcon(pageId, source.path, contentByPath.get(source.path));
        } else {
          setIcon(pageId, "📝");
        }
        if (source.format === "html") {
          const comments = extractNotionInlineComments(contentByPath.get(source.path) ?? "");
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
              pageId,
              blockId: mappedBlockId,
              authorMemberId,
              bodyText: `${authorPrefix}${comment.bodyText}`.trim(),
              mentionMemberIds: [],
              parentId: null,
            });
          });
        }
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

      // 페이지 구조의 사전 일괄 생성은 제거.
      // - ensurePageIdForSource 가 재귀적으로 부모를 만들기 때문에 사전 패스 없이도 트리는 정확히 구축된다.
      // - 사전 패스는 DB 행 HTML 파일을 standalone 페이지로 먼저 만들어 버려, 이후 onCollectionTable 의
      //   addRow 와 충돌해 같은 행이 2개 페이지로 중복 생성되는 원인이었다.
      // - 또한 수천 페이지를 동기 루프로 한 번에 createPage 하면 메인 스레드를 길게 차단하고
      //   Zustand persist 가 매번 직렬화되면서 localStorage quota 초과로 크래시 가능.

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
          const htmlContent = contentByPath.get(path) ?? "";
          // collection-content(인라인 DB) 영역의 이미지(컬럼 속성 아이콘 등)는 업로드에서 제외한다.
          // DB 는 databaseBlock 으로 치환되고 컬럼 아이콘은 퀵노트 lucide 기본 아이콘을 쓰므로,
          // Notion 컬럼 헤더 아이콘을 자산으로 올리면 "미사용" 이미지로만 쌓인다.
          const collectionAssetPaths = new Set<string>();
          if (typeof DOMParser !== "undefined") {
            const parsed = new DOMParser().parseFromString(htmlContent, "text/html");
            const scopes = parsed.querySelectorAll(
              ".collection-content, table.collection-content, .collection_view_page-block",
            );
            for (const scope of scopes) {
              if (!(scope instanceof HTMLElement)) continue;
              const scopedDoc = document.implementation.createHTMLDocument("");
              scopedDoc.body.appendChild(scope.cloneNode(true));
              for (const a of collectNotionAssetRefsFromHtml(scopedDoc, path, assetResolver)) {
                collectionAssetPaths.add(a.path);
              }
            }
          }
          for (const asset of collectNotionAssetRefsFromHtml(htmlContent, path, assetResolver)) {
            if (collectionAssetPaths.has(asset.path)) continue;
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

      // link-to-page href 해석 실패로 제목 텍스트만 남은 문단 → 구조적 자식 페이지 멘션으로 보강
      {
        const updateDocForHydrate = usePageStore.getState().updateDoc;
        for (const [sourcePath, pageId] of importedPageIdByPath.entries()) {
          const childEntries = Array.from(importedPageIdByPath.entries()).filter(
            ([childPath]) => findParentSourcePath(childPath) === sourcePath,
          );
          if (childEntries.length === 0) continue;
          const children = childEntries.map(([childPath, childPageId]) => ({
            pageId: childPageId,
            title: pageByPath.get(childPath)?.title ?? "",
          }));
          const page = usePageStore.getState().pages[pageId];
          if (!page?.doc) continue;
          const { doc: hydrated, changed } = hydrateStructuralChildPageMentions(page.doc, children);
          if (changed) updateDocForHydrate(pageId, hydrated);
        }
      }

      // 임포트 끝에서 멘션 id remap — standalone → DB 행 병합 시 옛 pageId 를 가리키던 멘션 노드들을
      // 새 pageId 로 일괄 재작성. 그렇지 않으면 클릭 시 빈 standalone 으로 이동해 "이동 안됨" 처럼 보임.
      if (pageIdRemap.size > 0) {
        const remapMentionIds = (node: unknown): boolean => {
          if (!node || typeof node !== "object") return false;
          const rec = node as { type?: unknown; attrs?: Record<string, unknown>; content?: unknown[] };
          let changed = false;
          if (rec.type === "mention" && rec.attrs && typeof rec.attrs.id === "string") {
            const raw = rec.attrs.id;
            const bare = raw.startsWith("p:") ? raw.slice(2) : raw;
            const remapped = pageIdRemap.get(bare);
            if (remapped) {
              rec.attrs.id = `p:${remapped}`;
              changed = true;
            }
          }
          if (Array.isArray(rec.content)) {
            for (const child of rec.content) if (remapMentionIds(child)) changed = true;
          }
          return changed;
        };
        const allPages = usePageStore.getState().pages;
        const updateDocAction = usePageStore.getState().updateDoc;
        for (const pageId of importedPageIdByPath.values()) {
          const page = allPages[pageId];
          if (!page || !page.doc) continue;
          const cloned = structuredClone(page.doc);
          if (remapMentionIds(cloned)) updateDocAction(pageId, cloned);
        }
      }

      // 임포트 후 재배치 패스 — 멘션 우선 처리/등록 순서로 인해 일시적으로 잘못 잡혔을 수 있는
      // parentId 를 구조적 부모(Notion 폴더 계층) 기준으로 일관성 있게 재정렬한다.
      // (이걸 빠뜨리면 깊은 자식 페이지들이 root 직속으로 평탄화되어 보이는 회귀가 발생)
      const movePage = usePageStore.getState().movePage;
      for (const [sourcePath, pageId] of importedPageIdByPath.entries()) {
        const parentSourcePath = findParentSourcePath(sourcePath);
        if (!parentSourcePath) continue;
        const desiredParentPageId = importedPageIdByPath.get(parentSourcePath);
        if (!desiredParentPageId || desiredParentPageId === pageId) continue;
        const currentParent = usePageStore.getState().pages[pageId]?.parentId ?? null;
        if (currentParent === desiredParentPageId) continue;
        movePage(pageId, desiredParentPageId, 0);
      }

      const newPageId = importedPageIdByPath.get(selectedPage.path) ?? null;
      if (!newPageId) {
        const doneMessage = "가져오기를 완료했지만 시작 페이지를 찾지 못했습니다.";
        showToast(doneMessage, { kind: "info" });
        setStatus({ kind: "done", message: doneMessage });
      } else {
        const doneMessage = "모든 페이지 생성이 완료되었습니다.";
        showToast(doneMessage, { kind: "success" });
        setStatus({ kind: "done", message: doneMessage });
      }
      setImportCompleted(true);
      setSelectedPath("");
    } catch (error) {
      console.error("[NotionImport] 가져오기 실패", error);
      showToast(
        error instanceof Error ? `가져오기 실패: ${error.message}` : "가져오기 중 오류가 발생했습니다.",
        { kind: "error" },
      );
    } finally {
      setImportProgress(null);
      setIsImporting(false);
      // 가져오기 종료 시 대기 중인 doc 동기화(`page:` 2초 idle 디바운스)를 즉시 발사한다.
      // 다중 페이지 import 의 마지막 페이지들이나 종료 직후 앱 전환 시 본문 enqueue 가
      // 유실돼 서버에 "제목만 있고 본문이 빈" 페이지가 남던 문제를 막는다.
      flushDebouncedKeys();
    }
  };

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900/40">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
          <li>Notion에서 HTML 포맷으로 모든 옵션을 활성화한 상태에서 zip 파일을 내려받습니다.</li>
          <li>내려받은 zip 압축 파일을 해제합니다.</li>
          <li>"파일 선택"을 누른 후 압축 해제한 폴더를 선택합니다.</li>
          <li>"가져오기" 버튼을 클릭합니다.</li>
        </ol>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (isSourceLoading) return;
                if (canUseNativeFolderPicker) {
                  void onPickFolder();
                  return;
                }
                if (isTauriRuntime) {
                  void onPickTauriFolder();
                  return;
                }
                folderInputRef.current?.click();
              }}
              disabled={isSourceLoading}
              className="inline-flex items-center rounded bg-zinc-900 px-3 py-1.5 text-xs text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {isSourceLoading ? <Loader2 size={12} className="mr-1.5 animate-spin" /> : null}
              파일 선택
            </button>
            <input
              ref={folderInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                void onPickFolderFiles(files);
              }}
              {...{ webkitdirectory: "", directory: "" }}
            />
          </div>
        </div>
      </section>

      {status.kind === "ready" ? (
        <div className="relative space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
          {status.preview.pages.length === 0 ? (
            null
          ) : (
            <>
              <label className="block text-sm">
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
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-white p-2 text-[11px] dark:bg-zinc-950">
                    {previewContent
                      ? previewContent.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 600)
                      : "(로드 중...)"}
                  </pre>
                </div>
              ) : null}

              {!shouldShowDbSection ? (
                <div className="relative inline-flex">
                  <button
                    type="button"
                    onClick={() => void onImportSelectedPage()}
                    disabled={isImporting || importCompleted}
                    className={`inline-flex items-center rounded px-3 py-1.5 text-sm text-white ${
                      isImporting || importCompleted
                        ? "cursor-not-allowed bg-zinc-400"
                        : "bg-blue-600 hover:bg-blue-700"
                    }`}
                  >
                    {isImporting ? importingLabel : importCompleted ? "가져오기 완료" : "가져오기"}
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
              ) : null}

            </>
          )}
        </div>
      ) : null}
      {shouldShowDbSection && sharedSource ? (
        <div className="relative space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
          <NotionCsvFolderSection compact sharedSource={sharedSource} />
        </div>
      ) : null}
      {status.kind === "error" ? (
        <p className="text-xs text-red-500">{status.message}</p>
      ) : null}
      {status.kind === "done" ? (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">{status.message}</p>
      ) : null}
    </div>
  );
}
