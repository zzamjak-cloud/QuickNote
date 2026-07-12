// DB 본문 전수 분석 — 계획 §6 "전수형" map-reduce 경로.
// 본문이 단일 요청 예산을 넘으면: ① 행 본문을 배치로 나눠 질문 관련 정보 추출(map)
// → ② 추출 결과를 모아 최종 종합(reduce). 배치 결과는 세션 캐시(내용+질문+모델 키).

import { streamAiChat, withRateLimitRetry } from "./aiClient";
import {
  computeDbViewRows,
  AI_CONTEXT_MAX_CHARS,
  AI_DB_CELL_MAX_CHARS,
  type AiContext,
} from "./contextBuilder";
import {
  getSummaryCache,
  setSummaryCache,
  hashAiContextMarkdown,
} from "./summaryCache";
import { loadPageBodies } from "./loadRowBodies";
import { pageDocToMarkdown } from "../export/pageToMarkdown";
import { shouldLoadPageContent } from "../sync/pageContentLoad";
import { usePageStore } from "../../store/pageStore";
import { formatPlainDisplay } from "../../components/database/databaseCellDisplayUtils";
import { isInternalHiddenColumnId } from "../../types/database";

/** 전수 분석 시 행당 본문 상한 — 배치가 예산을 관리하므로 컨텍스트 임베드(2K)보다 크게. */
export const DEEP_ROW_BODY_MAX_CHARS = 8_000;
/** 배치당 문자 예산 — 서버 MAX_CONTEXT_CHARS(120K) 이내 여유. */
const BATCH_CHAR_BUDGET = 80_000;
/** 배치 수 상한 — 폭주 방지. 초과분은 최종 종합에 미분석으로 고지. */
const MAX_BATCHES = 24;
/** 전수 분석 행 수 상한 — 표시용 행 상한(200)과 무관하게 현재 뷰 전체를 다룬다. */
const DEEP_MAX_ROWS = 1_000;

export type DeepAnalysisBatch = { markdown: string; rowCount: number };

export type DeepAnalysisPlan = {
  databaseId: string;
  label: string;
  /** 현재 뷰(필터·정렬) 행 수. */
  totalRows: number;
  /** 분석 대상 행 수(행 상한 적용). */
  analyzedRows: number;
  /** 배치 상한 초과로 미분석되는 행 수. */
  skippedRows: number;
  batches: DeepAnalysisBatch[];
};

/**
 * 전수 분석 계획 수립 — 대상 행 본문을 프리페치한 뒤 배치로 패킹한다.
 * 배치가 1개 이하면 단일 요청 컨텍스트로 충분하다는 뜻(호출부가 일반 경로 사용).
 */
export async function planDeepDbAnalysis(
  context: AiContext,
  onProgress?: (note: string) => void,
): Promise<DeepAnalysisPlan | null> {
  if (!context.databaseId || !context.panelState) return null;
  const view = computeDbViewRows(context.databaseId, context.panelState);
  if (!view) return null;

  // 전수 분석은 표시용 행 상한(칩의 "포함 행 수")과 무관하게 현재 뷰 전체가 대상 —
  // "주어진 조건(필터·정렬)의 본문 전체" 라는 사용자 멘탈 모델에 맞춘다.
  const targetRows = view.rows.slice(0, DEEP_MAX_ROWS);

  // 본문 프리페치 (lazy 로딩분)
  const pages = usePageStore.getState().pages;
  const missing = targetRows
    .filter((r) => {
      const page = pages[r.pageId];
      return page && shouldLoadPageContent(page, false);
    })
    .map((r) => r.pageId);
  if (missing.length > 0) {
    onProgress?.(`행 본문 ${missing.length}건 불러오는 중…`);
    await loadPageBodies(missing);
  }

  // 행 단위 직렬화: 제목 + 셀 값 + 본문(상한). 셀에도 답이 있는 경우가 많아 함께 넣는다.
  const freshPages = usePageStore.getState().pages;
  const cellColumns = view.columns.filter(
    (c) => !isInternalHiddenColumnId(c.id) && c.type !== "title",
  );
  const rowSections: string[] = [];
  for (const row of targetRows) {
    const page = freshPages[row.pageId];
    if (!page) continue;
    const cellLines = cellColumns
      .map((c) => {
        const text = (formatPlainDisplay(row.cells[c.id] ?? null, c) ?? "")
          .replace(/\r?\n/g, " ")
          .trim();
        if (!text) return null;
        return `${c.name || c.type}: ${
          text.length > AI_DB_CELL_MAX_CHARS ? `${text.slice(0, AI_DB_CELL_MAX_CHARS)}…` : text
        }`;
      })
      .filter(Boolean)
      .join(" | ");
    let body = page.doc
      ? pageDocToMarkdown(page.doc, {
          renderDatabaseBlock: () => "[중첩 DB 생략]",
        }).trim()
      : "";
    if (body.length > DEEP_ROW_BODY_MAX_CHARS) {
      body = `${body.slice(0, DEEP_ROW_BODY_MAX_CHARS)}…(이하 생략)`;
    }
    rowSections.push(
      [
        `### ${(row.title || "제목 없음").trim()}`,
        cellLines ? `속성: ${cellLines}` : null,
        body || "(본문 없음)",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  // 배치 패킹 — 순서 보존, 예산 내 채우기 (행당 상한 4K ≪ 배치 예산이라 단일 행 초과 없음)
  const batches: DeepAnalysisBatch[] = [];
  let bufParts: string[] = [];
  let bufChars = 0;
  const flush = () => {
    if (bufParts.length === 0) return;
    batches.push({ markdown: bufParts.join("\n\n"), rowCount: bufParts.length });
    bufParts = [];
    bufChars = 0;
  };
  for (const section of rowSections) {
    if (bufChars + section.length > BATCH_CHAR_BUDGET) {
      flush();
      if (batches.length >= MAX_BATCHES) break;
    }
    bufParts.push(section);
    bufChars += section.length + 2;
  }
  if (batches.length < MAX_BATCHES) flush();
  else bufParts = [];

  const analyzedRows = batches.reduce((n, b) => n + b.rowCount, 0);
  return {
    databaseId: context.databaseId,
    label: view.label,
    totalRows: view.rows.length,
    analyzedRows,
    skippedRows: rowSections.length - analyzedRows,
    batches,
  };
}

function mapPrompt(question: string, label: string, index: number, total: number): string {
  return [
    `아래 컨텍스트는 데이터베이스 "${label}" 의 행 본문 배치 ${index + 1}/${total} 이다.`,
    `사용자 질문: "${question}"`,
    "",
    "각 행(### 제목 단위)에서 질문과 관련된 정보를 **빠짐없이** 추출해, 행 제목을 붙여 불릿으로 정리하라.",
    "- 이 단계는 수집이다. 요약·집계·중복 제거·타당성 판단을 하지 말고 발견한 항목을 전부 기록하라.",
    "- 같은 내용이 여러 행에서 반복 언급돼도 각 행마다 기록하라(취합은 다음 단계에서 한다).",
    "- 원문에 없는 내용을 추측하거나 지어내지 마라.",
    "- 날짜·이름·수치·상태 표기(예정/확정 등)는 원문 표기 그대로 보존하라.",
    "- 관련 정보가 없는 행은 출력하지 말고 생략하라.",
    "- 관련 행이 하나도 없으면 \"관련 정보 없음\" 한 줄만 출력하라.",
  ].join("\n");
}

/**
 * map-reduce 실행. map 결과는 세션 캐시로 재사용(같은 질문·같은 내용 재분석 무료).
 * reduce 는 onReduceDelta 로 스트리밍된다.
 */
export async function runDeepDbAnalysis(args: {
  workspaceId: string;
  model: string;
  question: string;
  plan: DeepAnalysisPlan;
  signal: AbortSignal;
  onProgress: (status: string) => void;
  onReduceDelta: (delta: string) => void;
}): Promise<void> {
  const { plan, question, workspaceId, model, signal } = args;
  const total = plan.batches.length;
  const questionHash = hashAiContextMarkdown(question);
  const extracts: string[] = [];

  // map — 순차 실행(429 여유). 배치가 크면 병렬 이득보다 rate limit 비용이 큼.
  for (let i = 0; i < total; i += 1) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const batch = plan.batches[i]!;
    args.onProgress(`본문 분석 중 (${i + 1}/${total})…`);

    const cacheKey = `${workspaceId}|deep:${plan.databaseId}|${hashAiContextMarkdown(batch.markdown)}|${questionHash}|${model}`;
    const hit = getSummaryCache(cacheKey);
    if (hit) {
      extracts.push(hit.markdown);
      continue;
    }

    let out = "";
    await withRateLimitRetry(
      () =>
        streamAiChat({
          workspaceId,
          action: "chat",
          model,
          messages: [{ role: "user", content: mapPrompt(question, plan.label, i, total) }],
          context: {
            label: `${plan.label} 본문 배치 ${i + 1}/${total}`,
            markdown: batch.markdown,
          },
          enableTools: false,
          signal,
          onDelta: (d) => {
            out += d;
          },
        }),
      {
        signal,
        onWait: (sec) =>
          args.onProgress(`사용량 제한 — ${sec}초 대기 후 계속 (${i + 1}/${total})`),
      },
    );
    const cleaned = out.trim();
    extracts.push(cleaned);
    if (cleaned) {
      setSummaryCache(cacheKey, { markdown: cleaned, model, createdAt: Date.now() });
    }
  }

  // reduce — 추출 결과를 합쳐 최종 종합(총량 상한 내 절단 고지)
  args.onProgress(`종합 중…`);
  const parts = extracts
    .map((e, i) => `## 배치 ${i + 1} 추출\n\n${e || "(관련 정보 없음)"}`)
    .join("\n\n---\n\n");
  let reduceMarkdown = [
    `데이터베이스 "${plan.label}" 의 행 ${plan.analyzedRows}개(현재 뷰 ${plan.totalRows}행 중) 본문을 배치 ${total}개로 나눠, 질문과 관련된 정보를 행별로 추출한 결과다.`,
    plan.skippedRows > 0 ? `※ ${plan.skippedRows}행은 분량 상한으로 미분석.` : null,
    "",
    parts,
  ]
    .filter((v) => v != null)
    .join("\n");
  if (reduceMarkdown.length > AI_CONTEXT_MAX_CHARS) {
    reduceMarkdown = `${reduceMarkdown.slice(0, AI_CONTEXT_MAX_CHARS)}\n\n…(추출 결과가 길어 이후 생략됨)`;
  }

  await withRateLimitRetry(
    () =>
      streamAiChat({
        workspaceId,
        action: "chat",
        model,
        messages: [
          {
            role: "user",
            content: [
              `질문: ${question}`,
              "",
              "컨텍스트의 행별 추출 결과를 근거로 답하라.",
              "- 답변 서두에 분석 범위(분석한 행 수, 확인된 기간 범위)를 한 줄로 명시하라.",
              "- 추출된 항목을 임의로 제외하지 마라. 같은 인물·같은 날짜의 동일 건이 여러 행에서 반복 언급된 경우만 1건으로 합치고, '예정'·미확정 표기가 있는 항목은 제외하지 말고 별도로 구분해 표기하라.",
              "- 추출에 없는 내용은 추측하지 말고, 집계는 근거가 된 행 제목을 함께 표기하라.",
            ].join("\n"),
          },
        ],
        context: { label: `${plan.label} — 행별 추출 결과`, markdown: reduceMarkdown },
        enableTools: false,
        signal,
        onDelta: args.onReduceDelta,
      }),
    {
      signal,
      onWait: (sec) => args.onProgress(`사용량 제한 — ${sec}초 대기 후 종합`),
    },
  );

  // 커버리지 푸터 — 모델과 무관하게 실제 분석 범위를 결정적으로 표기
  args.onReduceDelta(
    `\n\n---\n\n> 📊 분석 범위: 현재 뷰 ${plan.totalRows}행 중 ${plan.analyzedRows}행 본문 분석 (배치 ${total}개${
      plan.skippedRows > 0 ? ` · ${plan.skippedRows}행 상한 초과 미분석` : ""
    })`,
  );
}
