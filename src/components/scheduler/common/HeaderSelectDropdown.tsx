// LC 스케줄러 헤더(컴팩트)용 소형 선택 드롭다운 — 네이티브 select 대체.
// 퀵노트 팝업 규약에 따라 useAnchoredPopover 로 버튼 아래 1차 배치 + 화면 클리핑 방지(플립·클램프).
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { useAnchoredPopover } from "../../../hooks/useAnchoredPopover";

const DEFAULT_MENU_WIDTH = 112;

type HeaderSelectOption<T extends string> = {
  value: T;
  label: string;
};

type Props<T extends string> = {
  value: T;
  options: readonly HeaderSelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  menuWidth?: number;
};

export function HeaderSelectDropdown<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  menuWidth = DEFAULT_MENU_WIDTH,
}: Props<T>) {
  const { buttonRef, popoverRef, open, coords, toggle, close } =
    useAnchoredPopover(menuWidth);
  const selected = options.find((option) => option.value === value);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => toggle(menuWidth)}
        className="flex shrink-0 items-center gap-1 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-100/40 dark:bg-zinc-800/40 px-1.5 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
      >
        <span className="truncate">{selected?.label ?? value}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && coords &&
        createPortal(
          <div
            ref={popoverRef}
            role="listbox"
            aria-label={ariaLabel}
            // LC 스케줄러 모달(z-[500]) 내부에서도 가려지지 않도록 z-[560]
            className="fixed z-[560] rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 py-1 shadow-xl"
            style={{ top: coords.top, left: coords.left, width: menuWidth }}
          >
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                onClick={() => {
                  onChange(option.value);
                  close();
                }}
                className={`flex w-full items-center px-3 py-1.5 text-left text-xs transition-colors ${
                  option.value === value
                    ? "bg-green-600 text-white"
                    : "text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
