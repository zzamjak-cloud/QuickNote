import { describe, expect, it } from "vitest";
import { hydrateStructuralChildPageMentions } from "../../lib/notionImport/hydrateChildPageMentions";
import {
  buildNotionHrefPathCandidates,
  extractNotionHexId,
  resolveNotionPageHref,
  type NotionPathNormalizer,
} from "../../lib/notionImport/resolveNotionPageHref";

const HEX = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HEX2 = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const norm: NotionPathNormalizer = {
  normalizePath: (value) =>
    value
      .replace(/^\.\/+/, "")
      .split("/")
      .filter(Boolean)
      .map((segment) =>
        segment
          .replace(/\.html$/i, "")
          .replace(/\s+[0-9a-f]{32}$/i, "")
          .trim()
          .toLowerCase(),
      )
      .join("/"),
  normalizeSegment: (value) =>
    value
      .replace(/\.html$/i, "")
      .replace(/\s+[0-9a-f]{32}$/i, "")
      .trim()
      .toLowerCase(),
  pathDirname: (path) => {
    const idx = path.lastIndexOf("/");
    return idx >= 0 ? path.slice(0, idx) : "";
  },
  pathBasename: (path) => {
    const idx = path.lastIndexOf("/");
    return idx >= 0 ? path.slice(idx + 1) : path;
  },
};

describe("resolveNotionPageHref", () => {
  const pages = [
    { path: `Parent ${HEX}.html`, title: "부모" },
    { path: `Parent ${HEX}/Child ${HEX2}.html`, title: "자식" },
  ];

  it("형제 폴더 패턴 — Parent.html + Child.html href → Parent/Child.html", () => {
    const linked = resolveNotionPageHref(`Child ${HEX2}.html`, `Parent ${HEX}.html`, pages, norm);
    expect(linked?.path).toBe(`Parent ${HEX}/Child ${HEX2}.html`);
  });

  it("상대 경로 ./Child.html 을 해석한다", () => {
    const linked = resolveNotionPageHref(
      `./Parent ${HEX}/Child ${HEX2}.html`,
      `Parent ${HEX}.html`,
      pages,
      norm,
    );
    expect(linked?.title).toBe("자식");
  });

  it("hex id 만으로 유일한 페이지를 찾는다", () => {
    expect(extractNotionHexId(`Child ${HEX2}.html`)).toBe(HEX2);
    const linked = resolveNotionPageHref(`unknown-${HEX2}`, `Parent ${HEX}.html`, pages, norm);
    expect(linked?.path).toBe(`Parent ${HEX}/Child ${HEX2}.html`);
  });

  it("후보 path 에 Parent/Child 패턴을 포함한다", () => {
    const candidates = buildNotionHrefPathCandidates(
      `Child ${HEX2}.html`,
      `Parent ${HEX}.html`,
      norm,
    );
    expect(candidates).toContain(`Parent ${HEX}/Child ${HEX2}.html`);
  });
});

describe("hydrateStructuralChildPageMentions", () => {
  it("제목만 남은 문단을 페이지 멘션으로 치환한다", () => {
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "자식" }] }],
    };
    const { doc: hydrated, changed } = hydrateStructuralChildPageMentions(doc, [
      { pageId: "child-id", title: "자식" },
    ]);
    expect(changed).toBe(true);
    expect(hydrated.content?.[0]?.content?.[0]?.type).toBe("mention");
    expect(hydrated.content?.[0]?.content?.[0]?.attrs).toMatchObject({
      id: "p:child-id",
      mentionKind: "page",
    });
  });
});
