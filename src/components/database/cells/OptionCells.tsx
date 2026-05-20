// SelectCell / MultiSelectCell / StatusCell — 옵션 칩 팝오버 셀.
// DatabaseCell.tsx 에서 분리 — 동작 변경 없음.

import { createPortal } from "react-dom";
import type { CellValue, ColumnDef } from "../../../types/database";
import { useAnchoredPopover } from "../../../hooks/useAnchoredPopover";
import { OptionChip } from "./OptionChip";

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
  const pop = useAnchoredPopover(180);

  return (
    <>
      <button
        ref={pop.buttonRef}
        type="button"
        onClick={() => pop.toggle(180)}
        title="옵션 선택"
        className="flex min-h-[20px] w-full items-center rounded px-1 py-0.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        {current ? (
          <OptionChip option={current} columnType="select" />
        ) : null}
      </button>
      {pop.open && pop.coords &&
        createPortal(
          <div
            ref={pop.popoverRef}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: pop.coords.top,
              left: pop.coords.left,
              width: 180,
            }}
            className="z-[700] max-h-[60vh] overflow-y-auto rounded-md border border-zinc-200 bg-white p-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          >
            <button
              type="button"
              onClick={() => {
                onChange(null);
                pop.close();
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
                    pop.close();
                  }}
                  className="block w-full rounded px-2 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <OptionChip option={o} columnType="select" />
                </button>
              ))
            )}
          </div>,
          document.body,
        )}
    </>
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
  const pop = useAnchoredPopover(200);

  const toggle = (id: string) => {
    const set = new Set(value);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    onChange([...set]);
  };

  const selected = opts.filter((o) => value.includes(o.id));

  return (
    <>
      <button
        ref={pop.buttonRef}
        type="button"
        onClick={() => pop.toggle(200)}
        title="옵션 선택"
        className="flex min-h-[20px] w-full flex-wrap items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        {selected.map((o) => (
          <OptionChip key={o.id} option={o} columnType="multiSelect" />
        ))}
      </button>
      {pop.open && pop.coords &&
        createPortal(
          <div
            ref={pop.popoverRef}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{ position: "fixed", top: pop.coords.top, left: pop.coords.left, width: 200 }}
            className="z-[700] max-h-[60vh] overflow-y-auto rounded-md border border-zinc-200 bg-white p-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          >
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
          </div>,
          document.body,
        )}
    </>
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
  const pop = useAnchoredPopover(180);

  const current = opts.find((o) => o.id === value) ?? opts[0];

  return (
    <>
      <button
        ref={pop.buttonRef}
        type="button"
        onClick={() => pop.toggle(180)}
        title="상태 변경"
        className="flex min-h-[20px] w-full items-center rounded px-1 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        {current ? (
          <OptionChip option={current} columnType="status" />
        ) : (
          <span className="text-xs text-zinc-400">옵션 없음</span>
        )}
      </button>
      {pop.open && pop.coords &&
        createPortal(
          <div
            ref={pop.popoverRef}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: pop.coords.top,
              left: pop.coords.left,
              width: 180,
            }}
            className="z-[700] rounded-md border border-zinc-200 bg-white p-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          >
            {opts.length === 0 ? (
              <div className="px-2 py-1 text-xs text-zinc-500">옵션이 없습니다</div>
            ) : (
              opts.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => {
                    onChange(o.id);
                    pop.close();
                  }}
                  className="block w-full rounded px-2 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <OptionChip option={o} columnType="status" />
                </button>
              ))
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
