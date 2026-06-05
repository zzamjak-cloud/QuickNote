import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { CellValue, TemplateAutomation } from "../../types/database";
import { useDatabaseStore } from "../../store/databaseStore";
import { PersonCell } from "./cells/PersonCell";
import { normalizePersonValue } from "./cells/utils";

type Props = {
  databaseId: string;
  templateId: string;
  open: boolean;
  onClose: () => void;
};

// 월~금 (JS getDay 기준 1~5).
const WEEKDAYS: Array<{ value: number; label: string }> = [
  { value: 1, label: "월" },
  { value: 2, label: "화" },
  { value: 3, label: "수" },
  { value: 4, label: "목" },
  { value: 5, label: "금" },
];

const DEFAULT_AUTOMATION: TemplateAutomation = {
  weekdays: [],
  hour: 10,
  minute: 30,
  titlePrefix: "",
};

/** 24시간제 → 오전/오후 + 1~12시 */
function to12h(hour: number): { ampm: "AM" | "PM"; h12: number } {
  const ampm = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return { ampm, h12 };
}

/** 오전/오후 + 1~12시 → 24시간제 */
function to24h(ampm: "AM" | "PM", h12: number): number {
  const base = h12 % 12; // 12 → 0
  return ampm === "AM" ? base : base + 12;
}

/**
 * 템플릿 자동 생성 설정 팝업.
 * 요일 토글 · 생성 시각 · 제목 접두 · 참여자(person 컬럼) 를 편집한다.
 */
export function TemplateAutomationPopup({ databaseId, templateId, open, onClose }: Props) {
  const templates = useDatabaseStore((s) => s.dbTemplates[databaseId] ?? []);
  const updateTemplate = useDatabaseStore((s) => s.updateTemplate);

  // 스토어의 현재 자동화 설정 — draft 초기값·lastRunDate 보존용.
  const stored = useMemo<TemplateAutomation>(() => {
    const tmpl = templates.find((t) => t.id === templateId);
    return tmpl?.automation ?? DEFAULT_AUTOMATION;
  }, [templates, templateId]);

  // 편집 중에는 로컬 draft 만 변경한다(서버 동기화 없음).
  // 저장 버튼 클릭 시에만 updateTemplate(→ 서버 동기화)을 1회 호출한다.
  const [draft, setDraft] = useState<TemplateAutomation>(stored);

  // 팝업이 열릴 때마다 스토어 최신값으로 draft 초기화.
  useEffect(() => {
    if (open) setDraft(stored);
    // open 전환 시에만 초기화 — 편집 중 stored 변경으로 덮어쓰지 않도록 의존성 최소화.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, templateId]);

  const patch = (next: Partial<TemplateAutomation>) => {
    setDraft((prev) => ({ ...prev, ...next }));
  };

  const toggleWeekday = (value: number) => {
    const set = new Set(draft.weekdays);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    patch({ weekdays: [...set].sort((a, b) => a - b) });
  };

  const handleSave = () => {
    // lastRunDate 는 스토어 권위값을 보존(편집 대상 아님).
    updateTemplate(databaseId, templateId, {
      automation: { ...draft, lastRunDate: stored.lastRunDate },
    });
    onClose();
  };

  const auto = draft;
  const { ampm, h12 } = to12h(auto.hour);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[800] flex items-center justify-center bg-black/30"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[320px] rounded-lg border border-zinc-200 bg-white p-4 text-base shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">자동화 설정</div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-0.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X size={14} />
          </button>
        </div>
        <div className="space-y-3">
        {/* 반복 요일 */}
        <div>
          <div className="mb-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">반복 요일</div>
          <div className="flex gap-1">
            {WEEKDAYS.map((d) => {
              const active = auto.weekdays.includes(d.value);
              return (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleWeekday(d.value)}
                  className={[
                    "h-7 w-9 rounded-md text-sm font-medium transition-colors",
                    active
                      ? "bg-blue-500 text-white hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-700"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700",
                  ].join(" ")}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 생성 시각 */}
        <div>
          <div className="mb-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">생성 시각</div>
          <div className="flex items-center gap-1.5">
            <select
              value={ampm}
              onChange={(e) => patch({ hour: to24h(e.target.value as "AM" | "PM", h12) })}
              className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            >
              <option value="AM">오전</option>
              <option value="PM">오후</option>
            </select>
            <select
              value={h12}
              onChange={(e) => patch({ hour: to24h(ampm, Number(e.target.value)) })}
              className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                <option key={h} value={h}>
                  {h}시
                </option>
              ))}
            </select>
            <select
              value={auto.minute === 0 || auto.minute === 30 ? String(auto.minute) : "custom"}
              onChange={(e) => {
                // "직접 입력" 선택 시 00/30 이 아닌 값(예: 15)으로 전환해 입력칸을 노출.
                patch({ minute: e.target.value === "custom" ? 15 : Number(e.target.value) });
              }}
              className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
            >
              <option value="0">00분</option>
              <option value="30">30분</option>
              <option value="custom">직접 입력</option>
            </select>
            {auto.minute !== 0 && auto.minute !== 30 && (
              <input
                type="number"
                min={0}
                max={59}
                value={auto.minute}
                onChange={(e) => {
                  const m = Math.max(0, Math.min(59, Number(e.target.value) || 0));
                  patch({ minute: m });
                }}
                className="w-14 rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              />
            )}
          </div>
        </div>

        {/* 제목 설정 */}
        <div>
          <div className="mb-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            제목 (생성 시 날짜가 뒤에 붙음)
          </div>
          <input
            type="text"
            value={auto.titlePrefix}
            onChange={(e) => patch({ titlePrefix: e.target.value })}
            placeholder="[CAT] 주간회의"
            className="w-full rounded-md border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
          />
        </div>

        {/* 참여자 (선택) */}
        <div>
          <div className="mb-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            참여자 (선택)
          </div>
          <PersonCell
            value={auto.participantMemberIds ?? []}
            onChange={(v: CellValue) =>
              patch({ participantMemberIds: normalizePersonValue(v as string | string[]) })
            }
          />
        </div>
      </div>

        {/* 저장 — 클릭 시에만 서버 동기화 */}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="rounded-md bg-blue-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-700"
          >
            저장
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
