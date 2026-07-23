import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SmilePlus } from "lucide-react";
import type { BlockCommentMsg, BlockCommentReaction } from "../../types/blockComment";
import { PageIconDisplay } from "../common/PageIconDisplay";
import { CommentReactionPicker } from "./CommentReactionPicker";
import type { CommentReactionTarget } from "../../lib/comments/commentReactions";

type MemberName = { memberId: string; name: string };

type Props = {
  msg: BlockCommentMsg;
  members: MemberName[];
  myMemberId: string | undefined;
  onToggleReaction: (
    id: string,
    reaction: CommentReactionTarget,
    memberId: string,
  ) => void;
};

function memberName(members: MemberName[], id: string): string {
  const member = members.find((item) => item.memberId === id);
  return member?.name ?? "구성원";
}

function reactionLabel(reaction: Pick<BlockCommentReaction, "kind" | "value">): string {
  return reaction.kind === "emoji" ? reaction.value : "커스텀 이모지";
}

function CommentReactionIcon({
  reaction,
}: {
  reaction: Pick<BlockCommentReaction, "kind" | "value">;
}) {
  if (reaction.kind === "custom") {
    return (
      <PageIconDisplay
        icon={reaction.value}
        size="sm"
        className="!h-4 !w-4"
        imgClassName="!h-4 !w-4"
      />
    );
  }
  return <span className="text-sm leading-none">{reaction.value}</span>;
}

export function CommentReactionBar({
  msg,
  members,
  myMemberId,
  onToggleReaction,
}: Props) {
  const [pickerAnchor, setPickerAnchor] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const reactions = (msg.reactions ?? []).filter((reaction) => reaction.memberIds.length > 0);

  useEffect(() => {
    if (!pickerAnchor) return;
    const close = () => setPickerAnchor(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    document.addEventListener("mousedown", close);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      document.removeEventListener("mousedown", close);
    };
  }, [pickerAnchor]);

  const openPicker = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 320;
    const height = 430;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const top = Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - height - 8));
    setPickerAnchor({ top, left });
  };

  const pickReaction = (reaction: CommentReactionTarget) => {
    if (!myMemberId) return;
    onToggleReaction(msg.id, reaction, myMemberId);
    setPickerAnchor(null);
  };

  if (reactions.length === 0 && !myMemberId) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1">
      {reactions.map((reaction) => {
        const active = !!myMemberId && reaction.memberIds.includes(myMemberId);
        const names = reaction.memberIds.map((id) => memberName(members, id)).join(", ");
        return (
          <button
            key={`${reaction.kind}:${reaction.value}`}
            type="button"
            disabled={!myMemberId}
            onClick={() => {
              if (!myMemberId) return;
              onToggleReaction(msg.id, reaction, myMemberId);
            }}
            className={[
              "inline-flex h-6 items-center gap-1 rounded-full border px-1.5 text-[11px] font-medium transition",
              active
                ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800",
              !myMemberId ? "cursor-default" : "",
            ].join(" ")}
            title={names}
            aria-label={`${reactionLabel(reaction)} 반응 ${reaction.memberIds.length}명`}
          >
            <CommentReactionIcon reaction={reaction} />
            <span>{reaction.memberIds.length}</span>
          </button>
        );
      })}
      {myMemberId ? (
        <button
          ref={triggerRef}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            if (pickerAnchor) setPickerAnchor(null);
            else openPicker();
          }}
          className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          title="반응 추가"
          aria-label="반응 추가"
        >
          <SmilePlus size={13} />
        </button>
      ) : null}
      {pickerAnchor
        ? createPortal(
            <div
              className="fixed z-[520]"
              style={{ top: pickerAnchor.top, left: pickerAnchor.left }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <CommentReactionPicker onPick={pickReaction} />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
