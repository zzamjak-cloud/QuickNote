import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Database,
  Kanban,
  GalleryHorizontal,
  GanttChartSquare,
  Table2,
  Link2,
  Plus,
  ArrowLeft,
  Trash2,
  PanelTop,
  Lock,
  Unlock,
} from "lucide-react";
import { listDatabases, useDatabaseStore } from "../../store/databaseStore";
import { usePageStore } from "../../store/pageStore";
import { useSettingsStore } from "../../store/settingsStore";
import type {
  DatabaseLayout,
  DatabasePanelState,
  ViewKind,
} from "../../types/database";
import { emptyPanelState } from "../../types/database";
import { DatabaseTableView } from "./views/DatabaseTableView";
import { DatabaseKanbanView } from "./views/DatabaseKanbanView";
import { DatabaseGalleryView } from "./views/DatabaseGalleryView";
import { DatabaseTimelineView } from "./views/DatabaseTimelineView";
import { DatabaseToolbarControls } from "./DatabaseToolbarControls";
function parsePanelState(raw: string): DatabasePanelState {
  try {
    const o = JSON.parse(raw) as Partial<DatabasePanelState>;
    return { ...emptyPanelState(), ...o };
  } catch {
    return emptyPanelState();
  }
}

/** ProseMirror 업데이트를 렌더링 밖으로 미뤄 React 19 flushSync 경고 방지 */
function scheduleAttrsUpdate(
  fn: () => void,
): void {
  queueMicrotask(fn);
}

const VIEW_ICONS: Record<ViewKind, typeof Table2> = {
  table: Table2,
  kanban: Kanban,
  timeline: GanttChartSquare,
  gallery: GalleryHorizontal,
};

/** 뷰 토글 라벨(한국어). */
const VIEW_LABELS: Record<ViewKind, string> = {
  table: "표",
  kanban: "칸반",
  timeline: "타임라인",
  gallery: "갤러리",
};

export function DatabaseBlockView(props: NodeViewProps) {
  const { node, updateAttributes, deleteNode } = props;
  const databaseId = String(node.attrs.databaseId ?? "");
  const readOnlyTitleAttr = Boolean(node.attrs.readOnlyTitle);
  const deletionLocked = Boolean(node.attrs.deletionLocked);
  const layout = (node.attrs.layout ?? "inline") as DatabaseLayout;
  // 레거시 'list' 값은 표 뷰로 자동 매핑
  const rawView = String(node.attrs.view ?? "table");
  const view = (rawView === "list" ? "table" : rawView) as ViewKind;
  const panelState = parsePanelState(String(node.attrs.panelState ?? "{}"));
  const panelStateRef = useRef(panelState);
  panelStateRef.current = panelState;

  const bundle = useDatabaseStore((s) => s.databases[databaseId]);
  const hasDatabaseId = databaseId.length > 0;
  /** 메모에 DB id 없음 — 연결 UI (슬래시 삽입 시 빈 DB 자동 생성 방지) */
  const needsBinding = !hasDatabaseId;
  /** id 있음, 저장소에 없음(삭제됨) */
  const bundleGone = hasDatabaseId && !bundle;

  const setDatabaseTitle = useDatabaseStore((s) => s.setDatabaseTitle);
  const deleteDatabaseFromStore = useDatabaseStore((s) => s.deleteDatabase);
  const renamePage = usePageStore((s) => s.renamePage);
  const activePageId = usePageStore((s) => s.activePageId);
  const pages = usePageStore((s) => s.pages);
  const findFullPagePageIdForDatabase = usePageStore(
    (s) => s.findFullPagePageIdForDatabase,
  );
  const setActivePageNav = usePageStore((s) => s.setActivePage);
  const setCurrentTabPage = useSettingsStore((s) => s.setCurrentTabPage);

  /** 전체 페이지 DB가 있으면 인라인은 참조 뷰로 보고 제목 편집 불가 + 원본 페이지 이동 허용 */
  const dbHomePageId = useMemo(
    () => findFullPagePageIdForDatabase(databaseId),
    [databaseId, pages, findFullPagePageIdForDatabase],
  );

  const inlineTitleLocked =
    layout === "inline" && (readOnlyTitleAttr || dbHomePageId != null);

  const openDbHomePage = useCallback(
    (pageId: string) => {
      setActivePageNav(pageId);
      setCurrentTabPage(pageId);
    },
    [setActivePageNav, setCurrentTabPage],
  );

  const displayDbTitle = bundle?.meta.title ?? "데이터베이스";
  /** 삭제 확인 입력값 — 「{표시 이름} 삭제」 */
  const deleteConfirmPhrase = useMemo(() => {
    const name = displayDbTitle.trim() || "데이터베이스";
    return `${name} 삭제`;
  }, [displayDbTitle]);

  const [titleDraft, setTitleDraft] = useState(displayDbTitle);
  useEffect(() => {
    setTitleDraft(displayDbTitle);
  }, [displayDbTitle, databaseId]);

  const commitDbTitle = () => {
    if (!hasDatabaseId) return;
    const t = titleDraft.trim() || "제목 없음";
    const ok = setDatabaseTitle(databaseId, t);
    if (!ok) {
      alert("이미 사용 중인 데이터베이스 이름입니다.");
      setTitleDraft(displayDbTitle);
      return;
    }
    if (layout === "fullPage" && activePageId) {
      renamePage(activePageId, t);
    }
  };

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletePhraseDraft, setDeletePhraseDraft] = useState("");

  const openDeleteDatabaseModal = () => {
    setDeletePhraseDraft("");
    setDeleteModalOpen(true);
  };

  const closeDeleteDatabaseModal = () => {
    setDeleteModalOpen(false);
    setDeletePhraseDraft("");
  };

  const executeDeleteDatabasePermanently = () => {
    if (!hasDatabaseId) return;
    if (deletePhraseDraft.trim() !== deleteConfirmPhrase) {
      alert(
        `다음 문구를 정확히 입력하세요:\n「${deleteConfirmPhrase}」`,
      );
      return;
    }
    deleteDatabaseFromStore(databaseId);
    scheduleAttrsUpdate(() => {
      deleteNode();
    });
    closeDeleteDatabaseModal();
  };

  const [linkOpen, setLinkOpen] = useState(false);

  /** DB 미연결 시: 신규 vs 기존 선택 → 다음 단계 */
  type InlineBindingStep = "choose" | "new" | "link";
  const [inlineBindingStep, setInlineBindingStep] =
    useState<InlineBindingStep>("choose");

  const setPanelState = useCallback(
    (patch: Partial<DatabasePanelState>) => {
      scheduleAttrsUpdate(() => {
        const next = { ...panelStateRef.current, ...patch };
        panelStateRef.current = next;
        updateAttributes({ panelState: JSON.stringify(next) });
      });
    },
    [updateAttributes],
  );

  const setView = useCallback(
    (v: ViewKind) => {
      scheduleAttrsUpdate(() => {
        updateAttributes({ view: v });
      });
    },
    [updateAttributes],
  );

  const databasesList = useDatabaseStore(listDatabases);

  const bindToExistingDatabase = useCallback(
    (id: string) => {
      if (!id) return;
      const linked = useDatabaseStore.getState().databases[id];
      scheduleAttrsUpdate(() => {
        updateAttributes(
          layout === "fullPage"
            ? { databaseId: id }
            : { databaseId: id, readOnlyTitle: true },
        );
      });
      if (layout === "fullPage" && activePageId && linked) {
        renamePage(activePageId, linked.meta.title);
      }
      setLinkOpen(false);
    },
    [layout, activePageId, updateAttributes, renamePage],
  );

  const createNewDatabaseAndBind = useCallback(() => {
    const id = useDatabaseStore.getState().createDatabase();
    const linked = useDatabaseStore.getState().databases[id];
    scheduleAttrsUpdate(() => {
      updateAttributes({ databaseId: id, readOnlyTitle: false });
    });
    if (layout === "fullPage" && activePageId && linked) {
      renamePage(activePageId, linked.meta.title);
    }
    setLinkOpen(false);
  }, [layout, activePageId, updateAttributes, renamePage]);

  const shellClass =
    layout === "fullPage"
      ? "my-4 w-[calc(100%+6rem)] max-w-none -mx-12"
      : "my-4";

  const viewToggleButtons = useMemo(
    () =>
      (Object.keys(VIEW_ICONS) as ViewKind[]).map((vk) => {
        const Icon = VIEW_ICONS[vk];
        const on = view === vk;
        return (
          <button
            key={vk}
            type="button"
            title={VIEW_LABELS[vk]}
            onClick={() => setView(vk)}
            className={[
              "flex items-center gap-1 rounded px-2 py-1 text-xs",
              on
                ? "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100"
                : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800",
            ].join(" ")}
          >
            <Icon size={14} />
            <span>{VIEW_LABELS[vk]}</span>
          </button>
        );
      }),
    [view, setView],
  );

  const activeViewComponent = useMemo(() => {
    if (!bundle) return null;
    switch (view) {
      case "table":
        return (
          <DatabaseTableView
            databaseId={databaseId}
            panelState={panelState}
            setPanelState={setPanelState}
          />
        );
      case "kanban":
        return (
          <DatabaseKanbanView
            databaseId={databaseId}
            panelState={panelState}
            setPanelState={setPanelState}
          />
        );
      case "gallery":
        return (
          <DatabaseGalleryView
            databaseId={databaseId}
            panelState={panelState}
            setPanelState={setPanelState}
          />
        );
      case "timeline":
        return (
          <DatabaseTimelineView
            databaseId={databaseId}
            panelState={panelState}
            setPanelState={setPanelState}
          />
        );
      default:
        return null;
    }
  }, [databaseId, bundle, panelState, setPanelState, view]);

  return (
    <NodeViewWrapper className="qn-database-block">
      <div
        className={shellClass}
        // 내부 컨트롤(버튼/입력) 클릭이 ProseMirror로 버블링되어 atom 노드를
        // 자동 선택(파란 배경 + BubbleToolbar 표시)하는 것을 차단.
        onMouseDown={(e) => e.stopPropagation()}
      >
        {needsBinding ? (
          <div className="p-2">
            <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50/60 px-3 py-4 text-xs dark:border-zinc-600 dark:bg-zinc-900/40">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                <Database size={16} className="shrink-0 text-zinc-500" />
                데이터베이스 블록 설정
              </div>

              {inlineBindingStep === "choose" ? (
                <>
                  <p className="mb-3 text-zinc-500 dark:text-zinc-400">
                    신규로 만들지, 이미 있는 데이터베이스에 연결할지 먼저
                    선택하세요. 연결이 완료될 때만 저장소에 DB가 반영됩니다.
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
                    <button
                      type="button"
                      className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
                      onClick={() => setInlineBindingStep("new")}
                    >
                      <Plus size={16} strokeWidth={2.25} />
                      새 데이터베이스 만들기
                    </button>
                    <button
                      type="button"
                      className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
                      onClick={() => setInlineBindingStep("link")}
                    >
                      <Link2 size={16} strokeWidth={2.25} />
                      기존 데이터베이스 연결
                    </button>
                  </div>
                </>
              ) : inlineBindingStep === "new" ? (
                <>
                  <p className="mb-3 text-zinc-500 dark:text-zinc-400">
                    새 데이터베이스가 저장소에 생성되고 이 블록에 바로 연결됩니다.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                      onClick={createNewDatabaseAndBind}
                    >
                      생성하고 연결
                    </button>
                    <button
                      type="button"
                      className="text-sm text-zinc-500 underline-offset-2 hover:text-zinc-700 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
                      onClick={() => setInlineBindingStep("choose")}
                    >
                      뒤로
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="mb-2 text-zinc-500 dark:text-zinc-400">
                    목록에서 연결할 데이터베이스를 고르세요.
                  </p>
                  <label className="mb-1 block text-zinc-600 dark:text-zinc-500">
                    기존 데이터베이스
                  </label>
                  <select
                    className="mb-3 w-full max-w-md rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-900"
                    value=""
                    onChange={(e) => bindToExistingDatabase(e.target.value)}
                  >
                    <option value="">선택…</option>
                    {databasesList.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.meta.title}
                      </option>
                    ))}
                  </select>
                  {databasesList.length === 0 ? (
                    <p className="mb-2 text-amber-700 dark:text-amber-400">
                      아직 저장된 데이터베이스가 없습니다. 「뒤로」에서 새로
                      만들기를 선택하세요.
                    </p>
                  ) : null}
                  <button
                    type="button"
                    className="text-sm text-zinc-500 underline-offset-2 hover:text-zinc-700 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
                    onClick={() => setInlineBindingStep("choose")}
                  >
                    뒤로
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <>
            {layout === "inline" ? (
              <>
                <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-2 py-2 dark:border-zinc-700">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Database size={16} className="shrink-0 text-zinc-500" />
                    {inlineTitleLocked ? (
                      <span
                        className="min-w-0 truncate text-left text-sm font-medium text-zinc-800 dark:text-zinc-200"
                        title={displayDbTitle}
                      >
                        {displayDbTitle}
                      </span>
                    ) : (
                      <input
                        type="text"
                        value={titleDraft}
                        onChange={(e) => setTitleDraft(e.target.value)}
                        onBlur={commitDbTitle}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        placeholder="데이터베이스 이름"
                        title="이름 변경"
                        className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-left text-sm font-medium text-zinc-800 outline-none focus:border-zinc-300 dark:text-zinc-200 dark:focus:border-zinc-600"
                      />
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {dbHomePageId != null ? (
                      <button
                        type="button"
                        title="데이터베이스 전체 페이지로 이동"
                        onClick={() => openDbHomePage(dbHomePageId)}
                        className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        <PanelTop size={15} />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      title={
                        deletionLocked
                          ? "삭제 잠금 해제 — 블록 삭제 허용"
                          : "삭제 잠금 — 키보드·그립 메뉴·박스 선택 삭제 방지"
                      }
                      onClick={() =>
                        scheduleAttrsUpdate(() =>
                          updateAttributes({ deletionLocked: !deletionLocked }),
                        )
                      }
                      className={[
                        "rounded p-1",
                        deletionLocked
                          ? "text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30"
                          : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800",
                      ].join(" ")}
                    >
                      {deletionLocked ? (
                        <Lock size={15} strokeWidth={2.25} />
                      ) : (
                        <Unlock size={15} strokeWidth={2} />
                      )}
                    </button>
                    <button
                      type="button"
                      title="다른 DB 연결"
                      onClick={() => setLinkOpen((v) => !v)}
                      className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <Link2 size={15} />
                    </button>
                    <button
                      type="button"
                      title="데이터베이스 영구 삭제…"
                      onClick={openDeleteDatabaseModal}
                      className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5">
                  {viewToggleButtons}
                </div>
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-1 px-2 py-1.5">
                <div className="flex flex-wrap items-center gap-0.5">
                  {viewToggleButtons}
                </div>
                <div className="ml-auto flex items-center gap-0.5">
                  <button
                    type="button"
                    title="다른 DB 연결"
                    onClick={() => setLinkOpen((v) => !v)}
                    className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <Link2 size={15} />
                  </button>
                  <button
                    type="button"
                    title="데이터베이스 영구 삭제…"
                    onClick={openDeleteDatabaseModal}
                    className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            )}

            <DatabaseToolbarControls
              databaseId={databaseId}
              panelState={panelState}
              setPanelState={setPanelState}
            />

            {linkOpen && (
              <div className="border-b border-zinc-200 px-3 py-2 text-xs dark:border-zinc-700">
                <div className="mb-1 font-medium text-zinc-700 dark:text-zinc-300">
                  기존 데이터베이스에 연결
                </div>
                <select
                  className="w-full max-w-xs rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-600 dark:bg-zinc-900"
                  value=""
                  onChange={(e) => bindToExistingDatabase(e.target.value)}
                >
                  <option value="">선택…</option>
                  {databasesList
                    .filter((d) => d.id !== databaseId)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.meta.title}
                      </option>
                    ))}
                </select>
              </div>
            )}

            <div className="p-2">
              {bundleGone ? (
                <div className="flex items-center gap-2 px-2 py-8 text-sm text-amber-700 dark:text-amber-400">
                  <ArrowLeft size={16} />
                  데이터를 찾을 수 없습니다. 연결을 다른 DB로 바꾸거나 블록을
                  삭제하세요.
                </div>
              ) : (
                activeViewComponent
              )}
            </div>
          </>
        )}
      </div>

      {deleteModalOpen && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/45 p-4"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeDeleteDatabaseModal();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="qn-db-delete-title"
            className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2
              id="qn-db-delete-title"
              className="text-base font-semibold text-zinc-900 dark:text-zinc-100"
            >
              데이터베이스 영구 삭제
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              「{bundle?.meta.title ?? "데이터베이스"}」와 모든 속성·행 데이터가 저장소에서
              삭제됩니다. 다른 페이지에 연결된 같은 DB 블록도 더 이상 불러오지 못합니다.
            </p>
            <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">
              계속하려면 아래 입력란에 다음 문구를{" "}
              <span className="font-semibold">정확히</span> 입력하세요.
            </p>
            <p className="mt-1 rounded-md bg-zinc-100 px-2 py-1.5 font-mono text-sm text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
              {deleteConfirmPhrase}
            </p>
            <input
              type="text"
              value={deletePhraseDraft}
              onChange={(e) => setDeletePhraseDraft(e.target.value)}
              placeholder={deleteConfirmPhrase}
              autoComplete="off"
              className="mt-3 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeDeleteDatabaseModal}
                className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                취소
              </button>
              <button
                type="button"
                onClick={executeDeleteDatabasePermanently}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                삭제 실행
              </button>
            </div>
          </div>
        </div>
      )}
    </NodeViewWrapper>
  );
}
