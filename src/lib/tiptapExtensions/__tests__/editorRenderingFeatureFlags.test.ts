import { afterEach, describe, expect, it } from "vitest";
import {
  EDITOR_LAZY_INACTIVE_TAB_PANELS_FLAG,
  isEditorLazyInactiveTabPanelsEnabled,
} from "../editorRenderingFeatureFlags";

describe("editorRenderingFeatureFlags", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("비활성 탭 lazy 실험은 기본값이 꺼져 있다", () => {
    expect(isEditorLazyInactiveTabPanelsEnabled()).toBe(false);
  });

  it("localStorage 플래그가 1일 때만 비활성 탭 lazy 실험을 켠다", () => {
    localStorage.setItem(EDITOR_LAZY_INACTIVE_TAB_PANELS_FLAG, "1");

    expect(isEditorLazyInactiveTabPanelsEnabled()).toBe(true);

    localStorage.setItem(EDITOR_LAZY_INACTIVE_TAB_PANELS_FLAG, "true");
    expect(isEditorLazyInactiveTabPanelsEnabled()).toBe(false);
  });
});
