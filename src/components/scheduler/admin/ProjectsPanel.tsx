// 설정 모달 — 프로젝트 관리 패널 (추가/편집/삭제/멤버 배정/활성화 토글).
import { useState } from "react";
import { Plus, Pencil, Trash2, Eye, EyeOff, Check, X, Search } from "lucide-react";
import { useMemberStore } from "../../../store/memberStore";
import {
  useSchedulerProjectsStore,
  type SchedulerProject,
} from "../../../store/schedulerProjectsStore";
import { ColorPickerGrid } from "../ColorPickerGrid";
import { DEFAULT_SCHEDULE_COLOR } from "../../../lib/scheduler/colors";

// 인라인 편집 상태 초기값
const EMPTY_FORM = {
  name: "",
  color: DEFAULT_SCHEDULE_COLOR,
  description: "",
  memberIds: [] as string[],
};

type FormState = typeof EMPTY_FORM;

export function ProjectsPanel() {
  const { projects, workspaceId, createProject, updateProject, deleteProject } =
    useSchedulerProjectsStore();
  const allMembers = useMemberStore((s) => s.members);
  // 활성 멤버만 구성원 선택 대상
  const activeMembers = allMembers.filter((m) => m.status === "active");

  // 추가 폼 표시 여부
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<FormState>(EMPTY_FORM);

  // 현재 인라인 편집 중인 프로젝트 ID + 폼 값
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);

  // 멤버 체크박스 토글 헬퍼
  function toggleMember(
    form: FormState,
    setForm: (f: FormState) => void,
    memberId: string,
  ) {
    setForm({
      ...form,
      memberIds: form.memberIds.includes(memberId)
        ? form.memberIds.filter((id) => id !== memberId)
        : [...form.memberIds, memberId],
    });
  }

  // 추가 저장
  function handleAdd() {
    if (!addForm.name.trim() || !workspaceId) return;
    void createProject({
      workspaceId,
      name: addForm.name.trim(),
      color: addForm.color,
      description: addForm.description.trim() || undefined,
      memberIds: addForm.memberIds,
      isHidden: false,
    });
    setAddForm(EMPTY_FORM);
    setShowAddForm(false);
  }

  // 편집 시작
  function startEdit(project: SchedulerProject) {
    setEditingId(project.id);
    setEditForm({
      name: project.name,
      color: project.color,
      description: project.description ?? "",
      memberIds: [...project.memberIds],
    });
  }

  // 편집 저장
  function handleEditSave() {
    if (!editingId || !editForm.name.trim() || !workspaceId) return;
    void updateProject({
      id: editingId,
      workspaceId,
      name: editForm.name.trim(),
      color: editForm.color,
      description: editForm.description.trim() || undefined,
      memberIds: editForm.memberIds,
    });
    setEditingId(null);
  }

  // 삭제 확인
  function handleDelete(project: SchedulerProject) {
    if (!window.confirm(`"${project.name}" 프로젝트를 삭제하시겠습니까?`)) return;
    if (!workspaceId) return;
    void deleteProject(project.id, workspaceId);
    if (editingId === project.id) setEditingId(null);
  }

  return (
    <div className="space-y-3">
      {/* 추가 버튼 */}
      {!showAddForm && (
        <button
          type="button"
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-amber-500 hover:bg-amber-600 text-white transition-colors"
        >
          <Plus size={13} />
          프로젝트 추가
        </button>
      )}

      {/* 추가 폼 */}
      {showAddForm && (
        <ProjectForm
          form={addForm}
          setForm={setAddForm}
          activeMembers={activeMembers}
          onToggleMember={(id) => toggleMember(addForm, setAddForm, id)}
          onSave={handleAdd}
          onCancel={() => { setShowAddForm(false); setAddForm(EMPTY_FORM); }}
          saveLabel="추가"
        />
      )}

      {/* 프로젝트 목록 */}
      {projects.length === 0 && !showAddForm && (
        <div className="flex items-center justify-center h-24 text-sm text-zinc-400">
          등록된 프로젝트가 없습니다.
        </div>
      )}

      {projects.map((project) => (
        <div
          key={project.id}
          className="border border-zinc-200 dark:border-zinc-700 rounded-md overflow-hidden"
        >
          {/* 프로젝트 행 헤더 */}
          <div className="flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-zinc-800">
            {/* 색상 점 */}
            <span
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: project.color }}
            />
            <span
              className={`flex-1 text-sm font-medium truncate ${
                project.isHidden
                  ? "text-zinc-400 dark:text-zinc-500 line-through"
                  : "text-zinc-900 dark:text-zinc-100"
              }`}
            >
              {project.name}
            </span>
            <span className="text-xs text-zinc-400">
              {project.memberIds.length}명
            </span>
            {/* 활성/비활성 토글 */}
            <button
              type="button"
              onClick={() => workspaceId && void updateProject({ id: project.id, workspaceId, isHidden: !project.isHidden })}
              title={project.isHidden ? "활성화" : "비활성화"}
              className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
            >
              {project.isHidden ? (
                <EyeOff size={15} className="text-zinc-400" />
              ) : (
                <Eye size={15} className="text-amber-500" />
              )}
            </button>
            {/* 편집 버튼 */}
            <button
              type="button"
              onClick={() => editingId === project.id ? setEditingId(null) : startEdit(project)}
              title="편집"
              className="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
            >
              <Pencil size={14} className="text-zinc-500" />
            </button>
            {/* 삭제 버튼 */}
            <button
              type="button"
              onClick={() => handleDelete(project)}
              title="삭제"
              className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              <Trash2 size={14} className="text-red-400" />
            </button>
          </div>

          {/* 인라인 편집 폼 */}
          {editingId === project.id && (
            <div className="border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 p-3">
              <ProjectForm
                form={editForm}
                setForm={setEditForm}
                activeMembers={activeMembers}
                onToggleMember={(id) => toggleMember(editForm, setEditForm, id)}
                onSave={handleEditSave}
                onCancel={() => setEditingId(null)}
                saveLabel="저장"
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── 공용 폼 컴포넌트 ─────────────────────────────────────────────────────────

type Member = { memberId: string; name: string };

type ProjectFormProps = {
  form: FormState;
  setForm: (f: FormState) => void;
  activeMembers: Member[];
  onToggleMember: (id: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saveLabel: string;
};

function ProjectForm({
  form,
  setForm,
  activeMembers,
  onToggleMember,
  onSave,
  onCancel,
  saveLabel,
}: ProjectFormProps) {
  const [memberQuery, setMemberQuery] = useState("");
  const normalizedMemberQuery = memberQuery.trim().toLowerCase();
  const filteredMembers = normalizedMemberQuery
    ? activeMembers.filter((m) => m.name.toLowerCase().includes(normalizedMemberQuery))
    : activeMembers;

  return (
    <div className="space-y-3">
      {/* 이름 */}
      <div>
        <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
          프로젝트 이름
        </label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="프로젝트 이름"
          className="w-full px-2 py-1.5 text-sm border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
      </div>

      {/* 설명 */}
      <div>
        <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
          설명 (선택)
        </label>
        <input
          type="text"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="프로젝트 설명"
          className="w-full px-2 py-1.5 text-sm border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
      </div>

      {/* 색상 */}
      <div>
        <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1.5">
          색상
        </label>
        <ColorPickerGrid value={form.color} onChange={(c) => setForm({ ...form, color: c })} />
      </div>

      {/* 구성원 선택 */}
      {activeMembers.length > 0 && (
        <div>
          <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1.5">
            구성원
          </label>
          <div className="mb-1.5 flex items-center gap-1.5 rounded border border-zinc-200 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900">
            <Search size={12} className="shrink-0 text-zinc-400" />
            <input
              type="search"
              value={memberQuery}
              onChange={(e) => setMemberQuery(e.target.value)}
              placeholder="구성원 검색"
              className="min-w-0 flex-1 bg-transparent text-xs text-zinc-900 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-100"
            />
          </div>
          <div className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto">
            {filteredMembers.map((m) => (
              <label
                key={m.memberId}
                className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-700"
              >
                <input
                  type="checkbox"
                  checked={form.memberIds.includes(m.memberId)}
                  onChange={() => onToggleMember(m.memberId)}
                  className="accent-amber-500"
                />
                <span className="text-xs text-zinc-800 dark:text-zinc-200 truncate">
                  {m.name}
                </span>
              </label>
            ))}
            {filteredMembers.length === 0 && (
              <div className="col-span-2 px-2 py-3 text-center text-xs text-zinc-400">
                검색 결과가 없습니다.
              </div>
            )}
          </div>
        </div>
      )}

      {/* 저장/취소 버튼 */}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={onSave}
          disabled={!form.name.trim()}
          className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-amber-500 hover:bg-amber-600 text-white transition-colors disabled:opacity-40"
        >
          <Check size={12} />
          {saveLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md border border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
        >
          <X size={12} />
          취소
        </button>
      </div>
    </div>
  );
}
