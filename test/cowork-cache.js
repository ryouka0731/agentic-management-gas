/*
 * 作業雑談部屋のテストで使う、疑似のスクリプトのキャッシュと時計。
 *
 * 疑似GAS (test/fakegas.js) は CacheService を持たない (持たせると、ほかの所のキャッシュがテストをまたいで
 * 効いてしまう)。作業雑談部屋のテストだけが、ここで足す。実機と同じく1つの値は 100KB (バイト) までで、
 * 超えると put が投げる。置いた長さ (秒) は時計で見る。
 */

/**
 * @param {object} fake createFakeGas() の返り (= 文脈)
 * @param {object} [opts]
 * @param {number} [opts.start] 始まりの時刻 (ミリ秒)
 * @returns {{store: Map, now: function(): number, advance: function(number): void, puts: string[]}}
 */
export function installCoworkCache(fake, opts = {}) {
  let now = opts.start || Date.UTC(2026, 9, 21, 1, 0, 0);
  const store = new Map();
  const puts = [];
  const LIMIT = 100 * 1024;
  const alive = (k) => {
    const e = store.get(k);
    if (!e) return null;
    if (e.until <= now) {
      store.delete(k);
      return null;
    }
    return e.value;
  };
  const put = (k, v, ttl) => {
    const value = String(v);
    if (Buffer.byteLength(value, 'utf8') > LIMIT) throw new Error('Argument too large: value');
    puts.push(k);
    store.set(k, { value, until: now + (ttl || 600) * 1000 });
  };
  const cache = {
    get: (k) => alive(k),
    getAll: (keys) => {
      const out = {};
      keys.forEach((k) => { const v = alive(k); if (v !== null) out[k] = v; });
      return out;
    },
    put,
    putAll: (obj, ttl) => { Object.keys(obj).forEach((k) => put(k, obj[k], ttl)); },
    remove: (k) => { store.delete(k); },
  };
  fake.CacheService = { getScriptCache: () => cache };
  // サーバの時計 (coworkNow_) もこの時計にそろえる
  fake.coworkNow_ = () => new Date(now);
  return {
    store,
    puts,
    now: () => now,
    advance: (ms) => { now += ms; },
  };
}
