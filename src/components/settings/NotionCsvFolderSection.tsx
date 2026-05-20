import { useState } from "react";
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
  phase: "파일맵 구성" | "DB 생성" | "항목 처리" | "에셋 업로드" | "완료";
  assetIdx?: number;
  assetTotal?: number;
};

function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function inferColumnType(header: string, values: string[]): ColumnType {
  const h = header.toLowerCase();
  // 1) 헤더 키워드 매칭
  if (h.includes("직군")) return "status";
  if (h.includes("날짜") || h.includes("일자") || h.includes("date") || h.endsWith("일")) return "date";
  if (h.includes("상태") || h.includes("status")) return "status";
  if (h.includes("멘토") || h.includes("담당") || h.includes("person") || h.includes("작성자")) return "person";

  const nonEmpty = values.filter((v) => v.trim().length > 0);
  if (nonEmpty.length === 0) return "text";

  // 2) 값 패턴: 모두 숫자 → number
  if (nonEmpty.every((v) => /^-?\d+([.,]\d+)?$/.test(v.trim()))) return "number";

  // 3) 값 패턴: 모두 날짜처럼 보이면 → date
  const dateRe = /^\d{4}[.\-/년]\s*\d{1,2}[.\-/월]\s*\d{1,2}|\d{1,2}\s*\/\s*\d{1,2}/;
  if (nonEmpty.every((v) => dateRe.test(v.trim()))) return "date";

  // 4) 고유 값 ≤ 8 이고, 전체 행의 절반 이상이 그 값들이면 → status (선택 옵션 후보)
  const uniqueValues = new Set(nonEmpty.map((v) => v.trim()));
  if (uniqueValues.size > 0 && uniqueValues.size <= 8 && nonEmpty.length >= uniqueValues.size * 2) {
    return "status";
  }

  return "text";
}

function notionStatusColorToQuickNote(token: string | null | undefined): string | undefined {
  if (!token) return undefined;
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
  return map[token.trim().toLowerCase()];
}

function parseDateCell(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const ymd = text.match(/(\d{4})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})/);
  if (ymd) return `${ymd[1]}-${ymd[2]?.padStart(2, "0")}-${ymd[3]?.padStart(2, "0")}`;
  const short = text.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (short) return `${new Date().getFullYear()}-${short[1]?.padStart(2, "0")}-${short[2]?.padStart(2, "0")}`;
  return null;
}

export function NotionCsvFolderSection() {
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

  const [status, setStatus] = useState<SectionStatus>({ kind: "idle" });
  const [progress, setProgress] = useState<ImportProgress | null>(null);

  const updateProgress = (update: Partial<ImportProgress>) => {
    setProgress((prev) => prev ? { ...prev, ...update } : null);
  };

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

  const onImport = async () => {
    if (status.kind !== "ready") return;
    const { pairs } = status;
    setStatus({ kind: "importing" });

    let totalRowsImported = 0;
    let totalFailed = 0;

    try {
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
        const preview = buildPreviewFromFileMap(fileMap);
        const assetResolver = createNotionAssetResolver(preview);

        // CSV 읽기
        updateProgress({ phase: "DB 생성" });
        await yieldToPaint();
        const csvFile = await pair.csvHandle.getFile();
        const csvData = parseCsv(await csvFile.text());
        if (csvData.headers.length === 0 || csvData.rows.length === 0) continue;

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
        const dbId = createDatabase(pair.folderBase);
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
              const hasTimeLike = cellMetas.some((m) => m.hasTimeTag);
              const hasPerson = cellMetas.some((m) => m.hasPerson);
              const maxSelected = cellMetas.reduce((max, m) => Math.max(max, m.selectedCount), 0);
              const hasStatusLike = cellMetas.some((m) => m.statusLike || !!m.statusColorToken);
              if (hasTimeLike) { colType = "date"; inferSource = "cellMeta(time)"; }
              else if (hasPerson) { colType = "person"; inferSource = "cellMeta(person)"; }
              else if (maxSelected >= 2) { colType = "multiSelect"; inferSource = "cellMeta(multi)"; }
              else if (hasStatusLike || maxSelected === 1) { colType = "status"; inferSource = "cellMeta(status)"; }
              else { colType = inferColumnType(header, values); inferSource = "휴리스틱(메타없음)"; }
            } else {
              colType = inferColumnType(header, values);
              inferSource = "휴리스틱(헤더불일치)";
            }
          } else {
            colType = inferColumnType(header, values);
          }
          console.log(`[CSV가져오기] 컬럼 "${header}" → ${colType} (${inferSource})`);

          const colId = addColumn(dbId, { name: header, type: colType });
          extraColIds.push({ id: colId, type: colType });

          if (colType === "status" || colType === "multiSelect") {
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
                      labelToColor.set(opt.label, notionStatusColorToQuickNote(opt.colorToken));
                    }
                  }
                } else {
                  const label = (r.cells[metaColIdx] ?? "").trim();
                  if (label && !labelToColor.has(label)) {
                    labelToColor.set(label, notionStatusColorToQuickNote(cm.statusColorToken));
                  }
                }
              });
            }
            // CSV에 있지만 메타에 없는 라벨도 포함 (CSV는 콤마 구분 가능)
            for (const row of csvData.rows) {
              const raw = (row[colIdx] ?? "").trim();
              if (!raw) continue;
              const parts = colType === "multiSelect" ? raw.split(",").map((p) => p.trim()).filter(Boolean) : [raw];
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
        const dbPageId = createPage(pair.folderBase, null);
        updateDoc(dbPageId, {
          type: "doc",
          content: [{ type: "databaseBlock", attrs: { databaseId: dbId } }],
        });

        // 각 CSV 행 순차 처리
        for (let rowIdx = 0; rowIdx < csvData.rows.length; rowIdx++) {
          const row = csvData.rows[rowIdx];
          if (!row) continue;
          const rowTitle = (row[0] ?? "").trim() || `항목 ${rowIdx + 1}`;

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

          // 행 페이지 생성 (DB가 자동 생성한 첫 행 재사용)
          const rowPageId =
            rowIdx === 0
              ? (useDatabaseStore.getState().databases[dbId]?.rowPageOrder[0] ?? addRow(dbId))
              : addRow(dbId);
          renamePage(rowPageId, rowTitle);

          // 셀 값 입력
          for (let colIdx = 1; colIdx < row.length; colIdx++) {
            const colMeta = extraColIds[colIdx - 1];
            if (!colMeta) continue;
            const rawCell = row[colIdx] ?? "";
            if (colMeta.type === "date") {
              const parsed = parseDateCell(rawCell);
              updateCell(dbId, rowPageId, colMeta.id, parsed ? { start: parsed } : rawCell);
            } else if (colMeta.type === "multiSelect") {
              const parts = rawCell.split(",").map((p) => p.trim()).filter(Boolean);
              updateCell(dbId, rowPageId, colMeta.id, parts);
            } else {
              updateCell(dbId, rowPageId, colMeta.id, rawCell);
            }
          }

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

          // HTML 본문을 페이지에 채워넣는 공용 처리 — row + child 페이지에서 재사용
          const fillPageFromHtml = async (
            targetPageId: string,
            html: string,
            htmlRelPathParam: string,
            label: string,
          ): Promise<void> => {
            updateProgress({ phase: "에셋 업로드" });
            const uploadedAssetByPath = new Map<string, UploadedNotionAsset>();
            const assetsToUpload = collectNotionAssetRefsFromHtml(html, htmlRelPathParam, assetResolver);
            console.log(`[CSV가져오기] "${label}" 에셋 ${assetsToUpload.length}개`);
            for (let assetIdx = 0; assetIdx < assetsToUpload.length; assetIdx++) {
              const asset = assetsToUpload[assetIdx];
              if (!asset || uploadedAssetByPath.has(asset.path)) continue;
              updateProgress({ phase: "에셋 업로드", assetIdx, assetTotal: assetsToUpload.length });
              await yieldToPaint();
              try {
                uploadedAssetByPath.set(asset.path, await uploadNotionAsset(asset));
              } catch (err) {
                console.warn(`[CSV가져오기] 에셋 업로드 실패: ${asset.name}`, err);
                uploadedAssetByPath.set(asset.path, failedNotionAsset(asset, err));
                totalFailed++;
              }
            }
            const resolveImageNode = (src: string, element: HTMLElement): JSONContent | null => {
              const ast = assetResolver.resolve(src, htmlRelPathParam);
              if (!ast) return null;
              const up = uploadedAssetByPath.get(ast.path);
              if (!up) return null;
              return uploadedAssetToDocNode(up, element.getAttribute("alt") ?? "");
            };
            const doc = notionHtmlToDoc(html, {
              currentPagePath: htmlRelPathParam,
              resolveImageSrc: (src) => /^https?:\/\//i.test(src) || src.startsWith("data:") ? src : null,
              resolveImageNode,
              resolveMediaNode: resolveImageNode,
              iconReplacementText: "▪︎",
              resolvePageMentionByHref: () => null,
              // onCollectionTable 미지정 → 중첩 collection-content 는 일반 HTML 테이블로 렌더
            });
            updateDoc(targetPageId, doc);

            // 아이콘 추출 및 적용
            const iconInfo = extractNotionPageIcon(html);
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

          // 매칭 HTML 파일 처리
          const htmlRelPath = findHtmlForRow(rowTitle, allPaths);
          if (!htmlRelPath) {
            console.warn(`[CSV가져오기] 행 HTML 매칭 실패: "${rowTitle}"`);
            totalFailed++;
          } else {
            const htmlHandle = fileMap.get(htmlRelPath);
            if (htmlHandle) {
              try {
                const htmlFile = await htmlHandle.getFile();
                const html = await htmlFile.text();
                await fillPageFromHtml(rowPageId, html, htmlRelPath, rowTitle);

                // 자식 페이지(서브 폴더 내 HTML) 처리
                const childHtmlPaths = findChildHtmlPaths(htmlRelPath, allPaths);
                if (childHtmlPaths.length > 0) {
                  console.log(`[CSV가져오기] "${rowTitle}" 자식 페이지 ${childHtmlPaths.length}개`);
                }
                for (const childPath of childHtmlPaths) {
                  const childHandle = fileMap.get(childPath);
                  if (!childHandle) continue;
                  try {
                    const childFile = await childHandle.getFile();
                    const childHtml = await childFile.text();
                    // 자식 페이지 제목 = 파일명에서 hex 제거
                    const childTitle = childPath
                      .split("/").pop()
                      ?.replace(/\.html$/i, "")
                      .replace(/\s+[0-9a-f]{32}$/i, "")
                      .trim() || "자식 페이지";
                    const childPageId = createPage(childTitle, rowPageId);
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

          totalRowsImported++;
        }
      }

      setStatus({ kind: "done", rowsImported: totalRowsImported, failed: totalFailed });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[CSV가져오기] 오류:", error);
      setStatus({ kind: "error", message: `가져오기 실패: ${msg}` });
    } finally {
      setProgress(null);
    }
  };

  const isImporting = status.kind === "importing";

  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
      <h3 className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        CSV 기반 DB 가져오기 (ZIP 또는 폴더)
      </h3>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        Notion HTML 내보내기 ZIP을 그대로 선택하거나, 압축 해제한 폴더를 선택합니다. CSV + 동명 서브폴더를 재귀 탐색해 데이터베이스 항목을 1개씩 순차 처리합니다.
      </p>

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
              <li key={pair.folderBase} className="truncate py-0.5">
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
