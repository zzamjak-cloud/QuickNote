// 설정 > AI 연결(MCP) — 관리자(manager 이상) 전용 "토큰 관리": 전 멤버의 PAT·연결된 앱 현황, 강제 폐기, 멤버별 일괄 폐기(퇴사자 처리).
// 서버(adminListMcpTokens 등)가 권한을 다시 검사하므로 이 섹션 노출은 편의일 뿐이다.
import { useCallback, useEffect, useState } from "react";
import { Ban, UserX } from "lucide-react";
import {
  adminListMcpTokensApi,
  adminRevokeMcpTokenApi,
  adminRevokeMcpTokensByMemberApi,
  type AdminMcpToken,
  type AdminMcpTokenFilter,
} from "../../lib/sync/mcpTokenApi";
import { useMemberStore } from "../../store/memberStore";
import { useUiStore } from "../../store/uiStore";
import { McpRevokeReasonDialog } from "./McpRevokeReasonDialog";

const STATUS_LABEL: Record<AdminMcpToken["status"], string> = { active: "활성", revoked: "폐기됨", expired: "만료" };
const STATUS_CLASS: Record<AdminMcpToken["status"], string> = {
  active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  revoked: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  expired: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};
const SELECT_CLASS =
  "min-h-[44px] w-full rounded-md border border-zinc-200 bg-white px-2 text-sm md:min-h-0 md:py-1 dark:border-zinc-700 dark:bg-zinc-900";

type Pending = { kind: "token"; token: AdminMcpToken } | { kind: "member"; memberId: string; label: string };

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString("ko-KR");
}

function TokenRow({ token, busy, onRevoke }: { token: AdminMcpToken; busy: boolean; onRevoke: () => void }) {
  const owner = token.memberName ? `${token.memberName}${token.memberEmail ? ` (${token.memberEmail})` : ""}` : token.memberId;
  const scope = token.workspaces.length === 0 ? "전체 워크스페이스" : token.workspaces.map((w) => w.name).join(", ");
  return (
    <li className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 sm:flex-row sm:items-start dark:border-zinc-700">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{token.name}</span>
          <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
            {token.kind === "oauth" ? "연결된 앱" : `PAT …${token.tokenHint}`}
          </span>
          <span className={`rounded px-1.5 py-0.5 text-[10px] ${STATUS_CLASS[token.status]}`}>{STATUS_LABEL[token.status]}</span>
          <span className="text-[10px] text-zinc-500">{token.scopes.includes("write") ? "읽기+쓰기" : "읽기"}</span>
        </div>
        <p className="truncate text-xs text-zinc-600 dark:text-zinc-300">{owner}</p>
        <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{scope}</p>
        <p className="text-xs text-zinc-400">
          생성 {formatDate(token.createdAt)} · 마지막 사용 {formatDate(token.lastUsedAt)} · 만료 {token.expiresAt ? formatDate(token.expiresAt) : "없음"}
          {token.revokedAt ? ` · 폐기 ${formatDate(token.revokedAt)}${token.revokeReason ? ` (${token.revokeReason})` : ""}` : ""}
        </p>
      </div>
      {token.status === "active" && (
        <button
          type="button"
          onClick={onRevoke}
          disabled={busy}
          aria-label={`${token.name} 강제 폐기`}
          className="flex min-h-[44px] items-center justify-center gap-1 rounded-md border border-red-200 px-2 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40 md:min-h-0 md:py-1 dark:border-red-900 dark:hover:bg-red-950/40"
        >
          <Ban size={12} aria-hidden />
          강제 폐기
        </button>
      )}
    </li>
  );
}

export function McpAdminTokensSection() {
  const members = useMemberStore((s) => s.members);
  const showToast = useUiStore((s) => s.showToast);
  const [filter, setFilter] = useState<AdminMcpTokenFilter>({ status: "active" });
  const [items, setItems] = useState<AdminMcpToken[]>([]);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);

  const load = useCallback(async (append: boolean, token: string | null) => {
    setLoading(true);
    try {
      const page = await adminListMcpTokensApi(filter, token);
      setItems((prev) => (append ? [...prev, ...page.items] : page.items));
      setNextToken(page.nextToken);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "토큰 현황을 불러오지 못했습니다", { kind: "error" });
    } finally {
      setLoading(false);
    }
  }, [filter, showToast]);

  useEffect(() => {
    void load(false, null);
  }, [load]);

  const confirm = async (reason: string) => {
    const target = pending;
    setPending(null);
    if (!target) return;
    setBusy(true);
    try {
      if (target.kind === "token") {
        const updated = await adminRevokeMcpTokenApi(target.token, reason);
        setItems((prev) => prev.map((t) => (t.tokenId === updated.tokenId ? updated : t)));
        showToast("토큰을 강제 폐기했습니다");
      } else {
        const r = await adminRevokeMcpTokensByMemberApi(target.memberId, reason);
        const revoked = new Map(r.items.map((t) => [t.tokenId, t]));
        setItems((prev) => prev.map((t) => revoked.get(t.tokenId) ?? t));
        showToast(`${r.revokedCount}개 토큰·연결을 폐기했습니다`);
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "폐기에 실패했습니다", { kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  const memberLabel = (id: string) => members.find((m) => m.memberId === id)?.name ?? id;

  return (
    <section className="space-y-3" aria-labelledby="mcp-admin-title">
      <div>
        <h3 id="mcp-admin-title" className="text-sm font-semibold">토큰 관리</h3>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          모든 구성원의 MCP 토큰·연결된 앱 현황입니다. 강제 폐기하면 즉시 접근이 끊기고, 소유자 목록에 "관리자에 의해 폐기됨"으로 표시됩니다.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <select aria-label="구성원 필터" className={SELECT_CLASS} value={filter.memberId ?? ""}
          onChange={(e) => setFilter((f) => ({ ...f, memberId: e.target.value || undefined }))}>
          <option value="">전체 구성원</option>
          {members.map((m) => <option key={m.memberId} value={m.memberId}>{m.name}</option>)}
        </select>
        <select aria-label="종류 필터" className={SELECT_CLASS} value={filter.kind ?? ""}
          onChange={(e) => setFilter((f) => ({ ...f, kind: (e.target.value || undefined) as AdminMcpTokenFilter["kind"] }))}>
          <option value="">전체 종류</option>
          <option value="pat">개인 액세스 토큰</option>
          <option value="oauth">연결된 앱</option>
        </select>
        <select aria-label="상태 필터" className={SELECT_CLASS} value={filter.status ?? ""}
          onChange={(e) => setFilter((f) => ({ ...f, status: (e.target.value || undefined) as AdminMcpTokenFilter["status"] }))}>
          <option value="">전체 상태</option>
          <option value="active">활성</option>
          <option value="revoked">폐기됨</option>
          <option value="expired">만료</option>
        </select>
      </div>
      {filter.memberId && (
        <button type="button" disabled={busy}
          onClick={() => setPending({ kind: "member", memberId: filter.memberId as string, label: memberLabel(filter.memberId as string) })}
          className="flex min-h-[44px] w-full items-center justify-center gap-1 rounded-md border border-red-200 px-3 text-sm text-red-600 hover:bg-red-50 disabled:opacity-40 sm:w-auto md:min-h-0 md:py-1.5 dark:border-red-900 dark:hover:bg-red-950/40">
          <UserX size={14} aria-hidden />
          이 구성원의 토큰·연결 모두 폐기
        </button>
      )}
      {loading && items.length === 0 ? (
        <p className="text-sm text-zinc-400">불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-zinc-400">조건에 맞는 토큰이 없습니다</p>
      ) : (
        <ul className="space-y-2">
          {items.map((t) => <TokenRow key={t.tokenId} token={t} busy={busy} onRevoke={() => setPending({ kind: "token", token: t })} />)}
        </ul>
      )}
      {nextToken && (
        <button type="button" disabled={loading} onClick={() => void load(true, nextToken)}
          className="min-h-[44px] w-full rounded-md border border-zinc-200 px-3 text-sm hover:bg-zinc-50 disabled:opacity-40 md:min-h-0 md:py-1.5 dark:border-zinc-700 dark:hover:bg-zinc-800">
          더 보기
        </button>
      )}
      <McpRevokeReasonDialog
        open={pending != null}
        title={pending?.kind === "member" ? "구성원 토큰 일괄 폐기" : "토큰 강제 폐기"}
        message={
          pending?.kind === "member"
            ? `${pending.label} 님의 활성 토큰과 연결된 앱을 모두 폐기합니다. 퇴사자 처리 등에 사용하며 되돌릴 수 없습니다.`
            : pending?.kind === "token"
              ? `"${pending.token.name}"(${pending.token.memberName ?? pending.token.memberId})을 폐기합니다. 즉시 접근이 끊기며 되돌릴 수 없습니다.`
              : ""
        }
        confirmLabel="폐기"
        onCancel={() => setPending(null)}
        onConfirm={(reason) => void confirm(reason)}
      />
    </section>
  );
}
