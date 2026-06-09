import "@testing-library/jest-dom";
// jsdom 에는 indexedDB 가 없어 webStorage 가 매 호출마다 예외를 던지고
// 스택트레이스 포함 Error 를 수천 건 로깅 → 테스트 메모리 폭증/OOM 원인.
// fake-indexeddb 로 정상 IDB 경로를 태워 에러 폭주를 제거한다.
import "fake-indexeddb/auto";

// jsdom에는 scrollIntoView가 없어 포커스/스크롤 보정 코드가 테스트에서만 예외를 낸다.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

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
