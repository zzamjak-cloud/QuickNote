// 플로우차트 블록의 NodeView. 문서에서는 정적 SVG(FlowchartStaticPreview)로 그려
// 측정·재계산·깜빡임 없이 즉시 표시하고, 더블클릭하면 편집 모달을 연다.
import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import {
  NodeViewWrapper,
  type NodeViewProps,
} from "@tiptap/react";
import { Workflow, History, Maximize2 } from "lucide-react";
import {
  parseFlowchart,
  serializeFlowchart,
  getFlowchartBounds,
  type FlowchartData,
  type FlowchartNodeLink,
} from "../../types/flowchart";
import { FlowchartStaticPreview } from "./FlowchartStaticPreview";
import { FlowchartEditorModal } from "./FlowchartEditorModal";
import { FlowchartFullViewModal } from "./FlowchartFullViewModal";
import { FlowchartHistoryDialog } from "./FlowchartHistoryDialog";
import { useFlowchartHistoryStore } from "../../store/flowchartHistoryStore";
import { useOpenPageInPeek } from "../page/useOpenPageInPeek";
import { stripPagePrefix } from "../../lib/tiptapExtensions/mentionKind";
import { useFlowchartStore } from "../../store/flowchartStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { newId } from "../../lib/id";
import {
  fetchFlowchartApi,
  pushFlowchartApi,
  saveFlowchartVersionApi,
} from "../../lib/sync/flowchartApi";

export function FlowchartBlockView(props: NodeViewProps) {
  const { node, selected, updateAttributes, editor } = props;
  const attrs = node.attrs as {
    flowchartId?: string;
    data?: string;
    title?: string;
  };
  const flowchartId = typeof attrs.flowchartId === "string" ? attrs.flowchartId : "";
  const raw = attrs.data;
  const title = typeof attrs.title === "string" ? attrs.title : "";
  // 인라인 스냅샷(오프라인/시드용)
  const inlineData: FlowchartData = useMemo(() => parseFlowchart(raw), [raw]);
  // 공유 저장소 레코드(있으면 권위) — 같은 flowchartId 의 모든 블록이 이걸 구독한다.
  const storeRecord = useFlowchartStore((s) =>
    flowchartId ? s.records[flowchartId] : undefined,
  );
  const data: FlowchartData =
    storeRecord && !storeRecord.deletedAt ? storeRecord.data : inlineData;
  const [editing, setEditing] = useState(false);
  const [fullViewOpen, setFullViewOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const openInPeek = useOpenPageInPeek();
  const pushVersion = useFlowchartHistoryStore((s) => s.pushVersion);

  const seedIfAbsent = useFlowchartStore((s) => s.seedIfAbsent);
  const upsertLocal = useFlowchartStore((s) => s.upsertLocal);
  const applyRemote = useFlowchartStore((s) => s.applyRemote);

  // 마운트 시 서버에서 최신본을 받아 store 에 병합(LWW) → 타 기기 변경 반영.
  useEffect(() => {
    if (!flowchartId) return;
    const wsId = useWorkspaceStore.getState().currentWorkspaceId;
    if (!wsId) return;
    let cancelled = false;
    void fetchFlowchartApi(flowchartId, wsId).then((rec) => {
      if (!cancelled && rec) applyRemote(rec);
    });
    return () => {
      cancelled = true;
    };
  }, [flowchartId, applyRemote]);

  // 서버 push 디바운스 타이머
  const pushTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (pushTimer.current) window.clearTimeout(pushTimer.current);
    },
    [],
  );

  // 마이그레이션/시드: 편집 가능한 문서에서만 1회.
  // - flowchartId 없으면 발급하고 인라인 데이터를 공유 저장소에 시드.
  // - 있으면 저장소가 비었을 때만 인라인 스냅샷으로 시드(새 기기/서버 미적재 대비).
  useEffect(() => {
    if (!editor.isEditable) return;
    const wsId = useWorkspaceStore.getState().currentWorkspaceId ?? null;
    if (!flowchartId) {
      const id = newId();
      seedIfAbsent({ id, workspaceId: wsId, title, data: inlineData });
      updateAttributes({ flowchartId: id });
    } else {
      seedIfAbsent({ id: flowchartId, workspaceId: wsId, title, data: inlineData });
    }
    // 의존성: flowchartId 변화 시에만 재실행 (인라인/title 변동은 시드에 영향 없음)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowchartId, editor.isEditable]);

  const openEditor = useCallback(() => {
    if (editor.isEditable) setEditing(true);
  }, [editor.isEditable]);

  // 미리보기에서 링크가 연결된 도형 클릭 → 외부=새 탭, 내부=피크
  const onNodeLink = useCallback(
    (link: FlowchartNodeLink) => {
      if (link.type === "url") {
        window.open(link.url, "_blank", "noopener,noreferrer");
      } else {
        // 과거 데이터가 "p:" 접두를 포함할 수 있어 방어적으로 제거한다.
        void openInPeek(stripPagePrefix(link.pageId));
      }
    },
    [openInPeek],
  );

  // 공유 저장소(권위)에 쓰고, 인라인 attrs 에도 스냅샷을 남긴다(오프라인/문서 이식 대비).
  // 저장소 upsert 가 같은 flowchartId 의 모든 복제본을 즉시 리렌더 → 동기화.
  const persist = useCallback(
    (next: FlowchartData) => {
      const wsId = useWorkspaceStore.getState().currentWorkspaceId ?? null;
      if (flowchartId) {
        const record = upsertLocal({
          id: flowchartId,
          workspaceId: wsId,
          title,
          data: next,
        });
        // 버전 히스토리 스냅샷(직전과 동일하면 건너뜀). 실제 적립 시에만 서버에도 적립.
        const versionAdded = pushVersion(flowchartId, title, next);
        if (versionAdded) {
          void saveFlowchartVersionApi(flowchartId, wsId ?? "", title, next);
        }
        // 서버 push 디바운스(1.5s) — 마지막 변경만 전송.
        if (pushTimer.current) window.clearTimeout(pushTimer.current);
        pushTimer.current = window.setTimeout(() => {
          void pushFlowchartApi(record);
        }, 1500);
      }
      updateAttributes({ data: serializeFlowchart(next) });
    },
    [flowchartId, title, upsertLocal, updateAttributes, pushVersion],
  );

  // 버전 복원 — 해당 스냅샷을 현재 상태로 저장(동기화·새 버전 누적 포함).
  const handleRestore = useCallback(
    (restored: FlowchartData) => {
      persist(restored);
      setHistoryOpen(false);
    },
    [persist],
  );

  const handleSave = useCallback(
    (next: FlowchartData) => {
      persist(next);
      setEditing(false);
    },
    [persist],
  );

  // 자동 저장 — 모달을 닫지 않고 저장소/스냅샷만 갱신
  const handleAutoSave = useCallback(
    (next: FlowchartData) => {
      persist(next);
    },
    [persist],
  );

  const isEmpty = data.nodes.length === 0;

  // 미리보기 박스를 저장된 도형 바운딩박스의 가로:세로 비율로 맞춘다.
  // 높이 상한을 두지 않아, 세로로 긴 차트는 박스도 같이 길어진다(내용이 작아지지 않음).
  const stageStyle = useMemo(() => {
    const b = getFlowchartBounds(data);
    if (!b) return { height: 180 } as const;
    return {
      aspectRatio: `${b.width} / ${b.height}`,
      minHeight: 140,
    } as const;
  }, [data]);

  return (
    <NodeViewWrapper
      as="div"
      data-flowchart-block="true"
      className={`group/flowchart my-2 overflow-hidden rounded-lg border ${
        selected
          ? "border-sky-400 ring-2 ring-sky-200 dark:ring-sky-900"
          : "border-zinc-200 dark:border-zinc-700"
      }`}
    >
      {/* 블록 헤더 — 제목 표시/편집 + 우측 버전 히스토리·전체보기 */}
      <div className="flex items-center gap-2 border-b border-zinc-200 bg-white px-3 py-1.5 dark:border-zinc-700 dark:bg-zinc-900">
        <Workflow className="h-4 w-4 shrink-0 text-zinc-400" />
        {editor.isEditable ? (
          <input
            type="text"
            value={title}
            onChange={(e) => updateAttributes({ title: e.target.value })}
            placeholder="제목 없음"
            // 평소엔 텍스트처럼, 호버/포커스 시 입력 필드로 보이게
            className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-medium text-zinc-800 outline-none placeholder:font-normal placeholder:text-zinc-400 hover:border-zinc-300 focus:border-sky-400 dark:text-zinc-100 dark:hover:border-zinc-600"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate px-1.5 text-sm font-medium text-zinc-800 dark:text-zinc-100">
            {title}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            aria-label="버전 히스토리"
            title="버전 히스토리"
            onClick={() => setHistoryOpen(true)}
            className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <History className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="전체보기"
            title="전체보기"
            disabled={isEmpty}
            onClick={() => setFullViewOpen(true)}
            className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div
        onDoubleClick={openEditor}
        className="relative w-full bg-zinc-50 dark:bg-zinc-900"
        style={stageStyle}
        role="button"
        tabIndex={0}
        title={editor.isEditable ? "더블클릭하여 편집" : undefined}
      >
        {isEmpty ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-zinc-400">
            <Workflow className="h-8 w-8" />
            <span className="text-sm">
              빈 플로우차트{editor.isEditable ? " · 더블클릭하여 편집" : ""}
            </span>
          </div>
        ) : (
          <div className="h-full w-full">
            <FlowchartStaticPreview data={data} onNodeLink={onNodeLink} />
          </div>
        )}
      </div>

      <FlowchartEditorModal
        open={editing}
        initial={data}
        onSave={handleSave}
        onAutoSave={handleAutoSave}
        onClose={() => setEditing(false)}
      />

      <FlowchartFullViewModal
        open={fullViewOpen}
        data={data}
        title={title}
        onClose={() => setFullViewOpen(false)}
      />

      <FlowchartHistoryDialog
        open={historyOpen}
        flowchartId={flowchartId}
        editable={editor.isEditable}
        onRestore={handleRestore}
        onClose={() => setHistoryOpen(false)}
      />
    </NodeViewWrapper>
  );
}
