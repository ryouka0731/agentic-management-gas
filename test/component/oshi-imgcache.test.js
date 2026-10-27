// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prefsFixture } from '../dom.js';
import { mount } from './mount.js';
import { loadGasWith } from '../harness.js';
import { createFakeGas } from '../fakegas.js';
import { APP_SOURCES } from '../sources.js';

/*
 * 推しの絵のブラウザの覚え (IndexedDB。js-oshi の oshiIdb*)。
 * 絵は1枚 400〜500KB の data URL で、画面を開くたびにサーバから取り直していた。2回目からは取りに行かない。
 * 探す順は メモリの覚え → IndexedDB → サーバ。IndexedDB が使えない環境では今までどおりサーバから取る。
 *
 * jsdom には IndexedDB が無いので、ここで小さな疑似を組む (open → transaction → objectStore の get / put / delete /
 * getAll / getAllKeys。返事は本物と同じく後から届く)。疑似は画面を組み直しても残す (ブラウザを開き直したのと同じ)。
 */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PNG_URL = 'data:image/png;base64,' + PNG.toString('base64');

let server = null;
/** 本物のサーバ (疑似GAS) の apiOshiGet。自分のキャラ「ルナ」に「おいわい」の絵だけ入れてある */
function oshiGet(charPref) {
  if (!server) {
    const fake = createFakeGas();
    const ctx = loadGasWith(fake, ...APP_SOURCES);
    ctx.repoInit('agentic-management');
    const c = ctx.apiOshiCharCreate('ルナ', 'genki').charId;
    ctx.apiOshiSetImage(c, 'celebrate', PNG_URL);
    server = { ctx };
  }
  server.ctx.apiPrefSet('oshi.char', charPref);
  return JSON.parse(JSON.stringify(server.ctx.apiOshiGet()));
}

const defaultUrl = (char, style, state) => 'data:image/webp;base64,' + Buffer.from(char + ':' + style + ':' + state).toString('base64');

/** タクを使う人 (最初からいるキャラ)。ホームのあいさつは止め、済ませたときの吹き出しだけを見る */
const TAKU = { 'oshi.on': true, 'oshi.char': 'builtin:taku', 'oshi.home': false };
/** 自分のキャラ (ルナ) を使い、絵が無い表情に最初からいるキャラを出さない人 */
const LUNA = { 'oshi.on': true, 'oshi.char': 'mine:1', 'oshi.fallback': 'none', 'oshi.home': false };

function mountOshi(values, over) {
  const v = values;
  const got = oshiGet(v['oshi.char']);
  return mount(Object.assign({
    apiPrefs: prefsFixture({ values: v }),
    apiOshiGet: got,
    // 本物と同じく、絵の行と同じ中身の指紋を返す
    apiOshiImage: (charId, state) => {
      const row = got.images.find((r) => r.state === state);
      return row ? { charId, state, sha: row.sha, dataUrl: PNG_URL } : null;
    },
    apiOshiDefaultImage: (char, style, state) => ({ char, style, state, dataUrl: defaultUrl(char, style, state),
      version: got.defaultImageVersion }),
  }, over || {}));
}

/**
 * IndexedDB の疑似。stores は画面を組み直しても残る。
 *
 * @param {{openFails?: boolean, getThrows?: boolean}} [opts]
 */
function fakeIndexedDB(opts) {
  const o = opts || {};
  const stores = { pics: new Map(), meta: new Map() };
  const created = new Set();
  const later = (fn) => setTimeout(fn, 0);
  function request(fn) {
    const r = { result: undefined, error: null, onsuccess: null, onerror: null };
    later(() => {
      try {
        r.result = fn();
      } catch (e) {
        r.error = e;
        if (r.onerror) r.onerror({ target: r, preventDefault() {} });
        return;
      }
      if (r.onsuccess) r.onsuccess({ target: r });
    });
    return r;
  }
  const db = {
    objectStoreNames: { contains: (n) => created.has(n) },
    createObjectStore(n) { created.add(n); return {}; },
    close() {},
    transaction(names) {
      const tx = { oncomplete: null, onerror: null, onabort: null };
      tx.objectStore = (n) => {
        if (!names.includes(n)) throw new Error('NotFoundError');
        const m = stores[n];
        return {
          get(key) {
            if (o.getThrows) throw new Error('InvalidStateError');
            return request(() => (m.has(key) ? structuredClone(m.get(key)) : undefined));
          },
          put(value, key) { return request(() => { m.set(key, structuredClone(value)); return key; }); },
          delete(key) { return request(() => { m.delete(key); }); },
          getAllKeys() { return request(() => [...m.keys()].sort()); },
          getAll() { return request(() => [...m.keys()].sort().map((k) => structuredClone(m.get(k)))); },
        };
      };
      // 本物は中の読み書きが済んでから終わる。疑似では少し後に終わったことにする
      setTimeout(() => { if (tx.oncomplete) tx.oncomplete({}); }, 5);
      return tx;
    },
  };
  let opened = 0;
  const idb = {
    stores,
    get opened() { return opened; },
    open() {
      opened++;
      const r = { result: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      later(() => {
        if (o.openFails) {
          r.error = new Error('InvalidStateError');
          if (r.onerror) r.onerror({ target: r, preventDefault() {} });
          return;
        }
        r.result = db;
        if (!created.has('pics') && r.onupgradeneeded) r.onupgradeneeded({ target: r });
        if (r.onsuccess) r.onsuccess({ target: r });
      });
      return r;
    },
  };
  return idb;
}

/** 疑似の返事 (setTimeout 0 / 5) が届くまで待つ */
const settle = () => new Promise((r) => setTimeout(r, 40));

const bubbleImg = () => document.querySelector('#oshi-bubble img.oshi-img');
const callsOf = (app, name) => app.calls.filter((c) => c.name === name).map((c) => c.args);

function closeOneIssue() {
  document.querySelector('[data-tab="issues"]').click();
  document.querySelector('#issue-list [aria-label$="を完了にする"]').click();
}

describe('推しの絵をブラウザ (IndexedDB) に覚える', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete window.indexedDB;
  });

  it('最初からいるキャラ: 1回目はサーバから取って版と一緒に置き、組み直すと (メモリが空でも) サーバを呼ばずに出す', async () => {
    const idb = fakeIndexedDB();
    window.indexedDB = idb;
    const version = oshiGet('builtin:taku').defaultImageVersion;
    expect(typeof version).toBe('number');

    const first = mountOshi(TAKU);
    closeOneIssue();
    await settle();
    expect(callsOf(first, 'apiOshiDefaultImage')).toEqual([['taku', 'chibi', 'celebrate']]);
    expect(bubbleImg().getAttribute('src')).toBe(defaultUrl('taku', 'chibi', 'celebrate'));
    expect(idb.stores.pics.get('d:taku:chibi:celebrate')).toEqual({ dataUrl: defaultUrl('taku', 'chibi', 'celebrate'), v: version });
    expect(idb.stores.meta.get('d:taku:chibi:celebrate').used).toBeGreaterThan(0);

    // 開き直した (画面の JS の覚えは空)
    const again = mountOshi(TAKU);
    closeOneIssue();
    await settle();
    expect(callsOf(again, 'apiOshiDefaultImage')).toEqual([]);
    expect(bubbleImg().getAttribute('src')).toBe(defaultUrl('taku', 'chibi', 'celebrate'));
  });

  it('最初からいるキャラ: 版が違う記録は使わずに取り直し、今の版で置き直す', async () => {
    const idb = fakeIndexedDB();
    window.indexedDB = idb;
    const version = oshiGet('builtin:taku').defaultImageVersion;
    idb.stores.pics.set('d:taku:chibi:celebrate', { dataUrl: 'data:image/webp;base64,T0xE', v: version - 1 });
    idb.stores.meta.set('d:taku:chibi:celebrate', { used: 1, v: version - 1 });

    const app = mountOshi(TAKU);
    closeOneIssue();
    await settle();
    expect(callsOf(app, 'apiOshiDefaultImage')).toEqual([['taku', 'chibi', 'celebrate']]);
    expect(bubbleImg().getAttribute('src')).toBe(defaultUrl('taku', 'chibi', 'celebrate'));
    expect(idb.stores.pics.get('d:taku:chibi:celebrate')).toEqual({ dataUrl: defaultUrl('taku', 'chibi', 'celebrate'), v: version });
  });

  it('置いたときに、前の版の最初からいるキャラの絵はほかの表情のぶんも消す', async () => {
    const idb = fakeIndexedDB();
    window.indexedDB = idb;
    const version = oshiGet('builtin:taku').defaultImageVersion;
    idb.stores.pics.set('d:taku:chibi:praise', { dataUrl: 'data:image/webp;base64,T0xE', v: version - 1 });
    idb.stores.meta.set('d:taku:chibi:praise', { used: Date.now(), v: version - 1 });

    mountOshi(TAKU);
    closeOneIssue();
    await settle();
    expect(idb.stores.pics.has('d:taku:chibi:praise')).toBe(false);
    expect(idb.stores.meta.has('d:taku:chibi:praise')).toBe(false);
    expect(idb.stores.pics.has('d:taku:chibi:celebrate')).toBe(true);
  });

  it('置く数が上限 (60枚) を超えたら、最後に使ったのが古い順に消す', async () => {
    const idb = fakeIndexedDB();
    window.indexedDB = idb;
    for (let i = 0; i < 60; i++) {
      const k = 's:' + String(i).padStart(64, '0');
      idb.stores.pics.set(k, { dataUrl: PNG_URL });
      // 0 番がいちばん古い
      idb.stores.meta.set(k, { used: 1000 + i });
    }
    mountOshi(TAKU);
    closeOneIssue();
    await settle();
    expect(idb.stores.pics.size).toBe(60);
    expect(idb.stores.meta.size).toBe(60);
    expect(idb.stores.pics.has('s:' + '0'.repeat(64))).toBe(false);
    expect(idb.stores.pics.has('s:' + String(1).padStart(64, '0'))).toBe(true);
    expect(idb.stores.pics.has('d:taku:chibi:celebrate')).toBe(true);
  });

  it('自分のキャラ: 1回目は apiOshiImage で取って中身の指紋で置き、組み直すとサーバを呼ばずに出す', async () => {
    const idb = fakeIndexedDB();
    window.indexedDB = idb;
    const sha = oshiGet('mine:1').images.find((r) => r.state === 'celebrate').sha;

    const first = mountOshi(LUNA);
    closeOneIssue();
    await settle();
    expect(callsOf(first, 'apiOshiImage')).toEqual([[1, 'celebrate']]);
    expect(bubbleImg().getAttribute('src')).toBe(PNG_URL);
    expect(idb.stores.pics.get('s:' + sha)).toEqual({ dataUrl: PNG_URL });

    const again = mountOshi(LUNA);
    closeOneIssue();
    await settle();
    expect(callsOf(again, 'apiOshiImage')).toEqual([]);
    expect(bubbleImg().getAttribute('src')).toBe(PNG_URL);
  });

  it('自分のキャラ: 絵を入れ替えて中身の指紋が変われば、覚えた絵は使わずに取り直す', async () => {
    const idb = fakeIndexedDB();
    window.indexedDB = idb;
    const old = oshiGet('mine:1').images.find((r) => r.state === 'celebrate').sha;
    idb.stores.pics.set('s:' + old, { dataUrl: 'data:image/png;base64,T0xE' });
    idb.stores.meta.set('s:' + old, { used: 1 });
    const got = oshiGet('mine:1');
    const sha = 'a'.repeat(64);
    got.images.forEach((r) => { if (r.state === 'celebrate') r.sha = sha; });
    got.mine.forEach((m) => m.images.forEach((r) => { if (r.state === 'celebrate') r.sha = sha; }));

    const app = mountOshi(LUNA, {
      apiOshiGet: got,
      apiOshiImage: (charId, state) => ({ charId, state, sha, dataUrl: PNG_URL }),
    });
    closeOneIssue();
    await settle();
    expect(callsOf(app, 'apiOshiImage')).toEqual([[1, 'celebrate']]);
    expect(bubbleImg().getAttribute('src')).toBe(PNG_URL);
    expect(idb.stores.pics.get('s:' + sha)).toEqual({ dataUrl: PNG_URL });
  });

  describe('IndexedDB が使えないときは、今までどおりサーバから取る (絵は出る)', () => {
    it('IndexedDB が無い: その場で (待たずに) サーバから取る', () => {
      delete window.indexedDB;
      const app = mountOshi(TAKU);
      closeOneIssue();
      expect(callsOf(app, 'apiOshiDefaultImage')).toEqual([['taku', 'chibi', 'celebrate']]);
      expect(bubbleImg().getAttribute('src')).toBe(defaultUrl('taku', 'chibi', 'celebrate'));
    });

    it('open が失敗する', async () => {
      window.indexedDB = fakeIndexedDB({ openFails: true });
      const app = mountOshi(TAKU);
      closeOneIssue();
      await settle();
      expect(callsOf(app, 'apiOshiDefaultImage')).toEqual([['taku', 'chibi', 'celebrate']]);
      expect(bubbleImg().getAttribute('src')).toBe(defaultUrl('taku', 'chibi', 'celebrate'));
      // 自分のキャラも同じ
      const mine = mountOshi(LUNA);
      closeOneIssue();
      await settle();
      expect(callsOf(mine, 'apiOshiImage')).toEqual([[1, 'celebrate']]);
      expect(bubbleImg().getAttribute('src')).toBe(PNG_URL);
    });

    it('get が投げる', async () => {
      const idb = fakeIndexedDB({ getThrows: true });
      window.indexedDB = idb;
      const app = mountOshi(TAKU);
      closeOneIssue();
      await settle();
      expect(callsOf(app, 'apiOshiDefaultImage')).toEqual([['taku', 'chibi', 'celebrate']]);
      expect(bubbleImg().getAttribute('src')).toBe(defaultUrl('taku', 'chibi', 'celebrate'));
    });

    it('window.indexedDB を読むだけで投げる (iframe で拒まれる)', () => {
      Object.defineProperty(window, 'indexedDB', { configurable: true, get() { throw new Error('SecurityError'); } });
      const app = mountOshi(TAKU);
      closeOneIssue();
      expect(callsOf(app, 'apiOshiDefaultImage')).toEqual([['taku', 'chibi', 'celebrate']]);
      expect(bubbleImg().getAttribute('src')).toBe(defaultUrl('taku', 'chibi', 'celebrate'));
    });

    it('open の返事が来ない: 待ちすぎずにサーバから取る', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        window.indexedDB = { open() { return {}; } };
        const app = mountOshi(TAKU);
        closeOneIssue();
        expect(callsOf(app, 'apiOshiDefaultImage')).toEqual([]);
        vi.advanceTimersByTime(1500);
        expect(callsOf(app, 'apiOshiDefaultImage')).toEqual([['taku', 'chibi', 'celebrate']]);
        expect(bubbleImg().getAttribute('src')).toBe(defaultUrl('taku', 'chibi', 'celebrate'));
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('読んでいるあいだに同じ絵が要っても、2回取りに行かない (待ち合わせる)', async () => {
    const idb = fakeIndexedDB();
    window.indexedDB = idb;
    const app = mountOshi(TAKU);
    closeOneIssue();
    closeOneIssue();
    await settle();
    expect(callsOf(app, 'apiOshiDefaultImage')).toEqual([['taku', 'chibi', 'celebrate']]);
    expect(idb.opened).toBe(1);
  });
});
