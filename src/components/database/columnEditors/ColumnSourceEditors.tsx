// 컬럼 편집 팝업의 추가 섹션 — sourceFromDb / progressSource / pageLinkScope·검색필터.
// DatabaseColumnMenu 내부에서 컬럼 type 에 따라 조건부 렌더링.

import { useMemo } from "react";
import { AppSelect } from "../../common/AppSelect";
import { useDatabaseStore, listDatabases } from "../../../store/databaseStore";
import type {
  ColumnDef,
  ProgressSourceConfig,
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
  const ps = column.config?.progressSource ?? null;

  const currentBundle = databases[databaseId];
  const linkedPageColumns = (currentBundle?.columns ?? []).filter(
    (c) => c.type === "pageLink" || c.type === "itemFetch",
  );
  const linkedPageColumnId =
    ps?.scope?.mode === "linkedPagesFromColumn" ? ps.scope.pageLinkColumnId : "";
  const linkedPageColumn = linkedPageColumns.find((c) => c.id === linkedPageColumnId) ?? null;
  const targetDbId =
    linkedPageColumn?.type === "itemFetch"
      ? linkedPageColumn.config?.itemFetchSourceDatabaseId ?? ps?.databaseId ?? ""
      : linkedPageColumn?.config?.pageLinkScopeDatabaseId ?? ps?.databaseId ?? "";
  const targetDb = targetDbId ? databases[targetDbId] : null;
  const statusColumnOptions = (targetDb?.columns ?? [])
    .filter((c) => c.type === "status" || c.type === "select" || c.type === "checkbox")
    .map((c) => ({ value: c.id, label: c.name }));

  const setProgressSource = (next: ProgressSourceConfig | null) => {
    if (!next) {
      const { progressSource: _omit, ...rest } = column.config ?? {};
      updateColumn(databaseId, column.id, { config: rest });
      return;
    }
    updateColumn(databaseId, column.id, {
      config: { ...(column.config ?? {}), progressSource: next },
    });
  };

  const selectLinkedPageColumn = (pageLinkColumnId: string) => {
    if (!pageLinkColumnId) {
      setProgressSource(null);
      return;
    }
    const linkedPageColumn = linkedPageColumns.find((c) => c.id === pageLinkColumnId);
    const nextTargetDbId =
      linkedPageColumn?.type === "itemFetch"
        ? linkedPageColumn.config?.itemFetchSourceDatabaseId ?? ""
        : linkedPageColumn?.config?.pageLinkScopeDatabaseId ?? "";
    setProgressSource({
      databaseId: nextTargetDbId,
      columnId: "",
      scope: { mode: "linkedPagesFromColumn", pageLinkColumnId },
    });
  };

  const selectStatusColumn = (statusColumnId: string) => {
    if (!linkedPageColumnId) return;
    setProgressSource({
      databaseId: targetDbId,
      columnId: statusColumnId,
      scope: { mode: "linkedPagesFromColumn", pageLinkColumnId: linkedPageColumnId },
    });
  };

  return (
    <div className="border-t border-zinc-100 px-2 py-1.5 dark:border-zinc-800">
      <div className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
        진행률 자동 계산
      </div>
      <p className="mb-2 text-[10px] leading-tight text-zinc-400">
        현재 행에 연결된 페이지들의 상태 컬럼에서 완료된 항목 비율을 계산합니다.
      </p>

      <div className="space-y-1.5">
        <div>
          <div className="text-[10px] uppercase text-zinc-400">1단계 · 연결 페이지 컬럼</div>
          <AppSelect
            value={linkedPageColumnId}
            onChange={selectLinkedPageColumn}
            options={[
              { value: "", label: "(수동 입력)" },
              ...linkedPageColumns.map((c) => ({ value: c.id, label: c.name })),
            ]}
            buttonClassName="w-full px-1.5 py-1 text-xs"
            portal
          />
          {linkedPageColumns.length === 0 && (
            <p className="mt-1 text-[10px] text-amber-500">
              먼저 현재 DB에 페이지 연결 또는 페이지 연결 가져오기 컬럼이 필요합니다.
            </p>
          )}
        </div>

        {linkedPageColumn && !targetDb && (
          <p className="text-[10px] leading-tight text-amber-500">
            선택한 컬럼에 연결 DB가 지정되어야 상태 컬럼을 고를 수 있습니다.
          </p>
        )}

        {targetDb && (
          <div>
            <div className="text-[10px] uppercase text-zinc-400">2단계 · 상태 컬럼</div>
            <AppSelect
              value={ps?.columnId ?? ""}
              onChange={selectStatusColumn}
              options={[{ value: "", label: "선택…" }, ...statusColumnOptions]}
              buttonClassName="w-full px-1.5 py-1 text-xs"
              portal
            />
            {statusColumnOptions.length === 0 && (
              <p className="mt-1 text-[10px] text-amber-500">
                상태·선택·체크박스 타입의 컬럼이 필요합니다.
              </p>
            )}
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
  const sourceMode = src?.automation ? "_automation" : enabled ? "_db" : linkedScope ?? "_none";

  const targetDb = src?.databaseId ? databases[src.databaseId] : null;
  const targetColumns = (targetDb?.columns ?? []).filter((c) => c.type === column.type);

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
          value={sourceMode}
          onChange={(v) => {
            if (v === "_none") {
              setLinkedScope(null);
              update(null);
            } else if (v === "_db") {
              update({ databaseId: "", columnId: "", automation: undefined });
            } else if (v === "_automation") {
              update({ databaseId: "", columnId: "", automation: true });
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
            { value: "_automation", label: "자동화" },
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
            onChange={(v) =>
              update({
                databaseId: v,
                columnId: "",
                automation: src?.automation,
              })
            }
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
          {targetDb && !src?.automation && (
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

          {targetDb && src?.automation && (
            <div>
              <div className="text-[10px] uppercase text-zinc-400">소속 항목 기준 컬럼</div>
              <AppSelect
                value={src?.viaPageLinkColumnId ?? ""}
                onChange={(v) =>
                  update({
                    ...src!,
                    viaPageLinkColumnId: v || undefined,
                  })
                }
                options={[
                  { value: "", label: "자동 감지" },
                  ...(databases[databaseId]?.columns ?? [])
                    .filter((c) => c.type === "pageLink")
                    .map((c) => ({ value: c.id, label: c.name })),
                ]}
                buttonClassName="w-full px-1.5 py-1 text-xs"
                portal
              />
              <p className="mt-1 text-[10px] leading-tight text-emerald-600 dark:text-emerald-400">
                현재 행의 기준 컬럼에 연결된 항목에서 지정 컬럼 값을 가져옵니다. 셀 직접 편집 불가.
              </p>
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
// 3) 페이지 연결 가져오기 편집기 — itemFetch
//    소스 DB + 매칭 컬럼 선택. 소스 DB 행 중 matchColumn 값이 현재 행 제목과 일치하는 항목을 표시.
// ─────────────────────────────────────────────────────────────────────────────

export function ItemFetchEditor({ databaseId, column }: CommonProps) {
  const updateColumn = useDatabaseStore((s) => s.updateColumn);
  const databases = useDatabaseStore((s) => s.databases);
  const allDatabases = useDatabaseStore(listDatabases);

  const sourceDbId = column.config?.itemFetchSourceDatabaseId ?? "";
  const matchColId = column.config?.itemFetchMatchColumnId ?? "";

  const sourceDb = sourceDbId ? databases[sourceDbId] : null;

  const matchColOptions = useMemo(() => {
    if (!sourceDb) return [];
    return sourceDb.columns
      .filter((c) => c.type !== "title")
      .map((c) => ({ value: c.id, label: `${c.name} (${c.type})` }));
  }, [sourceDb]);

  const setSourceDb = (v: string) => {
    updateColumn(databaseId, column.id, {
      config: {
        ...(column.config ?? {}),
        itemFetchSourceDatabaseId: v || undefined,
        itemFetchMatchColumnId: undefined,
      },
    });
  };

  const setMatchCol = (v: string) => {
    updateColumn(databaseId, column.id, {
      config: { ...(column.config ?? {}), itemFetchMatchColumnId: v || undefined },
    });
  };

  const dbOptions = allDatabases
    .filter((d) => d.id !== databaseId)
    .map((d) => ({ value: d.id, label: d.meta.title || "제목 없음" }));

  return (
    <div className="border-t border-zinc-100 px-2 py-1.5 dark:border-zinc-800">
      <div className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
        페이지 연결 가져오기
      </div>
      <p className="mb-2 text-[10px] leading-tight text-zinc-400">
        다른 DB의 특정 컬럼값이 현재 행 이름과 일치하는 항목을 자동으로 연결합니다.
      </p>
      <div className="space-y-1.5">
        <div>
          <div className="text-[10px] uppercase text-zinc-400">소스 DB</div>
          <AppSelect
            value={sourceDbId}
            onChange={setSourceDb}
            options={[{ value: "", label: "선택…" }, ...dbOptions]}
            buttonClassName="w-full px-1.5 py-1 text-xs"
            portal
          />
        </div>
        {sourceDb && (
          <div>
            <div className="text-[10px] uppercase text-zinc-400">매칭 컬럼</div>
            <AppSelect
              value={matchColId}
              onChange={setMatchCol}
              options={[{ value: "", label: "선택…" }, ...matchColOptions]}
              buttonClassName="w-full px-1.5 py-1 text-xs"
              portal
            />
            {matchColId && (
              <p className="mt-0.5 text-[10px] leading-tight text-emerald-600 dark:text-emerald-400">
                {sourceDb.columns.find((c) => c.id === matchColId)?.type === "pageLink"
                  ? "pageLink 컬럼: 현재 행 ID를 포함하는 항목을 가져옵니다."
                  : "텍스트 컬럼: 현재 행 제목과 동일한 값을 가진 항목을 가져옵니다."}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4) PageLink 자동화 편집기 — pageLink
//    연결 DB 표시 + 상대 컬럼 + 자동 채움 규칙 설정.
// ─────────────────────────────────────────────────────────────────────────────

type AutoFillRule = { targetColumnId: string; sourceColumnId: string };

export function PageLinkScopeEditor({ databaseId, column }: CommonProps) {
  const updateColumn = useDatabaseStore((s) => s.updateColumn);
  const databases = useDatabaseStore((s) => s.databases);
  const allDatabases = useDatabaseStore(listDatabases);

  const scopeDbId = column.config?.pageLinkScopeDatabaseId;
  const mirrorColumnId = column.config?.pageLinkMirrorColumnId ?? "";
  const isAutoReverse = column.config?.pageLinkAutoReverse === true;
  const autoFillRules: AutoFillRule[] = useMemo(
    () => column.config?.pageLinkAutoFill ?? [],
    [column.config?.pageLinkAutoFill],
  );

  const scopeDb = scopeDbId ? databases[scopeDbId] : null;
  const currentDb = databases[databaseId];

  // 연결 대상 DB에서 현재 셀에 표시할 pageLink 컬럼 목록
  const mirrorColumnOptions = useMemo(() => {
    if (!scopeDb) return [];
    return scopeDb.columns
      .filter((c) => c.type === "pageLink")
      .map((c) => ({ value: c.id, label: c.name }));
  }, [scopeDb]);

  // 현재 DB의 채울 수 있는 컬럼 (title 제외)
  const targetColOptions = useMemo(() => {
    if (!currentDb) return [];
    return currentDb.columns
      .filter((c) => c.id !== column.id && c.type !== "title")
      .map((c) => ({ value: c.id, label: c.name }));
  }, [currentDb, column.id]);

  // 연결 DB의 읽어올 수 있는 컬럼 (title 제외)
  const sourceColOptions = useMemo(() => {
    if (!scopeDb) return [];
    return scopeDb.columns
      .filter((c) => c.type !== "title")
      .map((c) => ({ value: c.id, label: c.name }));
  }, [scopeDb]);

  const setScopeDb = (v: string) => {
    updateColumn(databaseId, column.id, {
      config: {
        ...(column.config ?? {}),
        pageLinkScopeDatabaseId: v || undefined,
        pageLinkMirrorColumnId: undefined,
        pageLinkAutoFill: undefined,
      },
    });
  };

  const setMirrorColumnId = (v: string) => {
    updateColumn(databaseId, column.id, {
      config: {
        ...(column.config ?? {}),
        pageLinkMirrorColumnId: v || undefined,
        pageLinkReverseColumnName: undefined,
        pageLinkAutoFill: undefined,
      },
    });
  };

  const setAutoFillRules = (rules: AutoFillRule[]) => {
    updateColumn(databaseId, column.id, {
      config: {
        ...(column.config ?? {}),
        pageLinkAutoFill: rules.length > 0 ? rules : undefined,
      },
    });
  };

  const addAutoFillRule = () => {
    setAutoFillRules([...autoFillRules, { targetColumnId: "", sourceColumnId: "" }]);
  };

  const updateAutoFillRule = (idx: number, patch: Partial<AutoFillRule>) => {
    setAutoFillRules(autoFillRules.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const removeAutoFillRule = (idx: number) => {
    setAutoFillRules(autoFillRules.filter((_, i) => i !== idx));
  };

  return (
    <div className="border-t border-zinc-100 px-2 py-1.5 dark:border-zinc-800">
      <div className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
        페이지 연결 자동화
      </div>

      <div className="space-y-2">
        {/* 연결 DB */}
        <div>
          <div className="text-[10px] uppercase text-zinc-400">연결 DB</div>
          {isAutoReverse ? (
            <div className="mt-0.5 rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              {scopeDb?.meta.title ?? scopeDbId ?? "—"}
              <span className="ml-1 text-[10px] text-emerald-500">(자동 연결)</span>
            </div>
          ) : (
            <AppSelect
              value={scopeDbId ?? ""}
              onChange={setScopeDb}
              options={[
                { value: "", label: "전체 페이지" },
                ...allDatabases.map((d) => ({ value: d.id, label: d.meta.title || "제목 없음" })),
              ]}
              buttonClassName="w-full px-1.5 py-1 text-xs"
              portal
            />
          )}
        </div>

        {/* 연결 대상 DB에서 가져올 컬럼 */}
        {scopeDb && !isAutoReverse && (
          <div>
            <div className="text-[10px] uppercase text-zinc-400">가져올 컬럼</div>
            <AppSelect
              value={mirrorColumnId}
              onChange={setMirrorColumnId}
              options={[{ value: "", label: "선택…" }, ...mirrorColumnOptions]}
              buttonClassName="w-full px-1.5 py-1 text-xs"
              portal
            />
            {mirrorColumnId && (
              <p className="mt-0.5 text-[10px] leading-tight text-emerald-600 dark:text-emerald-400">
                현재 항목이 속한 {scopeDb.meta.title || "DB"} 항목의 이 컬럼 값을 그대로 표시
              </p>
            )}
          </div>
        )}

        {/* 자동 채움 규칙 */}
        {scopeDb && !isAutoReverse && !mirrorColumnId && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] uppercase text-zinc-400">자동 채움</span>
              <button
                type="button"
                onClick={addAutoFillRule}
                className="text-[10px] text-blue-500 hover:text-blue-700 dark:text-blue-400"
              >
                + 규칙 추가
              </button>
            </div>
            {autoFillRules.length === 0 && (
              <p className="text-[10px] text-zinc-400">
                페이지 연결 시 자동으로 채울 컬럼 규칙이 없습니다.
              </p>
            )}
            <div className="space-y-1">
              {autoFillRules.map((rule, idx) => (
                <div key={idx} className="flex items-center gap-1">
                  <AppSelect
                    value={rule.targetColumnId}
                    onChange={(v) => updateAutoFillRule(idx, { targetColumnId: v })}
                    options={[{ value: "", label: "채울 컬럼…" }, ...targetColOptions]}
                    buttonClassName="flex-1 px-1 py-0.5 text-[11px]"
                    portal
                  />
                  <span className="shrink-0 text-[10px] text-zinc-400">←</span>
                  <AppSelect
                    value={rule.sourceColumnId}
                    onChange={(v) => updateAutoFillRule(idx, { sourceColumnId: v })}
                    options={[{ value: "", label: "소스 컬럼…" }, ...sourceColOptions]}
                    buttonClassName="flex-1 px-1 py-0.5 text-[11px]"
                    portal
                  />
                  <button
                    type="button"
                    onClick={() => removeAutoFillRule(idx)}
                    className="shrink-0 text-[10px] text-zinc-400 hover:text-red-500"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            {autoFillRules.length > 0 && (
              <p className="mt-1 text-[10px] leading-tight text-zinc-400">
                페이지 연결 시 연결된 첫 번째 페이지의 값을 자동으로 채웁니다. 연결 해제 시 초기화됩니다.
              </p>
            )}
          </div>
        )}

        {isAutoReverse && (
          <p className="text-[10px] leading-tight text-zinc-400">
            이 컬럼은 다른 DB의 페이지 연결에서 자동으로 채워집니다. 직접 수정할 수 없습니다.
          </p>
        )}
      </div>
    </div>
  );
}
