import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportNonFatal } from "../lib/reportNonFatal";
import { attemptChunkReload, isChunkLoadError } from "../lib/chunkReload";

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
  reloading: boolean;
};

export class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null, reloading: false };

  static getDerivedStateFromError(error: Error): State {
    // 새 배포로 청크 해시가 바뀌어 발생한 로드 실패는 에러 화면 대신 자동 새로고침으로 복구.
    if (isChunkLoadError(error)) return { error: null, reloading: true };
    return { error, reloading: false };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (isChunkLoadError(error)) {
      // 쿨다운 내 반복 실패면 더 새로고침하지 않고 일반 에러로 노출.
      if (!attemptChunkReload()) {
        this.setState({ error, reloading: false });
      }
      return;
    }
    reportNonFatal(
      `${error.message}\n${info.componentStack}`,
      "root.errorBoundary",
    );
  }

  render() {
    if (this.state.reloading) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-white text-sm text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
          <span>새 버전을 적용하는 중…</span>
        </div>
      );
    }
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white px-6 text-center text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <div className="max-w-2xl rounded-2xl border border-red-200 bg-red-50 p-6 text-left shadow-sm dark:border-red-900/60 dark:bg-red-950/30">
          <p className="text-sm font-semibold text-red-700 dark:text-red-300">
            QuickNote 렌더링 오류
          </p>
          <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap text-xs leading-5 text-red-900 dark:text-red-100">
            {this.state.error.stack ?? this.state.error.message}
          </pre>
          <button
            type="button"
            className="mt-4 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
            onClick={() => window.location.reload()}
          >
            새로고침
          </button>
        </div>
      </div>
    );
  }
}
