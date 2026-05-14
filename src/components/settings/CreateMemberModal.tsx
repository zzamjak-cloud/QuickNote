import { MemberModal } from "./MemberModal";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreate: (input: { email: string; name: string; jobRole: string; workspaceRole: string }) => Promise<void> | void;
};

export function CreateMemberModal({ open, onClose, onCreate }: Props) {
  return (
    <MemberModal
      mode="create"
      open={open}
      onClose={onClose}
      onCreate={async (input) => {
        await onCreate(input);
      }}
    />
  );
}
