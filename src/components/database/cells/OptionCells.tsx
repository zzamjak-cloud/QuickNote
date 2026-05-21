import type { CellValue, ColumnDef } from "../../../types/database";
import { CellEditorBase } from "../../../lib/ui-primitives";
import { OptionChip } from "./OptionChip";

const MULTI_TRIGGER_CLASS =
  "flex min-h-[20px] w-full flex-wrap items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800";
const STATUS_TRIGGER_CLASS =
  "flex min-h-[20px] w-full items-center rounded px-1 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800";

export function SelectCell({
  column,
  value,
  onChange,
}: {
  column: ColumnDef;
  value: string;
  onChange: (v: CellValue) => void;
}) {
  const opts = column.config?.options ?? [];
  const current = opts.find((o) => o.id === value) ?? null;

  return (
    <CellEditorBase
      width={180}
      title="옵션 선택"
      display={current ? <OptionChip option={current} columnType="select" /> : null}
      editor={({ close }) => (
        <>
          <button
            type="button"
            onClick={() => {
              onChange(null);
              close();
            }}
            className="block w-full rounded px-2 py-1 text-left text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            — 선택 해제
          </button>
          {opts.length === 0 ? (
            <div className="px-2 py-1 text-xs text-zinc-500">옵션이 없습니다</div>
          ) : (
            opts.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  onChange(o.id);
                  close();
                }}
                className="block w-full rounded px-2 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <OptionChip option={o} columnType="select" />
              </button>
            ))
          )}
        </>
      )}
    />
  );
}

export function MultiSelectCell({
  column,
  value,
  onChange,
}: {
  column: ColumnDef;
  value: string[];
  onChange: (v: CellValue) => void;
}) {
  const opts = column.config?.options ?? [];
  const selected = opts.filter((o) => value.includes(o.id));

  const toggle = (id: string) => {
    const set = new Set(value);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    onChange([...set]);
  };

  return (
    <CellEditorBase
      width={200}
      title="옵션 선택"
      triggerClassName={MULTI_TRIGGER_CLASS}
      display={selected.map((o) => (
        <OptionChip key={o.id} option={o} columnType="multiSelect" />
      ))}
      editor={() => (
        <>
          {opts.length === 0 ? (
            <div className="px-2 py-1 text-xs text-zinc-500">
              옵션이 없습니다. 컬럼 메뉴에서 추가하세요.
            </div>
          ) : (
            opts.map((o) => {
              const on = value.includes(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => toggle(o.id)}
                  className={[
                    "block w-full rounded px-2 py-1 text-left",
                    on
                      ? "bg-zinc-100 dark:bg-zinc-800"
                      : "hover:bg-zinc-100 dark:hover:bg-zinc-800",
                  ].join(" ")}
                >
                  <OptionChip option={o} columnType="multiSelect" dimmed={!on} />
                </button>
              );
            })
          )}
        </>
      )}
    />
  );
}

export function StatusCell({
  column,
  value,
  onChange,
}: {
  column: ColumnDef;
  value: string;
  onChange: (v: CellValue) => void;
}) {
  const opts = column.config?.options ?? [];
  const current = opts.find((o) => o.id === value) ?? opts[0];

  return (
    <CellEditorBase
      width={180}
      title="상태 변경"
      triggerClassName={STATUS_TRIGGER_CLASS}
      display={
        current ? (
          <OptionChip option={current} columnType="status" />
        ) : (
          <span className="text-xs text-zinc-400">옵션 없음</span>
        )
      }
      editor={({ close }) => (
        <>
          {opts.length === 0 ? (
            <div className="px-2 py-1 text-xs text-zinc-500">옵션이 없습니다</div>
          ) : (
            opts.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  onChange(o.id);
                  close();
                }}
                className="block w-full rounded px-2 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <OptionChip option={o} columnType="status" />
              </button>
            ))
          )}
        </>
      )}
    />
  );
}
