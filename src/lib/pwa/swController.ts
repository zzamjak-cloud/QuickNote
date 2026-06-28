// PWA Service Worker 컨트롤러 — 웹(Vercel) 전용 싱글턴.
// 부팅 시점(main.tsx)에 등록해 auth 상태와 무관하게 SW 를 활성화한다(로그인 전에도 설치 가능).
// 업데이트 적용: 모바일/설치 PWA 는 자동(수동 불필요), 데스크톱 웹은 배너(usePwaUpdate)로 확인 후.

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// 모바일/설치 PWA 는 새 버전을 자동 적용한다(사용자 수동 업데이트 불필요).
// 데스크톱 웹은 배너로 확인 후 적용(편집 손실 방지).
function shouldAutoApplyUpdate(): boolean {
  if (typeof window === "undefined") return false;
  const isStandalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const isMobileWidth = window.matchMedia?.("(max-width: 767px)").matches;
  return Boolean(isStandalone || isMobileWidth);
}

type Listener = () => void;

// 주기 업데이트 점검 간격(1시간) — stale 셸이 무한정 유지되지 않도록.
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

let updateSW: ((reload?: boolean) => Promise<void>) | null = null;
let registration: ServiceWorkerRegistration | null = null;
let initialized = false;
const listeners = new Set<Listener>();

// useSyncExternalStore 가 Object.is 로 비교하므로 스냅샷은 캐시하고 변경 시에만 교체한다.
let snapshot = { needRefresh: false, offlineReady: false, isSupported: !isTauri };

function setState(next: Partial<typeof snapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const l of listeners) l();
}

// 부팅 1회 등록. 멱등(중복 호출 무시).
export function initPwa() {
  if (initialized || isTauri || typeof window === "undefined") return;
  initialized = true;
  // virtual:pwa-register 는 PWA 플러그인이 있을 때만 존재(Tauri 는 스텁 alias).
  import("virtual:pwa-register")
    .then(({ registerSW }) => {
      updateSW = registerSW({
        onNeedRefresh() {
          // 모바일/설치 PWA: 새 버전 자동 적용(즉시 새 SW 활성화 + reload). 데스크톱: 배너.
          if (shouldAutoApplyUpdate()) {
            void updateSW?.(true);
            return;
          }
          setState({ needRefresh: true });
        },
        onOfflineReady() {
          setState({ offlineReady: true });
        },
        onRegisteredSW(_swUrl, reg) {
          if (!reg) return;
          registration = reg;
          // 주기 점검: 새 SW 감지 시 onNeedRefresh(모바일 자동 적용 / 데스크톱 배너).
          window.setInterval(() => {
            void reg.update().catch(() => {});
          }, UPDATE_CHECK_INTERVAL_MS);
          // 장시간 열어둔 탭이 포커스 복귀할 때도 1회 점검.
          document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") {
              void reg.update().catch(() => {});
            }
          });
        },
      });
    })
    .catch(() => {
      // SW 미지원 또는 dev(devOptions 비활성) — 무시.
    });
}

export function subscribePwa(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPwaState() {
  return snapshot;
}

// 사용자 확인 후 새 SW 활성화 + 새로고침
export async function applyPwaUpdate() {
  await updateSW?.(true);
}

// 하드 staleness 복구 — 청크 404 가 새로고침 후에도 반복될 때(= stale precache 의심)
// 호출. 새 SW 를 강제로 받아 활성화한 뒤 reload 한다. chunkReload 가 위임한다.
export async function forcePwaUpdate(): Promise<void> {
  if (isTauri || typeof window === "undefined") {
    window.location.reload();
    return;
  }
  try {
    const reg =
      registration ??
      (await navigator.serviceWorker?.getRegistration()) ??
      null;
    await reg?.update();
    // 대기 중 새 SW 가 있으면 즉시 활성화(vite-plugin-pwa SW 의 SKIP_WAITING 핸들러).
    if (reg?.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
  } catch {
    // 무시 — 아래 reload 로 폴백.
  }
  window.location.reload();
}

export function dismissPwaUpdate() {
  setState({ needRefresh: false, offlineReady: false });
}
