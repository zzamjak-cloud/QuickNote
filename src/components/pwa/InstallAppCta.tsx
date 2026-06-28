import { CheckCircle2, Download, Share } from "lucide-react";
import { useInstallPrompt } from "../../hooks/useInstallPrompt";

// 설정(내 프로필)에 노출되는 "앱 설치" 안내·버튼. 웹 전용.
// - 이미 설치/standalone: 설치됨 표시
// - Chrome/Edge/Android(beforeinstallprompt): 설치 버튼
// - iOS Safari: 공유 → 홈 화면 수동 안내
// - 그 외(데스크톱 Safari/Firefox 등 프롬프트 미발생): 렌더하지 않음
export function InstallAppCta() {
  const { isSupported, canInstall, installed, isIos, install } =
    useInstallPrompt();

  if (!isSupported) return null;

  if (installed) {
    return (
      <Section>
        <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 size={16} />
          <span>앱이 설치되어 있습니다.</span>
        </div>
      </Section>
    );
  }

  if (canInstall) {
    return (
      <Section>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium text-zinc-800 dark:text-zinc-100">
              앱 설치
            </div>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              홈 화면/독에 QuickNote 를 추가해 더 빠르게 실행하세요.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void install()}
            className="flex shrink-0 items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Download size={15} />
            설치
          </button>
        </div>
      </Section>
    );
  }

  if (isIos) {
    return (
      <Section>
        <div className="font-medium text-zinc-800 dark:text-zinc-100">
          앱 설치
        </div>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          Safari 하단의 <Share size={13} className="inline shrink-0" /> 공유 버튼
          → <span className="font-medium">"홈 화면에 추가"</span> 를 눌러 설치할 수
          있습니다.
        </p>
      </Section>
    );
  }

  // 아직 설치 프롬프트가 준비되지 않은 경우(Android Chrome 초기 방문 등)에도 수동 경로 안내.
  return (
    <Section>
      <div className="font-medium text-zinc-800 dark:text-zinc-100">앱 설치</div>
      <p className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
        <Download size={13} className="inline shrink-0" />
        브라우저 메뉴(⋮)에서 <span className="font-medium">"앱 설치"</span> 또는{" "}
        <span className="font-medium">"홈 화면에 추가"</span> 를 선택하세요.
      </p>
    </Section>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-t border-zinc-100 pt-4 dark:border-zinc-800">
      {children}
    </div>
  );
}
