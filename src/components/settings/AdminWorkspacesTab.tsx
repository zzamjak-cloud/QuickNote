import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useUiStore } from "../../store/uiStore";
import {
  createWorkspaceApi,
  deleteWorkspaceApi,
  getWorkspaceApi,
  restoreWorkspaceApi,
  setWorkspaceAccessApi,
  updateWorkspaceApi,
  type WorkspaceAccessInput,
} from "../../lib/sync/workspaceApi";
import { CreateWorkspaceModal } from "../workspace/CreateWorkspaceModal";
import { EditWorkspaceModal } from "../workspace/EditWorkspaceModal";
import { WorkspaceDeleteConfirmDialog } from "../workspace/WorkspaceDeleteConfirmDialog";

type TabType = "active" | "archived";

export function AdminWorkspacesTab() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const upsertWorkspace = useWorkspaceStore((s) => s.upsertWorkspace);
  const showToast = useUiStore((s) => s.showToast);
  const [activeTab, setActiveTab] = useState<TabType>("active");
  const [listQuery, setListQuery] = useState("");
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [loadingWorkspaceId, setLoadingWorkspaceId] = useState<string | null>(null);
  const [openCreate, setOpenCreate] = useState(false);
  const [openEdit, setOpenEdit] = useState(false);
  const [editEntries, setEditEntries] = useState<WorkspaceAccessInput[]>([]);
  const [archivedActionId, setArchivedActionId] = useState<string | null>(null);
  const [archivedActionLoading, setArchivedActionLoading] = useState(false);
  const [deleteWorkspaceId, setDeleteWorkspaceId] = useState<string | null>(null);
  const [deletePhraseDraft, setDeletePhraseDraft] = useState("");

  // 활성/보관 공유 워크스페이스 분류 + 목록 검색 필터
  const sharedAll = useMemo(
    () => workspaces.filter((w) => w.type === "shared"),
    [workspaces],
  );
  const activeWorkspaces = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    return sharedAll
      .filter((w) => !w.removedAt)
      .filter((w) => !q || w.name.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [sharedAll, listQuery]);
  const archivedWorkspaces = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    return sharedAll
      .filter((w) => !!w.removedAt)
      .filter((w) => !q || w.name.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [sharedAll, listQuery]);

  const editingWorkspace = useMemo(
    () => sharedAll.find((w) => w.workspaceId === editingWorkspaceId) ?? null,
    [sharedAll, editingWorkspaceId],
  );

  const openEditModal = async (workspaceId: string) => {
    const target = sharedAll.find((w) => w.workspaceId === workspaceId);
    if (!target) return;
    setLoadingWorkspaceId(target.workspaceId);
    setOpenEdit(false);
    try {
      const detail = await getWorkspaceApi(target.workspaceId);
      setEditEntries(detail.access);
      setEditingWorkspaceId(target.workspaceId);
      setOpenEdit(true);
    } catch {
      showToast("워크스페이스 정보를 불러오지 못했습니다.", { kind: "error" });
    } finally {
      setLoadingWorkspaceId(null);
    }
  };

  // 보관 워크스페이스 복원
  const onRestoreWorkspace = async (workspaceId: string) => {
    const restored = await restoreWorkspaceApi(workspaceId);
    if (restored) upsertWorkspace(restored);
  };

  return (
    <div className="space-y-3">
      <div className="flex h-9 items-center justify-end">
        <button
          type="button"
          onClick={() => setOpenCreate(true)}
          style={{ visibility: activeTab === "active" ? "visible" : "hidden" }}
          className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
        >
          <Plus size={13} />
          워크스페이스 생성
        </button>
      </div>

      {/* 워크스페이스 / 보관함 탭 + 검색 */}
      <div className="flex items-center gap-2 border-b border-zinc-200 dark:border-zinc-700">
        <button
          type="button"
          onClick={() => setActiveTab("active")}
          className={`px-3 py-1.5 text-sm font-medium transition-colors ${
            activeTab === "active"
              ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
              : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          }`}
        >
          워크스페이스
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("archived")}
          className={`px-3 py-1.5 text-sm font-medium transition-colors ${
            activeTab === "archived"
              ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
              : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          }`}
        >
          보관함
        </button>
        <div className="ml-auto flex items-center gap-1.5 rounded-md border border-zinc-200 px-2 py-1 dark:border-zinc-700">
          <Search size={13} className="text-zinc-400" />
          <input
            value={listQuery}
            onChange={(e) => setListQuery(e.target.value)}
            placeholder="워크스페이스 검색"
            className="w-36 bg-transparent text-sm outline-none placeholder:text-zinc-400"
          />
        </div>
      </div>

      {activeTab === "active" ? (
        /* 활성 워크스페이스 목록 */
        <ul className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2 xl:grid-cols-3">
          {activeWorkspaces.length === 0 ? (
            <li className="col-span-full rounded border border-dashed border-zinc-300 px-3 py-6 text-center text-zinc-500 dark:border-zinc-700">
              공유 워크스페이스가 없습니다.
            </li>
          ) : (
            activeWorkspaces.map((ws) => (
              <li key={ws.workspaceId}>
                <button
                  type="button"
                  aria-label={`${ws.name} 설정 편집`}
                  onClick={() => void openEditModal(ws.workspaceId)}
                  disabled={loadingWorkspaceId !== null}
                  className="flex w-full items-center justify-between rounded border border-zinc-200 px-3 py-2 text-left hover:bg-zinc-50 disabled:cursor-wait disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{ws.name}</span>
                    <span className="block text-xs lowercase text-zinc-500 dark:text-zinc-400">
                      {loadingWorkspaceId === ws.workspaceId ? "불러오는 중..." : "workspace"}
                    </span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : (
        /* 보관된 워크스페이스 목록 */
        <ul className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2 xl:grid-cols-3">
          {archivedWorkspaces.length === 0 ? (
            <li className="col-span-full rounded border border-dashed border-zinc-300 px-3 py-6 text-center text-zinc-500 dark:border-zinc-700">
              보관된 워크스페이스 없음
            </li>
          ) : (
            archivedWorkspaces.map((ws) => (
              <li key={ws.workspaceId}>
                <button
                  type="button"
                  aria-label={`${ws.name} 관리`}
                  onClick={() => setArchivedActionId(ws.workspaceId)}
                  className="flex w-full items-center justify-between rounded border border-zinc-200 px-3 py-2 text-left hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-zinc-600 dark:text-zinc-300">{ws.name}</span>
                    <span className="block text-xs text-zinc-400">workspace</span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}

      <CreateWorkspaceModal
        open={openCreate}
        onClose={() => setOpenCreate(false)}
        onCreate={async (input) => {
          const created = await createWorkspaceApi(input);
          upsertWorkspace(created);
        }}
      />
      {/* 보관된 워크스페이스 액션 팝업 */}
      {archivedActionId && (() => {
        const ws = archivedWorkspaces.find((w) => w.workspaceId === archivedActionId);
        if (!ws) return null;
        return (
          <div
            className="fixed inset-0 z-[530] flex items-center justify-center bg-black/45 p-4"
            role="presentation"
            onMouseDown={(e) => { if (e.target === e.currentTarget) setArchivedActionId(null); }}
          >
            <div
              role="dialog"
              aria-modal="true"
              className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <h4 className="text-sm font-semibold">{ws.name}</h4>
              <p className="mt-1 text-xs text-zinc-500">보관된 워크스페이스입니다.</p>
              <div className="mt-4 flex justify-between gap-2">
                <button
                  type="button"
                  disabled={archivedActionLoading}
                  onClick={async () => {
                    setArchivedActionLoading(true);
                    try {
                      await deleteWorkspaceApi(ws.workspaceId);
                      const removeWs = useWorkspaceStore.getState().workspaces.filter(
                        (w) => w.workspaceId !== ws.workspaceId,
                      );
                      useWorkspaceStore.setState({ workspaces: removeWs });
                      setArchivedActionId(null);
                    } catch {
                      showToast("삭제에 실패했습니다.", { kind: "error" });
                    } finally {
                      setArchivedActionLoading(false);
                    }
                  }}
                  className="rounded border border-red-200 px-3 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/40"
                >
                  영구 삭제
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setArchivedActionId(null)}
                    disabled={archivedActionLoading}
                    className="rounded border px-3 py-1 text-xs disabled:opacity-60"
                  >
                    닫기
                  </button>
                  <button
                    type="button"
                    disabled={archivedActionLoading}
                    onClick={async () => {
                      setArchivedActionLoading(true);
                      try {
                        await onRestoreWorkspace(ws.workspaceId);
                        setArchivedActionId(null);
                      } finally {
                        setArchivedActionLoading(false);
                      }
                    }}
                    className="rounded bg-blue-600 px-3 py-1 text-xs text-white disabled:opacity-60 hover:bg-blue-700"
                  >
                    복원
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {editingWorkspace ? (
        <EditWorkspaceModal
          open={openEdit}
          workspaceName={editingWorkspace.name}
          initialEntries={editEntries}
          onClose={() => {
            setOpenEdit(false);
            setEditingWorkspaceId(null);
            setEditEntries([]);
          }}
          onSave={async ({ name, entries }) => {
            if (!editingWorkspace) return;
            const updated = await updateWorkspaceApi({
              workspaceId: editingWorkspace.workspaceId,
              name,
            });
            const accessUpdated = await setWorkspaceAccessApi({
              workspaceId: editingWorkspace.workspaceId,
              entries,
            });
            upsertWorkspace({
              ...updated,
              myEffectiveLevel: accessUpdated.myEffectiveLevel,
            });
            showToast("저장되었습니다.", { kind: "success" });
          }}
          onRequestDelete={() => {
            setDeleteWorkspaceId(editingWorkspace.workspaceId);
            setDeletePhraseDraft("");
          }}
        />
      ) : null}
      {editingWorkspace ? (
        <WorkspaceDeleteConfirmDialog
          open={deleteWorkspaceId === editingWorkspace.workspaceId}
          workspaceName={editingWorkspace.name}
          deleteConfirmPhrase={`${editingWorkspace.name} 삭제`}
          deletePhraseDraft={deletePhraseDraft}
          onDeletePhraseChange={setDeletePhraseDraft}
          onClose={() => {
            setDeleteWorkspaceId(null);
            setDeletePhraseDraft("");
          }}
          onConfirmDelete={async () => {
            if (deletePhraseDraft !== `${editingWorkspace.name} 삭제`) return;
            await deleteWorkspaceApi(editingWorkspace.workspaceId);
            useWorkspaceStore.setState({
              workspaces: useWorkspaceStore
                .getState()
                .workspaces.filter((w) => w.workspaceId !== editingWorkspace.workspaceId),
            });
            setDeleteWorkspaceId(null);
            setDeletePhraseDraft("");
            setOpenEdit(false);
            setEditingWorkspaceId(null);
            setEditEntries([]);
          }}
        />
      ) : null}
    </div>
  );
}
