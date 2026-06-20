import type { ColumnDef, TimelineDateCardConfig } from "../../../types/database";
import {
  TIMELINE_CARD_COLOR_PRESETS,
  defaultTimelineColor,
  isValidTimelineColor,
} from "./timelineCardUtils";

// DatabaseTimelineView 의 타임라인 날짜 카드 설정 패널 — 날짜 컬럼별 카드 표시 토글,
// 별도 제목, 카드 색상 프리셋 선택. store 변이는 props 콜백으로 위임(순수 표현 컴포넌트).
// 표시 가드(timelineSettingsOpen && dateCols.length > 0)는 호출처가 담당한다.
type Props = {
  dateCols: ColumnDef[];
  hasExplicitTimelineCards: boolean;
  dateColId: string | null;
  setTimelineColumnEnabled: (column: ColumnDef, enabled: boolean) => void;
  updateTimelineCardConfig: (column: ColumnDef, patch: TimelineDateCardConfig) => void;
};

export function TimelineDateCardSettings({
  dateCols,
  hasExplicitTimelineCards,
  dateColId,
  setTimelineColumnEnabled,
  updateTimelineCardConfig,
}: Props) {
  return (
    <div className="mb-2 rounded-md border border-zinc-200 bg-zinc-50/70 p-2 text-xs dark:border-zinc-700 dark:bg-zinc-900/60">
      <div className="grid gap-1.5">
        {dateCols.map((column, index) => {
          const config = column.config?.timelineCard;
          const enabled = hasExplicitTimelineCards
            ? config?.enabled === true
            : column.id === dateColId;
          const customTitle = config?.titleMode === "custom";
          const color = isValidTimelineColor(config?.color)
            ? config.color
            : defaultTimelineColor(index);
          return (
            <div
              key={column.id}
              className="grid grid-cols-1 items-center gap-2 rounded bg-white px-2 py-1.5 sm:grid-cols-[minmax(7rem,1fr)_auto_minmax(9rem,14rem)_auto] dark:bg-zinc-950"
            >
              <label className="flex min-w-0 items-center gap-2 text-zinc-700 dark:text-zinc-200">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => setTimelineColumnEnabled(column, event.target.checked)}
                  className="h-3.5 w-3.5 rounded border-zinc-300 text-blue-600 focus:ring-blue-500 dark:border-zinc-600"
                />
                <span className="truncate">{column.name}</span>
              </label>
              <label className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
                <input
                  type="checkbox"
                  checked={customTitle}
                  onChange={(event) => {
                    updateTimelineCardConfig(column, {
                      titleMode: event.target.checked ? "custom" : "pageTitle",
                      title: event.target.checked ? (config?.title || column.name) : config?.title,
                    });
                  }}
                  className="h-3.5 w-3.5 rounded border-zinc-300 text-blue-600 focus:ring-blue-500 dark:border-zinc-600"
                />
                별도 제목
              </label>
              <input
                type="text"
                value={config?.title ?? ""}
                disabled={!customTitle}
                onChange={(event) => updateTimelineCardConfig(column, {
                  titleMode: "custom",
                  title: event.target.value,
                })}
                placeholder="페이지 제목"
                className="h-7 min-w-0 rounded border border-zinc-200 bg-white px-2 text-xs text-zinc-700 outline-none focus:border-blue-400 disabled:bg-zinc-50 disabled:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:disabled:bg-zinc-900"
              />
              <div className="flex items-center gap-1">
                {TIMELINE_CARD_COLOR_PRESETS.map((preset) => (
                  <button
                    key={`${column.id}:${preset}`}
                    type="button"
                    onClick={() => updateTimelineCardConfig(column, { color: preset })}
                    className={[
                      "h-4 w-4 rounded-full border transition-transform hover:scale-110",
                      color === preset
                        ? "border-zinc-950 ring-2 ring-zinc-950/20 dark:border-white dark:ring-white/25"
                        : "border-white/80 dark:border-zinc-700",
                    ].join(" ")}
                    style={{ backgroundColor: preset }}
                    title={preset}
                    aria-label={`${column.name} 카드 색상 ${preset}`}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
