import { describe, expect, it } from "vitest";
import type { DocNode } from "../../types";
import { QfmError, collectBlockRefs, docToQfm, qfmToDoc } from "../index";
import { doc, p, t } from "./helpers";

const flowchart: DocNode = {
  type: "flowchartBlock",
  attrs: { flowchartId: "fc-1", data: '{"version":1,"nodes":[{"id":"n1"}],"edges":[]}', version: 1, title: "흐름" },
};
const tabs: DocNode = {
  type: "tabBlock",
  attrs: { id: "tab-1", placement: "left", activeIndex: 0 },
  content: [{ type: "tabPanel", attrs: { id: "panel-1", title: "탭A", icon: null }, content: [p(t("탭 내용"))] }],
};
const gallery: DocNode = {
  type: "galleryBlock",
  attrs: { sharedBlockId: "sb-1", data: '{"kind":"gallery","images":[]}', version: 1 },
};
const database: DocNode = {
  type: "databaseBlock",
  attrs: { id: "blk-db", databaseId: "db-1", layout: "inline", view: "board", panelState: '{"searchQuery":"x"}' },
};
const mergedTable: DocNode = {
  type: "table",
  attrs: { id: "tbl-1" },
  content: [
    {
      type: "tableRow",
      content: [{ type: "tableHeader", attrs: { colspan: 2, rowspan: 1 }, content: [p(t("병합"))] }],
    },
  ],
};

const original = doc(p(t("앞")), flowchart, tabs, gallery, database, mergedTable, p(t("뒤")));

describe("qn-block 참조 해석", () => {
  it("표현 불가 블록은 qn-block 으로 내보내고 resolveBlockRef 로 무손실 복원", () => {
    const md = docToQfm(original);
    expect(md).toContain('<qn-block id="fc-1" type="flowchartBlock"/>');
    expect(md).toContain('<qn-block id="tab-1" type="tabBlock"/>');
    expect(md).toContain('<qn-block id="sb-1" type="galleryBlock"/>');
    expect(md).toContain('<qn-block id="tbl-1" type="table"/>');
    expect(md).toContain('<database id="db-1" layout="inline" view="board"/>');
    expect(md).not.toContain("panelState");

    const refs = collectBlockRefs(original);
    const back = qfmToDoc(md, { resolveBlockRef: (id) => refs.get(id) ?? null });
    expect(back.content?.[1]).toEqual(flowchart);
    expect(back.content?.[2]).toEqual(tabs);
    expect(back.content?.[3]).toEqual(gallery);
    expect(back.content?.[4]).toEqual(database);
    expect(back.content?.[5]).toEqual(mergedTable);
  });

  it("복원된 노드는 원본과 참조를 공유하지 않는다(복제)", () => {
    const refs = collectBlockRefs(original);
    const back = qfmToDoc('<qn-block id="tab-1" type="tabBlock"/>', {
      resolveBlockRef: (id) => refs.get(id) ?? null,
    });
    expect(back.content?.[0]).not.toBe(tabs);
  });

  it("id 없는 qn-block 자리표시자는 버린다", () => {
    const back = qfmToDoc('<qn-block type="weird"/>\n\n본문', { resolveBlockRef: () => null });
    expect(back.content).toEqual([{ type: "paragraph", content: [{ type: "text", text: "본문" }] }]);
  });

  it("resolver 가 있는데 해석 불가하면 UNRESOLVED_BLOCK_REF(id 포함)", () => {
    const run = (): unknown => qfmToDoc('<qn-block id="nope" type="tabBlock"/>', { resolveBlockRef: () => null });
    expect(run).toThrow(QfmError);
    try {
      run();
    } catch (error) {
      expect((error as QfmError).code).toBe("UNRESOLVED_BLOCK_REF");
      expect((error as QfmError).blockId).toBe("nope");
    }
  });

  it("같은 qn-block 을 두 번 쓰면 DUPLICATE_BLOCK_REF (컨테이너 안 포함)", () => {
    const refs = collectBlockRefs(original);
    const md = '<qn-block id="tab-1"/>\n\n<callout>\n<qn-block id="tab-1"/>\n</callout>';
    expect(() => qfmToDoc(md, { resolveBlockRef: (id) => refs.get(id) ?? null })).toThrow(
      expect.objectContaining({ code: "DUPLICATE_BLOCK_REF", blockId: "tab-1" }),
    );
  });

  it("qn-block 이동은 허용", () => {
    const refs = collectBlockRefs(original);
    const back = qfmToDoc('<qn-block id="sb-1"/>\n\n<qn-block id="fc-1"/>', {
      resolveBlockRef: (id) => refs.get(id) ?? null,
    });
    expect(back.content?.map((n) => n.type)).toEqual(["galleryBlock", "flowchartBlock"]);
  });

  it("resolveBlockRef 없이도 안전하게 버리고 빈 문서는 빈 문단 하나", () => {
    expect(qfmToDoc('<qn-block id="fc-1"/>')).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });

  it("데이터베이스 블록: 레이아웃 변경은 반영, 원본 없으면 새 블록", () => {
    const refs = collectBlockRefs(original);
    const back = qfmToDoc('<database id="db-1" layout="fullPage"/>\n\n<database id="db-new"/>', {
      resolveBlockRef: (id) => refs.get(id) ?? null,
    });
    expect(back.content?.[0]?.attrs).toMatchObject({ databaseId: "db-1", layout: "fullPage", panelState: '{"searchQuery":"x"}' });
    expect(back.content?.[1]).toEqual({ type: "databaseBlock", attrs: { databaseId: "db-new", layout: "inline" } });
  });

  it("id 없는 알 수 없는 블록은 id 없이 내보낸다", () => {
    expect(docToQfm(doc({ type: "mysteryBlock" }))).toBe('<qn-block type="mysteryBlock"/>\n');
  });
});
