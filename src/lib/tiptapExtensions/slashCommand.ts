import { Extension } from "@tiptap/core";
import Suggestion, {
  type SuggestionOptions,
} from "@tiptap/suggestion";
import { Plugin } from "prosemirror-state";
import type { SlashMenuEntry, SlashCommandContext } from "./slashItems";

export type SlashCommandOptions = {
  suggestion: Omit<SuggestionOptions<SlashMenuEntry>, "editor">;
};

// 페이지 로드 시 "/" 포함 컨텐츠 때문에 슬래시 메뉴가 자동으로 열리는 버그 방지.
// 사용자가 직접 "/" 를 타이핑할 때만 true.
let _slashJustTyped = false;

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: "slashCommand",

  addOptions() {
    return {
      suggestion: {
        char: "/",
        startOfLine: false,
        // 슬래시 메뉴가 이미 활성화된 경우 또는 "/" 를 직접 타이핑한 경우에만 허용
        allow: ({ isActive }) => _slashJustTyped || (isActive ?? false),
        command: ({ editor, range, props }) => {
          const ctx: SlashCommandContext = { editor, range };
          const e = props as SlashMenuEntry;
          if (e.kind === "leaf") {
            e.command(ctx);
          }
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      // "/" 직접 입력 여부를 추적 — Suggestion 플러그인보다 먼저 등록해야 allow 가 올바른 값을 읽음
      new Plugin({
        state: {
          init() {
            return false;
          },
          apply(tr) {
            if (!tr.docChanged) return false;
            for (const step of tr.steps) {
              try {
                const json = step.toJSON() as {
                  stepType?: string;
                  slice?: { content?: Array<{ text?: string }> };
                };
                if (json.stepType === "replace") {
                  const text = json.slice?.content?.[0]?.text ?? "";
                  // 단일 "/" 문자를 삽입한 경우에만 허용
                  if (text === "/") {
                    _slashJustTyped = true;
                    return true;
                  }
                }
              } catch {
                // ignore
              }
            }
            _slashJustTyped = false;
            return false;
          },
        },
      }),
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});
