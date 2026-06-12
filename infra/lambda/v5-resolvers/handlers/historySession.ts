/**
 * 버전 히스토리 세션 머지 + 의미 변화 판정 유틸.
 *
 * - 세션: 같은 페이지/DB 에 대한 연속 편집을 하나의 버전 엔트리로 머지한다.
 *   경계 = idle 10분 또는 세션 최대 20분(Google Docs/Notion 류 활동 기반 체크포인트 캐던스).
 *   다음 upsert 가 자연히 새 세션을 연다(스케줄러 불필요).
 * - 의미 변화: 빈 블럭 추가/삭제, 동일 내용 블럭의 위치 이동(밀림), order/blockComments/updatedAt
 *   변화는 버전을 만들지 않는다. 블럭 매칭은 TipTap uniqueId(attrs.id) 기준.
 * - changedUnits: UI 가 재계산 없이 변경 단위를 조회하는 키 목록.
 *   페이지: "block:<id>" | "cell:<columnId>" | "meta:title|titleColor|icon|coverImage|parent"
 *   DB:     "column:<id>" | "preset:<id>" | "templates" | "meta:title"
 */

export const SESSION_IDLE_MS = 10 * 60 * 1000;
export const SESSION_MAX_MS = 20 * 60 * 1000;
/** 머지 누적 patch 가 이 개수를 넘으면 전체 스냅샷 set 1개로 강등(레거시 워커 호환 유지). */
export const SESSION_PATCH_COMPACT_LIMIT = 200;
const CONTRIBUTORS_MAX = 20;

export type SessionPatchOp = {
  op: "set" | "unset";
  path: Array<string | number>;
  value?: unknown;
};

export type Contributor = { memberId: string; name?: string | null };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseJsonLike(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** 키 순서 무관 직렬화 — DynamoDB 왕복/입력 경로에 따라 키 순서가 달라도 동일 시그니처. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function hashString(input: string): string {
  // djb2 — 식별용 짧은 해시(암호학적 강도 불필요)
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function hasMeaningfulNode(node: unknown): boolean {
  if (!isPlainObject(node)) return false;
  if (node.type === "text") {
    return typeof node.text === "string" && node.text.length > 0;
  }
  if (node.type !== "paragraph") return true;
  const content = node.content;
  return Array.isArray(content) && content.some(hasMeaningfulNode);
}

/** 빈 블럭(내용 없는 문단) 판정 — 이 블럭의 추가/삭제는 버전 사유가 아니다. */
export function isEmptyBlockNode(node: unknown): boolean {
  if (!isPlainObject(node)) return true;
  if (node.type !== "paragraph") return false;
  return !hasMeaningfulNode(node);
}

type BlockEntry = { sig: string; empty: boolean };

/** 블럭 시그니처: 타입 + (id 제외) attrs + content. 위치(index)는 포함하지 않는다 → 이동은 무변화. */
function blockSignature(node: Record<string, unknown>): string {
  const attrs = isPlainObject(node.attrs) ? { ...node.attrs } : {};
  delete (attrs as Record<string, unknown>).id;
  return stableStringify({ type: node.type, attrs, content: node.content ?? null });
}

/** doc 최상위 블럭들을 identity(attrs.id, 없으면 sig 해시) → {sig, empty} 맵으로 수집. */
export function collectBlockEntries(docValue: unknown): Map<string, BlockEntry> {
  const out = new Map<string, BlockEntry>();
  const doc = parseJsonLike(docValue);
  if (!isPlainObject(doc) || !Array.isArray(doc.content)) return out;
  for (const node of doc.content) {
    if (!isPlainObject(node)) continue;
    const sig = blockSignature(node);
    const attrs = node.attrs;
    const id =
      isPlainObject(attrs) && typeof attrs.id === "string" && attrs.id
        ? attrs.id
        : `sig-${hashString(sig)}`;
    out.set(id, { sig, empty: isEmptyBlockNode(node) });
  }
  return out;
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a ?? null) === stableStringify(b ?? null);
}

function diffDocUnits(beforeDoc: unknown, afterDoc: unknown, out: Set<string>): void {
  const before = collectBlockEntries(beforeDoc);
  const after = collectBlockEntries(afterDoc);
  for (const [id, entry] of after) {
    const prev = before.get(id);
    if (!prev) {
      // 신규 블럭 — 빈 블럭 생성은 버전 사유가 아니다.
      if (!entry.empty) out.add(`block:${id}`);
      continue;
    }
    if (prev.sig !== entry.sig) out.add(`block:${id}`);
  }
  for (const [id, entry] of before) {
    if (after.has(id)) continue;
    // 삭제 블럭 — 빈 블럭 삭제는 버전 사유가 아니다.
    if (!entry.empty) out.add(`block:${id}`);
  }
}

function diffRecordUnits(
  beforeValue: unknown,
  afterValue: unknown,
  prefix: string,
  out: Set<string>,
): void {
  const before = isPlainObject(parseJsonLike(beforeValue))
    ? (parseJsonLike(beforeValue) as Record<string, unknown>)
    : {};
  const after = isPlainObject(parseJsonLike(afterValue))
    ? (parseJsonLike(afterValue) as Record<string, unknown>)
    : {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (!jsonEqual(before[key], after[key])) out.add(`${prefix}:${key}`);
  }
}

/** id 보유 객체 배열을 id 단위로 비교. id 없는 요소가 섞이면 통째 비교로 폴백. */
function diffIdArrayUnits(
  beforeValue: unknown,
  afterValue: unknown,
  prefix: string,
  fallbackUnit: string,
  out: Set<string>,
): void {
  const before = parseJsonLike(beforeValue);
  const after = parseJsonLike(afterValue);
  const toMap = (value: unknown): Map<string, unknown> | null => {
    if (!Array.isArray(value)) return value == null ? new Map() : null;
    const map = new Map<string, unknown>();
    for (const item of value) {
      if (!isPlainObject(item) || typeof item.id !== "string" || !item.id) return null;
      map.set(item.id, item);
    }
    return map;
  };
  const beforeMap = toMap(before);
  const afterMap = toMap(after);
  if (!beforeMap || !afterMap) {
    if (!jsonEqual(before, after)) out.add(fallbackUnit);
    return;
  }
  const keys = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  for (const key of keys) {
    if (!jsonEqual(beforeMap.get(key), afterMap.get(key))) out.add(`${prefix}:${key}`);
  }
}

const PAGE_META_UNIT_FIELDS: Array<[field: string, unit: string]> = [
  ["title", "meta:title"],
  ["titleColor", "meta:titleColor"],
  ["icon", "meta:icon"],
  ["coverImage", "meta:coverImage"],
  ["parentId", "meta:parent"],
];

/**
 * 페이지 의미 변화 단위. 빈 배열이면 버전을 만들지 않는다.
 * order(형제 재배열 밀림)·blockComments(읽음 시각)·updatedAt 은 무시한다.
 */
export function diffMeaningfulPageUnits(
  beforeSnap: Record<string, unknown> | null,
  afterSnap: Record<string, unknown>,
): string[] {
  const out = new Set<string>();
  const before = beforeSnap ?? {};
  for (const [field, unit] of PAGE_META_UNIT_FIELDS) {
    if (!jsonEqual(before[field], afterSnap[field])) out.add(unit);
  }
  diffRecordUnits(before["dbCells"], afterSnap["dbCells"], "cell", out);
  diffDocUnits(before["doc"], afterSnap["doc"], out);
  return [...out].sort();
}

/**
 * DB 의미 변화 단위. panelState(뷰 UI 휘발 상태)·updatedAt·deletedAt 은 무시한다.
 */
export function diffMeaningfulDatabaseUnits(
  beforeSnap: Record<string, unknown> | null,
  afterSnap: Record<string, unknown>,
): string[] {
  const out = new Set<string>();
  const before = beforeSnap ?? {};
  if (!jsonEqual(before["title"], afterSnap["title"])) out.add("meta:title");
  diffIdArrayUnits(before["columns"], afterSnap["columns"], "column", "columns", out);
  diffIdArrayUnits(before["presets"], afterSnap["presets"], "preset", "presets", out);
  if (!jsonEqual(before["templates"], afterSnap["templates"])) out.add("templates");
  return [...out].sort();
}

/**
 * patch 합성은 순차 적용이므로 단순 연결로 성립한다. 뒤 op 의 path 가
 * 앞 op path 와 같거나 그 prefix 면 앞 op 는 덮이므로 제거해 누적 비대화를 막는다.
 */
export function compactPatchOps(ops: SessionPatchOp[]): SessionPatchOp[] {
  const out: SessionPatchOp[] = [];
  for (let i = 0; i < ops.length; i += 1) {
    const cur = ops[i]!;
    let overridden = false;
    for (let j = i + 1; j < ops.length; j += 1) {
      const later = ops[j]!.path;
      if (later.length <= cur.path.length && later.every((seg, k) => seg === cur.path[k])) {
        overridden = true;
        break;
      }
    }
    if (!overridden) out.push(cur);
  }
  return out;
}

/** 세션 중 편집에 참여한 멤버 누적(중복 제거, 최근 이름으로 갱신, 상한 유지). */
export function mergeContributors(
  existing: unknown,
  caller: Contributor,
): Contributor[] {
  const list: Contributor[] = [];
  const raw = parseJsonLike(existing);
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (isPlainObject(item) && typeof item.memberId === "string" && item.memberId) {
        list.push({ memberId: item.memberId, name: typeof item.name === "string" ? item.name : null });
      }
    }
  }
  const without = list.filter((c) => c.memberId !== caller.memberId);
  const next = [...without, { memberId: caller.memberId, name: caller.name ?? null }];
  return next.slice(-CONTRIBUTORS_MAX);
}

/** 최신 엔트리가 열린 세션이고 idle/max 경계 안이면 머지 대상. */
export function canMergeIntoSession(args: {
  latest: Record<string, unknown> | null;
  sessionKind: string;
  workspaceId: string;
  now: number;
}): boolean {
  const latest = args.latest;
  if (!latest) return false;
  if (latest.kind !== args.sessionKind) return false;
  if (latest.workspaceId !== args.workspaceId) return false;
  const started = Date.parse(typeof latest.sessionStartedAt === "string" ? latest.sessionStartedAt : "");
  const lastActive = Date.parse(typeof latest.lastActivityAt === "string" ? latest.lastActivityAt : "");
  if (!Number.isFinite(started) || !Number.isFinite(lastActive)) return false;
  if (args.now - lastActive >= SESSION_IDLE_MS) return false;
  if (args.now - started >= SESSION_MAX_MS) return false;
  return true;
}
