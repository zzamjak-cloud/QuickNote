// DB 템플릿 자동 생성 — EventBridge 스케줄(30분 주기) 호출 시 실행.
// Databases 테이블을 스캔해 자동화 설정이 도래한 템플릿의 행 페이지를 서버에서 생성한다.
// 생성 판정·중복 방지(lastRunDate)를 서버 1곳에서만 수행하므로 기기 간 불일치/중복이 없다.
//
// 타임존: 모든 자동화 시각은 KST(Asia/Seoul, UTC+9) 고정으로 해석한다.

import { randomUUID } from "node:crypto";
import { ScanCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { getCallerMember } from "./_auth";
import type { Member, Tables } from "./member";
import { upsertDatabase, upsertPage } from "./pageDatabase";

type TemplateAutomation = {
  weekdays: number[];
  hour: number;
  minute: number;
  titlePrefix: string;
  participantMemberIds?: string[];
  lastRunDate?: string;
};

type DatabaseTemplate = {
  id: string;
  title: string;
  cells?: Record<string, unknown>;
  pageId?: string;
  automation?: TemplateAutomation;
};

type ColumnLike = { id: string; type: string };

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "object") return value as T;
  if (typeof value !== "string") return fallback;
  try {
    let parsed = JSON.parse(value) as unknown;
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    return (parsed as T) ?? fallback;
  } catch {
    return fallback;
  }
}

/** KST 현재 시각 요소 — UTC+9 로 민 뒤 getUTC* 로 KST 벽시계를 읽는다. */
function nowKstParts(): {
  weekday: number;
  minutes: number;
  dateKey: string;
  titleDate: string;
  iso: string;
} {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const weekday = kst.getUTCDay();
  const minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const yyyy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kst.getUTCDate()).padStart(2, "0");
  return {
    weekday,
    minutes,
    dateKey: `${yyyy}-${mm}-${dd}`,
    titleDate: `${String(yyyy % 100).padStart(2, "0")}/${mm}/${dd}`,
    iso: new Date().toISOString(),
  };
}

/**
 * 자동화 도래 판정.
 * - 활성 요일에 오늘이 포함되고
 * - 설정 시각이 지났으며(-10분 허용 — 30분 주기 tick 정렬 보정)
 * - 오늘 아직 생성하지 않았으면(lastRunDate) 생성한다.
 */
function isAutomationDue(
  auto: TemplateAutomation | undefined,
  weekday: number,
  minutes: number,
  dateKey: string,
): boolean {
  if (!auto || !Array.isArray(auto.weekdays) || auto.weekdays.length === 0) return false;
  if (auto.lastRunDate === dateKey) return false;
  if (!auto.weekdays.includes(weekday)) return false;
  const scheduled = (auto.hour ?? 0) * 60 + (auto.minute ?? 0);
  return minutes >= scheduled - 10;
}

export async function runTemplateAutomations(args: {
  doc: DynamoDBDocumentClient;
  tables: Tables;
}): Promise<{ created: number }> {
  const { doc, tables } = args;
  if (!tables.Databases || !tables.Pages || !tables.Members) {
    console.warn("[templateAutomation] 필수 테이블 미설정 — skip");
    return { created: 0 };
  }
  const { weekday, minutes, dateKey, titleDate, iso } = nowKstParts();

  // Databases 전체 스캔(스키마/규모상 DB 개수는 적음).
  const databases: Array<Record<string, unknown>> = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await doc.send(
      new ScanCommand({ TableName: tables.Databases, ExclusiveStartKey: exclusiveStartKey }),
    );
    for (const item of res.Items ?? []) databases.push(item as Record<string, unknown>);
    exclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);

  // db 생성자(createdByMemberId = Cognito sub)별 caller 캐시.
  const callerCache = new Map<string, Member | null>();
  const resolveCaller = async (sub: string): Promise<Member | null> => {
    if (callerCache.has(sub)) return callerCache.get(sub) ?? null;
    try {
      const m = await getCallerMember(doc, tables.Members!, sub);
      callerCache.set(sub, m);
      return m;
    } catch {
      callerCache.set(sub, null);
      return null;
    }
  };

  let created = 0;

  for (const db of databases) {
    if (db.deletedAt) continue;
    const templates = parseJson<DatabaseTemplate[]>(db.templates, []);
    if (!Array.isArray(templates) || templates.length === 0) continue;

    const due = templates.filter((t) => isAutomationDue(t.automation, weekday, minutes, dateKey));
    if (due.length === 0) continue;

    const databaseId = String(db.id);
    const workspaceId = String(db.workspaceId);
    const createdByMemberId = String(db.createdByMemberId ?? "");
    const caller = createdByMemberId ? await resolveCaller(createdByMemberId) : null;
    if (!caller) {
      console.warn("[templateAutomation] caller 미해결 — skip", { databaseId });
      continue;
    }
    const columns = parseJson<ColumnLike[]>(db.columns, []);
    const dateCol = columns.find((c) => c.type === "date");
    const personCol = columns.find((c) => c.type === "person");

    let templatesChanged = false;

    for (const tmpl of due) {
      const auto = tmpl.automation!;
      // 템플릿 페이지의 셀·본문을 기준으로 새 행 구성.
      let templatePage: Record<string, unknown> | undefined;
      if (tmpl.pageId) {
        const res = await doc.send(
          new GetCommand({ TableName: tables.Pages!, Key: { id: tmpl.pageId } }),
        );
        templatePage = res.Item as Record<string, unknown> | undefined;
      }
      const rawCells = parseJson<Record<string, unknown>>(
        templatePage?.dbCells,
        (tmpl.cells as Record<string, unknown>) ?? {},
      );
      const cells: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rawCells)) {
        if (k !== "_qn_isTemplate") cells[k] = v;
      }
      // 날짜 컬럼이 있으면 생성 날짜 기록(없으면 기록하지 않음).
      if (dateCol) cells[dateCol.id] = { start: `${dateKey}T00:00:00` };
      // 참여자 등록 시 person 컬럼을 덮어쓴다(템플릿 값보다 우선).
      if (personCol && Array.isArray(auto.participantMemberIds) && auto.participantMemberIds.length > 0) {
        cells[personCol.id] = [...auto.participantMemberIds];
      }
      const docBody = parseJson<Record<string, unknown>>(templatePage?.doc, {});
      const prefix = (auto.titlePrefix ?? "").trim();
      const title = prefix ? `${prefix} ${titleDate}` : titleDate;

      try {
        await upsertPage({
          doc,
          tables,
          caller,
          input: {
            id: randomUUID(),
            workspaceId,
            createdByMemberId,
            title,
            order: String(Date.now()),
            databaseId,
            doc: JSON.stringify(docBody),
            dbCells: JSON.stringify(cells),
            createdAt: iso,
            updatedAt: iso,
          },
        });
        created += 1;
        auto.lastRunDate = dateKey;
        templatesChanged = true;
      } catch (err) {
        console.error("[templateAutomation] 행 생성 실패(무시)", { databaseId, templateId: tmpl.id, err });
      }
    }

    // lastRunDate 갱신을 Database 레코드에 반영(중복 방지 권위값).
    if (templatesChanged) {
      try {
        await upsertDatabase({
          doc,
          tables,
          caller,
          input: {
            id: databaseId,
            workspaceId,
            // updatedAt 을 현재로 갱신해 LWW 상 최신 쓰기로 인식 → 클라이언트도 lastRunDate 수신.
            updatedAt: new Date().toISOString(),
            templates: JSON.stringify(templates),
          },
        });
      } catch (err) {
        console.error("[templateAutomation] lastRunDate 기록 실패", { databaseId, err });
      }
    }
  }

  return { created };
}
