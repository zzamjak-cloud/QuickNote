import { Hash } from "lucide-react";
import { useUiStore } from "../../store/uiStore";

type Props = {
  databaseId: string;
};

/** DB 헤더용 — MCP·외부 AI 연동에 쓰는 데이터베이스 ID 를 클립보드로 복사한다. */
export function DatabaseCopyIdButton({ databaseId }: Props) {
  const showToast = useUiStore((s) => s.showToast);

  const copyId = () => {
    if (!databaseId) {
      showToast("복사할 데이터베이스 ID가 없습니다.", { kind: "error" });
      return;
    }
    void navigator.clipboard
      .writeText(databaseId)
      .then(() => showToast("데이터베이스 ID 복사 완료!", { kind: "success" }))
      .catch(() => showToast("데이터베이스 ID 복사에 실패했습니다.", { kind: "error" }));
  };

  return (
    <button
      type="button"
      title="데이터베이스 ID 복사"
      aria-label="데이터베이스 ID 복사"
      onClick={copyId}
      className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
    >
      <Hash size={15} />
    </button>
  );
}
