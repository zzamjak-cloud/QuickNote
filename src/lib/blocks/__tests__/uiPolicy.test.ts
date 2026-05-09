import { describe, expect, it } from "vitest";
import {
  isAttachmentBlockNodeType,
  isCalloutBlockNodeType,
  shouldFlattenWrapperBeforeTypeChange,
  shouldSuppressBlockHandle,
  shouldUseDatabaseBlockChrome,
} from "../uiPolicy";

describe("block ui policy", () => {
  it("suppresses handles for structural helper nodes", () => {
    expect(shouldSuppressBlockHandle("columnLayout")).toBe(true);
    expect(shouldSuppressBlockHandle("column")).toBe(true);
    expect(shouldSuppressBlockHandle("toggleHeader")).toBe(true);
    expect(shouldSuppressBlockHandle("paragraph")).toBe(false);
  });

  it("marks wrapper blocks that should flatten before type changes", () => {
    expect(shouldFlattenWrapperBeforeTypeChange("callout")).toBe(true);
    expect(shouldFlattenWrapperBeforeTypeChange("toggle")).toBe(true);
    expect(shouldFlattenWrapperBeforeTypeChange("blockquote")).toBe(true);
    expect(shouldFlattenWrapperBeforeTypeChange("paragraph")).toBe(false);
  });

  it("maps special UI decisions through the block registry", () => {
    expect(shouldUseDatabaseBlockChrome("databaseBlock")).toBe(true);
    expect(isAttachmentBlockNodeType("fileBlock")).toBe(true);
    expect(isCalloutBlockNodeType("callout")).toBe(true);
    expect(shouldUseDatabaseBlockChrome("paragraph")).toBe(false);
  });
});
