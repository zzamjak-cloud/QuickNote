// 설정 모달 — 프로젝트 관리 패널 (리스트/보관함/편집 팝업).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { Crown, Plus, Search, Trash2 } from "lucide-react";
import { useMemberStore, type Member } from "../../../store/memberStore";
import {
  useSchedulerProjectsStore,
  type SchedulerProject,
} from "../../../store/schedulerProjectsStore";
import { DEFAULT_SCHEDULE_COLOR } from "../../../lib/scheduler/colors";
import { useMemberSuggestionDropdown } from "../../../hooks/useMemberSuggestionDropdown";
import { sortByKoreanName } from "../../../lib/memberSearch";
import { AdminListHeader } from "../../settings/AdminListHeader";

const EMPTY_FORM = {
  name: "",
  color: DEFAULT_SCHEDULE_COLOR,
  description: "",
  memberIds: [] as string[],
  leaderMemberIds: [] as string[],
};

type FormState = typeof EMPTY_FORM;
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
  const activeMembers = useMemo(
    () => allMembers.filter((member) => member.status === "active"),
    [allMembers],
  );

  const [activeTab, setActiveTab] = useState<TabType>("active");
  const [listQuery, setListQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);

  const activeProjects = useMemo(
    () =>
      projects
        .filter((project) => !project.isHidden)
        .filter((project) => {
          const q = listQuery.trim().toLowerCase();
          return !q || project.name.toLowerCase().includes(q);
        })
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, "ko")),
    [listQuery, projects],
  );
  const archivedProjects = useMemo(
    () =>
      projects
        .filter((project) => project.isHidden)
        .filter((project) => {
          const q = listQuery.trim().toLowerCase();
          return !q || project.name.toLowerCase().includes(q);
        })
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, "ko")),
    [listQuery, projects],
  );
  const editingProject = useMemo(
    () => projects.find((project) => project.id === editingProjectId) ?? null,
    [editingProjectId, projects],
  );
  const membersById = useMemo(
    () => new Map(allMembers.map((member) => [member.memberId, member])),
    [allMembers],
  );

  const formatLeaderNames = (leaderMemberIds: string[]) => {
    if (leaderMemberIds.length === 0) return "-";
    const names = leaderMemberIds
      .map((leaderId) => membersById.get(leaderId)?.name)
      .filter((name): name is string => Boolean(name));
    if (names.length === 0) return "-";
    return names.join(", ");
  };

  const closeModal = () => {
    setCreateOpen(false);
    setEditingProjectId(null);
  };

  const handleCreate = async (form: FormState) => {
    if (!workspaceId) return;
    await createProject({
      workspaceId,
      name: form.name.trim(),
      color: form.color,
      description: form.description.trim() || undefined,
      memberIds: form.memberIds,
      leaderMemberIds: form.leaderMemberIds,
      isHidden: false,
    });
  };

  const handleUpdate = async (projectId: string, form: FormState) => {
    if (!workspaceId) return;
    await updateProject({
      id: projectId,
      workspaceId,
      name: form.name.trim(),
      color: form.color,
      description: form.description.trim() || undefined,
      memberIds: form.memberIds,
      leaderMemberIds: form.leaderMemberIds,
    });
  };

  const handleArchive = async (projectId: string) => {
    if (!workspaceId) return;
    await updateProject({
      id: projectId,
      workspaceId,
      isHidden: true,
    });
  };

  const handleRestore = async (projectId: string) => {
    if (!workspaceId) return;
    await updateProject({
      id: projectId,
      workspaceId,
      isHidden: false,
    });
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
          <div className="space-y-2">
            {activeProjects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => setEditingProjectId(project.id)}
                className="flex w-full items-center justify-between rounded-md border border-zinc-200 bg-white px-4 py-3 text-left transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                    {project.name}
                  </span>
                  <span className="block text-sm text-zinc-500 dark:text-zinc-400">
                    구성원 {project.memberIds.length}명
                  </span>
                </span>
                <span
                  className="ml-4 flex max-w-[45%] shrink-0 items-center justify-end gap-1.5 text-right text-sm text-zinc-500 dark:text-zinc-400"
                  title={formatLeaderNames(project.leaderMemberIds ?? [])}
                >
                  <span className="truncate">{formatLeaderNames(project.leaderMemberIds ?? [])}</span>
                  {(project.leaderMemberIds ?? []).length > 0 && (
                    <Crown size={13} className="shrink-0 text-amber-500" />
                  )}
                </span>
              </button>
            ))}
          </div>
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

      {createOpen && (
        <ProjectManageModal
          mode="create"
          activeMembers={activeMembers}
          workspaceId={workspaceId}
          onClose={closeModal}
          onSaveCreate={handleCreate}
        />
      )}
      {editingProject && (
        <ProjectManageModal
          mode="edit"
          project={editingProject}
          activeMembers={activeMembers}
          workspaceId={workspaceId}
          onClose={closeModal}
          onSaveEdit={handleUpdate}
          onArchive={handleArchive}
        />
      )}
    </div>
  );
}

type ProjectManageModalProps = {
  mode: "create" | "edit";
  project?: SchedulerProject;
  activeMembers: Member[];
  workspaceId: string | null;
  onClose: () => void;
  onSaveCreate?: (form: FormState) => Promise<void>;
  onSaveEdit?: (projectId: string, form: FormState) => Promise<void>;
  onArchive?: (projectId: string) => Promise<void>;
};

function ProjectManageModal({
  mode,
  project,
  activeMembers,
  workspaceId,
  onClose,
  onSaveCreate,
  onSaveEdit,
  onArchive,
}: ProjectManageModalProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [isNameEditing, setIsNameEditing] = useState(mode === "create");
  const [memberQuery, setMemberQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const dropdownWrapRef = useRef<HTMLDivElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const initializedProjectIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (mode === "edit" && project) {
      if (initializedProjectIdRef.current === project.id) return;
      setForm({
        name: project.name,
        color: project.color,
        description: project.description ?? "",
        memberIds: [...project.memberIds],
        leaderMemberIds: [...(project.leaderMemberIds ?? [])],
      });
      initializedProjectIdRef.current = project.id;
      setIsNameEditing(false);
      return;
    }
    setForm(EMPTY_FORM);
    initializedProjectIdRef.current = null;
    setIsNameEditing(true);
  }, [mode, project]);

  useEffect(() => {
    if (!isNameEditing) return;
    const input = nameInputRef.current;
    if (!input) return;
    requestAnimationFrame(() => {
      input.focus();
      if (mode === "create") return;
      input.select();
    });
  }, [isNameEditing, mode]);

  const membersById = useMemo(
    () => new Map(activeMembers.map((member) => [member.memberId, member])),
    [activeMembers],
  );
  const selectedMembers = useMemo(
    () => sortByKoreanName(
      form.memberIds
        .map((memberId) => membersById.get(memberId))
        .filter((member): member is Member => Boolean(member)),
    ),
    [form.memberIds, membersById],
  );

  const {
    suggestionMembers,
    isSuggestionOpen,
    highlightedIndex,
    handleQueryChange,
    handleKeyDown,
    selectMember,
  } = useMemberSuggestionDropdown({
    members: activeMembers,
    query: memberQuery,
    excludedMemberIds: form.memberIds,
    dropdownWrapRef,
  });

  const sortMemberIdsByName = (ids: string[]) =>
    sortByKoreanName(
      ids
        .map((memberId) => membersById.get(memberId))
        .filter((member): member is Member => Boolean(member)),
    ).map((member) => member.memberId);

  const updateMemberIds = (nextIds: string[]) => {
    const normalizedIds = Array.from(new Set(nextIds));
    const sortedIds = sortMemberIdsByName(normalizedIds);
    setForm((current) => ({
      ...current,
      memberIds: sortedIds,
      leaderMemberIds: current.leaderMemberIds.filter((leaderId) => sortedIds.includes(leaderId)),
    }));
  };

  const addMember = (memberId: string) => {
    updateMemberIds(
      form.memberIds.includes(memberId) ? form.memberIds : [...form.memberIds, memberId],
    );
  };

  const removeMember = (memberId: string) => {
    updateMemberIds(form.memberIds.filter((id) => id !== memberId));
  };

  const toggleLeader = (memberId: string) => {
    setForm((current) => {
      if (current.leaderMemberIds.includes(memberId)) {
        return {
          ...current,
          leaderMemberIds: current.leaderMemberIds.filter((leaderId) => leaderId !== memberId),
        };
      }
      if (!current.memberIds.includes(memberId)) return current;
      return {
        ...current,
        leaderMemberIds: [...current.leaderMemberIds, memberId],
      };
    });
  };

  const handleMemberQueryChange = (value: string) => {
    handleQueryChange(value, setMemberQuery);
  };

  const handleSelectSuggestion = (memberId: string) => {
    selectMember(memberId, addMember);
  };

  const handleMemberQueryKeyDown = (event: KeyboardEvent<HTMLInputElement>) =>
    handleKeyDown(event, addMember);

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
    const normalizedMemberIds = sortMemberIdsByName(form.memberIds);
    const normalizedLeaderIds = form.leaderMemberIds.filter((leaderId) => normalizedMemberIds.includes(leaderId));
    const nextForm: FormState = {
      ...form,
      memberIds: normalizedMemberIds,
      leaderMemberIds: normalizedLeaderIds,
    };
    setSubmitting(true);
    try {
      if (mode === "create") {
        await onSaveCreate?.(nextForm);
      } else if (project) {
        await onSaveEdit?.(project.id, nextForm);
      }
      onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "저장에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleArchive = async () => {
    if (!project || !onArchive) return;
    setErrorMessage(null);
    setSubmitting(true);
    try {
      await onArchive(project.id);
      onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "보관함 이동에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[980] flex items-center justify-center bg-black/45 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-[88vh] w-full max-w-md flex-col rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={nameInputRef}
          value={form.name}
          readOnly={!isNameEditing}
          onDoubleClick={() => setIsNameEditing(true)}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              name: event.target.value,
            }))
          }
          onBlur={() => {
            if (mode === "create") return;
            setIsNameEditing(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (mode === "edit") {
                setIsNameEditing(false);
                event.currentTarget.blur();
              }
            }
            if (event.key === "Escape") {
              if (mode !== "edit") return;
              event.preventDefault();
              setForm((current) => ({
                ...current,
                name: project?.name ?? current.name,
              }));
              setIsNameEditing(false);
              event.currentTarget.blur();
            }
          }}
          placeholder="프로젝트 이름"
          className={`w-full rounded border border-transparent bg-transparent px-2 py-1 text-2xl font-bold text-zinc-900 outline-none dark:text-zinc-100 ${
            isNameEditing
              ? "hover:border-zinc-200 focus:border-zinc-400 dark:hover:border-zinc-700 dark:focus:border-zinc-500"
              : "cursor-default"
          }`}
        />

        <div className="mt-3 flex-1 space-y-3 pr-1">
          <div>
            <label className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">프로젝트 설명</label>
            <textarea
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
              rows={3}
              placeholder="프로젝트 설명"
              className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-amber-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>

          <div ref={dropdownWrapRef} className="relative">
            <label className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">구성원 검색</label>
            <div className="flex items-center gap-1.5 rounded border border-zinc-200 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800">
              <Search size={12} className="shrink-0 text-zinc-400" />
              <input
                type="text"
                value={memberQuery}
                onChange={(event) => handleMemberQueryChange(event.target.value)}
                onKeyDown={handleMemberQueryKeyDown}
                placeholder="구성원 검색"
                className="min-w-0 flex-1 bg-transparent text-sm text-zinc-900 placeholder:text-zinc-400 outline-none dark:text-zinc-100"
              />
            </div>
            {isSuggestionOpen && (
              <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                {suggestionMembers.map((member, index) => (
                  <button
                    key={member.memberId}
                    type="button"
                    role="option"
                    aria-selected={highlightedIndex === index}
                    className={`flex w-full items-center px-2 py-1.5 text-left text-sm ${
                      highlightedIndex === index
                        ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                        : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    }`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => handleSelectSuggestion(member.memberId)}
                  >
                    {member.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
              등록된 구성원 ({selectedMembers.length})
            </div>
            <div className="max-h-[42vh] overflow-y-auto rounded border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-700 dark:bg-zinc-800/40">
              {selectedMembers.length === 0 ? (
                <div className="px-2 py-3 text-center text-sm text-zinc-400">
                  아직 등록된 구성원이 없습니다.
                </div>
              ) : (
                selectedMembers.map((member) => {
                  const isLeader = form.leaderMemberIds.includes(member.memberId);
                  return (
                    <div
                      key={member.memberId}
                      className="group flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                    >
                      <div className="min-w-0 flex-1 truncate text-sm text-zinc-800 dark:text-zinc-200">
                        {member.name}
                        {isLeader && (
                          <span className="ml-1.5 rounded bg-green-100 px-1 py-0.5 text-[10px] text-green-700 dark:bg-green-900/40 dark:text-green-300">
                            리더
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => toggleLeader(member.memberId)}
                          className={`rounded px-1.5 py-1 text-[10px] ${
                            isLeader
                              ? "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"
                              : "bg-green-600 text-white"
                          }`}
                        >
                          {isLeader ? "리더 해제" : "리더 등록"}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeMember(member.memberId)}
                          className="rounded border border-zinc-200 px-1.5 py-1 text-[10px] text-zinc-500 hover:bg-zinc-200 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-700"
                        >
                          제거
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {errorMessage && <p className="mt-3 text-xs text-red-500">{errorMessage}</p>}

        <div className="mt-4 flex items-center justify-between">
          {mode === "edit" ? (
            <button
              type="button"
              onClick={() => void handleArchive()}
              disabled={submitting}
              className="rounded bg-red-600 px-3 py-1.5 text-xs text-white hover:bg-red-700 disabled:opacity-60"
            >
              보관함으로 이동
            </button>
          ) : (
            <span />
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={submitting}
              className="rounded bg-amber-500 px-3 py-1.5 text-xs text-white hover:bg-amber-600 disabled:opacity-60"
            >
              저장
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              취소
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
