import { describe, expect, it } from "vitest";
import type { DocNode } from "../../types";
import { docToQfm, qfmToDoc } from "../index";
import { doc, h, li, link, normalize, p, t } from "./helpers";

function roundTrip(input: DocNode): { md: string; output: DocNode } {
  const md = docToQfm(input);
  return { md, output: qfmToDoc(md) };
}

function expectRoundTrip(input: DocNode): string {
  const { md, output } = roundTrip(input);
  expect(normalize(output), md).toEqual(normalize(input));
  return md;
}

describe("QFM 왕복(JSON→QFM→JSON)", () => {
  it("제목 1~6·문단", () => {
    expectRoundTrip(
      doc(h(1, t("하나")), h(2, t("둘")), h(3, t("셋")), h(6, t("여섯")), p(t("본문 문단입니다."))),
    );
  });

  it("인라인 마크(굵게·기울임·취소선·코드·링크·밑줄·색·형광펜)", () => {
    const md = expectRoundTrip(
      doc(
        p(
          t("a "),
          t("bold", "bold"),
          t(" "),
          t("it", "italic"),
          t(" "),
          t("bi", "bold", "italic"),
          t(" "),
          t("del", "strike"),
          t(" "),
          t("x < y", "code"),
          t(" "),
          t("site", link("https://example.com/a_(b)")),
          t(" "),
          t("under", "underline"),
          t(" "),
          t("red", { type: "textStyle", attrs: { color: "#ef4444" } }),
          t(" "),
          t("hl", { type: "highlight", attrs: { color: "yellow" } }),
          t(" "),
          t("plainhl", "highlight"),
        ),
      ),
    );
    expect(md).toContain("**bold**");
    expect(md).toContain("_it_");
    expect(md).toContain('<span color="#ef4444">red</span>');
  });

  it("단어 내부 이탤릭·인접 마크·특수문자 이스케이프", () => {
    expectRoundTrip(
      doc(
        p(t("snake"), t("case", "italic"), t("_name * [x] `y` ~~z~~ <div> \\ end")),
        p(t("bold", "bold"), t("plain"), t("bold2", "bold"), t(" lead", "italic")),
        p(t("# not heading")),
        p(t("1. not list")),
        p(t("- not bullet")),
        p(t("> not quote")),
      ),
    );
  });

  it("하드 브레이크·빈 문단", () => {
    expectRoundTrip(doc(p(t("첫 줄"), { type: "hardBreak" }, t("둘째 줄")), p(), p(t("끝"))));
  });

  it("글머리·번호·중첩 목록·항목 내 다중 블록", () => {
    expectRoundTrip(
      doc(
        {
          type: "bulletList",
          content: [
            li(p(t("a")), { type: "bulletList", content: [li(p(t("a-1"))), li(p(t("a-2")))] }),
            li(p(t("b")), p(t("b 둘째 문단"))),
          ],
        },
        {
          type: "orderedList",
          attrs: { start: 3 },
          content: [
            li(p(t("셋")), { type: "orderedList", content: [li(p(t("중첩")))] }),
            li(p(t("넷")), { type: "codeBlock", attrs: { language: "ts" }, content: [t("const a = 1;\n  b();")] }),
          ],
        },
      ),
    );
  });

  it("할 일 목록", () => {
    expectRoundTrip(
      doc({
        type: "taskList",
        content: [
          { type: "taskItem", attrs: { checked: true }, content: [p(t("완료"))] },
          {
            type: "taskItem",
            attrs: { checked: false },
            content: [p(t("미완")), { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [p(t("하위"))] }] }],
          },
        ],
      }),
    );
  });

  it("코드블록(언어·백틱 포함)·인용·구분선", () => {
    expectRoundTrip(
      doc(
        { type: "codeBlock", attrs: { language: "js" }, content: [t("```\nconsole.log(1)\n```")] },
        { type: "codeBlock" },
        { type: "blockquote", content: [p(t("인용")), { type: "bulletList", content: [li(p(t("q")))] }] },
        { type: "horizontalRule" },
        { type: "horizontalRule", attrs: { lineStyle: "dashed", thickness: 2, color: "#ef4444" } },
      ),
    );
  });

  it("GFM 표(정렬·파이프 이스케이프)", () => {
    const cell = (type: string, text: string, align?: string): DocNode => ({
      type,
      ...(align ? { attrs: { align } } : {}),
      content: [text ? p(t(text)) : p()],
    });
    expectRoundTrip(
      doc({
        type: "table",
        content: [
          { type: "tableRow", content: [cell("tableHeader", "이름"), cell("tableHeader", "값")] },
          { type: "tableRow", content: [cell("tableCell", "a|b"), cell("tableCell", "")] },
        ],
      }),
    );
  });

  it("이미지(단축형·속성 태그형)", () => {
    expectRoundTrip(
      doc(
        { type: "image", attrs: { src: "https://x.com/a.png", alt: "대체", title: "제목" } },
        { type: "image", attrs: { src: "quicknote-image://abc", width: 320, align: "center", caption: "캡션" } },
      ),
    );
  });

  it("콜아웃·토글·컬럼 중첩", () => {
    const md = expectRoundTrip(
      doc(
        { type: "callout", attrs: { preset: "warning", emoji: "⚠️" }, content: [p(t("주의")), h(2, t("내부 제목"))] },
        { type: "callout", content: [p(t("기본"))] },
        {
          type: "toggle",
          attrs: { open: false },
          content: [
            { type: "toggleHeader", attrs: { titleLevel: "2" }, content: [t("토글 "), t("제목", "bold")] },
            { type: "toggleContent", content: [p(t("내용")), { type: "toggle", content: [{ type: "toggleHeader", content: [t("안쪽")] }, { type: "toggleContent", content: [p()] }] }] },
          ],
        },
        {
          type: "columnLayout",
          attrs: { columns: 2, preset: "info" },
          content: [
            { type: "column", attrs: { width: 2 }, content: [p(t("왼쪽")), { type: "callout", content: [p(t("콜아웃 in 컬럼"))] }] },
            { type: "column", content: [{ type: "bulletList", content: [li(p(t("오른쪽")))] }] },
          ],
        },
      ),
    );
    expect(md).toContain('<callout preset="warning" icon="⚠️">');
    expect(md).toContain("<details><summary level=\"2\">");
    expect(md).toContain("<columns preset=\"info\">");
  });

  it("멘션·페이지 링크·날짜·아이콘·버튼 인라인 원자", () => {
    const md = expectRoundTrip(
      doc(
        p(
          t("담당 "),
          { type: "mention", attrs: { id: "m:mem-1", label: "홍길동", mentionKind: "member" } },
          t(" 참고 "),
          { type: "mention", attrs: { id: "p:page-1", label: "기획 <v2>", mentionKind: "page" } },
          t(" "),
          { type: "mention", attrs: { id: "d:db-1", label: "DB", mentionKind: "database" } },
          { type: "pageLink", attrs: { id: "page-2", label: "링크" } },
          { type: "dateInline", attrs: { value: "2026-10-03" } },
          { type: "lucideInlineIcon", attrs: { name: "Star", color: "#f59e0b" } },
          { type: "imageInlineIcon", attrs: { src: "quicknote-image://icon" } },
          { type: "buttonBlock", attrs: { label: "열기", href: "https://a.b", color: "blue" } },
        ),
      ),
    );
    expect(md).toContain('<mention-user id="mem-1">홍길동</mention-user>');
    expect(md).toContain('<mention-page id="page-1">기획 \\<v2></mention-page>');
  });

  it("데이터베이스·북마크·유튜브·파일 블록", () => {
    expectRoundTrip(
      doc(
        { type: "databaseBlock", attrs: { databaseId: "db-9", layout: "fullPage", view: "board" } },
        { type: "bookmarkBlock", attrs: { href: "https://x.com", title: "X \"제목\"", description: "설명" } },
        { type: "youtube", attrs: { src: "https://youtu.be/abc", start: 10 } },
        { type: "fileBlock", attrs: { src: "quicknote-file://f1", name: "a.pdf", size: 1024, mime: "application/pdf" } },
      ),
    );
  });
});

describe("AI 작성 마크다운 파싱", () => {
  it("일반 GFM 을 블록으로 변환", () => {
    const out = normalize(
      qfmToDoc(
        [
          "# 제목",
          "",
          "문단 *기울임* 과 __굵게__ 그리고 `코드`.",
          "",
          "* 항목 1",
          "  * 하위",
          "1) 첫째",
          "",
          "> [!WARNING] 조심",
          "> 둘째 줄",
          "",
          "| a | b |",
          "|:-:|--:|",
          "| 1 | 2 |",
          "",
          "<details><summary>열기</summary>",
          "숨김 내용",
          "</details>",
        ].join("\n"),
      ),
    );
    const types = (out.content ?? []).map((n) => n.type);
    expect(types).toEqual(["heading", "paragraph", "bulletList", "orderedList", "callout", "table", "toggle"]);
    expect(out.content?.[4]?.attrs).toEqual({ preset: "warning" });
    expect(out.content?.[1]?.content).toContainEqual({ type: "text", text: "굵게", marks: [{ type: "bold" }] });
    expect(out.content?.[6]?.attrs).toEqual({ open: false });
  });

  it("수식의 단일 별표는 기울임으로 보지 않는다", () => {
    const out = qfmToDoc("2 * 3 * 4 와 snake_case_name");
    expect(out.content?.[0]?.content).toEqual([{ type: "text", text: "2 * 3 * 4 와 snake_case_name" }]);
  });

  it("위험한 링크 스킴은 링크 마크 없이 텍스트만 남긴다", () => {
    const out = qfmToDoc("[클릭](javascript:alert(1)) ![x](data:image/png;base64,AA)");
    const json = JSON.stringify(out);
    expect(json).not.toContain("javascript:");
    expect(json).not.toContain("data:image");
  });
});
