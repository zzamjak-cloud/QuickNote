import { useState } from "react";
import { ArrowDownToLine, ArrowUpToLine, Trash2 } from "lucide-react";
import type { Member } from "../../store/memberStore";
import {
  demoteToMemberApi,
  promoteToManagerApi,
  removeMemberApi,
} from "../../lib/sync/memberApi";
import { SimpleConfirmDialog } from "../ui/SimpleConfirmDialog";

type Props = {
  meRole: Member["workspaceRole"];
  member: Member;
  onMemberUpdated: (member: Member) => void;
  onMemberRemoved: (memberId: string) => void;
};

export function MemberRowActions({
  meRole,
  member,
  onMemberUpdated,
  onMemberRemoved,
}: Props) {
  const [confirm, setConfirm] = useState<null | "promote" | "demote" | "remove">(null);
  const [busy, setBusy] = useState(false);

  const ROLE_RANK: Record<import("../../store/memberStore").MemberRole, number> = {
    developer: 5, owner: 4, leader: 3, manager: 2, member: 1,
  };
  const canManageMembers = (ROLE_RANK[meRole] ?? 0) >= ROLE_RANK["leader"];

  const executeConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm === "promote") {
        const updated = await promoteToManagerApi(member.memberId);
        onMemberUpdated(updated);
      } else if (confirm === "demote") {
        const updated = await demoteToMemberApi(member.memberId);
        onMemberUpdated(updated);
      } else if (confirm === "remove") {
        const removed = await removeMemberApi(member.memberId);
        onMemberRemoved(removed.memberId);
      }
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const confirmMessage = (() => {
    if (confirm === "remove") {
      return `${member.name} 구성원을 제거하시겠습니까?`;
    }
    if (confirm === "promote") {
      return [
        `${member.name} 구성원의 권한이 Member -> Manager로 변경됩니다.`,
        "Manager는 구성원/팀 관리(팀 배정, 권한 변경, 구성원 제거)를 수행할 수 있습니다.",
        "단, Owner의 권한은 변경할 수 없습니다.",
      ].join(" ");
    }
    if (confirm === "demote") {
      return [
        `${member.name} 구성원의 권한이 Manager -> Member로 변경됩니다.`,
        "변경 후에는 구성원/팀 관리 권한이 제거됩니다.",
      ].join(" ");
    }
    return `${member.name} 구성원의 권한을 변경하시겠습니까?`;
  })();

  return (
    <div className="flex items-center gap-1.5">
      {canManageMembers ? (
        <>
          {member.workspaceRole === "member" ? (
            <button
              type="button"
              onClick={() => setConfirm("promote")}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              disabled={busy}
              aria-label={`${member.name} 승격`}
              title="승격"
            >
              <ArrowUpToLine size={14} />
            </button>
          ) : null}
          {member.workspaceRole === "manager" ? (
            <button
              type="button"
              onClick={() => setConfirm("demote")}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              disabled={busy}
              aria-label={`${member.name} 강등`}
              title="강등"
            >
              <ArrowDownToLine size={14} />
            </button>
          ) : null}
          {member.workspaceRole !== "owner" && member.workspaceRole !== "developer" ? (
            <button
              type="button"
              onClick={() => setConfirm("remove")}
              className="rounded p-1 text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
              disabled={busy}
              aria-label={`${member.name} 제거`}
              title="제거"
            >
              <Trash2 size={14} />
            </button>
          ) : null}
        </>
      ) : null}

      <SimpleConfirmDialog
        open={confirm !== null}
        title={confirm === "remove" ? "구성원 제거" : "권한 변경"}
        message={confirmMessage}
        confirmLabel="확인"
        cancelLabel="취소"
        danger={confirm === "remove"}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void executeConfirm()}
      />
    </div>
  );
}
