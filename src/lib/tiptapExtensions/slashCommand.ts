import { Extension } from "@tiptap/core";
import Suggestion, {
  type SuggestionOptions,
} from "@tiptap/suggestion";
import type { SlashItem, SlashCommandContext } from "./slashItems";

export type SlashCommandOptions = {
  suggestion: Omit<SuggestionOptions<SlashItem>, "editor">;
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
          (props as SlashItem).command(ctx);
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
