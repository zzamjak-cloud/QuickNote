export type NotionImportSource =
  | { kind: "folder-handle"; label: string; dir: FileSystemDirectoryHandle }
  | { kind: "zip-file"; label: string; file: File }
  | { kind: "folder-files"; label: string; files: File[] };

