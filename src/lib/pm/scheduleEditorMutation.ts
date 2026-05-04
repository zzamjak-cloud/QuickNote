/**
 * React 19 flushSync / TipTap 동기 구간과의 충돌을 피하려고
 * 노드 attrs 갱신·슬래시 커맨드 등의 에디터 변이를 다음 마이크로태스크로 미룬다.
 */
export function scheduleEditorMutation(fn: () => void): void {
  queueMicrotask(fn);
}
