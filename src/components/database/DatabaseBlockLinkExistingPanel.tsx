import type { DatabaseMeta } from "../../types/database";

type Row = { id: string; meta: DatabaseMeta };

type Props = {
  databaseId: string;
  databasesList: Row[];
  onSelectExisting: (id: string) => void;
};

/** 연결된 상태에서 「다른 DB 연결」 시 표시하는 선택 패널 */
export function DatabaseBlockLinkExistingPanel({
  databaseId,
  databasesList,
  onSelectExisting,
}: Props) {
  return (
    <div className="border-b border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700">
      <div className="mb-1 font-medium text-zinc-700 dark:text-zinc-300">
        기존 데이터베이스에 연결
      </div>
      <select
        className="w-full max-w-xs rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-600 dark:bg-zinc-900"
        value=""
        onChange={(e) => onSelectExisting(e.target.value)}
      >
        <option value="">선택…</option>
        {databasesList
          .filter((d) => d.id !== databaseId)
          .map((d) => (
            <option key={d.id} value={d.id}>
              {d.meta.title}
            </option>
          ))}
      </select>
    </div>
  );
}
