import { describe, expect, it } from "vitest";
import {
  SESSION_IDLE_MS,
  SESSION_MAX_MS,
  canMergeIntoSession,
  compactPatchOps,
  diffMeaningfulDatabaseUnits,
  diffMeaningfulPageUnits,
  mergeContributors,
} from "./historySession";

function docOf(...blocks: unknown[]) {
  return JSON.stringify({ type: "doc", content: blocks });
}

const textBlock = (id: string, text: string) => ({
  type: "paragraph",
  attrs: { id },
  content: [{ type: "text", text }],
});

const emptyBlock = (id: string) => ({ type: "paragraph", attrs: { id } });

describe("diffMeaningfulPageUnits", () => {
  it("빈 블럭 추가/삭제와 블럭 위치 이동(밀림)은 변화로 치지 않는다", () => {
    const before = { doc: docOf(textBlock("a", "하나"), textBlock("b", "둘")) };
    const after = {
      doc: docOf(emptyBlock("z"), textBlock("b", "둘"), textBlock("a", "하나")),
    };
    expect(diffMeaningfulPageUnits(before, after)).toEqual([]);
  });

  it("블럭 내용 변경은 block:<id> 단위로 잡는다", () => {
    const before = { doc: docOf(textBlock("a", "하나"), textBlock("b", "둘")) };
    const after = { doc: docOf(textBlock("a", "하나!"), textBlock("b", "둘")) };
    expect(diffMeaningfulPageUnits(before, after)).toEqual(["block:a"]);
  });

  it("내용 있는 블럭의 추가·삭제는 변화다", () => {
    const before = { doc: docOf(textBlock("a", "하나")) };
    const after = { doc: docOf(textBlock("b", "새 블럭")) };
    expect(diffMeaningfulPageUnits(before, after)).toEqual(["block:a", "block:b"]);
  });

  it("order·blockComments·updatedAt 변경은 무시하고 메타·셀 변경은 잡는다", () => {
    const before = {
      title: "t",
      order: "1",
      blockComments: { a: { th: 1 } },
      updatedAt: "2026-01-01T00:00:00Z",
      dbCells: { col1: "x" },
    };
    const after = {
      title: "t2",
      order: "9",
      blockComments: { a: { th: 2 } },
      updatedAt: "2026-02-01T00:00:00Z",
      dbCells: { col1: "y" },
    };
    expect(diffMeaningfulPageUnits(before, after)).toEqual(["cell:col1", "meta:title"]);
  });

  it("null 기본값 attr 유무 차이(getJSON vs yDocToJson)는 변화가 아니다", () => {
    const before = {
      doc: docOf({
        type: "paragraph",
        attrs: { id: "a", textAlign: null },
        content: [{ type: "text", text: "x" }],
      }),
    };
    const after = {
      doc: docOf({
        type: "paragraph",
        attrs: { id: "a" },
        content: [{ type: "text", text: "x" }],
      }),
    };
    expect(diffMeaningfulPageUnits(before, after)).toEqual([]);
  });

  it("doc 이 JSON 문자열이고 키 순서가 달라도 동일 내용은 무변화", () => {
    const before = { doc: docOf({ type: "paragraph", attrs: { id: "a" }, content: [{ type: "text", text: "x" }] }) };
    const after = { doc: docOf({ content: [{ text: "x", type: "text" }], attrs: { id: "a" }, type: "paragraph" }) };
    expect(diffMeaningfulPageUnits(before, after)).toEqual([]);
  });
});

describe("diffMeaningfulDatabaseUnits", () => {
  it("panelState 변경만으로는 버전 사유가 아니다", () => {
    const before = { title: "db", panelState: { activeView: "table" } };
    const after = { title: "db", panelState: { activeView: "board" } };
    expect(diffMeaningfulDatabaseUnits(before, after)).toEqual([]);
  });

  it("컬럼·프리셋은 id 단위, 제목은 meta:title 로 잡는다", () => {
    const before = {
      title: "db",
      columns: [{ id: "c1", name: "이름" }],
      presets: [{ id: "p1", filter: null }],
    };
    const after = {
      title: "db2",
      columns: [{ id: "c1", name: "이름" }, { id: "c2", name: "상태" }],
      presets: [{ id: "p1", filter: { col: "c2" } }],
    };
    expect(diffMeaningfulDatabaseUnits(before, after)).toEqual([
      "column:c2",
      "meta:title",
      "preset:p1",
    ]);
  });

  it("id 없는 columns 배열은 통째 비교로 폴백한다", () => {
    const before = { columns: [{ name: "a" }] };
    const after = { columns: [{ name: "b" }] };
    expect(diffMeaningfulDatabaseUnits(before, after)).toEqual(["columns"]);
  });
});

describe("compactPatchOps", () => {
  it("뒤의 set 이 같은 path 나 그 prefix 를 덮으면 앞 op 를 제거한다", () => {
    const ops = compactPatchOps([
      { op: "set", path: ["doc", "content", 1], value: 1 },
      { op: "set", path: ["title"], value: "t1" },
      { op: "set", path: ["doc"], value: { type: "doc" } },
      { op: "set", path: ["title"], value: "t2" },
    ]);
    expect(ops).toEqual([
      { op: "set", path: ["doc"], value: { type: "doc" } },
      { op: "set", path: ["title"], value: "t2" },
    ]);
  });

  it("전체 스냅샷 set(path [])은 앞의 모든 op 를 덮는다", () => {
    const ops = compactPatchOps([
      { op: "set", path: ["title"], value: "x" },
      { op: "unset", path: ["icon"] },
      { op: "set", path: [], value: { id: "p1" } },
    ]);
    expect(ops).toEqual([{ op: "set", path: [], value: { id: "p1" } }]);
  });
});

describe("canMergeIntoSession", () => {
  const base = Date.parse("2026-06-12T00:00:00Z");
  const latest = {
    kind: "page.session",
    workspaceId: "ws-1",
    sessionStartedAt: "2026-06-12T00:00:00Z",
    lastActivityAt: "2026-06-12T00:05:00Z",
  };

  it("idle/max 경계 안의 열린 세션이면 머지", () => {
    expect(
      canMergeIntoSession({ latest, sessionKind: "page.session", workspaceId: "ws-1", now: base + 6 * 60_000 }),
    ).toBe(true);
  });

  it("idle 초과·세션 최대 초과·kind 불일치·엔트리 없음은 머지 불가", () => {
    expect(
      canMergeIntoSession({
        latest,
        sessionKind: "page.session",
        workspaceId: "ws-1",
        now: Date.parse(latest.lastActivityAt) + SESSION_IDLE_MS,
      }),
    ).toBe(false);
    expect(
      canMergeIntoSession({
        latest: { ...latest, lastActivityAt: new Date(base + SESSION_MAX_MS).toISOString() },
        sessionKind: "page.session",
        workspaceId: "ws-1",
        now: base + SESSION_MAX_MS + 1,
      }),
    ).toBe(false);
    expect(
      canMergeIntoSession({
        latest: { ...latest, kind: "page.create" },
        sessionKind: "page.session",
        workspaceId: "ws-1",
        now: base + 6 * 60_000,
      }),
    ).toBe(false);
    expect(
      canMergeIntoSession({ latest: null, sessionKind: "page.session", workspaceId: "ws-1", now: base }),
    ).toBe(false);
  });
});

describe("mergeContributors", () => {
  it("멤버를 중복 없이 누적하고 같은 멤버는 마지막 이름으로 갱신한다", () => {
    const first = mergeContributors(null, { memberId: "m1", name: "A" });
    const second = mergeContributors(first, { memberId: "m2", name: "B" });
    const third = mergeContributors(second, { memberId: "m1", name: "A2" });
    expect(third).toEqual([
      { memberId: "m2", name: "B" },
      { memberId: "m1", name: "A2" },
    ]);
  });
});
