// MCP 연결 명령·스니펫 표시 + 복사 버튼(빠른 연결 섹션·PAT 발급 패널 공용).
import { Copy } from "lucide-react";
import { useUiStore } from "../../store/uiStore";

type CopyProps = {
  text: string;
  label: string;
  disabled?: boolean;
};

export function McpCopyButton({ text, label, disabled }: CopyProps) {
  const showToast = useUiStore((s) => s.showToast);

  const copy = () => {
    navigator.clipboard
      .writeText(text)
      .then(() => showToast(`${label} 복사됨`))
      .catch(() => showToast("클립보드 복사에 실패했습니다", { kind: "error" }));
  };

  return (
    <button
      type="button"
      onClick={copy}
      disabled={disabled}
      className="flex min-h-[44px] shrink-0 items-center gap-1 rounded-md border border-zinc-200 px-2 text-xs hover:bg-zinc-100 disabled:opacity-40 md:min-h-0 md:py-1 dark:border-zinc-700 dark:hover:bg-zinc-800"
      aria-label={`${label} 복사`}
    >
      <Copy size={12} aria-hidden />
      복사
    </button>
  );
}

type BlockProps = CopyProps & {
  hint?: string;
};

export function McpCommandBlock({ text, label, hint, disabled }: BlockProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-medium text-zinc-600 dark:text-zinc-300">{label}</h4>
        <McpCopyButton text={text} label={label} disabled={disabled} />
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-zinc-900 p-2 font-mono text-[11px] text-zinc-100">
        {text}
      </pre>
      {hint && <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
    </div>
  );
}
