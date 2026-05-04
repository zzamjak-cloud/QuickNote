import { describe, it, expect } from "vitest";
import {
  sanitizeWebLinkHref,
  isAllowedTipTapLinkUri,
  isTrustedYoutubeInput,
} from "../lib/safeUrl";

describe("sanitizeWebLinkHref", () => {
  it("javascript/data 스킴은 거부한다", () => {
    expect(sanitizeWebLinkHref("javascript:alert(1)")).toBeNull();
    expect(sanitizeWebLinkHref("data:text/html,<svg/onload=alert(1)>")).toBeNull();
  });

  it("http(s)/mailto를 허용한다", () => {
    expect(sanitizeWebLinkHref("https://example.com/path")).toBe(
      "https://example.com/path",
    );
    expect(sanitizeWebLinkHref("mailto:a@b.co")).toBe("mailto:a@b.co");
  });

  it("스킴 없는 도메인은 https를 붙인다", () => {
    expect(sanitizeWebLinkHref("example.com/foo")).toBe(
      "https://example.com/foo",
    );
  });
});

describe("isAllowedTipTapLinkUri", () => {
  const ctx = {
    defaultValidate: (u: string) =>
      /^https?:\/\//i.test(u) || u.startsWith("mailto:"),
    protocols: [],
    defaultProtocol: "http",
  };

  it("dangerous 스킴은 defaultValidate 전에 false", () => {
    expect(
      isAllowedTipTapLinkUri("javascript:void(0)", {
        ...ctx,
        defaultValidate: () => true,
      }),
    ).toBe(false);
  });
});

describe("isTrustedYoutubeInput", () => {
  it("공식 호스트만 허용", () => {
    expect(isTrustedYoutubeInput("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      true,
    );
    expect(isTrustedYoutubeInput("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
    expect(isTrustedYoutubeInput("https://evil.com/youtube.com")).toBe(false);
  });
});
