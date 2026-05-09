import type { HistoryTimelineEntry } from "../types/history";
import type { Member } from "../store/memberStore";

/**
 * 페이지 버전 타임라인 한 줄에 표시할 수정자 라벨.
 * 이벤트에 스냅샷 이름이 없으면 구성원 목록/본인으로 보강한다.
 */
export function formatPageHistoryEditorLine(
  entry: HistoryTimelineEntry,
  opts: {
    members: Member[];
    me: Member | null;
  },
): string {
  const snap = entry.lastEditedByName?.trim();
  if (snap) return snap;
  const id = entry.lastEditedByMemberId;
  if (id) {
    if (opts.me?.memberId === id && opts.me.name) return opts.me.name;
    const m = opts.members.find((x) => x.memberId === id);
    if (m?.name) return m.name;
    return "구성원";
  }
  return "알 수 없음";
}
