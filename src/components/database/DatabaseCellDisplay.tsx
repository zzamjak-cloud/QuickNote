import type { CellValue, ColumnDef } from "../../types/database";
import { OptionChip } from "./cells/OptionChip";
import {
  formatPlainDisplay,
  stringArrayValue,
} from "./databaseCellDisplayUtils";

type Props = {
  column: ColumnDef;
  value: CellValue;
  textClassName?: string;
};

export function DatabaseCellDisplay({
  column,
  value,
  textClassName,
}: Props) {
  const options = column.config?.options ?? [];

  if (column.type === "status") {
    const raw = typeof value === "string" ? value : "";
    const current = options.find((option) => option.id === raw) ?? options[0];
    return current ? <OptionChip option={current} columnType="status" /> : null;
  }

  if (column.type === "select") {
    const raw = typeof value === "string" ? value : "";
    const current = options.find((option) => option.id === raw);
    return current ? <OptionChip option={current} columnType="select" /> : null;
  }

  if (column.type === "multiSelect") {
    const ids = stringArrayValue(value);
    const selected = options.filter((option) => ids.includes(option.id));
    if (selected.length === 0) return null;
    return (
      <span className="inline-flex max-w-full flex-wrap items-center gap-1">
        {selected.map((option) => (
          <OptionChip
            key={option.id}
            option={option}
            columnType="multiSelect"
          />
        ))}
      </span>
    );
  }

  const display = formatPlainDisplay(value, column);
  if (!display) return null;
  return (
    <span className={textClassName ?? "text-zinc-500 dark:text-zinc-400"}>
      {display}
    </span>
  );
}
