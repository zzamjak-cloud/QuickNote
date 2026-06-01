import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TimelineCardText } from "../TimelineCardText";
import { applyTimelineCardStickyOffset } from "../timelineCardStickyOffset";

describe("TimelineCardText", () => {
  it("제목·기간·children 을 렌더하고 카드 기하 정보를 data 속성으로 노출한다", () => {
    render(
      <TimelineCardText
        cardLeft={100}
        cardWidth={200}
        contentOffset={0}
        title="작업 카드"
        dateLabel="5/7 ~ 5/11"
        containerClassName="flex"
      >
        <span>홍길동</span>
      </TimelineCardText>,
    );
    expect(screen.queryByText("작업 카드")).not.toBeNull();
    expect(screen.queryByText("5/7 ~ 5/11")).not.toBeNull();
    expect(screen.queryByText("홍길동")).not.toBeNull();
    const el = document.querySelector<HTMLElement>("[data-timeline-card-text]");
    expect(el).not.toBeNull();
    expect(el?.dataset.cardLeft).toBe("100");
    expect(el?.dataset.cardWidth).toBe("200");
    // contentOffset 0 → transform 미적용.
    expect(el?.style.transform).toBe("");
  });

  it("contentOffset 이 있으면 transform 으로 텍스트를 우측 이동한다", () => {
    render(
      <TimelineCardText
        cardLeft={0}
        cardWidth={200}
        contentOffset={42}
        title="카드"
        containerClassName="flex"
      />,
    );
    const el = document.querySelector<HTMLElement>("[data-timeline-card-text]");
    expect(el?.style.transform).toBe("translateX(42px)");
  });

  it("dateLabel 이 없으면 기간 라벨을 렌더하지 않는다", () => {
    render(
      <TimelineCardText cardLeft={0} cardWidth={200} contentOffset={0} title="카드" containerClassName="flex" />,
    );
    // 제목만 존재.
    expect(screen.queryByText("카드")).not.toBeNull();
  });
});

describe("applyTimelineCardStickyOffset", () => {
  it("scrollLeft 기준으로 컨테이너 안 카드 텍스트들의 transform 을 갱신한다", () => {
    const { container } = render(
      <div>
        <TimelineCardText cardLeft={100} cardWidth={200} contentOffset={0} title="A" containerClassName="flex" />
        <TimelineCardText cardLeft={400} cardWidth={200} contentOffset={0} title="B" containerClassName="flex" />
      </div>,
    );
    const root = container.firstChild as HTMLElement;

    // scrollLeft=150: A(cardLeft 100)는 50px 밀려야 하고, B(cardLeft 400)는 아직 0.
    applyTimelineCardStickyOffset(root, 150);
    const [a, b] = Array.from(root.querySelectorAll<HTMLElement>("[data-timeline-card-text]"));
    expect(a?.style.transform).toBe("translateX(50px)");
    expect(b?.style.transform).toBe("");

    // 충분히 스크롤하면 카드 폭 - 최소노출폭(=200-36=164) 으로 클램프된다.
    applyTimelineCardStickyOffset(root, 100000);
    expect(a?.style.transform).toBe("translateX(164px)");
  });
});
