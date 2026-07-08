import { debouncePerKey } from "./debouncePerKey";
import { enqueueAsync, getSyncEngine } from "./runtime";
import { realGqlBridge } from "./graphql/bridge";
import { useMemberStore } from "../../store/memberStore";
import { useSettingsStore } from "../../store/settingsStore";
import type { FavoritePageMeta, SettingsStore } from "../../store/settingsStore";
import { useWorkspaceStore } from "../../store/workspaceStore";

/** clientPrefs 페이로드 버전(AppSync 저장 JSON). */
export const CLIENT_PREFS_SCHEMA_V = 1 as const;

export type ClientPrefsV1 = {
  v: 1 | 2;
  favoritePageIds: string[];
  favoritePageIdsUpdatedAt: number;
  favoritePageMetaById?: Record<string, FavoritePageMeta>;
  fullWidth?: boolean;
  pageFullWidthById?: Record<string, boolean>;
  fullWidthUpdatedAt?: number;
};

function sanitizeFavoritePageMetaById(
  raw: unknown,
  favoritePageIds: readonly string[],
): Record<string, FavoritePageMeta> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const ids = new Set(favoritePageIds);
  const result: Record<string, FavoritePageMeta> = {};
  for (const [pageId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!ids.has(pageId) || !value || typeof value !== "object" || Array.isArray(value)) continue;
    const meta = value as Record<string, unknown>;
    result[pageId] = {
      pageId,
      workspaceId:
        typeof meta.workspaceId === "string"
          ? meta.workspaceId
          : meta.workspaceId === null
            ? null
            : null,
      workspaceName: typeof meta.workspaceName === "string" ? meta.workspaceName : "",
      pageTitle: typeof meta.pageTitle === "string" ? meta.pageTitle : "제목 없음",
      pageIcon: typeof meta.pageIcon === "string" ? meta.pageIcon : null,
    };
  }
  return result;
}

function sanitizeBooleanRecord(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key === "string" && typeof value === "boolean") {
      result[key] = value;
    }
  }
  return result;
}

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
    const version = Number(o.v);
    if (version !== 1 && version !== 2) return null;
    if (!Array.isArray(o.favoritePageIds)) return null;
    const ts = Number(o.favoritePageIdsUpdatedAt);
    if (!Number.isFinite(ts)) return null;
    const fullWidthUpdatedAt = Number(o.fullWidthUpdatedAt);
    const favoritePageIds = o.favoritePageIds.map(String);
    return {
      v: version === 2 ? 2 : 1,
      favoritePageIds,
      favoritePageIdsUpdatedAt: ts,
      favoritePageMetaById: sanitizeFavoritePageMetaById(
        o.favoritePageMetaById,
        favoritePageIds,
      ),
      fullWidth: typeof o.fullWidth === "boolean" ? o.fullWidth : undefined,
      pageFullWidthById: sanitizeBooleanRecord(o.pageFullWidthById),
      fullWidthUpdatedAt: Number.isFinite(fullWidthUpdatedAt) ? fullWidthUpdatedAt : 0,
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

  // settings persist 복원 전에는 favoritePageIdsUpdatedAt 이 0으로 남아
  // 원격 타임스탬프가 더 크다고 판단되어 즐겨찾기가 통째로 지워질 수 있음 → 복원 후 재적용
  if (!useSettingsStore.persist.hasHydrated()) {
    void ensureSettingsPersistHydrated().then(() => {
      applyRemoteClientPrefs(raw);
    });
    return;
  }

  useSettingsStore.setState((s) => {
    const next: Partial<SettingsStore> = {};
    const remoteNewer = parsed.favoritePageIdsUpdatedAt > s.favoritePageIdsUpdatedAt;
    const sameTs =
      parsed.favoritePageIdsUpdatedAt === s.favoritePageIdsUpdatedAt;
    const listsMatch = favoritePageIdsSequenceEqual(
      parsed.favoritePageIds,
      s.favoritePageIds,
    );

    const remoteMeta = parsed.favoritePageMetaById ?? {};
    const remoteFullWidthNewer =
      (parsed.fullWidthUpdatedAt ?? 0) > s.fullWidthUpdatedAt;

    if (remoteFullWidthNewer) {
      if (typeof parsed.fullWidth === "boolean") next.fullWidth = parsed.fullWidth;
      // 통째 교체 금지 — 페이지별 전체너비 맵은 단일 타임스탬프 LWW 라서, 다른 기기가
      // 다른 페이지를 토글한 항목이 원격 맵에 없을 수 있다. union 병합(충돌 시 최신=원격 우선)
      // 으로 로컬에만 있는 항목을 보존한다. (전체너비가 다시 좁아지는 유실 버그 방지)
      next.pageFullWidthById = {
        ...s.pageFullWidthById,
        ...(parsed.pageFullWidthById ?? {}),
      };
      next.fullWidthUpdatedAt = parsed.fullWidthUpdatedAt ?? 0;
    } else if (parsed.pageFullWidthById) {
      // 원격이 더 오래됐어도 로컬에 없는 페이지 항목은 받아들인다(기존 로컬 값 우선).
      const union = { ...parsed.pageFullWidthById, ...s.pageFullWidthById };
      if (
        Object.keys(union).length !== Object.keys(s.pageFullWidthById).length
      ) {
        next.pageFullWidthById = union;
      }
    }

    if (!remoteNewer) {
      if (sameTs && listsMatch) {
        const favoritePageMetaById = { ...s.favoritePageMetaById };
        let changed = false;
        for (const pageId of parsed.favoritePageIds) {
          const meta = remoteMeta[pageId];
          if (!meta || favoritePageMetaById[pageId]) continue;
          favoritePageMetaById[pageId] = meta;
          changed = true;
        }
        if (changed) next.favoritePageMetaById = favoritePageMetaById;
        return Object.keys(next).length > 0 ? next : s;
      }
      if (sameTs && !listsMatch) {
        const favoritePageMetaById = { ...s.favoritePageMetaById };
        for (const id of Object.keys(favoritePageMetaById)) {
          if (!parsed.favoritePageIds.includes(id)) delete favoritePageMetaById[id];
        }
        for (const pageId of parsed.favoritePageIds) {
          if (remoteMeta[pageId]) favoritePageMetaById[pageId] = remoteMeta[pageId];
        }
        next.favoritePageIds = [...parsed.favoritePageIds];
        next.favoritePageMetaById = favoritePageMetaById;
        next.favoritePageIdsUpdatedAt = parsed.favoritePageIdsUpdatedAt;
        return next;
      }
      return Object.keys(next).length > 0 ? next : s;
    }

    const favoritePageMetaById = { ...s.favoritePageMetaById };
    for (const id of Object.keys(favoritePageMetaById)) {
      if (!parsed.favoritePageIds.includes(id)) delete favoritePageMetaById[id];
    }
    for (const pageId of parsed.favoritePageIds) {
      if (remoteMeta[pageId]) favoritePageMetaById[pageId] = remoteMeta[pageId];
    }
    next.favoritePageIds = [...parsed.favoritePageIds];
    next.favoritePageMetaById = favoritePageMetaById;
    next.favoritePageIdsUpdatedAt = parsed.favoritePageIdsUpdatedAt;
    return next;
  });
}

const DEBOUNCE_MS = 600;

/** 직접 GraphQL mutation — upsertPage 등 outbox 앞줄에 막혀 즐겨찾기가 영원히 안 나가는 문제 방지. */
async function pushClientPrefsToServer(): Promise<void> {
  const memberId = useMemberStore.getState().me?.memberId;
  if (!memberId) return;

  const {
    favoritePageIds,
    favoritePageMetaById,
    favoritePageIdsUpdatedAt,
    fullWidth,
    pageFullWidthById,
    fullWidthUpdatedAt,
  } = useSettingsStore.getState();
  const payload: ClientPrefsV1 = {
    v: CLIENT_PREFS_SCHEMA_V,
    favoritePageIds: [...favoritePageIds],
    favoritePageMetaById: favoritePageIds.reduce<Record<string, FavoritePageMeta>>(
      (acc, pageId) => {
        const meta = favoritePageMetaById[pageId];
        if (meta) acc[pageId] = meta;
        return acc;
      },
      {},
    ),
    favoritePageIdsUpdatedAt,
    fullWidth,
    pageFullWidthById: { ...pageFullWidthById },
    fullWidthUpdatedAt,
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

/**
 * Zustand persist 비동기 복원 완료까지 대기.
 * 복원 전에 서버로 flush 하면 메모리 기본값(빈 즐겨찾기)이 Lambda LWW 로 덮어써져
 * 새로고침 시 즐겨찾기가 사라지는 원인이 됨.
 */
export async function ensureSettingsPersistHydrated(): Promise<void> {
  if (useSettingsStore.persist.hasHydrated()) return;
  await Promise.resolve(useSettingsStore.persist.rehydrate());
}

/** 워크스페이스 currentWorkspaceId 복원 전에 setWorkspaces 하면 첫 WS로 덮여 새로고침마다 리셋됨 */
export async function ensureWorkspacePersistHydrated(): Promise<void> {
  if (useWorkspaceStore.persist.hasHydrated()) return;
  await Promise.resolve(useWorkspaceStore.persist.rehydrate());
}

/** memberId 확정 직후(Bootstrap): 즉시 서버 반영(await). */
export async function flushClientPrefsToServerNow(): Promise<void> {
  await ensureSettingsPersistHydrated();
  await pushClientPrefsToServer();
}
