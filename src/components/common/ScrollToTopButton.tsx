import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";

interface ScrollToTopButtonProps {
  /** 스크롤 컨테이너 ref — 없으면 window 스크롤을 대상으로 삼는다. */
  scrollRef?: React.RefObject<HTMLElement | null>;
  /** 버튼 고정 방식: 화면 기준 fixed 또는 부모 패널 기준 absolute */
  position?: "fixed" | "absolute";
  /** 접근성/툴팁 라벨. */
  label?: string;
}

const SHOW_THRESHOLD_PX = 8;

/** 우측 하단 고정 "맨 위로" 버튼 — 클릭 시 대상 스크롤 컨테이너를 최상단으로 이동 */
export function ScrollToTopButton({
  scrollRef,
  position = "fixed",
  label = "맨 위로",
}: ScrollToTopButtonProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // 이 버튼은 scrollRef 가 가리키는 컨테이너의 "자식"으로 렌더되는 경우가 많다.
    // React 의 ref attach 는 bottom-up(자식 먼저) 이라, 마운트 직후 effect 시점에
    // 조상 컨테이너의 ref(scrollRef.current)가 아직 null 일 수 있다.
    // → rAF 재시도로 ref 가 채워질 때까지 기다렸다가 리스너를 건다.
    let host: HTMLElement | Window | null = null;
    let raf = 0;
    const update = () => {
      if (!host) return;
      if (host === window) {
        const scrollTop =
          window.scrollY ||
          document.scrollingElement?.scrollTop ||
          document.documentElement.scrollTop ||
          0;
        setVisible(scrollTop > SHOW_THRESHOLD_PX);
        return;
      }
      const elementHost = host as HTMLElement;
      setVisible(elementHost.scrollTop > SHOW_THRESHOLD_PX);
    };
    const attach = () => {
      if (!scrollRef) {
        host = window;
        update();
        window.addEventListener("scroll", update, { passive: true });
        return;
      }
      host = scrollRef.current;
      if (!host) {
        raf = requestAnimationFrame(attach);
        return;
      }
      update();
      host.addEventListener("scroll", update, { passive: true });
    };
    attach();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      host?.removeEventListener("scroll", update);
      setVisible(false);
    };
  }, [scrollRef]);

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={() => {
        const host = scrollRef?.current;
        if (host) {
          host.scrollTo({ top: 0, behavior: "smooth" });
        } else {
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      }}
      title={label}
      aria-label={label}
      className={[
        position === "fixed" ? "fixed" : "absolute",
        "bottom-6 right-6 z-[660] inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-600 shadow-lg transition hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 dark:hover:text-zinc-100",
      ].join(" ")}
    >
      <ArrowUp size={18} />
    </button>
  );
}
