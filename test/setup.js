/**
 * テストを走らせる前の下ごしらえ。
 *
 * Node 26 では、起動時に --localstorage-file を渡さないと
 * window.localStorage が undefined になる。画面側は幅や見え方の
 * 覚え書きに localStorage を使っていて、テストも beforeEach で
 * clear() を呼ぶため、無いと jsdom のテストが総崩れになる。
 *
 * 実機のブラウザには必ずあるものなので、ここでは「無ければ補う」
 * だけにする。あるものを置き換えると、本物との違いを踏む。
 */

if (typeof window !== 'undefined' && !window.localStorage) {
  const store = {};

  const shim = {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem(key, value) { store[key] = String(value); },
    removeItem(key) { delete store[key]; },
    clear() { for (const key of Object.keys(store)) delete store[key]; },
    key(at) { return Object.keys(store)[at] ?? null; },
    get length() { return Object.keys(store).length; },
  };

  // jsdom が読み取り専用の形で持っていることがある。素直に入らなければ
  // property として置き直す
  try {
    window.localStorage = shim;
  } catch (e) {
    Object.defineProperty(window, 'localStorage', {
      value: shim, configurable: true, writable: true,
    });
  }

  if (typeof globalThis !== 'undefined' && !globalThis.localStorage) {
    globalThis.localStorage = window.localStorage;
  }
}
