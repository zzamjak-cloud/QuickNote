import { debouncePerKey } from "./debouncePerKey";
import { enqueueAsync, getSyncEngine } from "./runtime";
import { realGqlBridge } from "./graphql/bridge";
import { useMemberStore } from "../../store/memberStore";
import { useSettingsStore } from "../../store/settingsStore";

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
  if (!parsed) return;
  useSettingsStore.setState((s) => {
    const remoteNewer = parsed.favoritePageIdsUpdatedAt > s.favoritePageIdsUpdatedAt;
    const sameTs =
      parsed.favoritePageIdsUpdatedAt === s.favoritePageIdsUpdatedAt;
    const listsMatch = favoritePageIdsSequenceEqual(
      parsed.favoritePageIds,
      s.favoritePageIds,
    );

    if (!remoteNewer) {
      if (sameTs && listsMatch) return s;
      if (sameTs && !listsMatch) {
        return {
          favoritePageIds: [...parsed.favoritePageIds],
          favoritePageIdsUpdatedAt: parsed.favoritePageIdsUpdatedAt,
        };
      }
      return s;
    }

    return {
      favoritePageIds: [...parsed.favoritePageIds],
      favoritePageIdsUpdatedAt: parsed.favoritePageIdsUpdatedAt,
    };
  });
}

const DEBOUNCE_MS = 600;

/** 직접 GraphQL mutation — upsertPage 등 outbox 앞줄에 막혀 즐겨찾기가 영원히 안 나가는 문제 방지. */
async function pushClientPrefsToServer(): Promise<void> {
  const memberId = useMemberStore.getState().me?.memberId;
  if (!memberId) return;

  const { favoritePageIds, favoritePageIdsUpdatedAt } =
    useSettingsStore.getState();
  const payload: ClientPrefsV1 = {
    v: CLIENT_PREFS_SCHEMA_V,
    favoritePageIds: [...favoritePageIds],
    favoritePageIdsUpdatedAt,
  };
  const json = JSON.stringify(payload);

  try {
    await realGqlBridge.updateMyClientPrefs(json);
  } catch (err) {
    const msg =
      err instanceof Error
        ? err.message
        : (() => {
            const o = err as { errors?: { message?: string }[] };
            const gql = Array.isArray(o.errors)
              ? o.errors.map((e) => e.message).join("; ")
              : "";
            return gql || String(err);
          })();
    console.error("[sync] updateMyClientPrefs 직접 전송 실패, outbox 로 재시도", msg, err);
    enqueueAsync("updateMyClientPrefs", {
      id: memberId,
      clientPrefs: json,
    });
    const engine = await getSyncEngine();
    await engine.flush();
  }
}

/** 즐겨찾기 변경 후 호출 → 서버 저장(디바운스), 실패 시 outbox. */
export function scheduleEnqueueClientPrefs(): void {
  debouncePerKey("favoriteClientPrefsSync", DEBOUNCE_MS, () => {
    void pushClientPrefsToServer();
  });
}

/** memberId 확정 직후(Bootstrap): 즉시 서버 반영(await). */
export async function flushClientPrefsToServerNow(): Promise<void> {
  await pushClientPrefsToServer();
}
