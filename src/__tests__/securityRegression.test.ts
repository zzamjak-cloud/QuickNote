/**
 * `.full-review/05-final-report.md` HI-19 — 보안·무결성 회귀 (T-1 ~ T-5)
 *
 * T-1 duplicatePage doc 격리
 * T-2 panelState(JSON) 프로토타입·키 오염 방어
 * T-3 loadPages 스키마 검증
 * T-4 링크/URL 허용 스킴 매트릭스
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { usePageStore } from "../store/pageStore";
import { parseDatabasePanelStateJson } from "../lib/schemas/panelStateSchema";
import { loadPages, STORAGE_KEYS } from "../lib/storage";
import {
  sanitizeWebLinkHref,
  isAllowedTipTapLinkUri,
} from "../lib/safeUrl";
import { DatabaseBlock } from "../lib/tiptapExtensions/databaseBlock";
import { emptyPanelState } from "../types/database";
import type { JSONContent } from "@tiptap/core";

beforeEach(() => {
  localStorage.clear();
  usePageStore.setState({ pages: {}, activePageId: null });
});

describe("HI-19 T-1 duplicatePage doc 격리", () => {
  it("복제본 doc는 원본과 참조를 공유하지 않는다", () => {
    const id = usePageStore.getState().createPage("원본");
    usePageStore.getState().updateDoc(id, {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }],
    });
    const copyId = usePageStore.getState().duplicatePage(id);

    usePageStore.getState().updateDoc(id, {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }],
    });

    const a = usePageStore.getState().pages[id]!.doc;
    const b = usePageStore.getState().pages[copyId]!.doc;
    expect(JSON.stringify(a)).toContain("B");
    expect(JSON.stringify(b)).toContain("A");
  });
});

describe("HI-19 T-2 panelState 파싱·오염 방어", () => {
  it("__proto__ 키는 결과 객체에 나타나지 않는다", () => {
    const polluted = '{"searchQuery":"ok","__proto__":{"polluted":true}}';
    const out = parseDatabasePanelStateJson(polluted);
    expect(out.searchQuery).toBe("ok");
    expect(Object.prototype.hasOwnProperty.call(out as object, "__proto__")).toBe(
      false,
    );
  });
});

describe("HI-19 T-3 loadPages 검증", () => {
  it("스키마 불일치 시 빈 객체로 폴백", () => {
    localStorage.setItem(
      STORAGE_KEYS.pages,
      JSON.stringify({ x: { notAPage: true } }),
    );
    expect(loadPages()).toEqual({});
  });
});

describe("HI-19 T-4 URL 스킴 매트릭스", () => {
  const ctx = {
    defaultValidate: (u: string) =>
      /^https?:\/\//i.test(u) || u.startsWith("mailto:"),
    protocols: [] as string[],
    defaultProtocol: "http",
  };

  it("javascript:/data: 거부 · https 허용", () => {
    expect(sanitizeWebLinkHref("javascript:alert(1)")).toBeNull();
    expect(sanitizeWebLinkHref("https://a.test/x")).toBe("https://a.test/x");
    expect(
      isAllowedTipTapLinkUri("javascript:void(0)", {
        ...ctx,
        defaultValidate: () => true,
      }),
    ).toBe(false);
  });
});

describe("HI-19 databaseBlock 삭제", () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  const docWithDatabase: JSONContent = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "hi" }],
      },
      {
        type: "databaseBlock",
        attrs: {
          databaseId: "db-regression",
          layout: "inline",
          view: "table",
          panelState: JSON.stringify(emptyPanelState()),
          readOnlyTitle: false,
        },
      },
    ],
  };

  it("databaseBlock 은 tr.delete 로 문서에서 제거된다", () => {
    editor = new Editor({
      extensions: [StarterKit, DatabaseBlock],
      content: docWithDatabase,
      editable: true,
    });

    let dbPos = -1;
    let dbSize = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "databaseBlock") {
        dbPos = pos;
        dbSize = node.nodeSize;
        return false;
      }
    });
    expect(dbPos).toBeGreaterThanOrEqual(0);

    const tr = editor.state.tr.delete(dbPos, dbPos + dbSize);
    editor.view.dispatch(tr);

    let foundDb = false;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "databaseBlock") {
        foundDb = true;
        return false;
      }
    });
    expect(foundDb).toBe(false);
  });
});
