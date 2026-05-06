import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";

type Props = {
  editor: Editor;
};

// v4 단순화: outline / shadow / crop 제거.
// 향후 이미지 전용 버튼(정렬·alt 편집 등)이 추가될 때를 위해 컴포넌트는 유지하되
// 현재는 노출할 액션이 없으므로 null 을 반환한다.
export function ImageBubbleToolbar({ editor }: Props) {
  const sel = editor.state.selection;
  if (!(sel instanceof NodeSelection) || sel.node.type.name !== "image") {
    return null;
  }
  return null;
}
