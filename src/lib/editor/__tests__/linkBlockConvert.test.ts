import { describe, expect, it } from "vitest";
import { getConvertibleLinkHref } from "../linkBlockConvert";

// 최소 PMNode 목(mock) — getConvertibleLinkHref 가 사용하는 인터페이스만 구현한다.
type MockNode = {
  type: { name: string };
  attrs: Record<string, unknown>;
  isText: boolean;
  text?: string;
  marks: Array<{ type: { name: string }; attrs: Record<string, unknown> }>;
  childCount: number;
  forEach: (cb: (child: MockNode, offset: number, index: number) => void) => void;
};

function textNode(text: string, href?: string): MockNode {
  return {
    type: { name: "text" },
    attrs: {},
    isText: true,
    text,
    marks: href ? [{ type: { name: "link" }, attrs: { href } }] : [],
    childCount: 0,
    forEach: () => {},
  };
}

function buttonNode(href: string): MockNode {
  return {
    type: { name: "buttonBlock" },
    attrs: { href, label: "버튼" },
    isText: false,
    marks: [],
    childCount: 0,
    forEach: () => {},
  };
}

function paragraph(children: MockNode[]): MockNode {
  return {
    type: { name: "paragraph" },
    attrs: {},
    isText: false,
    marks: [],
    childCount: children.length,
    forEach: (cb) => children.forEach((c, i) => cb(c, 0, i)),
  };
}

function blockNode(name: string, attrs: Record<string, unknown>): MockNode {
  return {
    type: { name },
    attrs,
    isText: false,
    marks: [],
    childCount: 0,
    forEach: () => {},
  };
}

// 타입 캐스팅 헬퍼 — 목 노드를 PMNode 로 취급.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asNode = (n: MockNode) => n as any;

describe("getConvertibleLinkHref", () => {
  it("bookmarkBlock 의 외부 href 를 반환한다", () => {
    expect(getConvertibleLinkHref(asNode(blockNode("bookmarkBlock", { href: "https://example.com" }))))
      .toBe("https://example.com");
  });

  it("youtube 의 src 를 반환한다", () => {
    expect(getConvertibleLinkHref(asNode(blockNode("youtube", { src: "https://youtu.be/abc" }))))
      .toBe("https://youtu.be/abc");
  });

  it("문단 안의 단일 buttonBlock(인라인 아톰) href 를 반환한다", () => {
    // 멘션/버튼 으로 변환된 결과는 문단 안의 인라인 buttonBlock 이다.
    const para = paragraph([buttonNode("https://example.com/path")]);
    expect(getConvertibleLinkHref(asNode(para))).toBe("https://example.com/path");
  });

  it("문단 전체가 동일 link 마크 텍스트면 그 href 를 반환한다", () => {
    const para = paragraph([textNode("https://example.com", "https://example.com")]);
    expect(getConvertibleLinkHref(asNode(para))).toBe("https://example.com");
  });

  it("링크 외 텍스트가 섞인 문단은 null", () => {
    const para = paragraph([textNode("앞 텍스트 "), buttonNode("https://example.com")]);
    expect(getConvertibleLinkHref(asNode(para))).toBeNull();
  });

  it("내부 페이지 링크(quicknote://) buttonBlock 은 변환 대상이 아니다", () => {
    const para = paragraph([buttonNode("quicknote://page/abc123")]);
    expect(getConvertibleLinkHref(asNode(para))).toBeNull();
  });

  it("빈 문단/일반 텍스트 문단은 null", () => {
    expect(getConvertibleLinkHref(asNode(paragraph([])))).toBeNull();
    expect(getConvertibleLinkHref(asNode(paragraph([textNode("그냥 텍스트")])))).toBeNull();
  });
});
