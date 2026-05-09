import { filterWorkspaceMembersForMention } from "./filterMembersForMention";
import { searchMembersForMentionApi } from "../sync/memberApi";
import { useMemberStore } from "../../store/memberStore";
import { usePageStore } from "../../store/pageStore";
import { useDatabaseStore } from "../../store/databaseStore";

/** TipTap Mention 삽입 attrs용 — label 필수 */
export type MentionListItem = {
  id: string;
  label: string;
  subtitle: string;
  mentionKind: "member" | "page" | "database";
};

/** @query 에 대한 통합 멘션 후보(멤버·페이지·DB), 부분 문자열 필터 */
export async function loadMergedMentionItems(
  query: string,
  limit = 10,
): Promise<MentionListItem[]> {
  const q = query.trim().toLowerCase();
  const membersLocal = filterWorkspaceMembersForMention(query, 14);
  let remoteMembers: Awaited<ReturnType<typeof searchMembersForMentionApi>> = [];
  try {
    remoteMembers = await searchMembersForMentionApi(query, 14);
  } catch {
    remoteMembers = [];
  }

  const mergedMembers = new Map<string, MentionListItem>();
  const pushMember = (memberId: string, name: string, jobRole: string) => {
    const id = `m:${memberId}`;
    if (!mergedMembers.has(id)) {
      mergedMembers.set(id, {
        id,
        label: name,
        subtitle: jobRole || "멤버",
        mentionKind: "member",
      });
    }
  };
  for (const m of membersLocal) {
    pushMember(m.memberId, m.name, m.jobRole);
  }
  for (const m of remoteMembers) {
    pushMember(m.memberId, m.name, m.jobRole);
  }

  const pages = Object.values(usePageStore.getState().pages).filter((p) => {
    if (!q) return true;
    const title = (p.title || "제목 없음").toLowerCase();
    return title.includes(q);
  });
  const pageItems: MentionListItem[] = pages
    .slice(0, 8)
    .map((p) => ({
      id: `p:${p.id}`,
      label: p.title || "제목 없음",
      subtitle: "페이지",
      mentionKind: "page" as const,
    }));

  const databases = Object.values(useDatabaseStore.getState().databases).filter(
    (bundle) => {
      const t = (bundle.meta.title || "").toLowerCase();
      if (!q) return true;
      return t.includes(q);
    },
  );
  const dbItems: MentionListItem[] = databases.slice(0, 6).map((bundle) => ({
    id: `d:${bundle.meta.id}`,
    label: bundle.meta.title || "데이터베이스",
    subtitle: "DB",
    mentionKind: "database" as const,
  }));

  const combined: MentionListItem[] = [
    ...mergedMembers.values(),
    ...pageItems,
    ...dbItems,
  ];

  if (!q) {
    const head = combined.slice(0, limit);
    useMemberStore.getState().setMentionCandidates(
      query,
      head
        .filter((x) => x.mentionKind === "member")
        .map((x) => ({
          memberId: x.id.slice(2),
          name: x.label,
          jobRole: x.subtitle,
        })),
    );
    return head;
  }

  const filtered = combined.filter((item) => {
    const hay = `${item.label} ${item.subtitle}`.toLowerCase();
    return hay.includes(q);
  });

  const out = filtered.slice(0, limit);
  useMemberStore.getState().setMentionCandidates(
    query,
    out
      .filter((x) => x.mentionKind === "member")
      .map((x) => ({
        memberId: x.id.slice(2),
        name: x.label,
        jobRole: x.subtitle,
      })),
  );
  return out;
}
