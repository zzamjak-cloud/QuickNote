// 색상 선택 그리드 — COLOR_PRESETS 를 8열로 표시하는 공용 컴포넌트.
import { COLOR_PRESETS } from "../../lib/scheduler/colors";

type Props = {
  value: string;
  onChange: (hex: string) => void;
};

export function ColorPickerGrid({ value, onChange }: Props) {
  return (
    <div className="grid grid-cols-8 gap-1">
      {COLOR_PRESETS.map((hex) => (
        <button
          key={hex}
          type="button"
          title={hex}
          onClick={() => onChange(hex)}
          className={`w-7 h-7 rounded-md border-2 transition-transform hover:scale-110 ${
            value === hex
              ? "border-zinc-900 dark:border-white"
              : "border-transparent"
          }`}
          style={{ backgroundColor: hex }}
        />
      ))}
    </div>
  );
}
