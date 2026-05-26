// ZIP 을 FileSystemDirectoryHandle 와 호환되는 가상 디렉터리 트리로 변환.
// 폴더 모드 코드(detectCsvDbPairsRecursive, buildFileMap, …)를 그대로 재사용하기 위한 어댑터.
//
// 메모리 전략: JSZip 의 entries 는 디렉터리 인덱스만 메모리에 올리고
// 실제 파일 데이터는 readAsFile() 호출 시 lazy 해제. 따라서 대용량 ZIP 도 안전.

import JSZip from "jszip";

type VirtualFileNode = {
  kind: "file";
  name: string;
  entry?: JSZip.JSZipObject;
  file?: File;
};

type VirtualDirNode = {
  kind: "directory";
  name: string;
  children: Map<string, VirtualFileNode | VirtualDirNode>;
};

// FileSystemDirectoryHandle / FileSystemFileHandle 의 우리가 실제로 쓰는 메서드만 구현.
// 캐스팅으로 기존 API 와 호환되게 한다.
class VirtualFileHandle {
  readonly kind = "file" as const;
  readonly name: string;
  private readonly node: VirtualFileNode;

  constructor(name: string, node: VirtualFileNode) {
    this.name = name;
    this.node = node;
  }

  async getFile(): Promise<File> {
    if (this.node.file) return this.node.file;
    if (!this.node.entry) throw new Error(`가상 파일 엔트리가 없습니다: ${this.name}`);
    const blob = await this.node.entry.async("blob");
    // 확장자로 mime 추정 — 폴더 모드와 동일하게 처리되도록
    const mime = guessMime(this.name);
    return new File([blob], this.name, { type: mime });
  }
}

class ZipDirHandle {
  readonly kind = "directory" as const;
  readonly name: string;
  private readonly node: VirtualDirNode;

  constructor(name: string, node: VirtualDirNode) {
    this.name = name;
    this.node = node;
  }

  async *entries(): AsyncGenerator<[string, VirtualFileHandle | ZipDirHandle]> {
    for (const [name, child] of this.node.children) {
      if (child.kind === "file") {
        yield [name, new VirtualFileHandle(name, child)];
      } else {
        yield [name, new ZipDirHandle(name, child)];
      }
    }
  }

  // FileSystemDirectoryHandle 호환을 위한 stub (사용되지 않음)
  async getFileHandle(): Promise<never> {
    throw new Error("ZipDirHandle.getFileHandle: not implemented");
  }
  async getDirectoryHandle(): Promise<never> {
    throw new Error("ZipDirHandle.getDirectoryHandle: not implemented");
  }
}

class TauriFileHandle {
  readonly kind = "file" as const;
  readonly name: string;
  private readonly path: string;

  constructor(name: string, path: string) {
    this.name = name;
    this.path = path;
  }

  async getFile(): Promise<File> {
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const bytes = await readFile(this.path);
    return new File([bytes], this.name, { type: guessMime(this.name) });
  }
}

class TauriDirHandle {
  readonly kind = "directory" as const;
  readonly name: string;
  private readonly path: string;

  constructor(name: string, path: string) {
    this.name = name;
    this.path = path;
  }

  async *entries(): AsyncGenerator<[string, TauriFileHandle | TauriDirHandle]> {
    const [{ readDir }, { join }] = await Promise.all([
      import("@tauri-apps/plugin-fs"),
      import("@tauri-apps/api/path"),
    ]);
    const entries = await readDir(this.path);
    for (const entry of entries) {
      const childPath = await join(this.path, entry.name);
      if (entry.isDirectory) {
        yield [entry.name, new TauriDirHandle(entry.name, childPath)];
      } else if (entry.isFile) {
        yield [entry.name, new TauriFileHandle(entry.name, childPath)];
      }
    }
  }
}

function guessMime(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".mp4") || lower.endsWith(".m4v")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".html")) return "text/html";
  if (lower.endsWith(".md")) return "text/markdown";
  return "application/octet-stream";
}

function shouldExpandNestedRootZip(entryName: string, totalFileCount: number): boolean {
  if (!entryName.toLowerCase().endsWith(".zip")) return false;
  if (/^ExportBlock-/i.test(entryName) || /Part-\d+\.zip$/i.test(entryName)) return true;
  return totalFileCount === 1;
}

// ZIP entry 경로들을 트리로 정리
function buildTreeFromZip(zip: JSZip): VirtualDirNode {
  const root: VirtualDirNode = { kind: "directory", name: "", children: new Map() };

  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const parts = entry.name.split("/").filter(Boolean);
    if (parts.length === 0) continue;

    let cursor: VirtualDirNode = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const segment = parts[i];
      if (!segment) continue;
      let next = cursor.children.get(segment);
      if (!next || next.kind === "file") {
        const dirNode: VirtualDirNode = { kind: "directory", name: segment, children: new Map() };
        cursor.children.set(segment, dirNode);
        next = dirNode;
      }
      cursor = next as VirtualDirNode;
    }
    const fileName = parts[parts.length - 1];
    if (!fileName) continue;
    cursor.children.set(fileName, { kind: "file", name: fileName, entry });
  }

  // 루트가 단일 디렉터리만 포함하면 그 안으로 진입 (ExportBlock-xxx 같은 단일 래퍼 자동 펼침)
  if (root.children.size === 1) {
    const only = Array.from(root.children.values())[0];
    if (only && only.kind === "directory") return only;
  }
  return root;
}

function buildTreeFromFiles(files: File[]): VirtualDirNode {
  const root: VirtualDirNode = { kind: "directory", name: "", children: new Map() };

  for (const file of files) {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? file.name;
    const parts = rel.replace(/^\/+/, "").split("/").filter(Boolean);
    if (parts.length === 0) continue;

    let cursor = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const segment = parts[i];
      if (!segment) continue;
      let next = cursor.children.get(segment);
      if (!next || next.kind === "file") {
        const dirNode: VirtualDirNode = { kind: "directory", name: segment, children: new Map() };
        cursor.children.set(segment, dirNode);
        next = dirNode;
      }
      cursor = next as VirtualDirNode;
    }

    const fileName = parts[parts.length - 1];
    if (!fileName) continue;
    cursor.children.set(fileName, { kind: "file", name: fileName, file });
  }

  if (root.children.size === 1) {
    const only = Array.from(root.children.values())[0];
    if (only && only.kind === "directory") return only;
  }
  return root;
}

// 외부 진입점 — ZIP 파일을 FileSystemDirectoryHandle 호환 핸들로 변환
export async function createZipVirtualDir(input: Blob | ArrayBuffer): Promise<FileSystemDirectoryHandle> {
  let zip = await JSZip.loadAsync(input);
  // Notion 외부 ZIP(루트에 ExportBlock-*.zip 1개) 자동 언랩
  for (let depth = 0; depth < 3; depth += 1) {
    const files = Object.values(zip.files).filter((entry) => !entry.dir);
    if (files.length !== 1) break;
    const only = files[0];
    if (!only || !shouldExpandNestedRootZip(only.name, files.length)) break;
    const nestedBlob = await only.async("blob");
    zip = await JSZip.loadAsync(nestedBlob);
  }
  const tree = buildTreeFromZip(zip);
  const handle = new ZipDirHandle(tree.name || "zip-root", tree);
  return handle as unknown as FileSystemDirectoryHandle;
}

export function createFilesVirtualDir(files: File[]): FileSystemDirectoryHandle {
  const tree = buildTreeFromFiles(files);
  const handle = new ZipDirHandle(tree.name || "folder-root", tree);
  return handle as unknown as FileSystemDirectoryHandle;
}

export function createTauriVirtualDir(path: string): FileSystemDirectoryHandle {
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? "folder-root";
  return new TauriDirHandle(name, path) as unknown as FileSystemDirectoryHandle;
}
