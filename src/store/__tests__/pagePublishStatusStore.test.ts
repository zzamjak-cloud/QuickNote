import { beforeEach, describe, expect, it } from "vitest";
import {
  getPagePublishStatusRevision,
  usePagePublishStatusStore,
} from "../pagePublishStatusStore";

describe("pagePublishStatusStore", () => {
  beforeEach(() => {
    usePagePublishStatusStore.setState({ statusByPageId: {} });
  });

  it("늦게 도착한 상태 조회가 이후 게시 결과를 덮어쓰지 않는다", () => {
    const fetchRevision = getPagePublishStatusRevision("page-1");

    usePagePublishStatusStore.getState().setPublished("page-1", true);
    usePagePublishStatusStore
      .getState()
      .applyFetchedStatus("page-1", false, fetchRevision);

    expect(
      usePagePublishStatusStore.getState().statusByPageId["page-1"]?.published,
    ).toBe(true);
  });
});
