import { useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  Check,
  ChevronDown,
  FolderKanban,
  type LucideIcon,
  Users,
} from "lucide-react";
import { PopoverBase } from "../../../lib/ui-primitives";

type ScopeItem = {
  id: string;
  value: string;
  label: string;
  disabled?: boolean;
};

type ScopeColumn = {
  key: "org" | "team" | "project";
  title: string;
  icon: LucideIcon;
  items: ScopeItem[];
};

type ScopeSelectDropdownProps = {
  value: string;
  onChange: (value: string) => void;
  organizations: ScopeItem[];
  teams: ScopeItem[];
  projects: ScopeItem[];
  allOption?: ScopeItem;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
  listMaxHeightClass?: string;
  align?: "left" | "right";
  ariaLabel?: string;
  placeholder?: string;
  emptyLabel?: string;
};

function mergeClassNames(...tokens: Array<string | undefined>): string {
  return tokens.filter(Boolean).join(" ");
}

const MENU_WIDTH = 920;

export function ScopeSelectDropdown({
  value,
  onChange,
  organizations,
  teams,
  projects,
  allOption,
  className,
  buttonClassName,
  menuClassName,
  listMaxHeightClass = "max-h-[560px]",
  align = "left",
  ariaLabel,
  placeholder = "선택",
  emptyLabel = "없음",
}: ScopeSelectDropdownProps) {
  const listRefs = useRef<Record<string, HTMLDivElement | null>>({
    org: null,
    team: null,
    project: null,
  });
  const [scrollHintByColumn, setScrollHintByColumn] = useState<Record<string, boolean>>({
    org: false,
    team: false,
    project: false,
  });

  const columns = useMemo<ScopeColumn[]>(
    () => [
      {
        key: "org",
        title: "조직",
        icon: Building2,
        items: allOption ? [allOption, ...organizations] : organizations,
      },
      { key: "team", title: "팀", icon: Users, items: teams },
      { key: "project", title: "프로젝트", icon: FolderKanban, items: projects },
    ],
    [allOption, organizations, projects, teams],
  );

  const selectedLabel = useMemo(() => {
    for (const column of columns) {
      const found = column.items.find((item) => item.value === value);
      if (found) return found.label;
    }
    return placeholder;
  }, [columns, placeholder, value]);

  const updateScrollHint = (columnKey: string) => {
    const list = listRefs.current[columnKey];
    if (!list) return;
    const hasOverflow = list.scrollHeight > list.clientHeight + 2;
    const canScrollDown = list.scrollTop + list.clientHeight < list.scrollHeight - 2;
    const showHint = hasOverflow && canScrollDown;
    setScrollHintByColumn((prev) =>
      prev[columnKey] === showHint ? prev : { ...prev, [columnKey]: showHint },
    );
  };

  return (
    <div className={mergeClassNames("relative", className)}>
      <PopoverBase
        width={MENU_WIDTH}
        align={align}
        maxHeightClassName="max-h-none"
        contentClassName={mergeClassNames(
          "grid grid-cols-3 gap-0 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900",
          menuClassName,
        )}
        contentStyle={{ maxWidth: "calc(100vw - 24px)" }}
        zClassName="z-[720]"
        trigger={({ buttonRef, toggle, open }) => (
          <button
            ref={buttonRef}
            type="button"
            onClick={() => toggle(MENU_WIDTH)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={ariaLabel}
            className={mergeClassNames(
              "flex min-h-[32px] items-center justify-between gap-2 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-[13px] shadow-sm transition-colors hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-amber-400 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700/70",
              buttonClassName,
            )}
          >
            <span className="min-w-0 truncate text-zinc-800 dark:text-zinc-100">
              {selectedLabel}
            </span>
            <ChevronDown
              size={14}
              className={`shrink-0 text-zinc-500 transition-transform ${
                open ? "rotate-180" : ""
              }`}
            />
          </button>
        )}
        content={({ close }) => (
          <ScopeMenuContent
            columns={columns}
            value={value}
            onChange={(v) => {
              onChange(v);
              close();
            }}
            listMaxHeightClass={listMaxHeightClass}
            emptyLabel={emptyLabel}
            listRefs={listRefs}
            scrollHintByColumn={scrollHintByColumn}
            updateScrollHint={updateScrollHint}
            setScrollHintByColumn={setScrollHintByColumn}
          />
        )}
      />
    </div>
  );
}

interface ScopeMenuContentProps {
  columns: ScopeColumn[];
  value: string;
  onChange: (value: string) => void;
  listMaxHeightClass: string;
  emptyLabel: string;
  listRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  scrollHintByColumn: Record<string, boolean>;
  updateScrollHint: (columnKey: string) => void;
  setScrollHintByColumn: React.Dispatch<
    React.SetStateAction<Record<string, boolean>>
  >;
}

function ScopeMenuContent({
  columns,
  value,
  onChange,
  listMaxHeightClass,
  emptyLabel,
  listRefs,
  scrollHintByColumn,
  updateScrollHint,
  setScrollHintByColumn,
}: ScopeMenuContentProps) {
  // 마운트 후 다음 frame 에 scroll hint 갱신 + window resize 추적
  useEffect(() => {
    const raf = window.requestAnimationFrame(() => {
      columns.forEach((c) => updateScrollHint(c.key));
    });
    const onResize = () => columns.forEach((c) => updateScrollHint(c.key));
    window.addEventListener("resize", onResize);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      setScrollHintByColumn({ org: false, team: false, project: false });
    };
  }, [columns, updateScrollHint, setScrollHintByColumn]);

  return (
    <>
      {columns.map((column) => (
        <div
          key={column.key}
          className="min-w-0 border-r border-zinc-100 p-2 last:border-r-0 dark:border-zinc-800"
        >
          <div className="mb-1.5 flex items-center gap-1.5 rounded-md bg-zinc-100 px-2 py-1.5 text-[12px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            <column.icon size={14} className="shrink-0" />
            {column.title}
          </div>
          <div className="relative">
            <div
              ref={(node) => {
                listRefs.current[column.key] = node;
              }}
              onScroll={() => updateScrollHint(column.key)}
              className={mergeClassNames(
                listMaxHeightClass,
                "space-y-1 overflow-y-auto pb-6 pr-1",
              )}
            >
              {column.items.length === 0 ? (
                <div className="px-2 py-2 text-[12px] text-zinc-400 dark:text-zinc-500">
                  {emptyLabel}
                </div>
              ) : (
                column.items.map((item) => {
                  const selected = value === item.value;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      disabled={item.disabled}
                      onClick={() => {
                        if (item.disabled) return;
                        onChange(item.value);
                      }}
                      className={mergeClassNames(
                        "flex w-full min-w-0 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[13px] text-left transition-colors",
                        item.disabled
                          ? "cursor-not-allowed text-zinc-300 dark:text-zinc-600"
                          : selected
                            ? "bg-blue-600 font-semibold text-white"
                            : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800",
                      )}
                    >
                      <span className="truncate">{item.label}</span>
                      {selected ? (
                        <Check size={13} strokeWidth={2.6} className="shrink-0" />
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
            {scrollHintByColumn[column.key] ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-7 items-end justify-center bg-gradient-to-t from-white via-white/95 to-transparent pb-0.5 text-zinc-400 dark:from-zinc-900 dark:via-zinc-900/95 dark:text-zinc-500">
                <ChevronDown size={15} />
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </>
  );
}
