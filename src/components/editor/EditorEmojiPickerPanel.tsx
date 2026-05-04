import EmojiPickerReact, { EmojiStyle, Theme } from "emoji-picker-react";

type Props = {
  darkMode: boolean;
  onPick: (emoji: string) => void;
};

/** emoji-picker-react 전용 청크 — `Editor.tsx` 정적 import 방지 */
export function EditorEmojiPickerPanel({ darkMode, onPick }: Props) {
  return (
    <EmojiPickerReact
      theme={darkMode ? Theme.DARK : Theme.LIGHT}
      emojiStyle={EmojiStyle.NATIVE}
      previewConfig={{ showPreview: false }}
      searchDisabled={false}
      lazyLoadEmojis
      width={320}
      height={380}
      onEmojiClick={(data) => onPick(data.emoji)}
    />
  );
}
