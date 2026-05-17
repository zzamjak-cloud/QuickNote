export type VirtualRow<T> = {
  item: T;
  index: number;
  top: number;
  height: number;
};

export function buildVirtualRows<T>(
  items: T[],
  getHeight: (item: T, index: number) => number,
): VirtualRow<T>[] {
  let top = 0;
  return items.map((item, index) => {
    const height = Math.max(0, getHeight(item, index));
    const row = { item, index, top, height };
    top += height;
    return row;
  });
}

export function getVirtualRowsHeight<T>(rows: Array<VirtualRow<T>>): number {
  const last = rows.at(-1);
  return last ? last.top + last.height : 0;
}

export function getVisibleVirtualRows<T>(
  rows: Array<VirtualRow<T>>,
  scrollTop: number,
  viewportHeight: number,
  overscan = 480,
): Array<VirtualRow<T>> {
  const start = Math.max(0, scrollTop - overscan);
  const end = scrollTop + Math.max(0, viewportHeight) + overscan;
  return rows.filter((row) => row.top + row.height >= start && row.top <= end);
}
