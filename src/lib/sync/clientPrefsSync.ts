import { debouncePerKey } from "./debouncePerKey";
import { enqueueAsync, getSyncEngine } from "./runtime";
import { realGqlBridge } from "./graphql/bridge";
import { useMemberStore } from "../../store/memberStore";
import { useSettingsStore } from "../../store/settingsStore";

/** 콘솔 필터용 — DevTools 에서 "[QN clientPrefs]" 로 검색 */
const LOG = "[QN clientPrefs]";

function previewRawPrefs(raw: unknown): string {
  if (raw == null) return String(raw);
  if (typeof raw === "string") return raw.length > 160 ? `${raw.slice(0, 160)}…` : raw;
  try {
    const s = JSON.stringify(raw);
    return s.length > 160 ? `${s.slice(0, 160)}…` : s;
  } catch {
    return "[unserializable]";
  }
}

/** GraphQL/AppSync 에러 객체를 문자열로 */
function formatSyncErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  const o = err as { errors?: { message?: string }[]; message?: string };
  const gql = Array.isArray(o.errors) ? o.errors.map((e) => e.message).join("; ") : "";
  return gql || o.message || String(err);
}

/** clientPrefs 페이로드 버전(AppSync 저장 JSON). */
export const CLIENT_PREFS_SCHEMA_V = 1 as const;

export type ClientPrefsV1 = {
  v: typeof CLIENT_PREFS_SCHEMA_V;
  favoritePageIds: string[];
  favoritePageIdsUpdatedAt: number;
};

/** GraphQL/AWSJSON 또는 로컬에서 온 문자열→객체 디코드. */
export function decodeClientPrefsField(raw: unknown): ClientPrefsV1 | null {
  if (raw == null || raw === "") return null;
  try {
    // AppSync AWSJSON 이 객체가 아니라 "JSON 문자열을 또 문자열로 인코딩한 값"으로 올 때가 있음.
    // 한 번 parse 한 결과가 여전히 string 이면 한 겹 더 벗긴다(상한 5회).
    let cur: unknown = raw;
    for (let depth = 0; depth < 5; depth++) {
      if (typeof cur === "string") {
        const t = cur.trim();
        if (t === "") return null;
        cur = JSON.parse(t) as unknown;
      } else {
        break;
      }
    }
    const o = cur as Record<string, unknown>;
    if (typeof o !== "object" || o === null || Array.isArray(o)) return null;
    if (Number(o.v) !== CLIENT_PREFS_SCHEMA_V) return null;
    if (!Array.isArray(o.favoritePageIds)) return null;
    const ts = Number(o.favoritePageIdsUpdatedAt);
    if (!Number.isFinite(ts)) return null;
    return {
      v: CLIENT_PREFS_SCHEMA_V,
      favoritePageIds: o.favoritePageIds.map(String),
      favoritePageIdsUpdatedAt: ts,
    };
  } catch {
    return null;
  }
}

/** 순서 포함 동일 여부(즐겨찾기 DnD 순서 보존). */
function favoritePageIdsSequenceEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** me 등에서 받은 원격 prefs 를 로컬 설정에 반영. 더 새 타임스탬프만 적용한다. */
export function applyRemoteClientPrefs(raw: unknown): void {
  const parsed = decodeClientPrefsField(raw);
  if (!parsed) {
    console.info(`${LOG} applyRemote: 원격 필드 디코드 불가·스킵`, {
      rawType: raw === null || raw === undefined ? String(raw) : typeof raw,
      preview: previewRawPrefs(raw),
    });
    return;
  }
  useSettingsStore.setState((s) => {
    const remoteNewer = parsed.favoritePageIdsUpdatedAt > s.favoritePageIdsUpdatedAt;
    const sameTs =
      parsed.favoritePageIdsUpdatedAt === s.favoritePageIdsUpdatedAt;
    const listsMatch = favoritePageIdsSequenceEqual(
      parsed.favoritePageIds,
      s.favoritePageIds,
    );

    if (!remoteNewer) {
      // ts 가 같고 목록도 같으면 이미 수렴 — 스킵
      if (sameTs && listsMatch) {
        console.info(`${LOG} applyRemote: 변경 없음 (원격·로컬 동일 ts·동일 목록)`, {
          ts: parsed.favoritePageIdsUpdatedAt,
          count: parsed.favoritePageIds.length,
        });
        return s;
      }
      // ts 가 같고 목록만 다름 — LWW 동률이면 서버 스냅샷으로 수렴
      if (sameTs && !listsMatch) {
        console.info(`${LOG} applyRemote: 동일 ts·목록 불일치 → 서버 목록으로 덮어씀`, {
          ts: parsed.favoritePageIdsUpdatedAt,
          remoteCount: parsed.favoritePageIds.length,
          localCount: s.favoritePageIds.length,
        });
        return {
          favoritePageIds: [...parsed.favoritePageIds],
          favoritePageIdsUpdatedAt: parsed.favoritePageIdsUpdatedAt,
        };
      }
      // 원격이 더 오래됨
      console.info(`${LOG} applyRemote: 로컬 유지 (로컬 ts 가 더 최신)`, {
        remoteTs: parsed.favoritePageIdsUpdatedAt,
        localTs: s.favoritePageIdsUpdatedAt,
        remoteCount: parsed.favoritePageIds.length,
        localCount: s.favoritePageIds.length,
      });
      return s;
    }

    console.info(`${LOG} applyRemote: 원격 즐겨찾기 적용`, {
      remoteTs: parsed.favoritePageIdsUpdatedAt,
      prevLocalTs: s.favoritePageIdsUpdatedAt,
      remoteCount: parsed.favoritePageIds.length,
      prevLocalCount: s.favoritePageIds.length,
    });
    return {
      favoritePageIds: [...parsed.favoritePageIds],
      favoritePageIdsUpdatedAt: parsed.favoritePageIdsUpdatedAt,
    };
  });
}

const DEBOUNCE_MS = 600;

type PushSource = "bootstrap" | "debounced";

/** 직접 GraphQL mutation — upsertPage 등 outbox 앞줄에 막혀 즐겨찾기가 영원히 안 나가는 문제 방지. */
async function pushClientPrefsToServer(source: PushSource): Promise<void> {
  const memberId = useMemberStore.getState().me?.memberId;
  if (!memberId) {
    console.warn(`${LOG} push 건너뜀: member(me) 없음 — setMe 이전에 호출됐을 수 있음`, {
      source,
    });
    return;
  }

  const { favoritePageIds, favoritePageIdsUpdatedAt } =
    useSettingsStore.getState();
  const payload: ClientPrefsV1 = {
    v: CLIENT_PREFS_SCHEMA_V,
    favoritePageIds: [...favoritePageIds],
    favoritePageIdsUpdatedAt,
  };
  const json = JSON.stringify(payload);

  console.warn(`${LOG} push 시작`, {
    source,
    memberIdSuffix: memberId.length > 10 ? `…${memberId.slice(-8)}` : memberId,
    favoriteCount: favoritePageIds.length,
    favoritePageIdsUpdatedAt,
    jsonBytes: json.length,
  });

  try {
    await realGqlBridge.updateMyClientPrefs(json);
    console.warn(`${LOG} push 성공 (직접 GraphQL)`, {
      source,
      favoriteCount: favoritePageIds.length,
      favoritePageIdsUpdatedAt,
    });
  } catch (err) {
    console.error(`${LOG} push 실패 (직접 GraphQL) → outbox 폴백`, {
      source,
      message: formatSyncErr(err),
      err,
    });
    enqueueAsync("updateMyClientPrefs", {
      id: memberId,
      clientPrefs: json,
    });
    const engine = await getSyncEngine();
    await engine.flush();
    console.info(`${LOG} outbox flush 호출 완료 (폴백 경로)`, { source });
  }
}

/** 즐겨찾기 변경 후 호출 → 서버 저장(디바운스), 실패 시 outbox. */
export function scheduleEnqueueClientPrefs(): void {
  // 웹에서 콘솔 기본 필터가 Info 를 숨기는 경우가 있어 warn 사용
  console.warn(`${LOG} scheduleEnqueueClientPrefs (${DEBOUNCE_MS}ms 디바운스 시작)`);
  debouncePerKey("favoriteClientPrefsSync", DEBOUNCE_MS, () => {
    console.warn(`${LOG} 디바운스 만료 → push 실행`);
    void pushClientPrefsToServer("debounced");
  });
}

/** memberId 확정 직후(Bootstrap): 즉시 서버 반영(await). */
export async function flushClientPrefsToServerNow(): Promise<void> {
  console.warn(`${LOG} flushClientPrefsToServerNow (bootstrap 경로)`);
  await pushClientPrefsToServer("bootstrap");
}
