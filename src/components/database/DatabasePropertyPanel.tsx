import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
// ChevronDown 은 비-타이틀 컬럼 헤더에서 계속 사용
import type { ColumnType } from "../../types/database";
import { useDatabaseStore, defaultColumnForType } from "../../store/databaseStore";
import { usePageStore } from "../../store/pageStore";
import { DatabaseCell } from "./DatabaseCell";
import { DatabaseColumnMenu } from "./DatabaseColumnMenu";

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

export function DatabasePropertyPanel({
  databaseId,
  pageId,
}: {
  databaseId: string;
  pageId: string;
}) {
  const bundle = useDatabaseStore((s) => s.databases[databaseId]);
  const page = usePageStore((s) => s.pages[pageId]);
  const addColumn = useDatabaseStore((s) => s.addColumn);
  const updateColumn = useDatabaseStore((s) => s.updateColumn);
  // 속성 패널 메뉴는 로컬 상태로 관리 — 글로벌 openColumnMenuId 와 분리해야
  // 피크 뒤 dim 처리된 DB 의 동일 컬럼 헤더 메뉴가 함께 뜨지 않음
  const [localOpenColumnId, setLocalOpenColumnId] = useState<string | null>(null);
  const setOpenColumnMenu = (id: string | null) => setLocalOpenColumnId(id);
  const openColumnMenuId = localOpenColumnId;
  const [showAdd, setShowAdd] = useState(false);
  const [renamingTitleProperty, setRenamingTitleProperty] = useState(false);
  const [colMenuAnchor, setColMenuAnchor] = useState<HTMLElement | null>(null);
  const titleAnchorRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const titleColumn = bundle?.columns.find((c) => c.type === "title");
  const [titlePropertyDraft, setTitlePropertyDraft] = useState(
    titleColumn?.name ?? "이름",
  );

  useEffect(() => {
    setTitlePropertyDraft(titleColumn?.name ?? "이름");
  }, [titleColumn?.name]);

  useEffect(() => {
    if (renamingTitleProperty) titleInputRef.current?.focus();
  }, [renamingTitleProperty]);

  const commitTitlePropertyName = () => {
    if (!titleColumn) return;
    const next = titlePropertyDraft.trim() || titleColumn.name;
    if (next !== titleColumn.name) {
      updateColumn(databaseId, titleColumn.id, { name: next });
    }
    setTitlePropertyDraft(next);
    setRenamingTitleProperty(false);
  };

  if (!bundle || !page) return null;

  return (
    <div className="my-3 space-y-1 border-y border-zinc-200 py-3 text-xs dark:border-zinc-800">
      {titleColumn && (
        <div className="flex items-start gap-2">
          <div
            ref={titleAnchorRef}
            className="w-32 shrink-0 pt-0.5 text-zinc-500"
          >
            {renamingTitleProperty ? (
              <input
                ref={titleInputRef}
                value={titlePropertyDraft}
                onChange={(e) => setTitlePropertyDraft(e.target.value)}
                onBlur={commitTitlePropertyName}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") commitTitlePropertyName();
                  if (e.key === "Escape") {
                    setTitlePropertyDraft(titleColumn.name);
                    setRenamingTitleProperty(false);
                  }
                }}
                className="w-full rounded border border-zinc-300 bg-white px-1 text-xs dark:border-zinc-600 dark:bg-zinc-900"
              />
            ) : (
              // 이름 컬럼은 편집할 속성이 없으므로 클릭 메뉴 없이 더블클릭 이름 변경만 제공
              <div
                onDoubleClick={() => setRenamingTitleProperty(true)}
                className="flex w-full cursor-default items-center px-1 py-0.5"
                title="더블클릭하여 이름 변경"
              >
                <span className="min-w-0 flex-1 truncate">{titleColumn.name}</span>
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1 truncate px-1 py-0.5 text-zinc-700 dark:text-zinc-200">
            {page.title || "제목 없음"}
          </div>
        </div>
      )}
      {bundle.columns
        .filter((c) => c.type !== "title")
        .map((col) => {
          const value = (col.id in (page.dbCells ?? {}))
            ? page.dbCells![col.id]
            : null;
          const colMenuOpen = openColumnMenuId === col.id;
          return (
            <div key={col.id} className="flex items-start gap-2">
              <div className="w-32 shrink-0 pt-0.5 text-zinc-500">
                <button
                  type="button"
                  onClick={(e) => {
                    setOpenColumnMenu(colMenuOpen ? null : col.id);
                    if (!colMenuOpen) setColMenuAnchor(e.currentTarget);
                  }}
                  className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span className="min-w-0 flex-1 truncate">{col.name}</span>
                  <ChevronDown size={10} className="shrink-0 opacity-60" />
                </button>
                {colMenuOpen && colMenuAnchor && (
                  <DatabaseColumnMenu
                    databaseId={databaseId}
                    column={col}
                    anchorEl={colMenuAnchor}
                    onClose={() => { setOpenColumnMenu(null); setColMenuAnchor(null); }}
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <DatabaseCell
                  databaseId={databaseId}
                  rowId={pageId}
                  column={col}
                  value={value}
                />
              </div>
            </div>
          );
        })}
      <div className="pt-2">
        {showAdd ? (
          <select
            autoFocus
            defaultValue=""
            onBlur={() => setShowAdd(false)}
            onChange={(e) => {
              const t = e.target.value as ColumnType | "";
              if (t) {
                const label = COLUMN_TYPES.find((x) => x.id === t)?.label ?? "속성";
                const idx = bundle.columns.length + 1;
                addColumn(databaseId, defaultColumnForType(t, `${label} ${idx}`));
              }
              setShowAdd(false);
            }}
            className="rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-600 dark:bg-zinc-900"
          >
            <option value="">선택…</option>
            {COLUMN_TYPES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        ) : (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1 rounded px-1 py-0.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <Plus size={12} /> 속성 추가
          </button>
        )}
      </div>
    </div>
  );
}
