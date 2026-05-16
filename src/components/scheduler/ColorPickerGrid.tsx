// 색상 선택 그리드 — COLOR_PRESETS 를 12열 2줄로 촘촘하게 표시하는 공용 컴포넌트.
import { COLOR_PRESETS } from "../../lib/scheduler/colors";

type Props = {
  value: string;
  onChange: (hex: string) => void;
};

export function ColorPickerGrid({ value, onChange }: Props) {
  return (
    <div className="grid w-fit grid-cols-12 gap-0.5">
      {COLOR_PRESETS.map((hex) => (
        <button
          key={hex}
          type="button"
          title={hex}
          onClick={() => onChange(hex)}
          className={`h-5 w-5 rounded border transition-transform hover:scale-110 ${
            value === hex
              ? "border-zinc-950 ring-2 ring-zinc-950/20 dark:border-white dark:ring-white/25"
              : "border-zinc-200 dark:border-zinc-700"
          }`}
          style={{ backgroundColor: hex }}
        />
      ))}
    </div>
  );
}
