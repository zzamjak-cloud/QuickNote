// 서버(Lambda)·클라이언트 공용 ProseMirror/TipTap JSON 노드 타입.
// ⚠ npm 패키지 import 금지 — infra 번들에서 루트 node_modules 없이 컴파일된다.

export type DocMark = {
  type: string;
  attrs?: Record<string, unknown>;
};

export type DocNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  marks?: DocMark[];
  text?: string;
};
