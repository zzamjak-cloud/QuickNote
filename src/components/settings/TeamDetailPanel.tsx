import type { Team } from "../../store/teamStore";

type Props = {
  team: Team | null;
};

export function TeamDetailPanel({ team }: Props) {
  if (!team) {
    return (
      <div className="rounded-md border border-dashed border-zinc-300 p-3 text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        팀을 선택하면 멤버를 볼 수 있습니다.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-zinc-200 dark:border-zinc-700">
      <div className="border-b border-zinc-100 px-3 py-2 text-xs font-medium dark:border-zinc-800">
        {team.name} 멤버
      </div>
      <ul className="max-h-56 overflow-y-auto text-xs">
        {team.members.length === 0 ? (
          <li className="px-3 py-3 text-zinc-500">멤버가 없습니다.</li>
        ) : (
          team.members.map((m) => (
            <li key={m.memberId} className="border-t border-zinc-100 px-3 py-2 first:border-t-0 dark:border-zinc-800">
              <p>{m.name}</p>
              <p className="text-zinc-500">{m.email}</p>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
