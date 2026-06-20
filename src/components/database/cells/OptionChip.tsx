import type { ColumnType, SelectOption } from "../../../types/database";
import { contrastTextColor } from "./utils";
import { SELECT_COLOR_PRESETS } from "../selectColorPresets";
import { PageIconDisplay } from "../../common/PageIconDisplay";

function optionChipStyle(
  color: string | undefined,
  columnType: ColumnType,
) {
  const bg =
    columnType === "status"
      ? color ?? "#6b7280"
      : color ?? SELECT_COLOR_PRESETS[0]!;
  return { backgroundColor: bg, color: contrastTextColor(bg) };
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
        "inline-flex max-w-full items-center truncate rounded px-1.5 py-0.5 text-xs font-medium",
        dimmed ? "opacity-70" : "",
        className ?? "",
      ].join(" ")}
      style={optionChipStyle(option.color, columnType)}
    >
      {option.icon ? (
        <PageIconDisplay
          icon={option.icon}
          size="sm"
          className="mr-1 !h-3.5 !w-3.5 text-[13px]"
          imgClassName="!h-3.5 !w-3.5"
        />
      ) : null}
      {option.label}
    </span>
  );
}
