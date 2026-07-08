// 사이드바 트리의 "화면에 보이는 순서" 계산 헬퍼.
// Shift+클릭 범위 선택과 멀티 드래그 이동이 같은 순서 기준을 쓰도록 한 곳에 모은다.

import {
  usePageStore,
  createFilterPageTreeSelector,
  type PageNode,
} from "../store/pageStore";
import { useSettingsStore } from "../store/settingsStore";

// 사이드바와 동일한 트리 소스(필터 없음). 셀렉터는 시그니처 캐시를 가지므로 모듈 싱글턴으로 재사용.
const sidebarTreeSelector = createFilterPageTreeSelector("");

/** 사이드바에 실제로 보이는 순서(펼침 상태 반영)의 페이지 id 목록 */
export function computeVisibleSidebarPageIds(): string[] {
  const tree = sidebarTreeSelector(usePageStore.getState());
  const expanded = new Set(useSettingsStore.getState().expandedIds);
  const out: string[] = [];
  const walk = (nodes: PageNode[]) => {
    for (const n of nodes) {
      out.push(n.id);
      if (n.children.length > 0 && expanded.has(n.id)) walk(n.children);
    }
  };
  walk(tree);
  return out;
}

/** 조상이 함께 포함된 id(자손)를 제외하고 최상위 id 만 남긴다 — 일괄 이동/삭제 중복 방지 */
export function filterTopLevelPageIds(ids: string[]): string[] {
  const pages = usePageStore.getState().pages;
  const idSet = new Set(ids);
  return ids.filter((id) => {
    if (!pages[id]) return false;
    let cur = pages[id]?.parentId ?? null;
    while (cur) {
      if (idSet.has(cur)) return false;
      cur = pages[cur]?.parentId ?? null;
    }
    return true;
  });
}

/** id 목록을 사이드바 가시 순서로 정렬해 반환(가시 목록에 없는 id 는 제외) */
export function orderPageIdsByVisibleOrder(ids: string[]): string[] {
  const idSet = new Set(ids);
  return computeVisibleSidebarPageIds().filter((id) => idSet.has(id));
}
