/** ProseMirror `doc.content` Fragment.forEach 의 두 번째 인자는 조각 내부 누적 offset.
 * `doc` 자신은 root 라 자기 자신의 open/close 토큰이 좌표 공간을 차지하지 않으므로,
 * 직속 자식 블록의 doc-level 시작 좌표는 fragmentOffset 과 동일하다.
 * (이 값을 그대로 view.nodeDOM(pos)·doc.nodeAt(pos)·tr.delete(pos, ...) 등에 사용 가능.)
 * 과거 `1 + fragmentOffset` 으로 두면 atom 블록(databaseBlock 등)에서 한 칸 어긋나
 * 다음 블록 DOM 이 잡히거나 nodeAt 이 null/엉뚱한 노드를 반환했다. */
export function docTopLevelBlockStart(fragmentOffset: number): number {
  return fragmentOffset;
}
