// 콘텐츠 툴 공용 — 재사용하는 v5 핸들러(웹 게시·플로우차트)·업로드용 테이블/버킷 이름과 입력 조각.
// 이 값들은 콘텐츠 툴만 쓰므로 McpTables 필수 목록(missingTables)에 넣지 않고 툴 호출 시점에 확인한다 —
// 배포 전 환경에서도 다른 툴은 그대로 동작하고, 해당 툴만 "미구성" 오류를 돌려준다.
import { z } from "zod";
import type { Tables } from "../../../v5-resolvers/handlers/member";
import { ToolError, type McpContext } from "../../context";

export const idInput = z.string().trim().min(1).max(256);

function env(name: string): string | undefined {
  const value = process.env[name];
  return value ? value : undefined;
}

/** ctx.tables + 콘텐츠 툴 전용 이름(테스트는 ctx.tables 에 직접 넣는다). */
export function contentTables(ctx: McpContext): Tables & typeof ctx.tables {
  const t = ctx.tables;
  return {
    ...t,
    PublishedPages: t.PublishedPages ?? env("PUBLISHED_PAGES_TABLE_NAME"),
    SharedBlocks: t.SharedBlocks ?? env("SHARED_BLOCKS_TABLE_NAME"),
    Flowcharts: t.Flowcharts ?? env("FLOWCHARTS_TABLE_NAME"),
    FlowchartHistory: t.FlowchartHistory ?? env("FLOWCHART_HISTORY_TABLE_NAME"),
    ImagesBucketName: t.ImagesBucketName ?? env("IMAGES_BUCKET_NAME"),
  };
}

export function requireConfigured(value: string | undefined, feature: string): string {
  if (!value) throw new ToolError(`${feature} is not configured on this QuickNote server yet`);
  return value;
}

/** 공개 뷰어 origin — 클라 buildPublicPageUrl 의 기본값과 같다(웹 배포는 env 로 환경별 origin). */
const DEFAULT_PUBLIC_WEB_ORIGIN = "https://quick-note-khaki.vercel.app";

export function publicPageUrl(token: string): string {
  const origin = (env("PUBLIC_WEB_ORIGIN") ?? DEFAULT_PUBLIC_WEB_ORIGIN).replace(/\/+$/, "");
  return `${origin}/p/${token}`;
}
