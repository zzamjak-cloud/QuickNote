import "@testing-library/jest-dom";

// jsdom의 localStorage가 일부 환경에서 노출되지 않을 때 대비한 인메모리 폴리필.
// 일부 환경에서 jsdom의 localStorage 메서드가 누락되는 경우가 있어
// 항상 신뢰 가능한 인메모리 구현을 강제로 주입한다.
{
  const store = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: shim,
    writable: true,
    configurable: true,
  });
}
