// 피처 타임라인에서 표시할 마일스톤 항목을 고르는 서버 동기화 필터.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useDatabaseStore } from "../../../store/databaseStore";
import { usePageStore } from "../../../store/pageStore";
import { useSchedulerViewStore } from "../../../store/schedulerViewStore";
import type { Page } from "../../../types/page";
import { makeLCFeatureDatabaseId } from "../../../lib/scheduler/featureDatabase";
import { makeLCMilestoneDatabaseId } from "../../../lib/scheduler/milestoneDatabase";
import { LC_SCHEDULER_WORKSPACE_ID } from "../../../lib/scheduler/scope";
import { matchesSchedulerScope } from "../../../lib/scheduler/databaseScope";

type MilestoneOption = {
  id: string;
  title: string;
};

export function FeatureMilestoneFilter() {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const milestoneDatabaseId = makeLCMilestoneDatabaseId(LC_SCHEDULER_WORKSPACE_ID);
  const featureDatabaseId = makeLCFeatureDatabaseId(LC_SCHEDULER_WORKSPACE_ID);
  const milestoneDb = useDatabaseStore((s) => s.databases[milestoneDatabaseId]);
  const selectedIds =
    useDatabaseStore((s) => s.databases[featureDatabaseId]?.panelState?.schedulerFeatureMilestoneIds) ??
    null;
  const patchDatabasePanelState = useDatabaseStore((s) => s.patchDatabasePanelState);
  const pages = usePageStore((s) => s.pages);
  const selectedProjectId = useSchedulerViewStore((s) => s.selectedProjectId);

  const options = useMemo<MilestoneOption[]>(() => {
    if (!milestoneDb) return [];
    return milestoneDb.rowPageOrder
      .map((pageId) => pages[pageId])
      .filter((page): page is Page => Boolean(page && page.dbCells?._qn_isTemplate !== "1"))
      .filter((page) => matchesSchedulerScope(page, "milestone", selectedProjectId, pages))
      .map((page) => ({
        id: page.id,
        title: page.title.trim() || "제목 없음",
      }));
  }, [milestoneDb, pages, selectedProjectId]);

  const optionIds = useMemo(() => options.map((option) => option.id), [options]);
  const optionIdSet = useMemo(() => new Set(optionIds), [optionIds]);
  const visibleSelectedIds = useMemo(
    () => (selectedIds ?? optionIds).filter((id) => optionIdSet.has(id)),
    [optionIdSet, optionIds, selectedIds],
  );
  const selectedSet = useMemo(() => new Set(visibleSelectedIds), [visibleSelectedIds]);

  const commitSelectedIds = useCallback((ids: string[] | null) => {
    patchDatabasePanelState(featureDatabaseId, {
      schedulerFeatureMilestoneIds: ids,
    });
  }, [featureDatabaseId, patchDatabasePanelState]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!dropdownRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    if (selectedIds !== null && selectedIds.length > 0 && optionIds.length > 0 && visibleSelectedIds.length === 0) {
      commitSelectedIds(null);
    }
  }, [commitSelectedIds, optionIds.length, selectedIds, visibleSelectedIds.length]);

  const toggleMilestone = (pageId: string) => {
    const base = selectedIds === null ? optionIds : visibleSelectedIds;
    const next = new Set(base);
    if (next.has(pageId)) next.delete(pageId);
    else next.add(pageId);
    const nextIds = [...next];
    commitSelectedIds(nextIds.length === optionIds.length ? null : nextIds);
  };

  const label =
    selectedIds === null || visibleSelectedIds.length === optionIds.length
      ? "마일스톤"
      : visibleSelectedIds.length === 0
        ? "마일스톤 없음"
        : `마일스톤 ${visibleSelectedIds.length}개`;

  if (options.length === 0) return null;

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="px-2 py-1 text-xs gap-1 border border-zinc-200 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer flex items-center"
      >
        <span>{label}</span>
        <ChevronDown
          className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-xl z-50 min-w-[240px] max-h-[360px] overflow-y-auto">
          <div className="border-b border-zinc-200 dark:border-zinc-800 p-1 grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => commitSelectedIds(null)}
              className="text-left px-2 py-1.5 text-xs rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
            >
              전체 선택
            </button>
            <button
              type="button"
              onClick={() => commitSelectedIds([])}
              className="text-left px-2 py-1.5 text-xs rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
            >
              전체 해제
            </button>
          </div>
          <div className="px-3 pt-2 pb-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            피처에 연결된 마일스톤
          </div>
          <div className="py-1">
            {options.map((option) => (
              <label
                key={option.id}
                className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedSet.has(option.id)}
                  onChange={() => toggleMilestone(option.id)}
                  className="rounded border-zinc-200 dark:border-zinc-700"
                />
                <span className="truncate">{option.title}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
