import { describe, expect, it } from "vitest";
import type { Node as PMNode } from "@tiptap/pm/model";
import { GRIP_SIZE_PX, resolveHandleTop, type HoverInfo } from "../helpers";
import { isLikelyVerticalScrollbarInput } from "../../../../lib/navigation/pageScrollMemory";

function node(typeName: string, attrs: Record<string, unknown> = {}): PMNode {
  return { type: { name: typeName }, attrs } as unknown as PMNode;
}

function rect(top: number, height: number, left = 0, width = 100): DOMRect {
  return {
    x: left,
    y: top,
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

function hover(typeName: string, top: number, height: number, attrs?: Record<string, unknown>): HoverInfo {
  return {
    rect: rect(top, height),
    blockStart: 1,
    depth: 1,
    node: node(typeName, attrs),
  };
}

function scrollHost(props: {
  scrollHeight: number;
  clientHeight: number;
  offsetWidth: number;
  clientWidth: number;
}): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperties(el, {
    scrollHeight: { value: props.scrollHeight },
    clientHeight: { value: props.clientHeight },
    offsetWidth: { value: props.offsetWidth },
    clientWidth: { value: props.clientWidth },
  });
  el.getBoundingClientRect = () => rect(10, props.clientHeight, 20, props.offsetWidth);
  return el;
}

describe("block handle positioning", () => {
  it("centers the horizontal rule handle on the visible line", () => {
    const wrapper = rect(20, 400);
    const rule = hover("horizontalRule", 120, 2);

    expect(resolveHandleTop(rule, wrapper)).toBe(120 - 20 + 1 - GRIP_SIZE_PX / 2);
  });
});

describe("editor scrollbar mouse detection", () => {
  it("treats the right native scrollbar area as scrollbar drag input", () => {
    const host = scrollHost({
      scrollHeight: 1200,
      clientHeight: 500,
      offsetWidth: 300,
      clientWidth: 285,
    });
    const event = new MouseEvent("mousedown", { clientX: 315, clientY: 30 });

    expect(isLikelyVerticalScrollbarInput(event, host)).toBe(true);
  });

  it("does not treat normal editor content as scrollbar drag input", () => {
    const host = scrollHost({
      scrollHeight: 1200,
      clientHeight: 500,
      offsetWidth: 300,
      clientWidth: 285,
    });
    const event = new MouseEvent("mousedown", { clientX: 240, clientY: 30 });

    expect(isLikelyVerticalScrollbarInput(event, host)).toBe(false);
  });
});
