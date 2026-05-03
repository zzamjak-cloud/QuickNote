import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus } from "lucide-react";
import type { ColumnType } from "../../types/database";
import { defaultColumnForType, useDatabaseStore } from "../../store/databaseStore";
import { useUiStore } from "../../store/uiStore";

const COLUMN_TYPES: { id: ColumnType; label: string }[] = [
  { id: "text", label: "텍스트" },
  { id: "number", label: "숫자" },
  { id: "select", label: "선택" },
  { id: "multiSelect", label: "다중 선택" },
  { id: "status", label: "상태" },
  { id: "date", label: "날짜" },
  { id: "person", label: "사람" },
  { id: "file", label: "파일" },
  { id: "checkbox", label: "체크박스" },
  { id: "url", label: "URL" },
  { id: "phone", label: "연락처" },
  { id: "email", label: "이메일" },
];

export function DatabaseAddColumnButton({ databaseId }: { databaseId: string }) {
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

  const toggle = () => {
    if (open) {
      setOpenColumnMenu(null);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      // 포털로 렌더하되 버튼 우측 정렬, 화면 밖으로 나가지 않도록 클램프
      const width = 192; // w-48
      const left = Math.min(rect.right - width, window.innerWidth - width - 8);
      const top = rect.bottom + 4;
      setCoords({ top, left: Math.max(8, left) });
    }
    setOpenColumnMenu(menuKey);
  };

  return (
    <th className="w-8 border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-700">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        title="속성 추가"
        className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        <Plus size={14} />
      </button>
      {open && coords &&
        createPortal(
          <div
            ref={popoverRef}
            style={{ position: "fixed", top: coords.top, left: coords.left, width: 192 }}
            className="z-50 max-h-[60vh] overflow-y-auto rounded-md border border-zinc-200 bg-white p-1 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          >
            <div className="px-2 py-1 text-[10px] uppercase text-zinc-500">속성 타입</div>
            {COLUMN_TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  if (!bundle) return;
                  const idx = bundle.columns.length + 1;
                  addColumn(databaseId, defaultColumnForType(t.id, `${t.label} ${idx}`));
                  setOpenColumnMenu(null);
                }}
                className="block w-full rounded px-2 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                {t.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </th>
  );
}
