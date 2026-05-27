import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";

interface ScrollToTopButtonProps {
  /** 스크롤 컨테이너 ref — 이 컨테이너를 최상단으로 스크롤한다 */
  scrollRef: React.RefObject<HTMLElement | null>;
  /** 버튼 고정 방식: 화면 기준 fixed 또는 부모 패널 기준 absolute */
  position?: "fixed" | "absolute";
}

const SHOW_THRESHOLD_PX = 8;

/** 우측 하단 고정 "맨 위로" 버튼 — 클릭 시 대상 스크롤 컨테이너를 최상단으로 이동 */
export function ScrollToTopButton({
  scrollRef,
  position = "fixed",
}: ScrollToTopButtonProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const host = scrollRef.current;
    if (!host) return;
    const update = () => setVisible(host.scrollTop > SHOW_THRESHOLD_PX);
    update();
    host.addEventListener("scroll", update, { passive: true });
    return () => host.removeEventListener("scroll", update);
  }, [scrollRef]);

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
      title="맨 위로"
      aria-label="맨 위로"
      className={[
        position === "fixed" ? "fixed" : "absolute",
        "bottom-6 right-6 z-[400] inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-600 shadow-lg transition hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 dark:hover:text-zinc-100",
      ].join(" ")}
    >
      <ArrowUp size={18} />
    </button>
  );
}
