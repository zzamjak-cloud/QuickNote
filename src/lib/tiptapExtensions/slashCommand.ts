import { Extension } from "@tiptap/core";
import Suggestion, {
  type SuggestionOptions,
} from "@tiptap/suggestion";
import type { SlashMenuEntry, SlashCommandContext } from "./slashItems";

export type SlashCommandOptions = {
  suggestion: Omit<SuggestionOptions<SlashMenuEntry>, "editor">;
};

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: "slashCommand",

  addOptions() {
    return {
      suggestion: {
        char: "/",
        startOfLine: false,
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
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});
