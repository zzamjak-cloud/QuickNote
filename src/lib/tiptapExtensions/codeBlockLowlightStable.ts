import CodeBlockLowlight, {
  type CodeBlockLowlightOptions,
} from "@tiptap/extension-code-block-lowlight";
import { findChildren } from "@tiptap/core";
import { Plugin, PluginKey, type Plugin as PMPlugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type Decoration as PMDecoration } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import highlight from "highlight.js/lib/core";

const LOWLIGHT_ORIGINAL_KEY = "lowlight";

type LowlightApi = {
  highlight: (lang: string, value: string) => unknown;
  listLanguages: () => string[];
  registered?: (name: string) => boolean;
};

type HastLike = {
  properties?: { className?: unknown };
  children?: unknown;
  value?: unknown;
};

function parseNodes(
  nodes: unknown,
  className: string[] = [],
): { text: string; classes: string[] }[] {
  if (!Array.isArray(nodes)) return [];
  return (nodes as unknown[]).flatMap((node: unknown) => {
    const n = node as HastLike;
    const raw = n.properties?.className;
    const classFromProps = Array.isArray(raw)
      ? raw
      : raw
        ? [String(raw)]
        : [];
    const classes = [...className, ...classFromProps];
    if (n.children) {
      return parseNodes(n.children, classes);
    }
    return [{ text: String(n.value ?? ""), classes }];
  });
}

function getHighlightNodes(result: unknown): unknown {
  const r = result as { value?: unknown; children?: unknown };
  return r.value || r.children || [];
}

function isRegistered(lowlight: LowlightApi, name: string): boolean {
  return (
    Boolean(highlight.getLanguage(name)) ||
    Boolean(lowlight.registered?.(name))
  );
}

function getDecorations({
  doc,
  name,
  lowlight,
  defaultLanguage,
  fallbackLanguage,
}: {
  doc: PMNode;
  name: string;
  lowlight: LowlightApi;
  defaultLanguage: string | null;
  fallbackLanguage: string;
}): DecorationSet {
  const decorations: PMDecoration[] = [];
  findChildren(doc, (node) => node.type.name === name).forEach((block) => {
    let from = block.pos + 1;
    const raw =
      block.node.attrs.language ?? defaultLanguage ?? fallbackLanguage;
    const lang =
      typeof raw === "string" && raw.trim() !== ""
        ? raw.trim()
        : fallbackLanguage;

    const languages = lowlight.listLanguages();
    const canUse = languages.includes(lang) || isRegistered(lowlight, lang);
    const effective = canUse ? lang : fallbackLanguage;
    const nodes = getHighlightNodes(
      lowlight.highlight(effective, block.node.textContent),
    );

    parseNodes(nodes).forEach((node) => {
      const to = from + node.text.length;
      if (node.classes.length) {
        decorations.push(
          Decoration.inline(from, to, {
            class: node.classes.join(" "),
          }),
        );
      }
      from = to;
    });
  });
  return DecorationSet.create(doc, decorations);
}

function stableLowlightPlugin({
  name,
  lowlight,
  defaultLanguage,
  fallbackLanguage,
}: {
  name: string;
  lowlight: LowlightApi;
  defaultLanguage: string | null;
  fallbackLanguage: string;
}): PMPlugin {
  const pluginKeyInstance = new PluginKey<DecorationSet>(LOWLIGHT_ORIGINAL_KEY);
  return new Plugin({
    key: pluginKeyInstance,
    state: {
      init: (_, { doc }) =>
        getDecorations({ doc, name, lowlight, defaultLanguage, fallbackLanguage }),
      apply: (transaction, decorationSet, oldState, newState) => {
        const oldNodeName = oldState.selection.$head.parent.type.name;
        const newNodeName = newState.selection.$head.parent.type.name;
        const oldNodes = findChildren(oldState.doc, (n) => n.type.name === name);
        const newNodes = findChildren(newState.doc, (n) => n.type.name === name);
        if (
          transaction.docChanged &&
          ([oldNodeName, newNodeName].includes(name) ||
            newNodes.length !== oldNodes.length ||
            transaction.steps.some((step) => {
              const a = step as { from?: number; to?: number };
              if (a.from === void 0 || a.to === void 0) return false;
              return oldNodes.some(
                (node) =>
                  node.pos >= a.from! &&
                  node.pos + node.node.nodeSize <= a.to!,
              );
            }))
        ) {
          return getDecorations({
            doc: transaction.doc,
            name,
            lowlight,
            defaultLanguage,
            fallbackLanguage,
          });
        }
        return decorationSet.map(transaction.mapping, transaction.doc);
      },
    },
    props: {
      decorations(state) {
        return pluginKeyInstance.getState(state);
      },
    },
  });
}

function stripOriginalLowlight(plugins: readonly PMPlugin[]): PMPlugin[] {
  return plugins.filter((p) => {
    const k = (p as unknown as { spec?: { key?: { key?: string } } }).spec
      ?.key?.key;
    return k !== LOWLIGHT_ORIGINAL_KEY;
  });
}

export interface CodeBlockLowlightStableOptions extends CodeBlockLowlightOptions {
  /** language 비어 있을 때 (highlightAuto 대신) — 입력 중 색이 요동치지 않게 함 */
  fallbackLanguage?: string;
}

export const CodeBlockLowlightStable = CodeBlockLowlight.extend<CodeBlockLowlightStableOptions>({
  addOptions() {
    const base = this.parent?.();
    if (!base) {
      throw new Error("CodeBlockLowlightStable: parent addOptions required");
    }
    return {
      ...base,
      fallbackLanguage: base.fallbackLanguage ?? "javascript",
    };
  },

  addProseMirrorPlugins() {
    const parent = (this.parent?.() ?? []) as PMPlugin[];
    const withoutDup = stripOriginalLowlight(parent);
    const low = this.options.lowlight as LowlightApi;
    const fb = this.options.fallbackLanguage || "javascript";
    return [
      ...withoutDup,
      stableLowlightPlugin({
        name: this.name,
        lowlight: low,
        defaultLanguage: this.options.defaultLanguage ?? null,
        fallbackLanguage: fb,
      }),
    ];
  },
});
