import type { ColumnType, SelectOption } from "../../../types/database";
import { optionStyle } from "./utils";

function optionChipStyle(
  color: string | undefined,
  columnType: ColumnType,
) {
  if (columnType === "status") {
    return { backgroundColor: color ?? "#6b7280" };
  }
  return optionStyle(color);
}

export function OptionChip({
  option,
  columnType,
  dimmed,
  className,
}: {
  option: SelectOption;
  columnType: ColumnType;
  dimmed?: boolean;
  className?: string;
}) {
  return (
    <span
      className={[
        "inline-flex max-w-full items-center truncate rounded px-1.5 py-0.5 text-xs font-medium text-white",
        dimmed ? "opacity-70" : "",
        className ?? "",
      ].join(" ")}
      style={optionChipStyle(option.color, columnType)}
    >
      {option.label}
    </span>
  );
}
