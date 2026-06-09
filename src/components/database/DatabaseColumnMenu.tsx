import { useEffect, useRef, useState } from "react";
import { EyeOff, Trash2, Type } from "lucide-react";
import type { ColumnDef, ColumnType } from "../../types/database";
import { useDatabaseStore } from "../../store/databaseStore";
import { ColumnOptionsEditor } from "./ColumnOptionsEditor";
import { AppSelect } from "../common/AppSelect";
import { AnchoredPanelBase } from "../../lib/ui-primitives";
import { IconPicker } from "../common/IconPicker";
import { PageIconDisplay } from "../common/PageIconDisplay";
import { defaultColumnIcon } from "./columnTypeIcons";
import {
  ProgressSourceEditor,
  SelectSourceEditor,
  PageLinkScopeEditor,
  ItemFetchEditor,
} from "./columnEditors/ColumnSourceEditors";

type TypeLabel = { id: ColumnType; label: string; icon?: string };

const TYPE_LABELS: TypeLabel[] = [
  { id: "text", label: "텍스트", icon: defaultColumnIcon("text") },
  { id: "number", label: "숫자", icon: defaultColumnIcon("number") },
  { id: "select", label: "선택", icon: defaultColumnIcon("select") },
  { id: "multiSelect", label: "다중 선택", icon: defaultColumnIcon("multiSelect") },
  { id: "status", label: "상태", icon: defaultColumnIcon("status") },
  { id: "date", label: "날짜", icon: defaultColumnIcon("date") },
  { id: "person", label: "사람", icon: defaultColumnIcon("person") },
  { id: "file", label: "파일", icon: defaultColumnIcon("file") },
  { id: "checkbox", label: "체크박스", icon: defaultColumnIcon("checkbox") },
  { id: "url", label: "URL", icon: defaultColumnIcon("url") },
  { id: "phone", label: "연락처", icon: defaultColumnIcon("phone") },
  { id: "email", label: "이메일", icon: defaultColumnIcon("email") },
  { id: "dbLink", label: "DB 연결", icon: defaultColumnIcon("dbLink") },
  { id: "pageLink", label: "페이지 연결", icon: defaultColumnIcon("pageLink") },
  { id: "progress", label: "진행률", icon: defaultColumnIcon("progress") },
  { id: "itemFetch", label: "페이지 연결 가져오기", icon: defaultColumnIcon("itemFetch") },
];

type Props = {
  databaseId: string;
  column: ColumnDef;
  /** 부모 헤더 셀 — 메뉴를 그 아래에 띄우기 위한 기준점 */
  anchorEl?: HTMLElement | null;
  onClose: () => void;
  onHide?: () => void;
};

export function DatabaseColumnMenu({ databaseId, column, anchorEl, onClose, onHide }: Props) {
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
  const isSelectKind =
    column.type === "select" || column.type === "multiSelect" || column.type === "status";
  const wrapText = column.config?.wrapText === true;
  const selectedType = TYPE_LABELS.find((item) => item.id === column.type);
  const typeOptions = TYPE_LABELS.map((item) => ({
    value: item.id,
    label: item.label,
    icon: item.icon ? <PageIconDisplay icon={item.icon} size="sm" /> : undefined,
  }));
  const selectedTypeOption = {
    value: column.type,
    label: selectedType?.label ?? (column.type === "json" ? "JSON" : column.type),
    icon: selectedType?.icon ? <PageIconDisplay icon={selectedType.icon} size="sm" /> : undefined,
  };

  return (
    <AnchoredPanelBase
      anchorEl={anchorEl ?? null}
      open={!!anchorEl}
      onClose={onClose}
      width={260}
      additionalIgnoreSelector="[data-qn-color-picker]"
    >
      <div className="max-h-[72vh] overflow-y-auto">
        <div className="flex items-center gap-1 border-b border-zinc-100 px-2 py-1.5 dark:border-zinc-800">
          <IconPicker
            current={column.icon ?? null}
            defaultIcon={<PageIconDisplay icon={defaultColumnIcon(column.type)} size="sm" />}
            size="sm"
            onChange={(icon) => updateColumn(databaseId, column.id, { icon: icon ?? undefined })}
          />
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
              options={typeOptions}
              selectedOption={selectedTypeOption}
              className="mt-0.5"
              buttonClassName="w-full px-1 py-0.5"
              portal
            />
          </div>
        )}

        {isSelectKind && (
          <>
            <SelectSourceEditor databaseId={databaseId} column={column} />
            {/* sourceFromDb/linkedScope 가 설정된 경우 옵션은 원본 미러링 — 편집기 숨김 */}
            {!column.config?.sourceFromDb && !column.config?.linkedScope && (
              <div className="border-t border-zinc-100 px-1 py-1 dark:border-zinc-800">
                <ColumnOptionsEditor databaseId={databaseId} column={column} />
              </div>
            )}
          </>
        )}

        {column.type === "progress" && (
          <ProgressSourceEditor databaseId={databaseId} column={column} />
        )}

        {column.type === "itemFetch" && (
          <ItemFetchEditor databaseId={databaseId} column={column} />
        )}
        {column.type === "pageLink" && (
          <PageLinkScopeEditor databaseId={databaseId} column={column} />
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

        {!isTitle && onHide && (
          <button
            type="button"
            onClick={() => { onHide(); onClose(); }}
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <EyeOff size={12} /> 숨기기
          </button>
        )}

        {!isTitle && (
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
