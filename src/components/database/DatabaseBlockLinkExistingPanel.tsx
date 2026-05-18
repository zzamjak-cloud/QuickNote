import type { DatabaseMeta } from "../../types/database";
import { AppSelect } from "../common/AppSelect";

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
  const options = databasesList
    .filter((d) => d.id !== databaseId)
    .map((d) => ({ value: d.id, label: d.meta.title }));

  return (
    <div className="border-b border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700">
      <div className="mb-1 font-medium text-zinc-700 dark:text-zinc-300">
        기존 데이터베이스에 연결
      </div>
      <AppSelect
        value=""
        onChange={(nextValue) => {
          if (!nextValue) return;
          onSelectExisting(nextValue);
        }}
        options={options}
        placeholder="선택…"
        className="w-full max-w-xs"
      />
    </div>
  );
}
