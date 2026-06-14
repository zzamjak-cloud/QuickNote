import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { usePageStore } from "../../../store/pageStore";
import { useSettingsStore } from "../../../store/settingsStore";
import type { Page } from "../../../types/page";
import { installPageMentionClickNavigation } from "../pageMentionClick";

function page(id: string): Page {
  return {
    id,
    title: id,
    icon: null,
    doc: { type: "doc", content: [] },
    parentId: null,
    order: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("pageMentionClick", () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    document.body.innerHTML = `
      <div class="ProseMirror">
        <span data-type="mention" data-id="p:page-2" data-mention-kind="page" class="page-mention">
          <span>대상 페이지</span>
        </span>
      </div>
    `;
    useSettingsStore.setState({
      tabs: [{ pageId: "page-1", databaseId: null }],
      activeTabIndex: 0,
    });
    usePageStore.setState({
      pages: {
        "page-1": page("page-1"),
        "page-2": page("page-2"),
      },
      activePageId: "page-1",
    });
    cleanup = installPageMentionClickNavigation();
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    document.body.innerHTML = "";
  });

  it("페이지 멘션 mousedown/mouseup 으로 현재 탭 이동한다", () => {
    const mention = document.querySelector("[data-type='mention']") as HTMLElement;
    mention.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10 }),
    );
    mention.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10 }),
    );

    expect(usePageStore.getState().activePageId).toBe("page-2");
    expect(useSettingsStore.getState().tabs[0]?.pageId).toBe("page-2");
  });

  it("멤버 멘션은 이동하지 않는다", () => {
    document.body.innerHTML = `
      <div class="ProseMirror">
        <span data-type="mention" data-id="m:user-1" data-mention-kind="member">@멤버</span>
      </div>
    `;
    const mention = document.querySelector("[data-type='mention']") as HTMLElement;
    mention.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10 }),
    );
    mention.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10 }),
    );

    expect(usePageStore.getState().activePageId).toBe("page-1");
  });
});
