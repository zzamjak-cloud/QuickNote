import { useAuthStore } from "../../store/authStore";

const reasonMessages: Record<string, string> = {
  initial: "",
  signedOut: "로그아웃되었습니다.",
  expired: "세션이 만료되었습니다. 다시 로그인해주세요.",
  denied: "이 계정은 화이트리스트에 등록되어 있지 않습니다. 관리자에게 문의하세요.",
  callbackError: "로그인 처리 중 오류가 발생했습니다.",
  restoreTimeout:
    "로그인 정보를 불러오는 데 시간이 초과했습니다. 다시 로그인해 주세요.",
};

export function LoginScreen() {
  const state = useAuthStore((s) => s.state);
  const signIn = useAuthStore((s) => s.signIn);

  const message =
    state.status === "anonymous" ? reasonMessages[state.reason] ?? "" : "";
  const errorDetail =
    state.status === "anonymous" ? state.errorMessage ?? "" : "";

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-6 dark:bg-zinc-950">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">
          <span className="text-xl font-semibold">Q</span>
        </div>
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            QuickNote 로그인
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            허용된 Google 계정으로 로그인하세요.
          </p>
        </div>

        {message && (
          <div className="w-full rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
            {message}
            {errorDetail && (
              <div className="mt-1 break-all text-xs opacity-70">{errorDetail}</div>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            void signIn();
          }}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Google로 로그인
        </button>
      </div>
    </div>
  );
}
