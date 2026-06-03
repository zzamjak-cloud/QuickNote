import { ChevronDown, ChevronRight } from "lucide-react";

// 그룹화 섹션 헤더 — 접기 chevron + 색 점 + 라벨 + 개수 배지.
// 표/리스트/갤러리 뷰가 공유한다(타임라인은 후속).

type Props = {
  label: string;
  collapsed: boolean;
  onToggle: () => void;
  /** 표 뷰처럼 별도 컨테이너(<td>) 안에 둘 때 바깥 여백을 호출부가 제어하도록 분리. */
  className?: string;
};

export function GroupSectionHeader({ label, collapsed, onToggle, className }: Props) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={[
        "flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-sm font-bold text-zinc-800 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800/60",
        className ?? "",
      ].join(" ")}
    >
      {collapsed ? (
        <ChevronRight size={14} className="shrink-0 text-zinc-400" />
      ) : (
        <ChevronDown size={14} className="shrink-0 text-zinc-400" />
      )}
      <span className="truncate">{label}</span>
    </button>
  );
}
