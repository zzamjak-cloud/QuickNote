import { Fragment, type Node as PMNode } from "@tiptap/pm/model";

/**
 * 복제 삽입용 노드 클론 — 블록 id attr 을 재귀적으로 null 로 벗겨
 * UniqueID appendTransaction 이 새 id 를 부여하게 한다.
 *
 * `node.copy()` 로 복제하면 id 까지 복제되어 문서에 동일 id 블록이 영구히 공존한다.
 * 댓글 앵커·스크롤 타깃 등 blockId 해석이 전부 "문서 순서상 첫 매칭"이라,
 * 복제본이 원본보다 앞에 오게 되면 댓글이 복제본에 붙는 오바인딩이 생긴다.
 */
export function cloneWithoutBlockIds(node: PMNode): PMNode {
  const children: PMNode[] = [];
  node.content.forEach((child) => {
    children.push(child.isText ? child : cloneWithoutBlockIds(child));
  });
  const fragment = Fragment.from(children);
  if (typeof node.attrs.id === "undefined") {
    return node.copy(fragment);
  }
  return node.type.create({ ...node.attrs, id: null }, fragment, node.marks);
}
