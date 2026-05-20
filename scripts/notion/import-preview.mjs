#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

function isMarkdownFile(filePath) {
  return filePath.toLowerCase().endsWith(".md");
}

function isCsvFile(filePath) {
  return filePath.toLowerCase().endsWith(".csv");
}

function isHtmlFile(filePath) {
  return filePath.toLowerCase().endsWith(".html");
}

function isZipFile(filePath) {
  return filePath.toLowerCase().endsWith(".zip");
}

function shouldExpandNestedZip(basePath, entryName, siblingCount) {
  if (basePath) return false;
  if (entryName.includes("/")) return false;
  if (/^ExportBlock-/i.test(entryName) || /Part-\d+\.zip$/i.test(entryName)) return true;
  return siblingCount === 1;
}

function trimExtension(name) {
  return name.replace(/\.[^.]+$/, "");
}

function normalizeNotionName(name) {
  const withoutExt = trimExtension(name);
  const noIdSuffix = withoutExt.replace(/\s+[0-9a-f]{32}$/i, "");
  return noIdSuffix.trim() || "제목 없음";
}

function splitPath(filePath) {
  return filePath.split("/").filter(Boolean);
}

function pageMeta(filePath) {
  const parts = splitPath(filePath);
  const fileName = parts[parts.length - 1] ?? filePath;
  const title = normalizeNotionName(fileName);
  const depth = Math.max(parts.length - 1, 0);
  const parentSegment = parts.length > 1 ? parts[parts.length - 2] : null;
  return {
    title,
    depth,
    parentTitle: parentSegment ? normalizeNotionName(parentSegment) : null,
  };
}

async function main() {
  const zipPath = process.argv[2];
  if (!zipPath) {
    console.error("사용법: node scripts/notion/import-preview.mjs <zip 파일 경로>");
    process.exit(1);
  }

  const absolutePath = path.resolve(zipPath);
  const raw = await fs.readFile(absolutePath);
  const queue = [{ basePath: "", data: raw }];
  const entries = [];

  while (queue.length > 0) {
    const current = queue.shift();
    const zip = await JSZip.loadAsync(current.data);
    const currentEntries = Object.values(zip.files).filter((entry) => !entry.dir);
    for (const entry of currentEntries) {
      const entryName = current.basePath ? `${current.basePath}/${entry.name}` : entry.name;
      if (isZipFile(entry.name) && shouldExpandNestedZip(current.basePath, entry.name, currentEntries.length)) {
        const nested = await entry.async("nodebuffer");
        queue.push({
          basePath: trimExtension(entryName),
          data: nested,
        });
        continue;
      }
      entries.push({ name: entryName, entry });
    }
  }

  const markdownEntries = entries.filter((item) => isMarkdownFile(item.name));
  const htmlEntries = entries.filter((item) => isHtmlFile(item.name));
  const csvEntries = entries.filter((item) => isCsvFile(item.name));
  const assetEntries = entries.filter(
    (item) => !isMarkdownFile(item.name) && !isHtmlFile(item.name) && !isCsvFile(item.name),
  );

  const pages = [];
  for (const item of markdownEntries) {
    const markdown = await item.entry.async("string");
    const meta = pageMeta(item.name);
    const preview = markdown.split("\n").slice(0, 5).join("\n");
    pages.push({
      path: item.name,
      title: meta.title,
      depth: meta.depth,
      parentTitle: meta.parentTitle,
      preview,
    });
  }
  pages.sort((a, b) => a.path.localeCompare(b.path));

  const summary = {
    zipPath: absolutePath,
    totalFiles: entries.length,
    markdownFileCount: markdownEntries.length,
    htmlFileCount: htmlEntries.length,
    csvFileCount: csvEntries.length,
    assetFileCount: assetEntries.length,
  };

  console.log(JSON.stringify(summary, null, 2));
  console.log("\n--- 페이지 미리보기 ---");
  pages.forEach((page, idx) => {
    console.log(`\n[${idx + 1}] ${page.title}`);
    console.log(`path: ${page.path}`);
    console.log(`depth: ${page.depth}`);
    console.log(`parent: ${page.parentTitle ?? "(root)"}`);
    console.log("preview:");
    console.log(page.preview || "(빈 페이지)");
  });
}

main().catch((error) => {
  console.error("Notion ZIP 미리보기 실패:", error);
  process.exit(1);
});
