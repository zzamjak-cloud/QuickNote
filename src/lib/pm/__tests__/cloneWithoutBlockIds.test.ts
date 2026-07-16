import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { cloneWithoutBlockIds } from "../cloneWithoutBlockIds";

// id attr 이 있는 블록·없는 블록이 섞인 최소 스키마
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      attrs: { id: { default: null }, align: { default: "left" } },
    },
    callout: {
      group: "block",
      content: "block+",
      attrs: { id: { default: null } },
    },
    horizontalRule: { group: "block" },
    text: { group: "inline" },
  },
});

describe("cloneWithoutBlockIds", () => {
  it("최상위 블록의 id 를 null 로 벗기고 다른 attr·텍스트는 유지한다", () => {
    const para = schema.nodes.paragraph.create(
      { id: "orig-1", align: "center" },
      schema.text("hello"),
    );
    const clone = cloneWithoutBlockIds(para);
    expect(clone.attrs.id).toBeNull();
    expect(clone.attrs.align).toBe("center");
    expect(clone.textContent).toBe("hello");
  });

  it("중첩 자식 블록의 id 도 재귀적으로 벗긴다", () => {
    const callout = schema.nodes.callout.create({ id: "c-1" }, [
      schema.nodes.paragraph.create({ id: "p-1" }, schema.text("a")),
      schema.nodes.paragraph.create({ id: "p-2" }, schema.text("b")),
    ]);
    const clone = cloneWithoutBlockIds(callout);
    expect(clone.attrs.id).toBeNull();
    expect(clone.child(0).attrs.id).toBeNull();
    expect(clone.child(1).attrs.id).toBeNull();
    expect(clone.textContent).toBe("ab");
  });

  it("id attr 이 없는 노드는 그대로 복제한다", () => {
    const hr = schema.nodes.horizontalRule.create();
    const clone = cloneWithoutBlockIds(hr);
    expect(clone.type.name).toBe("horizontalRule");
    expect("id" in clone.attrs).toBe(false);
  });
});
