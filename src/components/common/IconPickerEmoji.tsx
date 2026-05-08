import EmojiPickerReact, { EmojiStyle, Theme } from "emoji-picker-react";
import { useSettingsStore } from "../../store/settingsStore";

type Props = {
  onPick: (emoji: string) => void;
};

/** 사이드바 아이콘 피커 본체 — emoji-picker 청크 분리 */
export function IconPickerEmoji({ onPick }: Props) {
  const darkMode = useSettingsStore((s) => s.darkMode);
  return (
    <EmojiPickerReact
      theme={darkMode ? Theme.DARK : Theme.LIGHT}
      emojiStyle={EmojiStyle.NATIVE}
      previewConfig={{ showPreview: false }}
      searchDisabled={false}
      lazyLoadEmojis
      width={304}
      height={360}
      onEmojiClick={(data) => onPick(data.emoji)}
    />
  );
}
