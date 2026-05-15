import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";

const COPY_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;

const pluginKey = new PluginKey("codeBlockCopyUi");

/**
 * 복사 위젯 위치: 블록 끝(마지막 유효 위치). lowlight 와 같은 좌표(pos+1)를 쓰지 않아 데코 충돌을 피함.
 * 빈 블록은 pos+1 만 존재.
 */
function widgetPosForCodeBlock(node: PMNode, blockPos: number): number {
  if (node.content.size === 0) return blockPos + 1;
  return blockPos + node.nodeSize - 1;
}

/** 마크다운 언어 블록은 NodeView 가 패널 우상단 고정 복사 UI를 담당한다 */
function isMarkdownCodeBlockLanguage(lang: unknown): boolean {
  const s = String(lang ?? "")
    .toLowerCase()
    .trim();
  return s === "markdown" || s === "md";
}

function buildDecorations(doc: PMNode): Decoration[] {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "codeBlock") return true;
    if (isMarkdownCodeBlockLanguage(node.attrs.language)) return false;
    const wpos = widgetPosForCodeBlock(node, pos);
    const blockStart = pos;
    decos.push(
      Decoration.widget(
        wpos,
        (view: EditorView) => {
          const wrap = document.createElement("span");
          wrap.className = "qn-code-copy-anchor";
          wrap.setAttribute("contenteditable", "false");
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "qn-code-copy-btn";
          btn.title = "코드 복사";
          btn.setAttribute("aria-label", "코드 복사");
          btn.innerHTML = `${COPY_ICON_SVG}<span class="qn-code-copy-label">복사</span>`;
          btn.addEventListener("mousedown", (e) => e.preventDefault());
          btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const n = view.state.doc.nodeAt(blockStart);
            if (!n || n.type.name !== "codeBlock") return;
            void navigator.clipboard.writeText(n.textContent);
          });
          wrap.appendChild(btn);
          return wrap;
        },
        {
          key: `qn-copy-${blockStart}`,
          side: 1,
          ignoreSelection: true,
          stopEvent: (event: Event) =>
            (event.target as HTMLElement | null)?.closest?.(".qn-code-copy-btn") !=
            null,
        },
      ),
    );
    return false;
  });
  return decos;
}

/**
 * ProseMirror Decoration.widget 로 복사 UI를 넣는다.
 * 수동으로 pre 에 붙인 노드는 다음 렌더에서 지워질 수 있어 표시가 안 됐음.
 */
export const CodeBlockCopy = Extension.create({
  name: "codeBlockCopyUi",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pluginKey,
        state: {
          init: (_, { doc }) =>
            DecorationSet.create(doc, buildDecorations(doc)),
          apply(tr, set, _old, newState) {
            if (tr.docChanged) {
              return DecorationSet.create(
                newState.doc,
                buildDecorations(newState.doc),
              );
            }
            return set.map(tr.mapping, newState.doc);
          },
        },
        props: {
          decorations(state) {
            return pluginKey.getState(state);
          },
        },
      }),
    ];
  },
});
