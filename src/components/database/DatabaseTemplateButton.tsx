import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  CalendarClock,
  Check,
  ChevronLeft,
  Pencil,
  Plus,
  Power,
  X,
} from "lucide-react";
import { useDatabaseStore } from "../../store/databaseStore";
import { usePageStore } from "../../store/pageStore";
import { useSettingsStore } from "../../store/settingsStore";
import type {
  ColumnDef,
  DatabasePanelState,
  DatabaseTemplate,
  DatabaseTemplateAutomationConfig,
  TemplateAutomationWeekday,
} from "../../types/database";
import { useAnchoredPopover } from "../../hooks/useAnchoredPopover";
import {
  TEMPLATE_AUTOMATION_DEFAULT_TIMEZONE,
  TEMPLATE_AUTOMATION_WEEKDAY_LABELS,
  normalizeTemplateAutomationConfig,
  resolveTemplateAutomationDateColumnId,
} from "../../lib/database/templateAutomation";
import { useAddDatabaseRowAndOpen, useOpenDatabaseRow } from "./useOpenDatabaseRow";

type Props = {
  databaseId: string;
};

const WEEKDAYS: TemplateAutomationWeekday[] = [0, 1, 2, 3, 4, 5, 6];
const TIMEZONE_OPTIONS = ["Asia/Seoul", "UTC", "America/New_York", "America/Los_Angeles"];
const TEMPLATE_POPOVER_WIDTH = 300;
const AUTOMATION_POPOVER_WIDTH = 360;

/**
 * DB 템플릿 관리 버튼.
 * 템플릿 생성·적용·삭제와 템플릿별 자동 생성 설정을 같은 DB templates payload로 동기화한다.
 */
export function DatabaseTemplateButton({ databaseId }: Props) {
  const { buttonRef, popoverRef, open, coords, toggle, close } =
    useAnchoredPopover(TEMPLATE_POPOVER_WIDTH);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);

  const bundle = useDatabaseStore((s) => s.databases[databaseId]);
  const templates = useDatabaseStore((s) => s.dbTemplates[databaseId] ?? []);
  const addTemplate = useDatabaseStore((s) => s.addTemplate);
  const updateTemplate = useDatabaseStore((s) => s.updateTemplate);
  const deleteTemplate = useDatabaseStore((s) => s.deleteTemplate);
  const applyTemplate = useDatabaseStore((s) => s.applyTemplate);
  const addRowAndOpen = useAddDatabaseRowAndOpen(databaseId);
  const openRow = useOpenDatabaseRow(databaseId);

  const pages = usePageStore((s) => s.pages);
  const setActivePage = usePageStore((s) => s.setActivePage);
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);

  const editingTemplate = useMemo(
    () => templates.find((template) => template.id === editingTemplateId) ?? null,
    [editingTemplateId, templates],
  );

  const handleToggle = () => {
    toggle(editingTemplateId ? AUTOMATION_POPOVER_WIDTH : TEMPLATE_POPOVER_WIDTH, () => {
      if (!open) setEditingTemplateId(null);
    });
  };

  const navigateToPage = (pageId: string) => {
    close();
    setEditingTemplateId(null);
    setActivePage(pageId);
    setCurrentTabPage(pageId);
  };

  const handleAdd = () => {
    // 템플릿 페이지 생성 후 즉시 이동해서 편집한다.
    const pageId = addTemplate(databaseId);
    if (pageId) navigateToPage(pageId);
  };

  const handleDelete = (id: string, title: string) => {
    if (!window.confirm(`'${title}'을 삭제하시겠습니까?`)) return;
    deleteTemplate(databaseId, id);
    if (editingTemplateId === id) setEditingTemplateId(null);
  };

  const handleApply = (id: string) => {
    close();
    setEditingTemplateId(null);
    const pageId = applyTemplate(databaseId, id);
    if (pageId) void openRow(pageId, { source: "database-template-apply-open" });
  };

  const handleAddEmptyRow = () => {
    close();
    setEditingTemplateId(null);
    addRowAndOpen(undefined, { source: "database-template-empty-row-open" });
  };

  const handleSaveAutomation = (
    templateId: string,
    automation: DatabaseTemplateAutomationConfig,
  ) => {
    updateTemplate(databaseId, templateId, { automation });
    setEditingTemplateId(null);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        title="템플릿"
        className="inline-flex h-7 items-center gap-1 rounded-md bg-blue-500 px-2 text-xs font-medium text-white hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-700"
      >
        템플릿
        {templates.length > 0 && (
          <span className="rounded bg-blue-400 px-1 text-[10px] text-white dark:bg-blue-500">
            {templates.length}
          </span>
        )}
      </button>

      {open && coords &&
        createPortal(
          <div
            ref={popoverRef}
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              width: editingTemplate ? AUTOMATION_POPOVER_WIDTH : TEMPLATE_POPOVER_WIDTH,
            }}
            className="z-50 overflow-hidden rounded-md border border-zinc-200 bg-white text-base shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          >
            {editingTemplate ? (
              <TemplateAutomationPanel
                template={editingTemplate}
                pageTitle={
                  editingTemplate.pageId
                    ? (pages[editingTemplate.pageId]?.title ?? editingTemplate.title)
                    : editingTemplate.title
                }
                columns={bundle?.columns ?? []}
                panelState={bundle?.panelState}
                onBack={() => setEditingTemplateId(null)}
                onSave={(automation) => handleSaveAutomation(editingTemplate.id, automation)}
              />
            ) : (
              <TemplateListPanel
                templates={templates}
                pages={pages}
                onAddEmptyRow={handleAddEmptyRow}
                onAddTemplate={handleAdd}
                onApply={handleApply}
                onEditPage={navigateToPage}
                onEditAutomation={(templateId) => setEditingTemplateId(templateId)}
                onDelete={handleDelete}
              />
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

function TemplateListPanel({
  templates,
  pages,
  onAddEmptyRow,
  onAddTemplate,
  onApply,
  onEditPage,
  onEditAutomation,
  onDelete,
}: {
  templates: DatabaseTemplate[];
  pages: ReturnType<typeof usePageStore.getState>["pages"];
  onAddEmptyRow: () => void;
  onAddTemplate: () => void;
  onApply: (templateId: string) => void;
  onEditPage: (pageId: string) => void;
  onEditAutomation: (templateId: string) => void;
  onDelete: (templateId: string, title: string) => void;
}) {
  return (
    <>
      <div className="border-b border-zinc-100 px-2 py-1.5 dark:border-zinc-800">
        <button
          type="button"
          onClick={onAddEmptyRow}
          className="mb-1 flex w-full items-center gap-1.5 rounded px-1 py-1 text-base text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          title="빈 페이지"
        >
          <Plus size={12} />
          빈 페이지
        </button>
        <button
          type="button"
          onClick={onAddTemplate}
          className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-base text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <Plus size={12} />
          새 템플릿
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="px-3 py-3 text-center text-base text-zinc-400">
          템플릿이 없습니다
        </div>
      ) : (
        <ul className="max-h-72 overflow-y-auto py-1">
          {templates.map((template) => {
            const pageTitle = template.pageId
              ? (pages[template.pageId]?.title ?? template.title)
              : template.title;
            const automationEnabled = template.automation?.enabled === true;
            return (
              <li
                key={template.id}
                className="flex items-center gap-1 px-2 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                <button
                  type="button"
                  onClick={() => onApply(template.id)}
                  className="min-w-0 flex-1 truncate text-left text-base text-zinc-700 dark:text-zinc-300"
                  title={`'${pageTitle}' 템플릿으로 새 항목 추가`}
                >
                  {pageTitle}
                </button>
                <button
                  type="button"
                  title={automationEnabled ? "자동화 설정됨" : "자동화 설정"}
                  onClick={() => onEditAutomation(template.id)}
                  className={[
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-zinc-200 dark:hover:bg-zinc-700",
                    automationEnabled ? "text-blue-600 dark:text-blue-400" : "text-zinc-400",
                  ].join(" ")}
                >
                  <CalendarClock size={16} />
                </button>
                {template.pageId && (
                  <button
                    type="button"
                    title="템플릿 페이지 편집"
                    onClick={() => onEditPage(template.pageId!)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  >
                    <Pencil size={16} />
                  </button>
                )}
                <button
                  type="button"
                  title="템플릿 삭제"
                  onClick={() => onDelete(template.id, pageTitle)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                >
                  <X size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function TemplateAutomationPanel({
  template,
  pageTitle,
  columns,
  panelState,
  onBack,
  onSave,
}: {
  template: DatabaseTemplate;
  pageTitle: string;
  columns: ColumnDef[];
  panelState?: DatabasePanelState;
  onBack: () => void;
  onSave: (automation: DatabaseTemplateAutomationConfig) => void;
}) {
  const existing = template.automation;
  const defaultTime = existing?.time ?? "09:00";
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [weekdays, setWeekdays] = useState<TemplateAutomationWeekday[]>(
    existing?.weekdays?.length ? existing.weekdays : [1],
  );
  const [time, setTime] = useState(defaultTime);
  const [timezone, setTimezone] = useState(existing?.timezone ?? TEMPLATE_AUTOMATION_DEFAULT_TIMEZONE);
  const [titlePrefix, setTitlePrefix] = useState(existing?.titlePrefix ?? pageTitle);
  const [dateColumnId, setDateColumnId] = useState<string>(
    existing?.dateColumnId ?? "",
  );
  const [endDate, setEndDate] = useState(existing?.endDate ?? "");

  const dateColumns = columns.filter((column) => column.type === "date");
  const resolvedDateColumnId = resolveTemplateAutomationDateColumnId(
    columns,
    panelState,
    dateColumnId ? { dateColumnId } : undefined,
  );
  const resolvedDateColumnName =
    dateColumns.find((column) => column.id === resolvedDateColumnId)?.name ?? "없음";

  const toggleWeekday = (weekday: TemplateAutomationWeekday) => {
    setWeekdays((current) => {
      if (current.includes(weekday)) {
        const next = current.filter((item) => item !== weekday);
        return next.length > 0 ? next : current;
      }
      return [...current, weekday].sort((a, b) => a - b);
    });
  };

  const save = () => {
    const normalized = normalizeTemplateAutomationConfig(
      {
        id: existing?.id ?? `${template.id}:weekly`,
        enabled,
        weekdays,
        time,
        timezone,
        titlePrefix,
        dateColumnId: dateColumnId || undefined,
        maxAttempts: existing?.maxAttempts,
        endDate: endDate || null,
        updatedAt: Date.now(),
      },
      `${template.id}:weekly`,
    );
    if (!normalized) {
      window.alert("요일과 시간을 확인해주세요.");
      return;
    }
    onSave(normalized);
  };

  const disable = () => {
    const normalized = normalizeTemplateAutomationConfig(
      {
        id: existing?.id ?? `${template.id}:weekly`,
        enabled: false,
        weekdays,
        time,
        timezone,
        titlePrefix,
        dateColumnId: dateColumnId || undefined,
        maxAttempts: existing?.maxAttempts,
        endDate: endDate || null,
        updatedAt: Date.now(),
      },
      `${template.id}:weekly`,
    );
    if (!normalized) return;
    onSave(normalized);
  };

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-zinc-100 px-2 py-2 dark:border-zinc-800">
        <button
          type="button"
          onClick={onBack}
          title="뒤로"
          className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <ChevronLeft size={15} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
            {pageTitle}
          </div>
          <div className="text-xs text-zinc-400">템플릿 자동 생성</div>
        </div>
        <label className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          사용
        </label>
      </div>

      <div className="space-y-3 px-3 py-3">
        <div>
          <div className="mb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">요일</div>
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((weekday) => {
              const selected = weekdays.includes(weekday);
              return (
                <button
                  key={weekday}
                  type="button"
                  onClick={() => toggleWeekday(weekday)}
                  className={[
                    "h-8 rounded border text-xs font-medium",
                    selected
                      ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-950/40 dark:text-blue-300"
                      : "border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800",
                  ].join(" ")}
                >
                  {TEMPLATE_AUTOMATION_WEEKDAY_LABELS[weekday]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
              시간
            </span>
            <input
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              className="h-8 w-full rounded border border-zinc-200 bg-white px-2 text-sm text-zinc-800 outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
              종료 날짜
            </span>
            <div className="flex gap-1">
              <input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                aria-label={endDate ? "종료 날짜" : "종료일 없음"}
                className="h-8 min-w-0 flex-1 rounded border border-zinc-200 bg-white px-2 text-sm text-zinc-800 outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
              <button
                type="button"
                onClick={() => setEndDate("")}
                disabled={!endDate}
                className="h-8 rounded border border-zinc-200 px-2 text-xs text-zinc-500 hover:bg-zinc-50 disabled:cursor-default disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                없음
              </button>
            </div>
            {!endDate ? (
              <span className="mt-1 block text-[11px] text-zinc-400">종료일 없음</span>
            ) : null}
          </label>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
            시간대
          </span>
          <select
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            className="h-8 w-full rounded border border-zinc-200 bg-white px-2 text-sm text-zinc-800 outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          >
            {TIMEZONE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
            제목 접두어
          </span>
          <input
            type="text"
            value={titlePrefix}
            onChange={(event) => setTitlePrefix(event.target.value)}
            placeholder={pageTitle}
            className="h-8 w-full rounded border border-zinc-200 bg-white px-2 text-sm text-zinc-800 outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
            날짜 컬럼
          </span>
          <select
            value={dateColumnId}
            onChange={(event) => setDateColumnId(event.target.value)}
            className="h-8 w-full rounded border border-zinc-200 bg-white px-2 text-sm text-zinc-800 outline-none focus:border-blue-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          >
            <option value="">자동 선택: {resolvedDateColumnName}</option>
            {dateColumns.map((column) => (
              <option key={column.id} value={column.id}>
                {column.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center justify-between border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">
        <button
          type="button"
          onClick={disable}
          className="inline-flex h-8 items-center gap-1 rounded px-2 text-xs text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          <Power size={13} />
          끄기
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onBack}
            className="h-8 rounded px-2 text-xs text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            취소
          </button>
          <button
            type="button"
            onClick={save}
            className="inline-flex h-8 items-center gap-1 rounded bg-blue-600 px-2 text-xs font-medium text-white hover:bg-blue-700"
          >
            <Check size={13} />
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
