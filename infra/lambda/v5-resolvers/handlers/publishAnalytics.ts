// 웹 게시 방문자 대시보드 집계 — developer 전용 조회.
// 기록은 public-view Lambda(op=hit)가 담당하고, 여기서는 읽기 집계만 한다.
// 동일 IP 는 토큰별 솔트 해시(visitor#<hash>) 1건으로 저장되므로 방문자 1명으로 집계된다.

import {
  DynamoDBDocumentClient,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { badRequest, type Member } from "./_auth";
import { requireDeveloper } from "./aiConfig";
import type { Tables } from "./member";
import { getActivePublishRecords } from "./publishedPage";

const VISITOR_PREFIX = "visitor#";
const DAY_PREFIX = "day#";
const PAGE_PREFIX = "page#";
// 응답 크기 방어 — 일별은 최근 N일, 페이지별은 상위 N개만 반환.
const MAX_DAILY_ENTRIES = 60;
const MAX_PAGE_ENTRIES = 50;
const MAX_COUNTRY_ENTRIES = 60;

type BaseArgs = {
  doc: DynamoDBDocumentClient;
  tables: Tables;
  caller: Member;
  pageId: string;
};

export type PublishAnalyticsGql = {
  pageId: string;
  published: boolean;
  totalViews: number;
  uniqueVisitors: number;
  firstViewAt: string | null;
  lastViewAt: string | null;
  countries: Array<{ country: string; visitors: number; views: number }>;
  daily: Array<{ date: string; views: number }>;
  pages: Array<{ pageId: string; views: number }>;
};

type AnalyticsRow = {
  token: string;
  sk: string;
  views?: number;
  country?: string;
  firstSeenAt?: string;
  lastSeenAt?: string;
};

function emptyAnalytics(pageId: string, published: boolean): PublishAnalyticsGql {
  return {
    pageId,
    published,
    totalViews: 0,
    uniqueVisitors: 0,
    firstViewAt: null,
    lastViewAt: null,
    countries: [],
    daily: [],
    pages: [],
  };
}

async function queryAllAnalyticsRows(
  doc: DynamoDBDocumentClient,
  tableName: string,
  token: string,
): Promise<AnalyticsRow[]> {
  const rows: AnalyticsRow[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await doc.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "#t = :t",
        ExpressionAttributeNames: { "#t": "token" },
        ExpressionAttributeValues: { ":t": token },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    for (const item of r.Items ?? []) rows.push(item as AnalyticsRow);
    exclusiveStartKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);
  return rows;
}

/** 웹 게시 방문자 분석 집계 — 해당 페이지의 모든 active 토큰을 합산한다. */
export async function getPublishAnalytics(
  args: BaseArgs,
): Promise<PublishAnalyticsGql> {
  requireDeveloper(args.caller);
  if (!args.tables.PublishedPages) badRequest("PublishedPages table 미설정");
  if (!args.tables.PublishAnalytics) badRequest("PublishAnalytics table 미설정");

  const actives = await getActivePublishRecords(
    args.doc,
    args.tables.PublishedPages,
    args.pageId,
  );
  if (actives.length === 0) return emptyAnalytics(args.pageId, false);

  let totalViews = 0;
  let uniqueVisitors = 0;
  let firstViewAt: string | null = null;
  let lastViewAt: string | null = null;
  const countries = new Map<string, { visitors: number; views: number }>();
  const daily = new Map<string, number>();
  const pages = new Map<string, number>();

  for (const record of actives) {
    const rows = await queryAllAnalyticsRows(
      args.doc,
      args.tables.PublishAnalytics,
      record.token,
    );
    for (const row of rows) {
      const views = typeof row.views === "number" ? row.views : 0;
      if (row.sk.startsWith(VISITOR_PREFIX)) {
        uniqueVisitors += 1;
        totalViews += views;
        const country = row.country?.trim() || "??";
        const stat = countries.get(country) ?? { visitors: 0, views: 0 };
        stat.visitors += 1;
        stat.views += views;
        countries.set(country, stat);
        if (row.firstSeenAt && (!firstViewAt || row.firstSeenAt < firstViewAt)) {
          firstViewAt = row.firstSeenAt;
        }
        if (row.lastSeenAt && (!lastViewAt || row.lastSeenAt > lastViewAt)) {
          lastViewAt = row.lastSeenAt;
        }
      } else if (row.sk.startsWith(DAY_PREFIX)) {
        const date = row.sk.slice(DAY_PREFIX.length);
        daily.set(date, (daily.get(date) ?? 0) + views);
      } else if (row.sk.startsWith(PAGE_PREFIX)) {
        const pageId = row.sk.slice(PAGE_PREFIX.length);
        pages.set(pageId, (pages.get(pageId) ?? 0) + views);
      }
    }
  }

  return {
    pageId: args.pageId,
    published: true,
    totalViews,
    uniqueVisitors,
    firstViewAt,
    lastViewAt,
    countries: Array.from(countries.entries())
      .map(([country, stat]) => ({ country, ...stat }))
      .sort((a, b) => b.visitors - a.visitors || b.views - a.views)
      .slice(0, MAX_COUNTRY_ENTRIES),
    daily: Array.from(daily.entries())
      .map(([date, views]) => ({ date, views }))
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .slice(-MAX_DAILY_ENTRIES),
    pages: Array.from(pages.entries())
      .map(([pageId, views]) => ({ pageId, views }))
      .sort((a, b) => b.views - a.views)
      .slice(0, MAX_PAGE_ENTRIES),
  };
}
