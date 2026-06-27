// PWA Service Worker 컨트롤러 — 웹(Vercel) 전용 싱글턴.
// 부팅 시점(main.tsx)에 등록해 auth 상태와 무관하게 SW 를 활성화한다(로그인 전에도 설치 가능).
// 업데이트(onNeedRefresh) 발생 시 구독자(usePwaUpdate)에게 알린다.
// 자동 reload 는 하지 않는다 — 사용자 확인 후 applyUpdate() 로만 새 SW 활성화.

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type Listener = () => void;

let updateSW: ((reload?: boolean) => Promise<void>) | null = null;
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
          setState({ needRefresh: true });
        },
        onOfflineReady() {
          setState({ offlineReady: true });
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

export function dismissPwaUpdate() {
  setState({ needRefresh: false, offlineReady: false });
}
