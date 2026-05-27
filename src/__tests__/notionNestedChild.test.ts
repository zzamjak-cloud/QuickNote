import { describe, it, expect } from "vitest";
import { findChildHtmlPaths } from "../lib/notionImport/csvFolderImporter";

// NotionCsvFolderSection 의 private 헬퍼들을 그대로 복제하여 부모 매핑 로직을 재현한다.
function stripNotionId(value: string): string {
  return value.replace(/\s+[0-9a-f]{32}$/i, "").trim();
}
function importedPathDepth(path: string): number {
  return path.split("/").filter(Boolean).length;
}
function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(0, idx) : "";
}
function findParentHtmlPath(childPath: string, candidates: Set<string>): string | null {
  const byStrippedFolder = new Map<string, string>();
  for (const candidate of candidates) {
    const key = stripNotionId(candidate.replace(/\.html$/i, ""));
    if (!byStrippedFolder.has(key)) byStrippedFolder.set(key, candidate);
  }
  let dir = dirname(childPath);
  while (dir) {
    const exact = `${dir}.html`;
    if (candidates.has(exact)) return exact;
    const stripped = `${stripNotionId(dir)}.html`;
    if (candidates.has(stripped)) return stripped;
    const normalized = byStrippedFolder.get(stripNotionId(dir));
    if (normalized && normalized !== childPath) return normalized;
    dir = dirname(dir);
  }
  return null;
}

// NotionCsvFolderSection.tsx 759-775 루프를 그대로 재현해 parentTitle 매핑을 만든다.
function resolveParents(rowHtmlPath: string, allPaths: string[]) {
  const childHtmlPaths = findChildHtmlPaths(rowHtmlPath, allPaths);
  const childPagePaths = childHtmlPaths.sort(
    (a, b) => importedPathDepth(a) - importedPathDepth(b) || a.localeCompare(b),
  );
  const candidates = new Set([rowHtmlPath, ...childPagePaths]);
  const childIdByPathInRow = new Map<string, string>();
  const parentOf: Record<string, string> = {};
  const ROW = "ROW";
  for (const childPath of childPagePaths) {
    const parentHtmlPath = findParentHtmlPath(childPath, candidates);
    const parentPageId =
      parentHtmlPath && parentHtmlPath !== rowHtmlPath
        ? (childIdByPathInRow.get(parentHtmlPath) ?? ROW)
        : ROW;
    childIdByPathInRow.set(childPath, childPath); // id = path 로 가정
    parentOf[childPath] = parentPageId;
  }
  return parentOf;
}

const HEX = "0123456789abcdef0123456789abcdef";
const HEX2 = "fedcba9876543210fedcba9876543210";
const HEX3 = "11112222333344445555666677778888";

describe("Notion CSV 중첩 자식 부모 매핑", () => {
  it("폴더·파일 hex 동일 케이스: 손자는 자식에 붙어야 한다", () => {
    const row = `DB/Row ${HEX}.html`;
    const child = `DB/Row ${HEX}/Child ${HEX2}.html`;
    const grand = `DB/Row ${HEX}/Child ${HEX2}/Grand ${HEX3}.html`;
    const all = [row, child, grand];
    const parents = resolveParents(row, all);
    expect(parents[child]).toBe("ROW");
    expect(parents[grand]).toBe(child); // 평탄화되면 "ROW" 가 됨
  });

  it("자식 폴더에 hex 없는 케이스 (Notion 변형)", () => {
    const row = `DB/Row ${HEX}.html`;
    const child = `DB/Row ${HEX}/Child ${HEX2}.html`;
    // 손자 폴더가 hex 없는 자식 이름을 사용
    const grand = `DB/Row ${HEX}/Child/Grand ${HEX3}.html`;
    const all = [row, child, grand];
    const parents = resolveParents(row, all);
    expect(parents[grand]).toBe(child);
  });
});
