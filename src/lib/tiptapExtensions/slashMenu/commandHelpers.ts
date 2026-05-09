import type { ChainedCommands } from "@tiptap/core";
import type { Range } from "@tiptap/react";
import { scheduleEditorMutation } from "../../pm/scheduleEditorMutation";
import type { SlashCommandContext } from "./types";

export function runSlashCommand(
  ctx: SlashCommandContext,
  command: (chain: ChainedCommands) => ChainedCommands,
): void {
  command(ctx.editor.chain().focus().deleteRange(ctx.range)).run();
}

export function clearSlashRange(ctx: SlashCommandContext): void {
  ctx.editor.chain().focus().deleteRange(ctx.range).run();
}

export function scheduleSlashMutation(
  range: Range,
  mutation: (range: Range) => void,
): void {
  const stableRange = { from: range.from, to: range.to };
  scheduleEditorMutation(() => mutation(stableRange));
}
