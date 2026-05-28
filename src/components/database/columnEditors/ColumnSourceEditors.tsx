// 컬럼 편집 팝업의 추가 섹션 — sourceFromDb / progressSource / pageLinkScope·검색필터.
// DatabaseColumnMenu 내부에서 컬럼 type 에 따라 조건부 렌더링.

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { newId } from "../../../lib/id";
import { AppSelect } from "../../common/AppSelect";
import { useDatabaseStore, listDatabases } from "../../../store/databaseStore";
import type {
  ColumnDef,
  ProgressSourceConfig,
  SearchFilterRule,
  ColumnSourceFromDb,
} from "../../../types/database";

type CommonProps = {
  databaseId: string;
  column: ColumnDef;
};

// ─────────────────────────────────────────────────────────────────────────────
// 1) 진행률 소스 편집기 — column.type === "progress"
// ─────────────────────────────────────────────────────────────────────────────

export function ProgressSourceEditor({ databaseId, column }: CommonProps) {
  const updateColumn = useDatabaseStore((s) => s.updateColumn);
  const databases = useDatabaseStore((s) => s.databases);
  const allDatabases = useDatabaseStore(listDatabases);
  const ps = column.config?.progressSource ?? null;

  const targetDb = ps?.databaseId ? databases[ps.databaseId] : null;
  const targetCol = ps && targetDb ? targetDb.columns.find((c) => c.id === ps.columnId) : null;
  const targetOptions = targetCol?.config?.options ?? [];

  // 같은 DB 내 pageLink 컬럼들 (linkedPagesFromColumn 모드 선택용)
  const currentBundle = databases[databaseId];
  const pageLinkColumns = (currentBundle?.columns ?? []).filter((c) => c.type === "pageLink");

  /** 진행률 자동 계산 설정 patch — DB 선택 해제 시 progressSource 삭제. */
  const update = (patch: Partial<ProgressSourceConfig>) => {
    const merged: ProgressSourceConfig = {
      databaseId: patch.databaseId ?? ps?.databaseId ?? "",
      columnId: patch.columnId ?? ps?.columnId ?? "",
      completedValue: patch.completedValue ?? ps?.completedValue ?? "",
      scope: patch.scope ?? ps?.scope ?? { mode: "allRows" },
    };
    // 대상 DB가 비어있으면 자동 계산 해제 → progressSource 자체를 제거.
    if (!merged.databaseId) {
      const { progressSource: _omit, ...rest } = column.config ?? {};
      updateColumn(databaseId, column.id, { config: rest });
      return;
    }
    updateColumn(databaseId, column.id, {
      config: { ...(column.config ?? {}), progressSource: merged },
    });
  };

  const dbOptions = allDatabases.map((d) => ({ value: d.id, label: d.meta.title || "제목 없음" }));
  const columnOptions = (targetDb?.columns ?? [])
    .filter((c) => c.type === "status" || c.type === "select" || c.type === "checkbox")
    .map((c) => ({ value: c.id, label: c.name }));

  return (
    <div className="border-t border-zinc-100 px-2 py-1.5 dark:border-zinc-800">
      <div className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
        자동 계산 소스
      </div>
      <p className="mb-2 text-[10px] leading-tight text-zinc-400">
        대상 DB와 완료 판정 컬럼을 선택하면 진행률이 자동 계산됩니다. DB를 비우면 수동 입력 모드로 돌아갑니다.
      </p>

      <div className="space-y-1.5">
        <div>
          <div className="text-[10px] uppercase text-zinc-400">1단계 · 대상 DB</div>
          <AppSelect
            value={ps?.databaseId ?? ""}
            onChange={(v) => update({ databaseId: v, columnId: "", completedValue: "" })}
            options={[{ value: "", label: "(수동 입력)" }, ...dbOptions]}
            buttonClassName="w-full px-1.5 py-1 text-xs"
            portal
          />
        </div>

        {targetDb && (
          <div>
            <div className="text-[10px] uppercase text-zinc-400">2단계 · 완료 판정 컬럼</div>
            <AppSelect
              value={ps?.columnId ?? ""}
              onChange={(v) => update({ columnId: v, completedValue: "" })}
              options={[{ value: "", label: "선택…" }, ...columnOptions]}
              buttonClassName="w-full px-1.5 py-1 text-xs"
              portal
            />
            {columnOptions.length === 0 && (
              <p className="mt-1 text-[10px] text-amber-500">
                상태·선택·체크박스 타입의 컬럼이 필요합니다.
              </p>
            )}
          </div>
        )}

        {targetCol && (
          <div>
            <div className="text-[10px] uppercase text-zinc-400">3단계 · 완료 값</div>
            {targetCol.type === "checkbox" ? (
              <AppSelect
                value={ps?.completedValue ?? "true"}
                onChange={(v) => update({ completedValue: v })}
                options={[{ value: "true", label: "체크됨" }]}
                buttonClassName="w-full px-1.5 py-1 text-xs"
                portal
              />
            ) : (
              <AppSelect
                value={ps?.completedValue ?? ""}
                onChange={(v) => update({ completedValue: v })}
                options={[
                  { value: "", label: "선택…" },
                  ...targetOptions
                    .filter((o) => !o.divider)
                    .map((o) => ({ value: o.id, label: o.label })),
                ]}
                buttonClassName="w-full px-1.5 py-1 text-xs"
                portal
              />
            )}
          </div>
        )}

        {/* 스코프 모드 */}
        {ps && (
          <div>
            <div className="text-[10px] uppercase text-zinc-400">계산 범위</div>
            <AppSelect
              value={ps.scope?.mode ?? "allRows"}
              onChange={(v) =>
                update({
                  scope:
                    v === "linkedPagesFromColumn"
                      ? {
                          mode: "linkedPagesFromColumn",
                          pageLinkColumnId:
                            ps.scope?.mode === "linkedPagesFromColumn"
                              ? ps.scope.pageLinkColumnId
                              : pageLinkColumns[0]?.id ?? "",
                        }
                      : { mode: "allRows" },
                })
              }
              options={[
                { value: "allRows", label: "대상 DB 전체 행" },
                ...(pageLinkColumns.length > 0
                  ? [{ value: "linkedPagesFromColumn", label: "이 행에 연결된 페이지만" }]
                  : []),
              ]}
              buttonClassName="w-full px-1.5 py-1 text-xs"
              portal
            />
          </div>
        )}

        {ps?.scope?.mode === "linkedPagesFromColumn" && pageLinkColumns.length > 0 && (
          <div>
            <div className="text-[10px] uppercase text-zinc-400">연결 컬럼</div>
            <AppSelect
              value={ps.scope.pageLinkColumnId}
              onChange={(v) =>
                update({ scope: { mode: "linkedPagesFromColumn", pageLinkColumnId: v } })
              }
              options={pageLinkColumns.map((c) => ({ value: c.id, label: c.name }))}
              buttonClassName="w-full px-1.5 py-1 text-xs"
              portal
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2) Select sourceFromDb 편집기 — select/multiSelect/status
// ─────────────────────────────────────────────────────────────────────────────

export function SelectSourceEditor({ databaseId, column }: CommonProps) {
  const updateColumn = useDatabaseStore((s) => s.updateColumn);
  const databases = useDatabaseStore((s) => s.databases);
  const allDatabases = useDatabaseStore(listDatabases);
  const src = column.config?.sourceFromDb ?? null;
  const linkedScope = column.config?.linkedScope ?? null;
  const enabled = src != null;

  const targetDb = src?.databaseId ? databases[src.databaseId] : null;
  const targetColumns = (targetDb?.columns ?? []).filter(
    (c) => c.type === "select" || c.type === "multiSelect" || c.type === "status",
  );

  const update = (patch: ColumnSourceFromDb | null) => {
    if (patch === null) {
      const { sourceFromDb: _omit, ...rest } = column.config ?? {};
      updateColumn(databaseId, column.id, { config: rest });
      return;
    }
    updateColumn(databaseId, column.id, {
      // sourceFromDb 와 linkedScope 는 상호 배타적 — 설정 시 다른 쪽 해제
      config: { ...(column.config ?? {}), sourceFromDb: patch, linkedScope: undefined },
    });
  };

  const setLinkedScope = (scope: "organization" | "team" | "project" | null) => {
    if (scope === null) {
      const { linkedScope: _omit, ...rest } = column.config ?? {};
      updateColumn(databaseId, column.id, { config: rest });
      return;
    }
    updateColumn(databaseId, column.id, {
      config: { ...(column.config ?? {}), linkedScope: scope, sourceFromDb: undefined },
    });
  };

  return (
    <div className="border-t border-zinc-100 px-2 py-1.5 dark:border-zinc-800">
      {/* 내부 엔티티(조직/팀/프로젝트) 연결 */}
      <div>
        <div className="text-[10px] uppercase text-zinc-400">옵션 소스</div>
        <AppSelect
          value={linkedScope ?? (enabled ? "_db" : "_none")}
          onChange={(v) => {
            if (v === "_none") {
              setLinkedScope(null);
              update(null);
            } else if (v === "_db") {
              update({ databaseId: "", columnId: "" });
            } else {
              setLinkedScope(v as "organization" | "team" | "project");
            }
          }}
          options={[
            { value: "_none", label: "직접 옵션 편집" },
            { value: "organization", label: "조직 (organizationStore)" },
            { value: "team", label: "팀 (teamStore)" },
            { value: "project", label: "프로젝트 (schedulerProjects)" },
            { value: "_db", label: "다른 DB 컬럼…" },
          ]}
          buttonClassName="w-full px-1.5 py-1 text-xs"
          portal
        />
        {linkedScope && (
          <p className="mt-1 text-[10px] leading-tight text-zinc-400">
            {linkedScope === "organization" && "옵션은 조직 목록과 자동 동기화됩니다."}
            {linkedScope === "team" && "옵션은 팀 목록과 자동 동기화됩니다."}
            {linkedScope === "project" && "옵션은 LC 프로젝트 목록과 자동 동기화됩니다."}
          </p>
        )}
      </div>

      {enabled && (
        <div className="mt-2 space-y-1.5">
          <AppSelect
            value={src?.databaseId ?? ""}
            onChange={(v) => update({ databaseId: v, columnId: "" })}
            options={[
              { value: "", label: "DB 선택…" },
              ...allDatabases
                .filter((d) => d.id !== databaseId)
                .map((d) => ({ value: d.id, label: d.meta.title || "제목 없음" })),
            ]}
            buttonClassName="w-full px-1.5 py-1 text-xs"
            portal
          />
          {targetDb && (
            <AppSelect
              value={src?.columnId ?? ""}
              onChange={(v) => update({ ...src!, columnId: v })}
              options={[
                { value: "", label: "컬럼 선택…" },
                ...targetColumns.map((c) => ({ value: c.id, label: c.name })),
              ]}
              buttonClassName="w-full px-1.5 py-1 text-xs"
              portal
            />
          )}

          {/* 값 자동 동기화 — 현재 DB 의 pageLink 컬럼이 가리키는 페이지의 셀값을 사용 */}
          {targetDb && (
            <div>
              <div className="text-[10px] uppercase text-zinc-400">값 자동 가져오기</div>
              <AppSelect
                value={src?.viaPageLinkColumnId ?? ""}
                onChange={(v) =>
                  update({
                    ...src!,
                    viaPageLinkColumnId: v || undefined,
                  })
                }
                options={[
                  { value: "", label: "사용 안 함 (값 독립 편집)" },
                  ...(databases[databaseId]?.columns ?? [])
                    .filter((c) => c.type === "pageLink")
                    .map((c) => ({ value: c.id, label: `${c.name} 연결 페이지` })),
                ]}
                buttonClassName="w-full px-1.5 py-1 text-xs"
                portal
              />
              {src?.viaPageLinkColumnId && (
                <p className="mt-1 text-[10px] leading-tight text-emerald-600 dark:text-emerald-400">
                  선택한 pageLink 컬럼의 첫 번째 연결 페이지에서 자동 미러링됩니다. 셀 직접 편집 불가.
                </p>
              )}
            </div>
          )}

          {enabled && (
            <p className="text-[10px] leading-tight text-zinc-400">
              옵션 목록은 원본 DB에서 자동 미러링됩니다. 이 DB 에서는 옵션 수정 불가.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3) PageLink 스코프 + 검색 필터 편집기 — pageLink
// ─────────────────────────────────────────────────────────────────────────────

const FILTER_KIND_LABELS: { id: SearchFilterRule["kind"]; label: string }[] = [
  { id: "database", label: "DB" },
  { id: "milestone", label: "마일스톤" },
  { id: "feature", label: "피처" },
  { id: "organization", label: "조직" },
  { id: "team", label: "팀" },
  { id: "project", label: "프로젝트" },
];

export function PageLinkScopeEditor({ databaseId, column }: CommonProps) {
  const updateColumn = useDatabaseStore((s) => s.updateColumn);
  const allDatabases = useDatabaseStore(listDatabases);
  const scopeDbId = column.config?.pageLinkScopeDatabaseId ?? "";
  const filters: SearchFilterRule[] = useMemo(
    () => column.config?.searchFilters ?? [],
    [column.config?.searchFilters],
  );

  const dbOptions = [
    { value: "", label: "전체 페이지" },
    ...allDatabases.map((d) => ({ value: d.id, label: d.meta.title || "제목 없음" })),
  ];

  const setScopeDb = (v: string) => {
    updateColumn(databaseId, column.id, {
      config: {
        ...(column.config ?? {}),
        pageLinkScopeDatabaseId: v || undefined,
      },
    });
  };

  const setFilters = (next: SearchFilterRule[]) => {
    updateColumn(databaseId, column.id, {
      config: {
        ...(column.config ?? {}),
        searchFilters: next.length > 0 ? next : undefined,
      },
    });
  };

  const addFilter = () => {
    setFilters([...filters, { id: newId(), kind: "database", value: "" }]);
  };
  const updateFilter = (id: string, patch: Partial<SearchFilterRule>) => {
    setFilters(filters.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };
  const removeFilter = (id: string) => {
    setFilters(filters.filter((f) => f.id !== id));
  };

  return (
    <div className="border-t border-zinc-100 px-2 py-1.5 dark:border-zinc-800">
      <div className="space-y-1.5">
        <div>
          <div className="text-[10px] uppercase text-zinc-400">검색 대상 DB</div>
          <AppSelect
            value={scopeDbId}
            onChange={setScopeDb}
            options={dbOptions}
            buttonClassName="w-full px-1.5 py-1 text-xs"
            portal
          />
        </div>

        <div className="pt-1">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] uppercase text-zinc-400">검색 필터</span>
            <button
              type="button"
              onClick={addFilter}
              className="inline-flex h-5 items-center gap-0.5 rounded border border-zinc-200 px-1.5 text-[10px] text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <Plus size={10} /> 추가
            </button>
          </div>
          {filters.length === 0 && (
            <p className="text-[10px] leading-tight text-zinc-400">필터가 없습니다.</p>
          )}
          <div className="space-y-1">
            {filters.map((f) => (
              <FilterRow
                key={f.id}
                rule={f}
                onChange={(patch) => updateFilter(f.id, patch)}
                onRemove={() => removeFilter(f.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function FilterRow({
  rule,
  onChange,
  onRemove,
}: {
  rule: SearchFilterRule;
  onChange: (patch: Partial<SearchFilterRule>) => void;
  onRemove: () => void;
}) {
  const allDatabases = useDatabaseStore(listDatabases);
  // kind=database 인 경우 DB 목록을 value 후보로 제공. 그 외는 단순 텍스트 입력.
  const [textDraft, setTextDraft] = useState(rule.value ?? "");

  return (
    <div className="flex items-center gap-1">
      <AppSelect
        value={rule.kind}
        onChange={(v) => onChange({ kind: v as SearchFilterRule["kind"], value: "" })}
        options={FILTER_KIND_LABELS.map((k) => ({ value: k.id, label: k.label }))}
        buttonClassName="px-1 py-0.5 text-[11px]"
        portal
      />
      {rule.kind === "database" ? (
        <AppSelect
          value={rule.value ?? ""}
          onChange={(v) => onChange({ value: v })}
          options={[
            { value: "", label: "선택…" },
            ...allDatabases.map((d) => ({ value: d.id, label: d.meta.title || "제목 없음" })),
          ]}
          buttonClassName="flex-1 px-1 py-0.5 text-[11px]"
          portal
        />
      ) : (
        <input
          value={textDraft}
          onChange={(e) => setTextDraft(e.target.value)}
          onBlur={() => onChange({ value: textDraft.trim() || undefined })}
          placeholder="id…"
          className="min-w-0 flex-1 rounded border border-zinc-200 bg-white px-1 py-0.5 text-[11px] outline-none dark:border-zinc-700 dark:bg-zinc-900"
        />
      )}
      <button
        type="button"
        onClick={onRemove}
        className="rounded p-0.5 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
        aria-label="필터 제거"
      >
        <Trash2 size={11} />
      </button>
    </div>
  );
}
