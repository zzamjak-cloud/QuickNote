import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useUiStore } from "../../store/uiStore";
import {
  createWorkspaceApi,
  deleteWorkspaceApi,
  getWorkspaceApi,
  setWorkspaceAccessApi,
  updateWorkspaceApi,
  type WorkspaceAccessInput,
} from "../../lib/sync/workspaceApi";
import { CreateWorkspaceModal } from "../workspace/CreateWorkspaceModal";
import { EditWorkspaceModal } from "../workspace/EditWorkspaceModal";
import { WorkspaceDeleteConfirmDialog } from "../workspace/WorkspaceDeleteConfirmDialog";

export function AdminWorkspacesTab() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const upsertWorkspace = useWorkspaceStore((s) => s.upsertWorkspace);
  const removeWorkspace = useWorkspaceStore((s) => s.removeWorkspace);
  const showToast = useUiStore((s) => s.showToast);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [deletingWorkspaceId, setDeletingWorkspaceId] = useState<string | null>(null);
  const [loadingWorkspaceId, setLoadingWorkspaceId] = useState<string | null>(null);
  const [openCreate, setOpenCreate] = useState(false);
  const [openEdit, setOpenEdit] = useState(false);
  const [editEntries, setEditEntries] = useState<WorkspaceAccessInput[]>([]);
  const [deletePhraseDraft, setDeletePhraseDraft] = useState("");

  const shared = useMemo(
    () => workspaces.filter((w) => w.type === "shared"),
    [workspaces],
  );
  const editingWorkspace = useMemo(
    () => shared.find((w) => w.workspaceId === editingWorkspaceId) ?? null,
    [shared, editingWorkspaceId],
  );
  const deletingWorkspace = useMemo(
    () => shared.find((w) => w.workspaceId === deletingWorkspaceId) ?? null,
    [shared, deletingWorkspaceId],
  );
  const deleteConfirmPhrase = useMemo(() => {
    const name = deletingWorkspace?.name?.trim() || "워크스페이스";
    return `${name} 삭제`;
  }, [deletingWorkspace]);

  const openEditModal = async (workspaceId: string) => {
    const target = shared.find((w) => w.workspaceId === workspaceId);
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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">워크스페이스 관리</h3>
        <button
          type="button"
          onClick={() => setOpenCreate(true)}
          className="inline-flex items-center gap-1 rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          <Plus size={12} />
          워크스페이스 생성
        </button>
      </div>
      <div className="rounded-md border border-zinc-200 dark:border-zinc-700">
        <div className="border-b border-zinc-100 px-3 py-2 text-xs font-medium dark:border-zinc-800">
          공유 워크스페이스
        </div>
        <ul className="grid max-h-[420px] grid-cols-1 gap-2 overflow-y-auto p-2 text-xs md:grid-cols-2 xl:grid-cols-3">
          {shared.length === 0 ? (
            <li className="col-span-full rounded border border-dashed border-zinc-300 px-3 py-6 text-center text-zinc-500 dark:border-zinc-700">
              공유 워크스페이스가 없습니다.
            </li>
          ) : (
            shared.map((ws) => (
              <li key={ws.workspaceId}>
                <button
                  type="button"
                  onClick={() => void openEditModal(ws.workspaceId)}
                  disabled={loadingWorkspaceId !== null}
                  className="flex w-full items-center justify-between rounded border border-zinc-200 px-3 py-2 text-left hover:bg-zinc-50 disabled:cursor-wait disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{ws.name}</span>
                    <span className="block text-[10px] lowercase text-zinc-500 dark:text-zinc-400">
                      {loadingWorkspaceId === ws.workspaceId ? "불러오는 중..." : "workspace"}
                    </span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
      <CreateWorkspaceModal
        open={openCreate}
        onClose={() => setOpenCreate(false)}
        onCreate={async (input) => {
          const created = await createWorkspaceApi(input);
          upsertWorkspace(created);
        }}
      />
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
          }}
          onRequestDelete={() => {
            setDeletingWorkspaceId(editingWorkspace.workspaceId);
            setDeletePhraseDraft("");
          }}
        />
      ) : null}
      <WorkspaceDeleteConfirmDialog
        open={Boolean(deletingWorkspace)}
        workspaceName={deletingWorkspace?.name ?? "워크스페이스"}
        deleteConfirmPhrase={deleteConfirmPhrase}
        deletePhraseDraft={deletePhraseDraft}
        onDeletePhraseChange={setDeletePhraseDraft}
        onClose={() => {
          setDeletingWorkspaceId(null);
          setDeletePhraseDraft("");
        }}
        onConfirmDelete={() => {
          if (!deletingWorkspace) return;
          if (deletePhraseDraft.trim() !== deleteConfirmPhrase) {
            alert(`다음 문구를 정확히 입력하세요:\n「${deleteConfirmPhrase}」`);
            return;
          }
          void (async () => {
            const ok = await deleteWorkspaceApi(deletingWorkspace.workspaceId);
            if (ok) {
              removeWorkspace(deletingWorkspace.workspaceId);
              if (editingWorkspaceId === deletingWorkspace.workspaceId) {
                setEditingWorkspaceId(null);
              }
            }
            setDeletingWorkspaceId(null);
            setDeletePhraseDraft("");
          })();
        }}
      />
    </div>
  );
}
