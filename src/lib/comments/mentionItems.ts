import { filterWorkspaceMembersForMention } from "./filterMembersForMention";
import { searchMembersForMentionApi } from "../sync/memberApi";
import { useMemberStore } from "../../store/memberStore";
import { usePageStore } from "../../store/pageStore";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { koreanIncludes } from "../koreanSearch";
import { CACHE_TTL, isCacheFresh } from "../cache/ttl";
import {
  loadCrossWorkspacePageCandidates,
  rememberCrossWorkspacePages,
} from "../crossWorkspaceSearch";
import {
  MENTION_MEMBER_PREFIX,
  MENTION_PAGE_PREFIX,
} from "../tiptapExtensions/mentionKind";
import type { Page } from "../../types/page";

/**
 * 멤버 로컬 캐시가 신선한지 판단한다.
 * 캐시가 비었거나(최초 로드 전) TTL 이 만료된 경우에만 원격 멤버 검색을 fallback 으로 허용한다.
 * 평상시(워크스페이스 메타 캐시가 따뜻한 상태)에는 멘션 후보를 캐시만으로 처리한다.
 */
function isMemberCacheFresh(): boolean {
  const state = useMemberStore.getState();
  return state.members.length > 0 && isCacheFresh(state.lastFetchedAt, CACHE_TTL.WORKSPACE_META);
}

/** TipTap Mention 삽입 attrs용 — label 필수 */
export type MentionListItem = {
  id: string;
  label: string;
  subtitle: string;
  mentionKind: "member" | "page";
  workspaceId?: string;
  page?: Page;
};

function buildLocalMentionItems(query: string): MentionListItem[] {
  const membersLocal = filterWorkspaceMembersForMention(query, 14);
  const mergedMembers = new Map<string, MentionListItem>();
  const pushMember = (memberId: string, name: string, jobRole: string) => {
    const id = `${MENTION_MEMBER_PREFIX}${memberId}`;
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

  return [...mergedMembers.values()];
}

function pageMentionItems(pages: Page[], query: string, limit: number): MentionListItem[] {
  const q = query.trim().toLowerCase();
  // 동명 페이지 구분을 위해 subtitle 에 소속 워크스페이스 이름을 표기한다.
  const workspaceNameById = new Map(
    useWorkspaceStore.getState().workspaces.map((w) => [w.workspaceId, w.name]),
  );
  return pages
    .filter((p) => {
      if ((p as { deletedAt?: string | null }).deletedAt) return false;
      if (!q) return true;
      // 평범한 includes 는 저장 제목이 분해형(NFD)·입력이 조합형(NFC)이면 한글 부분일치에 실패한다
      // (검색 누락). koreanIncludes 는 NFC 정규화 + 한글 퍼지 매칭으로 앱 전역 검색과 동일하게 처리.
      return koreanIncludes((p.title || "제목 없음").toLowerCase(), q);
    })
    // 로컬 페이지가 merge 앞쪽에 오므로 작은 하드캡은 타 워크스페이스 페이지를 잘라낸다.
    // 최종 limit 이 통합 후보를 다시 자르므로 여기서는 그보다 넉넉히 둔다.
    .slice(0, Math.max(limit, 16))
    .map((p) => ({
      id: `${MENTION_PAGE_PREFIX}${p.id}`,
      label: p.title || "제목 없음",
      subtitle: (p.workspaceId && workspaceNameById.get(p.workspaceId)) || "페이지",
      mentionKind: "page" as const,
      workspaceId: p.workspaceId,
      page: p,
    }));
}

export function rememberMentionItemTarget(item: MentionListItem): void {
  if (item.page) rememberCrossWorkspacePages([item.page]);
}

/** @query 에 대한 통합 멘션 후보(멤버·페이지), 부분 문자열 필터 */
export async function loadMergedMentionItems(
  query: string,
  limit = 10,
  options?: { includeRemoteMembers?: boolean },
): Promise<MentionListItem[]> {
  const q = query.trim().toLowerCase();
  const includeRemoteMembers = options?.includeRemoteMembers ?? true;
  const localCombined = buildLocalMentionItems(query);
  let pageItems: MentionListItem[] = [];
  try {
    const pages = await loadCrossWorkspacePageCandidates();
    pageItems = pageMentionItems(pages, query, limit);
  } catch {
    pageItems = pageMentionItems(Object.values(usePageStore.getState().pages), query, limit);
  }

  const mergedMembers = new Map<string, MentionListItem>();
  const accessibleMemberIds = new Set(
    filterWorkspaceMembersForMention(query, 14).map((m) => m.memberId),
  );
  const localMemberItems = localCombined.filter((item) => item.mentionKind === "member");
  for (const m of localMemberItems) {
    mergedMembers.set(m.id, m);
  }
  // 캐시가 신선하면 원격 검색을 생략한다 — 멤버 변경은 설정팝업에서 즉시 캐시에 반영되므로
  // 캐시만으로 충분하고, 키 입력마다 AppSync/Lambda 를 호출할 필요가 없다.
  if (includeRemoteMembers && !isMemberCacheFresh()) {
    let remoteMembers: Awaited<ReturnType<typeof searchMembersForMentionApi>> = [];
    try {
      remoteMembers = await searchMembersForMentionApi(query, 14);
    } catch {
      remoteMembers = [];
    }
    for (const m of remoteMembers) {
      if (!accessibleMemberIds.has(m.memberId)) continue;
      const id = `m:${m.memberId}`;
      if (!mergedMembers.has(id)) {
        mergedMembers.set(id, {
          id,
          label: m.name,
          subtitle: m.jobRole || "멤버",
          mentionKind: "member",
        });
      }
    }
  }

  const combined: MentionListItem[] = [
    ...mergedMembers.values(),
    ...pageItems,
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
    // 전역 검색과 동일한 한글 매처(NFC 정규화). plain includes 는 NFD 저장 제목을 놓친다(검색 누락).
    return koreanIncludes(hay, q);
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
