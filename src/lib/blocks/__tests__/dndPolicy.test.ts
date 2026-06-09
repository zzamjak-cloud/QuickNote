import { describe, expect, it } from "vitest";
import { canDropNodeTypeInContainers } from "../dndPolicy";

describe("block dnd policy", () => {
  it("allows ordinary blocks inside columns and tabs", () => {
    expect(canDropNodeTypeInContainers("paragraph", ["column"])).toBe(true);
    expect(canDropNodeTypeInContainers("fileBlock", ["tabPanel"])).toBe(true);
  });

  it("allows column layouts to be dropped inside columns (중첩 허용)", () => {
    expect(canDropNodeTypeInContainers("columnLayout", ["column"])).toBe(true);
  });

  it("allows column layouts at document level and inside tabs", () => {
    expect(canDropNodeTypeInContainers("columnLayout", ["doc"])).toBe(true);
    expect(canDropNodeTypeInContainers("columnLayout", ["tabPanel"])).toBe(true);
  });

  it("keeps unknown block types permissive for extension compatibility", () => {
    expect(canDropNodeTypeInContainers("futureBlock", ["column"])).toBe(true);
  });
});
