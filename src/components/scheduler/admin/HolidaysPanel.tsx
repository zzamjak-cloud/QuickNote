// 설정 모달 — 공휴일/이벤트 관리 패널 (연도 선택, 추가/편집/삭제).
import { useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { getHolidaysForYear } from "../../../lib/scheduler/koreanHolidays";
import {
  useSchedulerHolidaysStore,
  type HolidayType,
  type SchedulerHoliday,
} from "../../../store/schedulerHolidaysStore";
import { ColorPickerGrid } from "../ColorPickerGrid";
import { DEFAULT_SCHEDULE_COLOR } from "../../../lib/scheduler/colors";

const HOLIDAY_TYPE_LABELS: Record<HolidayType, string> = {
  holiday: "공휴일",
  evaluation: "평가",
  release: "릴리즈",
  meeting: "회의",
  custom: "기타",
};

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [
  CURRENT_YEAR - 2,
  CURRENT_YEAR - 1,
  CURRENT_YEAR,
  CURRENT_YEAR + 1,
  CURRENT_YEAR + 2,
];

type FormState = {
  title: string;
  date: string;
  type: HolidayType;
  color: string;
};

const EMPTY_FORM: FormState = {
  title: "",
  date: "",
  type: "holiday",
  color: DEFAULT_SCHEDULE_COLOR,
};

export function HolidaysPanel() {
  const { holidays, workspaceId, createHoliday, updateHoliday, deleteHoliday } =
    useSchedulerHolidaysStore();

  // 연도 필터
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR);

  // 추가 폼
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<FormState>(EMPTY_FORM);

  // 인라인 편집
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);

  // 선택 연도의 공식 공휴일 (정적 데이터)
  const officialHolidays = useMemo(() => getHolidaysForYear(selectedYear), [selectedYear]);

  // 선택 연도의 사용자 등록 공휴일 — 날짜순 정렬
  const filtered = holidays
    .filter((h) => h.date.startsWith(String(selectedYear)))
    .sort((a, b) => a.date.localeCompare(b.date));

  function handleAdd() {
    if (!addForm.title.trim() || !addForm.date || !workspaceId) return;
    void createHoliday({
      workspaceId,
      title: addForm.title.trim(),
      date: addForm.date,
      type: addForm.type,
      color: addForm.color,
    });
    setAddForm(EMPTY_FORM);
    setShowAddForm(false);
  }

  function startEdit(h: SchedulerHoliday) {
    setEditingId(h.id);
    setEditForm({ title: h.title, date: h.date, type: h.type, color: h.color });
  }

  function handleEditSave() {
    if (!editingId || !editForm.title.trim() || !editForm.date || !workspaceId) return;
    void updateHoliday({
      id: editingId,
      workspaceId,
      title: editForm.title.trim(),
      date: editForm.date,
      type: editForm.type,
      color: editForm.color,
    });
    setEditingId(null);
  }

  function handleDelete(h: SchedulerHoliday) {
    if (!window.confirm(`"${h.title}"을(를) 삭제하시겠습니까?`)) return;
    if (!workspaceId) return;
    void deleteHoliday(h.id, workspaceId);
    if (editingId === h.id) setEditingId(null);
  }

  return (
    <div className="space-y-4">
      {/* 연도 선택 */}
      <div className="flex items-center gap-3">
        <select
          value={selectedYear}
          onChange={(e) => setSelectedYear(Number(e.target.value))}
          className="px-2 py-1.5 text-sm border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-400"
        >
          {YEAR_OPTIONS.map((y) => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>
      </div>

      {/* ── 공식 공휴일 (자동) ── */}
      <div>
        <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-2">
          공식 공휴일 (자동)
        </div>
        <div className="space-y-1">
          {officialHolidays.map((h) => (
            <div
              key={h.date}
              className="flex items-center gap-2 px-3 py-2 rounded-md bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/40"
            >
              <span className="text-xs text-zinc-500 w-24 flex-shrink-0">{h.date}</span>
              <span className="flex-1 text-sm text-zinc-800 dark:text-zinc-200 truncate">{h.name}</span>
              {h.isSubstitute && (
                <span className="px-1.5 py-0.5 text-[10px] rounded bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300 flex-shrink-0">
                  대체
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── 사용자 등록 공휴일/이벤트 ── */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
            사용자 등록 공휴일/이벤트
          </span>
          {!showAddForm && (
            <button
              type="button"
              onClick={() => {
                setAddForm({ ...EMPTY_FORM, date: `${selectedYear}-01-01` });
                setShowAddForm(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-amber-500 hover:bg-amber-600 text-white transition-colors"
            >
              <Plus size={13} />
              추가
            </button>
          )}
        </div>

        {/* 추가 폼 */}
        {showAddForm && (
          <HolidayForm
            form={addForm}
            setForm={setAddForm}
            onSave={handleAdd}
            onCancel={() => { setShowAddForm(false); setAddForm(EMPTY_FORM); }}
            saveLabel="추가"
          />
        )}

        {/* 목록 */}
        {filtered.length === 0 && !showAddForm && (
          <div className="flex items-center justify-center h-16 text-sm text-zinc-400">
            {selectedYear}년에 등록된 일정이 없습니다.
          </div>
        )}

      {filtered.map((h) => (
        <div
          key={h.id}
          className="border border-zinc-200 dark:border-zinc-700 rounded-md overflow-hidden"
        >
          {/* 항목 행 */}
          <div className="flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-zinc-800">
            {/* 색상 점 */}
            <span
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: h.color }}
            />
            <span className="text-xs text-zinc-500 w-24 flex-shrink-0">{h.date}</span>
            <span className="flex-1 text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
              {h.title}
            </span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300">
              {HOLIDAY_TYPE_LABELS[h.type]}
            </span>
            {/* 편집 */}
            <button
              type="button"
              onClick={() => editingId === h.id ? setEditingId(null) : startEdit(h)}
              title="편집"
              className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
            >
              <Pencil size={14} className="text-zinc-500" />
            </button>
            {/* 삭제 */}
            <button
              type="button"
              onClick={() => handleDelete(h)}
              title="삭제"
              className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              <Trash2 size={14} className="text-red-400" />
            </button>
          </div>

          {/* 인라인 편집 폼 */}
          {editingId === h.id && (
            <div className="border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 p-3">
              <HolidayForm
                form={editForm}
                setForm={setEditForm}
                onSave={handleEditSave}
                onCancel={() => setEditingId(null)}
                saveLabel="저장"
              />
            </div>
          )}
        </div>
      ))}
      </div>
    </div>
  );
}

// ─── 공용 폼 컴포넌트 ─────────────────────────────────────────────────────────

type HolidayFormProps = {
  form: FormState;
  setForm: (f: FormState) => void;
  onSave: () => void;
  onCancel: () => void;
  saveLabel: string;
};

function HolidayForm({ form, setForm, onSave, onCancel, saveLabel }: HolidayFormProps) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {/* 제목 */}
        <div>
          <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">제목</label>
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="일정 제목"
            className="w-full px-2 py-1.5 text-sm border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </div>
        {/* 날짜 */}
        <div>
          <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">날짜</label>
          <input
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            className="w-full px-2 py-1.5 text-sm border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </div>
        {/* 타입 */}
        <div>
          <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">유형</label>
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as HolidayType })}
            className="w-full px-2 py-1.5 text-sm border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-400"
          >
            {(Object.keys(HOLIDAY_TYPE_LABELS) as HolidayType[]).map((t) => (
              <option key={t} value={t}>{HOLIDAY_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>
      </div>

      {/* 색상 */}
      <div>
        <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1.5">색상</label>
        <ColorPickerGrid value={form.color} onChange={(c) => setForm({ ...form, color: c })} />
      </div>

      {/* 버튼 */}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={onSave}
          disabled={!form.title.trim() || !form.date}
          className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-amber-500 hover:bg-amber-600 text-white transition-colors disabled:opacity-40"
        >
          <Check size={12} />
          {saveLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md border border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
        >
          <X size={12} />
          취소
        </button>
      </div>
    </div>
  );
}
