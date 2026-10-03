// 테스트용 in-memory DynamoDBDocumentClient — 명령 이름·입력만 보고 단순 해석한다.
// 키 조건/필터는 "attr = :v" 등식만 지원(이 모듈들이 쓰는 형태로 충분).
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export type Item = Record<string, unknown>;
type Cmd = { constructor: { name: string }; input: Item };

const EQ_RE = /(#?\w+)\s*=\s*(:\w+)/g;

// 테이블별 기본키(Put 시 같은 키 항목을 교체). 미지정 테이블은 id 가 있으면 id 를 키로 본다.
const KEY_FIELDS: Record<string, string[]> = {
  "page-history": ["pageId", "historyId"],
  "database-history": ["databaseId", "historyId"],
  members: ["memberId"],
  "mcp-tokens": ["tokenHash"],
  "workspace-access": ["workspaceId", "subjectKey"],
};

function equalities(expr: unknown, values: Item, names: Record<string, string> = {}): [string, unknown][] {
  if (typeof expr !== "string") return [];
  // 괄호 그룹(OR·함수 조건)은 무시하고 최상위 AND 등식만 본다.
  let flat = expr;
  while (/\([^()]*\)/.test(flat)) flat = flat.replace(/\([^()]*\)/g, "");
  return [...flat.matchAll(EQ_RE)].map((m) => [names[m[1]] ?? m[1].replace(/^#/, ""), values[m[2]]]);
}

function keyOf(table: string, item: Item): Item | null {
  const fields = KEY_FIELDS[table] ?? ("id" in item ? ["id"] : null);
  return fields ? Object.fromEntries(fields.map((f) => [f, item[f]])) : null;
}

function matchesKey(item: Item, key: Item): boolean {
  return Object.entries(key).every(([k, v]) => item[k] === v);
}

export function createFakeDdb(tables: Record<string, Item[]>) {
  const calls: Cmd[] = [];
  const counters = new Map<string, number>();
  const rows = (name: string): Item[] => (tables[name] ??= []);

  async function send(cmd: Cmd): Promise<Item> {
    calls.push(cmd);
    const input = cmd.input;
    switch (cmd.constructor.name) {
      case "GetCommand": {
        const item = rows(String(input.TableName)).find((it) => matchesKey(it, input.Key as Item));
        return { Item: item ? { ...item } : undefined };
      }
      case "BatchGetCommand": {
        const responses: Record<string, Item[]> = {};
        for (const [table, req] of Object.entries(input.RequestItems as Record<string, { Keys: Item[] }>)) {
          responses[table] = req.Keys.flatMap((k) => rows(table).filter((it) => matchesKey(it, k)));
        }
        return { Responses: responses, UnprocessedKeys: {} };
      }
      case "QueryCommand":
        return query(input);
      case "ScanCommand":
        return { Items: rows(String(input.TableName)).map((it) => ({ ...it })) };
      case "PutCommand":
        return put(String(input.TableName), input.Item as Item, input);
      case "DeleteCommand":
        tables[String(input.TableName)] = rows(String(input.TableName)).filter((it) => !matchesKey(it, input.Key as Item));
        return {};
      case "BatchWriteCommand":
        for (const [table, reqs] of Object.entries(input.RequestItems as Record<string, Item[]>)) {
          for (const r of reqs) {
            const del = r.DeleteRequest as { Key: Item } | undefined;
            if (del) tables[table] = rows(table).filter((it) => !matchesKey(it, del.Key));
            const putReq = r.PutRequest as { Item: Item } | undefined;
            if (putReq) put(table, putReq.Item);
          }
        }
        return { UnprocessedItems: {} };
      case "UpdateCommand":
        return update(input);
      default:
        throw new Error(`fake ddb: 미지원 명령 ${cmd.constructor.name}`);
    }
  }

  function put(table: string, item: Item, input?: Item): Item {
    const key = keyOf(table, item);
    const existing = key ? rows(table).find((it) => matchesKey(it, key)) : undefined;
    const values = (input?.ExpressionAttributeValues ?? {}) as Item;
    // 조건은 기존 항목이 있을 때만 최상위 등식(예: updatedAt = :eu)을 검사한다.
    if (existing && equalities(input?.ConditionExpression, values).some(([k, v]) => existing[k] !== v)) {
      throw Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });
    }
    if (key) tables[table] = rows(table).filter((it) => !matchesKey(it, key));
    rows(table).push({ ...item });
    return {};
  }

  function query(input: Item): Item {
    const values = (input.ExpressionAttributeValues ?? {}) as Item;
    const names = (input.ExpressionAttributeNames ?? {}) as Record<string, string>;
    const conds = [
      ...equalities(input.KeyConditionExpression, values, names),
      ...equalities(input.FilterExpression, values, names),
    ];
    let items = rows(String(input.TableName)).filter((it) => conds.every(([k, v]) => it[k] === v));
    if (input.ScanIndexForward === false) {
      items = [...items].sort((a, b) => String(b.updatedAt ?? b.createdAt ?? "").localeCompare(String(a.updatedAt ?? a.createdAt ?? "")));
    }
    const start = Number((input.ExclusiveStartKey as Item | undefined)?.__offset ?? 0);
    const limit = typeof input.Limit === "number" ? input.Limit : items.length;
    const page = items.slice(start, start + limit);
    const next = start + limit < items.length ? { __offset: start + limit } : undefined;
    return { Items: page.map((it) => ({ ...it })), ScannedCount: page.length, LastEvaluatedKey: next };
  }

  function update(input: Item): Item {
    const table = String(input.TableName);
    const key = input.Key as Item;
    const values = (input.ExpressionAttributeValues ?? {}) as Item;
    const names = (input.ExpressionAttributeNames ?? {}) as Record<string, string>;
    const expr = String(input.UpdateExpression).replace(/\sREMOVE\s.*$/, "");
    if (expr.startsWith("ADD cnt")) {
      const id = `${table}|${JSON.stringify(key)}`;
      const amount = Number(values[/ADD cnt (:\w+)/.exec(expr)?.[1] ?? ""] ?? 1);
      const cnt = (counters.get(id) ?? 0) + amount;
      counters.set(id, cnt);
      return { Attributes: { ...key, cnt } };
    }
    const item = rows(table).find((it) => matchesKey(it, key));
    const condFails = equalities(input.ConditionExpression, values, names).some(([k, v]) => item?.[k] !== v);
    if (!item || condFails) throw Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });
    for (const [attr, value] of equalities(expr, values, names)) item[attr] = value;
    return { Attributes: { ...item } };
  }

  return { doc: { send } as unknown as DynamoDBDocumentClient, calls, tables };
}
