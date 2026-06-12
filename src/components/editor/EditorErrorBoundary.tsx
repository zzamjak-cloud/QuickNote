import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportNonFatal } from "../../lib/reportNonFatal";

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
};

/**
 * 에디터 영역 전용 에러 경계.
 * TipTap view 미마운트 접근 등 에디터 내부 오류가 루트 경계까지 전파되면
 * 사이드바를 포함한 앱 전체가 무너진다(2026-06-12 라이브 사고) — 에디터 영역에 격리하고
 * 사용자가 그 자리에서 다시 시도(재마운트)할 수 있게 한다.
 */
export class EditorErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportNonFatal(
      `${error.message}\n${info.componentStack}`,
      "editor.errorBoundary",
    );
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-white text-sm text-zinc-500 dark:bg-[#111111] dark:text-zinc-400">
        <span>에디터를 표시하는 중 문제가 발생했습니다.</span>
        <button
          type="button"
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          onClick={() => this.setState({ error: null })}
        >
          다시 시도
        </button>
      </div>
    );
  }
}
