// PWA 설치 프롬프트 컨트롤러 — 웹(Vercel) 전용 싱글턴.
// beforeinstallprompt 는 페이지 로드 직후(React 마운트 전) 발생할 수 있으므로
// 부팅 시점(main.tsx)에 리스너를 건다. 설정 화면의 "앱 설치" CTA 가 promptInstall() 로 트리거.
import { isStandalonePwa } from "./displayMode";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// 표준 타입 정의 부재 — beforeinstallprompt 이벤트 형태.
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt: () => Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Listener = () => void;

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let initialized = false;
const listeners = new Set<Listener>();

let snapshot = {
  canInstall: false,
  installed: typeof window !== "undefined" ? isStandalonePwa() : false,
  isSupported: !isTauri,
};

function setState(next: Partial<typeof snapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const l of listeners) l();
}

export function initInstallPrompt() {
  if (initialized || isTauri || typeof window === "undefined") return;
  initialized = true;

  window.addEventListener("beforeinstallprompt", (e) => {
    // 기본 미니 인포바를 막고 우리 CTA 로 제어.
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    setState({ canInstall: true });
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    setState({ canInstall: false, installed: true });
  });
}

export function subscribeInstall(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getInstallState() {
  return snapshot;
}

// 네이티브 설치 프롬프트 표시. 수락 시 appinstalled 가 별도로 발생한다.
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferredPrompt) return "unavailable";
  const prompt = deferredPrompt;
  deferredPrompt = null;
  setState({ canInstall: false });
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  return outcome;
}
