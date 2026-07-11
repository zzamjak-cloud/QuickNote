import { ListItem } from "@tiptap/extension-list";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";

/** 중첩 리스트 컨테이너 타입 — listItem 의 첫 자식으로 오면 이중 마커를 만든다. */
const NESTED_LIST_TYPES = new Set(["bulletList", "orderedList", "taskList"]);
const LIST_ITEM_TYPES = new Set(["listItem", "taskItem"]);

/**
 * 글머리/번호 항목 안에 이미지·동영상·파일·콜아웃·컬럼 등 어떤 블록이든 자유롭게 넣을 수 있도록
 * 기본 content (`"paragraph block*"`) 를 더 느슨하게 확장한다.
 *
 * 기본 스키마는 첫 자식이 반드시 paragraph 라 다음 두 시나리오를 지원하지 못한다:
 *   1) 비어있는 새 항목에 /이미지 로 이미지를 삽입 → 이미지가 listItem 밖으로 lift 됨.
 *   2) 부모 항목 텍스트와 자식 항목 사이에 이미지/미디어 끼워 넣기 — Notion 가져오기 시
 *      block child 를 첨부해도 schema가 받아주지 않으면 사라진다.
 *
 * 변경: 첫 위치에도 이미지·fileBlock·horizontalRule·columnLayout·callout·toggle·blockquote 같은
 * 블록을 허용한다. 첫 자식이 paragraph 가 아니어도 Enter/Backspace 등 list 기본 키맵은
 * 정상 동작한다 (split/lift 헬퍼가 paragraph 부재 케이스를 graceful 처리).
 */
export const ListItemPermissive = ListItem.extend({
  content: "block+",

  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      // 이중 마커 방지 정규화: 범위 선택 삭제 등으로 listItem/taskItem 의 첫 자식이 leading
      // paragraph 없이 곧바로 리스트(bulletList 등)가 되면(<li><ul>), 부모 마커와 첫 자식 마커가
      // 같은 줄에 겹쳐 불릿이 2개로 보인다. content:"block+" 완화가 이 구조를 유효로 허용하므로
      // PM 자동교정이 없다 → 첫 자식이 리스트인 항목 앞에 빈 paragraph 를 보정 삽입한다.
      // 노드 삽입만 하고 selection 은 건드리지 않는다(collab appendTransaction selection 되돌림 회귀 방지).
      new Plugin({
        key: new PluginKey("listItemNestedMarkerFix"),
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const paragraphType = newState.schema.nodes.paragraph;
          if (!paragraphType) return null;
          const targets: number[] = [];
          newState.doc.descendants((node: PMNode, pos: number) => {
            if (!LIST_ITEM_TYPES.has(node.type.name)) return;
            const first = node.firstChild;
            if (first && NESTED_LIST_TYPES.has(first.type.name)) targets.push(pos);
          });
          if (targets.length === 0) return null;
          const tr = newState.tr;
          // 뒤(큰 pos)부터 삽입해 앞 위치가 밀리지 않게 한다.
          for (const pos of targets.sort((a, b) => b - a)) {
            tr.insert(pos + 1, paragraphType.create());
          }
          return tr.steps.length > 0 ? tr : null;
        },
      }),
    ];
  },
});
