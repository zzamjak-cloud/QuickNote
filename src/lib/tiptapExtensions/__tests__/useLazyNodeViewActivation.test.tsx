import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLazyNodeViewActivation } from "../useLazyNodeViewActivation";

type ObservedEntry = {
  isIntersecting: boolean;
  intersectionRatio: number;
};

const observerInstances: IntersectionObserverStub[] = [];

class IntersectionObserverStub {
  readonly rootMargin: string;
  readonly threshold: IntersectionObserverInit["threshold"];
  readonly observed = new Set<Element>();
  disconnected = false;

  constructor(
    private readonly callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    this.rootMargin = options?.rootMargin ?? "";
    this.threshold = options?.threshold;
    observerInstances.push(this);
  }

  observe(element: Element) {
    this.observed.add(element);
  }

  unobserve(element: Element) {
    this.observed.delete(element);
  }

  disconnect() {
    this.disconnected = true;
    this.observed.clear();
  }

  trigger(entry: ObservedEntry) {
    const [target] = Array.from(this.observed);
    if (!target) return;
    this.callback([{ ...entry, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

function Probe({
  selected = false,
  forceActive = false,
}: {
  selected?: boolean;
  forceActive?: boolean;
}) {
  const activation = useLazyNodeViewActivation<HTMLDivElement>({
    selected,
    forceActive,
    rootMargin: "640px 0px",
  });

  return (
    <div>
      <div ref={activation.ref} data-testid="target" />
      <output aria-label="state">{activation.active ? "active" : "idle"}</output>
      <button type="button" onClick={activation.activate}>
        activate
      </button>
    </div>
  );
}

describe("useLazyNodeViewActivation", () => {
  beforeEach(() => {
    observerInstances.length = 0;
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("viewport에 진입하기 전에는 idle이고 진입 후 active로 고정된다", async () => {
    render(<Probe />);

    expect(screen.getByLabelText("state").textContent).toBe("idle");
    expect(observerInstances).toHaveLength(1);
    expect(observerInstances[0].rootMargin).toBe("640px 0px");

    act(() => {
      observerInstances[0].trigger({
        isIntersecting: true,
        intersectionRatio: 0.1,
      });
    });

    await waitFor(() => {
      expect(screen.getByLabelText("state").textContent).toBe("active");
    });
    expect(observerInstances[0].disconnected).toBe(true);
  });

  it("선택된 NodeView는 viewport를 기다리지 않고 active가 된다", () => {
    render(<Probe selected />);

    expect(screen.getByLabelText("state").textContent).toBe("active");
    expect(observerInstances).toHaveLength(0);
  });

  it("수동 activate와 IntersectionObserver 미지원 fallback을 제공한다", async () => {
    render(<Probe />);

    fireEvent.click(screen.getByRole("button", { name: "activate" }));
    expect(screen.getByLabelText("state").textContent).toBe("active");

    vi.unstubAllGlobals();
    observerInstances.length = 0;
    render(<Probe forceActive={false} />);

    expect(screen.getAllByLabelText("state").at(-1)?.textContent).toBe("active");
  });
});
