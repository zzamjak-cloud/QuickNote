// 웹 게시 방문자 대시보드 — developer 전용. 조회수·고유 방문자(IP 해시)·국가별·일별·페이지별 집계.
import { useEffect, useMemo, useState } from "react";
import { BarChart3, Loader2 } from "lucide-react";
import { DialogBase } from "../../lib/ui-primitives";
import { usePageStore } from "../../store/pageStore";
import {
  getPublishAnalyticsApi,
  type PublishAnalytics,
} from "../../lib/sync/publishApi";

type Props = {
  pageId: string | null;
  onClose: () => void;
};

/** ISO alpha-2 → 국기 이모지. 미상("??")은 지구본. */
function countryFlag(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return "🌐";
  return String.fromCodePoint(
    ...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

function countryName(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return "알 수 없음";
  try {
    return new Intl.DisplayNames(["ko"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-1 flex-col gap-0.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        {value}
      </span>
    </div>
  );
}

function RatioBar({ ratio }: { ratio: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
      <div
        className="h-full rounded-full bg-blue-500"
        style={{ width: `${Math.max(2, Math.round(ratio * 100))}%` }}
      />
    </div>
  );
}

export function PublishDashboardDialog({ pageId, onClose }: Props) {
  const open = pageId !== null;
  const pages = usePageStore((s) => s.pages);
  const [analytics, setAnalytics] = useState<PublishAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!pageId) {
      setAnalytics(null);
      setError(null);
      return;
    }
    let canceled = false;
    setLoading(true);
    setError(null);
    getPublishAnalyticsApi(pageId)
      .then((a) => {
        if (!canceled) setAnalytics(a);
      })
      .catch((e) => {
        if (!canceled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [pageId]);

  const recentDaily = useMemo(() => {
    const daily = analytics?.daily ?? [];
    return daily.slice(-14);
  }, [analytics]);
  const maxDailyViews = useMemo(
    () => Math.max(1, ...recentDaily.map((d) => d.views)),
    [recentDaily],
  );
  const maxCountryVisitors = Math.max(
    1,
    ...(analytics?.countries ?? []).map((c) => c.visitors),
  );

  const pageTitle = (id: string): string =>
    pages[id]?.title?.trim() || `${id.slice(0, 8)}…`;

  return (
    <DialogBase
      open={open}
      onClose={onClose}
      widthClassName="max-w-lg"
      labelId="qn-publish-dashboard-title"
    >
      <DialogBase.Header id="qn-publish-dashboard-title">
        <span className="inline-flex items-center gap-2">
          <BarChart3 size={16} /> 게시 대시보드
        </span>
      </DialogBase.Header>
      <DialogBase.Body>
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 size={14} className="animate-spin" /> 방문 통계 불러오는 중…
          </p>
        ) : error ? (
          <p className="text-sm text-red-500">{error}</p>
        ) : !analytics ? null : !analytics.published ? (
          <p className="text-sm text-zinc-500">게시 중인 링크가 없습니다.</p>
        ) : (
          <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
            <div className="flex gap-2">
              <StatCard label="총 조회수" value={analytics.totalViews.toLocaleString()} />
              <StatCard
                label="방문자 수 (고유 IP)"
                value={analytics.uniqueVisitors.toLocaleString()}
              />
            </div>
            <p className="text-xs text-zinc-400">
              첫 방문 {formatDateTime(analytics.firstViewAt)} · 마지막 방문{" "}
              {formatDateTime(analytics.lastViewAt)}
            </p>

            {analytics.countries.length > 0 ? (
              <section className="flex flex-col gap-1.5">
                <h3 className="text-xs font-semibold text-zinc-500">국가별 방문자</h3>
                {analytics.countries.map((c) => (
                  <div key={c.country} className="flex items-center gap-2 text-sm">
                    <span className="w-6 text-center">{countryFlag(c.country)}</span>
                    <span className="w-28 truncate text-zinc-700 dark:text-zinc-200">
                      {countryName(c.country)}
                    </span>
                    <div className="flex-1">
                      <RatioBar ratio={c.visitors / maxCountryVisitors} />
                    </div>
                    <span className="w-20 shrink-0 text-right text-xs text-zinc-500">
                      {c.visitors.toLocaleString()}명 · {c.views.toLocaleString()}회
                    </span>
                  </div>
                ))}
              </section>
            ) : null}

            {recentDaily.length > 0 ? (
              <section className="flex flex-col gap-1.5">
                <h3 className="text-xs font-semibold text-zinc-500">
                  최근 {recentDaily.length}일 조회수
                </h3>
                <div className="flex h-20 items-end gap-1">
                  {recentDaily.map((d) => (
                    <div
                      key={d.date}
                      className="flex-1 rounded-t bg-blue-400/80 dark:bg-blue-500/70"
                      style={{ height: `${Math.max(4, (d.views / maxDailyViews) * 100)}%` }}
                      title={`${d.date} · ${d.views.toLocaleString()}회`}
                    />
                  ))}
                </div>
                <div className="flex justify-between text-[10px] text-zinc-400">
                  <span>{recentDaily[0]?.date}</span>
                  <span>{recentDaily[recentDaily.length - 1]?.date}</span>
                </div>
              </section>
            ) : null}

            {analytics.pages.length > 0 ? (
              <section className="flex flex-col gap-1.5">
                <h3 className="text-xs font-semibold text-zinc-500">
                  페이지별 조회수 (상위 {Math.min(10, analytics.pages.length)})
                </h3>
                {analytics.pages.slice(0, 10).map((p) => (
                  <div key={p.pageId} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-200">
                      {pageTitle(p.pageId)}
                    </span>
                    <span className="shrink-0 text-xs text-zinc-500">
                      {p.views.toLocaleString()}회
                    </span>
                  </div>
                ))}
              </section>
            ) : null}

            {analytics.totalViews === 0 ? (
              <p className="text-sm text-zinc-500">
                아직 기록된 방문이 없습니다. 방문 집계는 대시보드 배포 이후의 조회부터
                기록됩니다.
              </p>
            ) : null}
          </div>
        )}
      </DialogBase.Body>
      <DialogBase.Footer>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          닫기
        </button>
      </DialogBase.Footer>
    </DialogBase>
  );
}
