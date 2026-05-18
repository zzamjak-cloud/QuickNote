import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export type AppSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type AppSelectGroup = {
  label?: string;
  options: AppSelectOption[];
};

type AppSelectProps = {
  value: string;
  onChange: (value: string) => void;
  options?: AppSelectOption[];
  groups?: AppSelectGroup[];
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  optionClassName?: string;
  align?: "left" | "right";
  groupLayout?: "stack" | "columns";
  selectedStyle?: "neutral" | "blue";
  showSelectedCheck?: boolean;
  openOnMount?: boolean;
  onOpenChange?: (open: boolean) => void;
};

function mergeClassNames(...tokens: Array<string | undefined>): string {
  return tokens.filter(Boolean).join(" ");
}

export function AppSelect({
  value,
  onChange,
  options,
  groups,
  placeholder = "선택",
  emptyLabel = "항목 없음",
  disabled = false,
  ariaLabel,
  className,
  buttonClassName,
  menuClassName,
  optionClassName,
  align = "left",
  groupLayout = "stack",
  selectedStyle = "neutral",
  showSelectedCheck = false,
  openOnMount = false,
  onOpenChange,
}: AppSelectProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(openOnMount);

  const grouped = useMemo<AppSelectGroup[]>(() => {
    if (groups && groups.length > 0) return groups;
    return [{ options: options ?? [] }];
  }, [groups, options]);

  const flatOptions = useMemo(
    () => grouped.flatMap((group) => group.options),
    [grouped],
  );

  const current = useMemo(
    () => flatOptions.find((opt) => opt.value === value) ?? null,
    [flatOptions, value],
  );

  const updateOpen = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  useEffect(() => {
    if (!openOnMount) return;
    buttonRef.current?.focus();
  }, [openOnMount]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
      onOpenChange?.(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        onOpenChange?.(false);
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onOpenChange, open]);

  const handleSelect = (nextValue: string, itemDisabled?: boolean) => {
    if (itemDisabled) return;
    onChange(nextValue);
    updateOpen(false);
  };

  return (
    <div ref={rootRef} className={mergeClassNames("relative", className)}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => updateOpen(!open)}
        className={mergeClassNames(
          "flex w-full items-center justify-between gap-2 rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 shadow-sm outline-none transition-colors hover:bg-zinc-50 focus:ring-2 focus:ring-blue-400 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60",
          buttonClassName,
        )}
      >
        <span className={mergeClassNames("truncate text-left", current ? "" : "text-zinc-400 dark:text-zinc-500")}>
          {current?.label ?? placeholder}
        </span>
        <ChevronDown
          size={14}
          className={mergeClassNames("shrink-0 text-zinc-400 transition-transform", open ? "rotate-180" : "")}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className={mergeClassNames(
            "absolute top-full z-[720] mt-1 min-w-full rounded-md border border-zinc-200 bg-white p-1 text-sm shadow-xl dark:border-zinc-700 dark:bg-zinc-900",
            align === "right" ? "right-0" : "left-0",
            menuClassName,
          )}
        >
          {flatOptions.length === 0 ? (
            <div className="px-2 py-1.5 text-zinc-400 dark:text-zinc-500">{emptyLabel}</div>
          ) : (
            <div
              className={groupLayout === "columns" ? "grid gap-0" : "max-h-64 space-y-0.5 overflow-y-auto"}
              style={groupLayout === "columns"
                ? { gridTemplateColumns: `repeat(${Math.max(1, grouped.length)}, minmax(0, 1fr))` }
                : undefined}
            >
              {grouped.map((group, groupIdx) => (
                <div
                  key={`${group.label ?? "group"}:${groupIdx}`}
                  className={mergeClassNames(
                    "space-y-0.5",
                    groupLayout === "columns"
                      ? "min-w-0 border-r border-zinc-100 p-1 last:border-r-0 dark:border-zinc-800"
                      : undefined,
                  )}
                >
                  {group.label ? (
                    <div className="px-2 py-1 font-medium text-zinc-500 dark:text-zinc-400">
                      {group.label}
                    </div>
                  ) : null}
                  <div className={groupLayout === "columns" ? "max-h-64 space-y-0.5 overflow-y-auto" : "space-y-0.5"}>
                    {group.options.map((option) => {
                      const selected = option.value === value;
                      const selectedClassName = selectedStyle === "blue"
                        ? "bg-blue-600 font-semibold text-white"
                        : "bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100";
                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          disabled={option.disabled}
                          onClick={() => handleSelect(option.value, option.disabled)}
                          className={mergeClassNames(
                            "flex w-full items-center rounded px-2 py-1.5 text-left transition-colors",
                            option.disabled
                              ? "cursor-not-allowed text-zinc-300 dark:text-zinc-600"
                              : selected
                                ? selectedClassName
                                : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800",
                            optionClassName,
                          )}
                        >
                          <span className="truncate">{option.label}</span>
                          {selected && showSelectedCheck ? (
                            <Check size={13} strokeWidth={2.6} className="ml-auto shrink-0" />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
