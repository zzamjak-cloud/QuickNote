import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  YOUTUBE_IFRAME_ALLOW,
  YOUTUBE_IFRAME_ALLOW_WITH_AUTOPLAY,
} from "../youtubePermissionsPolicy";

describe("YouTube iframe 권한 정책", () => {
  it("웹·공개 페이지 iframe에 compute-pressure를 좁게 위임한다", () => {
    expect(YOUTUBE_IFRAME_ALLOW.split("; ")).toContain("compute-pressure");
    expect(YOUTUBE_IFRAME_ALLOW_WITH_AUTOPLAY.split("; ")).toContain("compute-pressure");
  });

  it("Tauri용 중첩 YouTube iframe에도 같은 권한을 위임한다", () => {
    const wrapper = readFileSync(join(process.cwd(), "public/yt-embed.js"), "utf8");
    expect(wrapper).toContain("compute-pressure");
    expect(wrapper).not.toContain("compute-pressure *");
  });
});
