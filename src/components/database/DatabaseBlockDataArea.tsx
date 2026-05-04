import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

type Props = {
  bundleGone: boolean;
  children: ReactNode;
};

export function DatabaseBlockDataArea({ bundleGone, children }: Props) {
  return (
    <div className="p-2">
      {bundleGone ? (
        <div className="flex items-center gap-2 px-2 py-8 text-sm text-amber-700 dark:text-amber-400">
          <ArrowLeft size={16} />
          데이터를 찾을 수 없습니다. 연결을 다른 DB로 바꾸거나 블록을 삭제하세요.
        </div>
      ) : (
        children
      )}
    </div>
  );
}
