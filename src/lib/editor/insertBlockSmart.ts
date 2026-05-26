import type { Editor } from "@tiptap/react";

/**
 * 글머리/번호/체크 항목 안에 이미지·파일 블록을 정확한 위치에 직접 끼워 넣는다.
 *
 * TipTap insertContent/insertContentAt 은 schema 적합화 과정에서 listItem 의 첫 paragraph 제약을
 * 만족시키려고 노드를 lift 시키는 경우가 있어, listItem 내부에 머물러야 할 미디어 블록이
 * 항목 밖으로 빠져나가는 회귀가 있었다. 본 헬퍼는:
 *   1) 현재 selection 의 가장 가까운 listItem/taskItem 조상을 찾는다.
 *   2) 그 항목 안 첫 paragraph 가 끝나는 위치(=중첩 리스트 직전) 를 계산.
 *   3) ProseMirror tr.insert 로 그 위치에 노드를 직접 박는다 (TipTap smart-lift 우회).
 * listItem 안이 아니면 기본 insertContent 로 폴백한다.
 */
export function insertBlockSmart(
  editor: Editor,
  nodeJSON: { type: string; attrs?: Record<string, unknown> },
): void {
  const { state } = editor;
  const { selection } = state;
  const $from = selection.$from;
  // listItem / taskItem / column / callout / toggleContent — 이런 컨테이너 안에 커서가 있으면
  // 항상 그 컨테이너 내부에 노드를 박는다. 그렇지 않으면 TipTap insertContent 가 schema 적합화로
  // 컨테이너 밖으로 노드를 lift 시켜 페이지 최하단에 떨어지는 회귀가 있다.
  const CONTAINER_TYPES = new Set([
    "listItem",
    "taskItem",
    "column",
    "callout",
    "toggleContent",
  ]);
  let containerDepth = -1;
  for (let d = $from.depth; d > 0; d -= 1) {
    if (CONTAINER_TYPES.has($from.node(d).type.name)) {
      containerDepth = d;
      break;
    }
  }
  if (containerDepth < 0) {
    editor.chain().focus().insertContent(nodeJSON).run();
    return;
  }
  const container = $from.node(containerDepth);
  const containerStart = $from.start(containerDepth);
  // 컨테이너 내부에서 현재 커서가 머문 직속 자식 블록 인덱스를 찾아, 그 블록 직후 위치를 삽입점으로 한다.
  // (listItem 의 경우 첫 paragraph 직후가 기본. 일반 컨테이너 도 현재 커서가 위치한 블록 뒤로 끼움.)
  const indexInContainer = $from.index(containerDepth);
  let offset = 0;
  let i = 0;
  container.content.forEach((child) => {
    if (i < indexInContainer) {
      offset += child.nodeSize;
      i += 1;
    } else if (i === indexInContainer) {
      offset += child.nodeSize;
      i += 1;
    }
  });
  let insertPos = containerStart + offset;
  // listItem 은 첫 paragraph 뒤(=중첩 리스트 앞) 고정 — 사용자가 어느 위치에 있더라도 자식 리스트보다는 앞쪽에 둔다.
  if (container.type.name === "listItem" || container.type.name === "taskItem") {
    let acc = 0;
    let placed = false;
    container.content.forEach((child) => {
      if (placed) return;
      if (child.type.name === "paragraph") {
        insertPos = containerStart + acc + child.nodeSize;
        placed = true;
      }
      acc += child.nodeSize;
    });
    if (!placed) insertPos = containerStart + 1;
  }
  const nodeType = editor.schema.nodes[nodeJSON.type];
  if (!nodeType) {
    editor.chain().focus().insertContent(nodeJSON).run();
    return;
  }
  const node = nodeType.create(nodeJSON.attrs ?? null);
  const tr = editor.state.tr.insert(insertPos, node);
  editor.view.dispatch(tr);
  editor.view.focus();
}
