import { useEffect, useRef, useState } from "react";
import { Trash2, Type } from "lucide-react";
import type { ColumnDef, ColumnType } from "../../types/database";
import { useDatabaseStore } from "../../store/databaseStore";
import { ColumnOptionsEditor } from "./ColumnOptionsEditor";
import { isLCSchedulerDatabaseId, isLCSchedulerRequiredColumnId } from "../../lib/scheduler/database";
import { AppSelect } from "../common/AppSelect";
import { AnchoredPanelBase } from "../../lib/ui-primitives";

const TYPE_LABELS: { id: ColumnType; label: string }[] = [
  { id: "text", label: "텍스트" },
  { id: "json", label: "JSON" },
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

type Props = {
  databaseId: string;
  column: ColumnDef;
  /** 부모 헤더 셀 — 메뉴를 그 아래에 띄우기 위한 기준점 */
  anchorEl?: HTMLElement | null;
  onClose: () => void;
};

export function DatabaseColumnMenu({ databaseId, column, anchorEl, onClose }: Props) {
  const updateColumn = useDatabaseStore((s) => s.updateColumn);
  const removeColumn = useDatabaseStore((s) => s.removeColumn);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [nameDraft, setNameDraft] = useState(column.name);
  const committedRef = useRef(false);

  useEffect(() => {
    committedRef.current = false;
    setNameDraft(column.name);
    const timer = setTimeout(() => nameInputRef.current?.select(), 60);
    return () => clearTimeout(timer);
  }, [column.name]);

  const commitName = () => {
    if (committedRef.current) return;
    const t = nameDraft.trim() || column.name;
    if (t !== column.name) {
      committedRef.current = true;
      updateColumn(databaseId, column.id, { name: t });
    }
  };

  const isTitle = column.type === "title";
  const isProtectedSchedulerColumn =
    isLCSchedulerDatabaseId(databaseId) && isLCSchedulerRequiredColumnId(column.id);
  const isSelectKind =
    column.type === "select" || column.type === "multiSelect" || column.type === "status";
  const wrapText = column.config?.wrapText === true;

  return (
    <AnchoredPanelBase
      anchorEl={anchorEl ?? null}
      open={!!anchorEl}
      onClose={onClose}
      width={260}
      additionalIgnoreSelector="[data-qn-color-picker]"
    >
      <div className="max-h-[72vh] overflow-y-auto">
        <div className="border-b border-zinc-100 px-2 py-1.5 dark:border-zinc-800">
          <input
            ref={nameInputRef}
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") { commitName(); onClose(); }
              if (e.key === "Escape") { setNameDraft(column.name); onClose(); }
            }}
            placeholder="속성 이름"
            className="w-full rounded border border-zinc-200 bg-white px-2 py-1 text-sm outline-none focus:border-blue-400 dark:border-zinc-600 dark:bg-zinc-900"
          />
        </div>

        {!isTitle && (
          <div className="px-2 py-1">
            <div className="flex items-center gap-1 text-xs text-zinc-500">
              <Type size={11} /> 타입
            </div>
            <AppSelect
              value={column.type}
              onChange={(nextValue) =>
                updateColumn(databaseId, column.id, { type: nextValue as ColumnType })
              }
              options={TYPE_LABELS.map((item) => ({ value: item.id, label: item.label }))}
              className="mt-0.5"
              buttonClassName="w-full px-1 py-0.5"
            />
          </div>
        )}

        {isSelectKind && (
          <div className="border-t border-zinc-100 px-1 py-1 dark:border-zinc-800">
            <ColumnOptionsEditor databaseId={databaseId} column={column} />
          </div>
        )}

        <div className="border-t border-zinc-100 px-2 py-1.5 dark:border-zinc-800">
          <button
            type="button"
            onClick={() =>
              updateColumn(databaseId, column.id, {
                config: { ...(column.config ?? {}), wrapText: !wrapText },
              })
            }
            className={[
              "flex w-full items-center justify-between rounded px-1 py-1 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
            ].join(" ")}
          >
            <span>자동 줄바꿈</span>
            <span
              aria-hidden
              className={[
                "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                wrapText ? "bg-blue-600" : "bg-zinc-300 dark:bg-zinc-600",
              ].join(" ")}
            >
              <span
                className={[
                  "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                  wrapText ? "translate-x-4" : "translate-x-0.5",
                ].join(" ")}
              />
            </span>
          </button>
        </div>

        {!isTitle && !isProtectedSchedulerColumn && (
          <button
            type="button"
            onClick={() => {
              if (!confirming) { setConfirming(true); return; }
              removeColumn(databaseId, column.id);
              onClose();
            }}
            className={[
              "flex w-full items-center gap-2 rounded px-2 py-1",
              confirming
                ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                : "text-zinc-700 hover:bg-red-50 hover:text-red-600 dark:text-zinc-300 dark:hover:bg-red-950/40",
            ].join(" ")}
          >
            <Trash2 size={12} /> {confirming ? "한 번 더 누르면 삭제" : "삭제"}
          </button>
        )}
      </div>
    </AnchoredPanelBase>
  );
}
