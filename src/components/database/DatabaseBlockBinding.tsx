import { Database, Link2, Plus, Search } from "lucide-react";
import type { Dispatch, KeyboardEvent, SetStateAction } from "react";
import { listDatabases, useDatabaseStore } from "../../store/databaseStore";
import type { DatabaseMeta } from "../../types/database";

type InlineBindingStep = "choose" | "new" | "link";

type Props = {
  inlineBindingStep: InlineBindingStep;
  setInlineBindingStep: (s: InlineBindingStep) => void;
  linkPickerQuery: string;
  setLinkPickerQuery: (q: string) => void;
  linkPickerHighlight: number;
  setLinkPickerHighlight: Dispatch<SetStateAction<number>>;
  linkPickerListBaseId: string;
  linkPickerFiltered: { id: string; meta: DatabaseMeta }[];
  createNewDatabaseAndBind: () => void;
  bindToExistingDatabase: (id: string) => void;
  onLinkPickerKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
};

/** DB 미연결 시 — 신규 / 기존 연결 마법사 */
export function DatabaseBlockBinding({
  inlineBindingStep,
  setInlineBindingStep,
  linkPickerQuery,
  setLinkPickerQuery,
  linkPickerHighlight,
  setLinkPickerHighlight,
  linkPickerListBaseId,
  linkPickerFiltered,
  createNewDatabaseAndBind,
  bindToExistingDatabase,
  onLinkPickerKeyDown,
}: Props) {
  const databasesList = useDatabaseStore(listDatabases);

  return (
    <div className="p-2">
      <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50/60 px-3 py-4 text-xs dark:border-zinc-600 dark:bg-zinc-900/40">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
          <Database size={16} className="shrink-0 text-zinc-500" />
          데이터베이스 블록 설정
        </div>

        {inlineBindingStep === "choose" ? (
          <>
            <p className="mb-3 text-zinc-500 dark:text-zinc-400">
              신규로 만들지, 이미 있는 데이터베이스에 연결할지 먼저 선택하세요.
              연결이 완료될 때만 저장소에 DB가 반영됩니다.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
              <button
                type="button"
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
                onClick={() => setInlineBindingStep("new")}
              >
                <Plus size={16} strokeWidth={2.25} />
                새 데이터베이스 만들기
              </button>
              <button
                type="button"
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
                onClick={() => {
                  setLinkPickerQuery("");
                  setLinkPickerHighlight(0);
                  setInlineBindingStep("link");
                }}
              >
                <Link2 size={16} strokeWidth={2.25} />
                기존 데이터베이스 연결
              </button>
            </div>
          </>
        ) : inlineBindingStep === "new" ? (
          <>
            <p className="mb-3 text-zinc-500 dark:text-zinc-400">
              새 데이터베이스가 저장소에 생성되고 이 블록에 바로 연결됩니다.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                onClick={createNewDatabaseAndBind}
              >
                생성하고 연결
              </button>
              <button
                type="button"
                className="text-sm text-zinc-500 underline-offset-2 hover:text-zinc-700 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
                onClick={() => setInlineBindingStep("choose")}
              >
                뒤로
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mb-2 text-zinc-500 dark:text-zinc-400">
              검색어로 목록을 좁힌 뒤, ↑↓로 항목을 고르고 Enter로 연결합니다.
            </p>
            <label
              className="mb-1 block text-zinc-600 dark:text-zinc-500"
              htmlFor="qn-db-link-picker-search"
            >
              기존 데이터베이스 검색
            </label>
            <div className="relative mb-2 max-w-md">
              <Search
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400"
                aria-hidden
              />
              <input
                id="qn-db-link-picker-search"
                type="text"
                inputMode="search"
                autoComplete="off"
                value={linkPickerQuery}
                onChange={(e) => setLinkPickerQuery(e.target.value)}
                onKeyDown={onLinkPickerKeyDown}
                placeholder="이름 일부 입력…"
                className="w-full rounded border border-zinc-300 bg-white py-1.5 pl-8 pr-2 text-sm text-zinc-900 caret-zinc-900 placeholder:text-zinc-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/35 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:caret-sky-300 dark:placeholder:text-zinc-500 dark:focus:border-sky-400 dark:focus:ring-sky-400/35"
              />
            </div>
            <div
              role="listbox"
              aria-label="검색된 데이터베이스"
              className="mb-3 max-h-48 max-w-md overflow-y-auto rounded border border-zinc-200 bg-white dark:border-zinc-600 dark:bg-zinc-950"
            >
              {databasesList.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-amber-700 dark:text-amber-400">
                  아직 저장된 데이터베이스가 없습니다. 「뒤로」에서 새로 만들기를
                  선택하세요.
                </div>
              ) : linkPickerFiltered.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  검색과 일치하는 데이터베이스가 없습니다.
                </div>
              ) : (
                linkPickerFiltered.map((d, idx) => (
                  <button
                    key={d.id}
                    type="button"
                    role="option"
                    id={`${linkPickerListBaseId}-opt-${idx}`}
                    aria-selected={linkPickerHighlight === idx}
                    className={[
                      "flex w-full cursor-pointer border-b border-zinc-100 px-3 py-2 text-left text-sm last:border-b-0 dark:border-zinc-800",
                      linkPickerHighlight === idx
                        ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-50"
                        : "text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800/80",
                    ].join(" ")}
                    onMouseEnter={() => setLinkPickerHighlight(idx)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => bindToExistingDatabase(d.id)}
                  >
                    {d.meta.title}
                  </button>
                ))
              )}
            </div>
            <button
              type="button"
              className="text-sm text-zinc-500 underline-offset-2 hover:text-zinc-700 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
              onClick={() => setInlineBindingStep("choose")}
            >
              뒤로
            </button>
          </>
        )}
      </div>
    </div>
  );
}
