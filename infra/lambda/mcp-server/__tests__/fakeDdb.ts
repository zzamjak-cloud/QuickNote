// 테스트용 in-memory DynamoDBDocumentClient — 명령 이름·입력만 보고 단순 해석한다.
// 키 조건/필터는 "attr = :v" 등식만 지원(이 모듈들이 쓰는 형태로 충분).
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export type Item = Record<string, unknown>;
type Cmd = { constructor: { name: string }; input: Item };

const EQ_RE = /(\w+)\s*=\s*(:\w+)/g;

function equalities(expr: unknown, values: Item): [string, unknown][] {
  if (typeof expr !== "string") return [];
  // 괄호 그룹(OR·함수 조건)은 무시하고 최상위 AND 등식만 본다.
  let flat = expr;
  while (/\([^()]*\)/.test(flat)) flat = flat.replace(/\([^()]*\)/g, "");
  return [...flat.matchAll(EQ_RE)].map((m) => [m[1], values[m[2]]]);
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
        rows(String(input.TableName)).push({ ...(input.Item as Item) });
        return {};
      case "UpdateCommand":
        return update(input);
      default:
        throw new Error(`fake ddb: 미지원 명령 ${cmd.constructor.name}`);
    }
  }

  function query(input: Item): Item {
    const values = (input.ExpressionAttributeValues ?? {}) as Item;
    const conds = [
      ...equalities(input.KeyConditionExpression, values),
      ...equalities(input.FilterExpression, values),
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
    const expr = String(input.UpdateExpression);
    if (expr.startsWith("ADD cnt")) {
      const id = `${table}|${JSON.stringify(key)}`;
      const cnt = (counters.get(id) ?? 0) + 1;
      counters.set(id, cnt);
      return { Attributes: { ...key, cnt } };
    }
    const item = rows(table).find((it) => matchesKey(it, key));
    const condFails = equalities(input.ConditionExpression, values).some(([k, v]) => item?.[k] !== v);
    if (!item || condFails) throw Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" });
    for (const [attr, value] of equalities(expr, values)) item[attr] = value;
    return { Attributes: { ...item } };
  }

  return { doc: { send } as unknown as DynamoDBDocumentClient, calls, tables };
}
