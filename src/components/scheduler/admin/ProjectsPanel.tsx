// 설정 모달 — 프로젝트 관리 패널 (리스트/보관함/편집 팝업).
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Plus, Trash2 } from "lucide-react";
import { useMemberStore } from "../../../store/memberStore";
import {
  useSchedulerProjectsStore,
  type SchedulerProject,
} from "../../../store/schedulerProjectsStore";
import { useSettingsStore } from "../../../store/settingsStore";
import { sortByKoreanName } from "../../../lib/memberSearch";
import { AdminListHeader } from "../../settings/AdminListHeader";
import { EntityCard } from "../../common/EntityCard";
import { EntityEditModal } from "../../common/EntityEditModal";

type FormState = {
  name: string;
  description: string;
  memberIds: string[];
  leaderMemberIds: string[];
};

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  memberIds: [],
  leaderMemberIds: [],
};

type TabType = "active" | "archived";

export function ProjectsPanel() {
  const { projects, workspaceId, createProject, updateProject, deleteProject } =
    useSchedulerProjectsStore(
      useShallow((s) => ({
        projects: s.projects,
        workspaceId: s.workspaceId,
        createProject: s.createProject,
        updateProject: s.updateProject,
        deleteProject: s.deleteProject,
      })),
    );
  const allMembers = useMemberStore((s) => s.members);
  const entityIcons = useSettingsStore((s) => s.entityIcons);
  const setEntityIcon = useSettingsStore((s) => s.setEntityIcon);

  const [activeTab, setActiveTab] = useState<TabType>("active");
  const [listQuery, setListQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);

  // 생성/편집 폼 상태
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const activeProjects = useMemo(
    () =>
      projects
        .filter((p) => !p.isHidden)
        .filter((p) => {
          const q = listQuery.trim().toLowerCase();
          return !q || p.name.toLowerCase().includes(q);
        })
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, "ko")),
    [listQuery, projects],
  );
  const archivedProjects = useMemo(
    () =>
      projects
        .filter((p) => p.isHidden)
        .filter((p) => {
          const q = listQuery.trim().toLowerCase();
          return !q || p.name.toLowerCase().includes(q);
        })
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, "ko")),
    [listQuery, projects],
  );

  const editingProject = useMemo(
    () => projects.find((p) => p.id === editingProjectId) ?? null,
    [editingProjectId, projects],
  );

  const membersById = useMemo(
    () => new Map(allMembers.map((m) => [m.memberId, m])),
    [allMembers],
  );

  const selectedMembers = useMemo(
    () =>
      sortByKoreanName(
        form.memberIds
          .map((id) => membersById.get(id))
          .filter((m): m is NonNullable<typeof m> => Boolean(m)),
      ),
    [form.memberIds, membersById],
  );

  const formatLeaderNames = (leaderMemberIds: string[]) => {
    if (leaderMemberIds.length === 0) return "-";
    const names = leaderMemberIds
      .map((id) => membersById.get(id)?.name)
      .filter((n): n is string => Boolean(n));
    return names.length === 0 ? "-" : names.join(", ");
  };

  // 편집 모달 열기 시 폼 초기화
  useEffect(() => {
    if (editingProject) {
      setForm({
        name: editingProject.name,
        description: editingProject.description ?? "",
        memberIds: [...editingProject.memberIds],
        leaderMemberIds: [...(editingProject.leaderMemberIds ?? [])],
      });
      setErrorMessage(null);
    }
  }, [editingProject]);

  // 생성 모달 열기 시 폼 초기화
  useEffect(() => {
    if (createOpen) {
      setForm(EMPTY_FORM);
      setErrorMessage(null);
    }
  }, [createOpen]);

  const sortMemberIdsByName = (ids: string[]) =>
    sortByKoreanName(
      ids.map((id) => membersById.get(id)).filter((m): m is NonNullable<typeof m> => Boolean(m)),
    ).map((m) => m.memberId);

  const updateMemberIds = (nextIds: string[]) => {
    const sorted = sortMemberIdsByName(Array.from(new Set(nextIds)));
    setForm((f) => ({
      ...f,
      memberIds: sorted,
      leaderMemberIds: f.leaderMemberIds.filter((id) => sorted.includes(id)),
    }));
  };

  const addMember = (memberId: string) =>
    updateMemberIds(
      form.memberIds.includes(memberId) ? form.memberIds : [...form.memberIds, memberId],
    );
  const removeMember = (memberId: string) =>
    updateMemberIds(form.memberIds.filter((id) => id !== memberId));
  const toggleLeader = (memberId: string) => {
    setForm((f) => ({
      ...f,
      leaderMemberIds: f.leaderMemberIds.includes(memberId)
        ? f.leaderMemberIds.filter((id) => id !== memberId)
        : f.memberIds.includes(memberId)
          ? [...f.leaderMemberIds, memberId]
          : f.leaderMemberIds,
    }));
  };

  const closeModal = () => {
    setCreateOpen(false);
    setEditingProjectId(null);
  };

  const handleSave = async () => {
    setErrorMessage(null);
    if (!workspaceId) {
      setErrorMessage("워크스페이스 정보를 확인할 수 없습니다.");
      return;
    }
    if (!form.name.trim()) {
      setErrorMessage("프로젝트 이름을 입력해 주세요.");
      return;
    }
    const normalized = sortMemberIdsByName(form.memberIds);
    const finalForm = {
      ...form,
      memberIds: normalized,
      leaderMemberIds: form.leaderMemberIds.filter((id) => normalized.includes(id)),
    };
    setSubmitting(true);
    try {
      if (createOpen) {
        await createProject({
          workspaceId,
          name: finalForm.name.trim(),
          description: finalForm.description.trim() || undefined,
          memberIds: finalForm.memberIds,
          leaderMemberIds: finalForm.leaderMemberIds,
          isHidden: false,
        });
      } else if (editingProject) {
        await updateProject({
          id: editingProject.id,
          workspaceId,
          name: finalForm.name.trim(),
          description: finalForm.description.trim() || undefined,
          memberIds: finalForm.memberIds,
          leaderMemberIds: finalForm.leaderMemberIds,
        });
      }
      closeModal();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "저장에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleArchive = async () => {
    if (!editingProject || !workspaceId) return;
    setSubmitting(true);
    try {
      await updateProject({ id: editingProject.id, workspaceId, isHidden: true });
      closeModal();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "보관함 이동에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRestore = async (projectId: string) => {
    if (!workspaceId) return;
    await updateProject({ id: projectId, workspaceId, isHidden: false });
  };

  const handleDelete = async (project: SchedulerProject) => {
    if (!workspaceId) return;
    if (!window.confirm(`"${project.name}" 프로젝트를 삭제하시겠습니까?`)) return;
    await deleteProject(project.id, workspaceId);
  };

  return (
    <div className="space-y-3">
      <div className="flex h-9 items-center justify-end">
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          style={{ visibility: activeTab === "active" ? "visible" : "hidden" }}
          className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
        >
          <Plus size={13} />
          프로젝트 추가
        </button>
      </div>

      <AdminListHeader
        leftLabel="프로젝트"
        activeTab={activeTab}
        query={listQuery}
        queryPlaceholder="프로젝트 검색"
        onChangeTab={setActiveTab}
        onChangeQuery={setListQuery}
      />

      {activeTab === "active" ? (
        activeProjects.length === 0 ? (
          <div className="flex h-24 items-center justify-center text-sm text-zinc-400">
            등록된 프로젝트가 없습니다.
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-2">
            {activeProjects.map((project) => (
              <li key={project.id}>
                <EntityCard
                  icon={entityIcons[project.id] ?? null}
                  name={project.name}
                  memberCount={project.memberIds.length}
                  leaderLabel={formatLeaderNames(project.leaderMemberIds ?? [])}
                  hasLeaders={(project.leaderMemberIds ?? []).length > 0}
                  onClick={() => setEditingProjectId(project.id)}
                />
              </li>
            ))}
          </ul>
        )
      ) : (
        <ul className="grid grid-cols-1 gap-2 text-sm">
          {archivedProjects.length === 0 ? (
            <li className="col-span-full rounded border border-dashed border-zinc-300 px-3 py-6 text-center text-zinc-500 dark:border-zinc-700">
              보관된 프로젝트가 없습니다.
            </li>
          ) : (
            archivedProjects.map((project) => (
              <li key={project.id}>
                <div className="flex items-center gap-2 rounded border border-zinc-200 px-3 py-2 dark:border-zinc-700">
                  <span className="min-w-0 flex-1 truncate text-zinc-500 line-through dark:text-zinc-400">
                    {project.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleRestore(project.id)}
                    className="rounded border border-zinc-200 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-700"
                  >
                    복원
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(project)}
                    className="rounded border border-red-200 p-1.5 text-red-500 hover:bg-red-50 dark:border-red-900/60 dark:hover:bg-red-900/20"
                    aria-label={`${project.name} 삭제`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </li>
            ))
          )}
        </ul>
      )}

      {/* 생성 모달 */}
      {createOpen && (
        <EntityEditModal
          name={form.name}
          onNameChange={(n) => setForm((f) => ({ ...f, name: n }))}
          icon={null}
          onIconChange={() => {}}
          description={form.description}
          onDescriptionChange={(d) => setForm((f) => ({ ...f, description: d }))}
          descriptionPlaceholder="프로젝트 소개"
          selectedMembers={selectedMembers}
          allMembers={allMembers}
          leaderMemberIds={form.leaderMemberIds}
          onToggleLeader={toggleLeader}
          onAddMember={addMember}
          onRemoveMember={removeMember}
          onSave={handleSave}
          onCancel={closeModal}
          saving={submitting}
        />
      )}

      {/* 편집 모달 */}
      {editingProject && (
        <EntityEditModal
          name={form.name}
          onNameChange={(n) => setForm((f) => ({ ...f, name: n }))}
          icon={entityIcons[editingProject.id] ?? null}
          onIconChange={(icon) => setEntityIcon(editingProject.id, icon)}
          description={form.description}
          onDescriptionChange={(d) => setForm((f) => ({ ...f, description: d }))}
          descriptionPlaceholder="프로젝트 소개"
          selectedMembers={selectedMembers}
          allMembers={allMembers}
          leaderMemberIds={form.leaderMemberIds}
          onToggleLeader={toggleLeader}
          onAddMember={addMember}
          onRemoveMember={removeMember}
          onSave={handleSave}
          onArchive={handleArchive}
          onCancel={closeModal}
          saving={submitting}
        />
      )}

      {errorMessage && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 rounded bg-red-600 px-4 py-2 text-sm text-white shadow-lg">
          {errorMessage}
        </div>
      )}
    </div>
  );
}
