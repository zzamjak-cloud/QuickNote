import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Plus, Search, X } from "lucide-react";
import { newId } from "../../../lib/id";
import { usePageStore } from "../../../store/pageStore";
import { useDatabaseStore, listDatabases } from "../../../store/databaseStore";
import { useOrganizationStore } from "../../../store/organizationStore";
import { useTeamStore } from "../../../store/teamStore";
import { useSchedulerProjectsStore } from "../../../store/schedulerProjectsStore";
import {
  LC_MILESTONE_DATABASE_ID_PREFIX,
  LC_FEATURE_DATABASE_ID_PREFIX,
} from "../../../lib/scheduler/database";
import { koreanIncludes } from "../../../lib/koreanSearch";
import { PageIconDisplay } from "../../common/PageIconDisplay";
import { AppSelect } from "../../common/AppSelect";
import { applySearchFilters } from "../../../lib/database/columnSource";
import {
  useSearchFilterPrefsStore,
  makeSearchFilterPrefKey,
} from "../../../store/searchFilterPrefsStore";
import type { SearchFilterRule } from "../../../types/database";

type Props = {
  anchorEl: HTMLElement | null;
  selectedIds: string[];
  /** 현재 행의 pageId — 자기 자신은 검색 목록에서 제외 */
  excludePageId?: string;
  /** 검색을 특정 DB의 행 페이지로만 제한 */
  scopeDatabaseId?: string;
  /** 컬럼 config에서 전달되는 사전 필터 — 항상 적용됨 */
  searchFilters?: SearchFilterRule[];
  /** 단계별 필터 prefs 저장 키 — `${databaseId}:${columnId}` */
  prefsDatabaseId?: string;
  prefsColumnId?: string;
  onToggle: (pageId: string) => void;
  onClose: () => void;
};

const FILTER_KIND_LABELS: { id: SearchFilterRule["kind"]; label: string }[] = [
  { id: "organization", label: "조직" },
  { id: "team", label: "팀" },
  { id: "project", label: "프로젝트" },
  { id: "milestone", label: "마일스톤" },
  { id: "feature", label: "피처" },
  { id: "database", label: "DB" },
];

export function PageLinkSearchPopup({
  anchorEl,
  selectedIds,
  excludePageId,
  scopeDatabaseId,
  searchFilters,
  prefsDatabaseId,
  prefsColumnId,
  onToggle,
  onClose,
}: Props) {
  const [query, setQuery] = useState("");
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: "hidden" });
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const pages = usePageStore((s) => s.pages);
  const databases = useDatabaseStore((s) => s.databases);
  const allDatabases = useDatabaseStore(listDatabases);
  const organizations = useOrganizationStore((s) => s.organizations);
  const teams = useTeamStore((s) => s.teams);
  const projects = useSchedulerProjectsStore((s) => s.projects);

  // 사용자가 검색 시점에 단계별로 누적하는 동적 필터 — store 에 영구 저장하여
  // 다음에 동일 컬럼 팝업을 열었을 때 마지막 사용한 필터가 그대로 복원된다.
  const prefsKey =
    prefsDatabaseId && prefsColumnId
      ? makeSearchFilterPrefKey(prefsDatabaseId, prefsColumnId)
      : null;
  const userFilters = useSearchFilterPrefsStore((s) =>
    prefsKey ? s.presetsByKey[prefsKey] ?? [] : [],
  );
  const setStorePresets = useSearchFilterPrefsStore((s) => s.setPresets);
  const setUserFilters = (next: SearchFilterRule[] | ((prev: SearchFilterRule[]) => SearchFilterRule[])) => {
    if (!prefsKey) return;
    const resolved = typeof next === "function" ? next(userFilters) : next;
    setStorePresets(prefsKey, resolved);
  };

  // 마일스톤·피처 페이지 후보 — value picker 옵션화
  const milestonePages = useMemo(
    () =>
      Object.values(pages).filter(
        (p) => p.databaseId && p.databaseId.startsWith(LC_MILESTONE_DATABASE_ID_PREFIX),
      ),
    [pages],
  );
  const featurePages = useMemo(
    () =>
      Object.values(pages).filter(
        (p) => p.databaseId && p.databaseId.startsWith(LC_FEATURE_DATABASE_ID_PREFIX),
      ),
    [pages],
  );

  const valueOptionsForKind = (kind: SearchFilterRule["kind"]) => {
    switch (kind) {
      case "organization":
        return organizations.map((o) => ({ value: o.organizationId, label: o.name }));
      case "team":
        return teams.map((t) => ({ value: t.teamId, label: t.name }));
      case "project":
        return projects.map((p) => ({ value: p.id, label: p.name }));
      case "milestone":
        return milestonePages.map((p) => ({ value: p.id, label: p.title || "제목 없음" }));
      case "feature":
        return featurePages.map((p) => ({ value: p.id, label: p.title || "제목 없음" }));
      case "database":
        return allDatabases.map((d) => ({ value: d.id, label: d.meta.title || "제목 없음" }));
    }
  };

  // 앵커 기준 위치 계산
  useLayoutEffect(() => {
    if (!anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const popupWidth = 320;
    const gap = 4;
    const left = Math.min(rect.left, window.innerWidth - popupWidth - 8);
    const top = rect.bottom + gap;
    setStyle({
      position: "fixed",
      top,
      left: Math.max(8, left),
      width: popupWidth,
      zIndex: 9999,
    });
  }, [anchorEl]);

  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (popupRef.current?.contains(target)) return;
      // AppSelect 등 portal 로 띄운 드롭다운(role="listbox")은 popup 외부지만 닫지 않음
      if (target.closest('[role="listbox"]')) return;
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [onClose]);

  // 후보 페이지 산출 — scope → 컬럼 config 필터 → 사용자 동적 필터 → 검색어
  const candidatePages = useMemo(() => {
    let result = Object.values(pages).filter((p) => p.id !== excludePageId);
    if (scopeDatabaseId) result = result.filter((p) => p.databaseId === scopeDatabaseId);
    result = applySearchFilters(result, searchFilters, databases, pages);
    result = applySearchFilters(result, userFilters, databases, pages);
    return result;
  }, [pages, databases, excludePageId, scopeDatabaseId, searchFilters, userFilters]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? candidatePages.filter((p) => koreanIncludes(p.title.toLowerCase(), q))
    : candidatePages
        .slice()
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
        .slice(0, 30);

  const addFilter = () => {
    setUserFilters((prev) => [...prev, { id: newId(), kind: "organization", value: "" }]);
  };
  const updateFilter = (id: string, patch: Partial<SearchFilterRule>) => {
    setUserFilters((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };
  const removeFilter = (id: string) => {
    setUserFilters((prev) => prev.filter((f) => f.id !== id));
  };

  return createPortal(
    <div
      ref={popupRef}
      style={style}
      className="rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
    >
      {/* 단계별 필터 누적 영역 — 사용자가 + 버튼으로 자유 추가 */}
      <div className="border-b border-zinc-200 px-2 py-1.5 dark:border-zinc-700">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wide text-zinc-500">
            필터 단계 {userFilters.length > 0 ? `(${userFilters.length})` : ""}
          </span>
          <button
            type="button"
            onClick={addFilter}
            className="inline-flex h-5 items-center gap-0.5 rounded border border-zinc-200 px-1.5 text-[10px] text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <Plus size={10} /> 추가
          </button>
        </div>
        {userFilters.length === 0 && (
          <p className="text-[10px] leading-tight text-zinc-400">
            + 버튼으로 단계를 추가해 검색 범위를 좁힐 수 있습니다.
          </p>
        )}
        <div className="space-y-1">
          {userFilters.map((f, idx) => {
            const valueOptions = valueOptionsForKind(f.kind);
            return (
              <div key={f.id} className="flex items-center gap-1">
                <span className="w-4 shrink-0 text-center text-[10px] text-zinc-400">
                  {idx + 1}
                </span>
                <AppSelect
                  value={f.kind}
                  onChange={(v) =>
                    updateFilter(f.id, {
                      kind: v as SearchFilterRule["kind"],
                      value: "",
                    })
                  }
                  options={FILTER_KIND_LABELS.map((k) => ({ value: k.id, label: k.label }))}
                  buttonClassName="px-1 py-0.5 text-[11px]"
                  portal
                />
                <AppSelect
                  value={f.value ?? ""}
                  onChange={(v) => updateFilter(f.id, { value: v })}
                  options={[{ value: "", label: "선택…" }, ...valueOptions]}
                  buttonClassName="min-w-0 flex-1 px-1 py-0.5 text-[11px]"
                  portal
                />
                <button
                  type="button"
                  onClick={() => removeFilter(f.id)}
                  className="rounded p-0.5 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                  aria-label="필터 제거"
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* 검색 입력 */}
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-700">
        <Search size={14} className="shrink-0 text-zinc-400" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="페이지 검색..."
          className="flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
        />
      </div>

      {/* 페이지 목록 */}
      <div className="max-h-60 overflow-y-auto py-1">
        {filtered.map((page) => {
          const selected = selectedIds.includes(page.id);
          return (
            <button
              key={page.id}
              type="button"
              onClick={() => onToggle(page.id)}
              className={[
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800",
                selected ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-700 dark:text-zinc-300",
              ].join(" ")}
            >
              <PageIconDisplay icon={page.icon ?? null} size="sm" />
              <span className="min-w-0 flex-1 truncate">{page.title || "제목 없음"}</span>
              {selected && <Check size={12} className="shrink-0 text-amber-500" />}
            </button>
          );
        })}
        {filtered.length === 0 && (
          <p className="px-3 py-4 text-center text-sm text-zinc-400">검색 결과가 없습니다</p>
        )}
      </div>
    </div>,
    document.body,
  );
}
