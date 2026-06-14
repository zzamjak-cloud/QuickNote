import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus } from "lucide-react";
import type { ColumnType } from "../../types/database";
import { defaultColumnForType, useDatabaseStore } from "../../store/databaseStore";
import { useUiStore } from "../../store/uiStore";
import { PageIconDisplay } from "../common/PageIconDisplay";
import { COLUMN_TYPE_LABELS, defaultColumnIcon } from "./columnTypeIcons";

// 이 메뉴에서 추가 가능한 타입(순서 유지). 라벨/아이콘은 단일 레지스트리에서 파생.
const ADDABLE_COLUMN_TYPE_IDS: ColumnType[] = [
  "text", "number", "select", "multiSelect", "status", "date", "person",
  "file", "checkbox", "url", "phone", "email", "dbLink", "pageLink", "itemFetch",
];
const COLUMN_TYPES: { id: ColumnType; label: string; icon?: string }[] =
  ADDABLE_COLUMN_TYPE_IDS.map((id) => ({
    id,
    label: COLUMN_TYPE_LABELS[id],
    icon: defaultColumnIcon(id),
  }));

export function DatabaseAddColumnButton({
  databaseId,
  onAfterAdd,
}: {
  databaseId: string;
  onAfterAdd?: (colId: string) => void;
}) {
  const addColumn = useDatabaseStore((s) => s.addColumn);
  const bundle = useDatabaseStore((s) => s.databases[databaseId]);
  const openColumnMenuId = useUiStore((s) => s.openColumnMenuId);
  const setOpenColumnMenu = useUiStore((s) => s.setOpenColumnMenu);
  const menuKey = `add:${databaseId}`;
  const open = openColumnMenuId === menuKey;
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current?.contains(e.target as Node)) return;
      if (buttonRef.current?.contains(e.target as Node)) return;
      setOpenColumnMenu(null);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open, setOpenColumnMenu]);

  const placeMenu = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 216;
    const estimatedHeight = Math.min(420, 32 + COLUMN_TYPES.length * 34);
    const left = Math.min(rect.left, window.innerWidth - width - 8);
    const downTop = rect.bottom + 6;
    const upTop = Math.max(8, rect.top - estimatedHeight - 6);
    const top =
      downTop + estimatedHeight <= window.innerHeight - 8 ? downTop : upTop;
    setCoords({ top, left: Math.max(8, left) });
  };

  useEffect(() => {
    if (!open) return;
    placeMenu();
    const onResize = () => placeMenu();
    const onScroll = () => placeMenu();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const toggle = () => {
    if (open) {
      setOpenColumnMenu(null);
      return;
    }
    placeMenu();
    setOpenColumnMenu(menuKey);
  };

  return (
    <div className="relative h-8 w-8 border-0 bg-transparent p-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        title="속성 추가"
        className="absolute left-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-500 shadow-sm hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
      >
        <Plus size={14} />
      </button>
      {open && coords &&
        createPortal(
          <div
            ref={popoverRef}
            style={{ position: "fixed", top: coords.top, left: coords.left, width: 216 }}
            className="z-50 max-h-[60vh] overflow-y-auto rounded-md border border-zinc-200 bg-white p-1 text-base shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          >
            <div className="px-2 py-1 text-sm uppercase text-zinc-500">속성 타입</div>
            {COLUMN_TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  if (!bundle) return;
                  const idx = bundle.columns.length + 1;
                  const colId = addColumn(databaseId, defaultColumnForType(t.id, `${t.label} ${idx}`));
                  onAfterAdd?.(colId);
                  setOpenColumnMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-base hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                {t.icon ? <PageIconDisplay icon={t.icon} size="sm" /> : null}
                {t.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
