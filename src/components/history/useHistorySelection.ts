import { useCallback, useEffect, useRef, useState } from "react";

export function useHistorySelection(itemIds: readonly string[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const anchorRef = useRef<number | null>(null);
  const idsRef = useRef(itemIds);
  idsRef.current = itemIds;

  const toggleOne = useCallback((id: string, opts: { shiftKey: boolean }) => {
    const ids = idsRef.current;
    const idx = ids.indexOf(id);
    if (idx < 0) return;

    if (opts.shiftKey && anchorRef.current != null) {
      const start = Math.min(anchorRef.current, idx);
      const end = Math.max(anchorRef.current, idx);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) {
          const v = ids[i];
          if (v) next.add(v);
        }
        return next;
      });
      return;
    }

    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchorRef.current = idx;
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) =>
      prev.size === idsRef.current.length ? new Set() : new Set(idsRef.current),
    );
    anchorRef.current = null;
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds((prev) => (prev.size ? new Set() : prev));
    anchorRef.current = null;
  }, []);

  const itemIdsKey = itemIds.join("\u0001");
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const valid = new Set(itemIds);
    let changed = false;
    const next = new Set<string>();
    selectedIds.forEach((id) => {
      if (valid.has(id)) next.add(id);
      else changed = true;
    });
    if (!changed) return;
    setSelectedIds(next);
  }, [itemIdsKey, selectedIds, itemIds]);

  return { selectedIds, toggleOne, toggleAll, clearSelection };
}
