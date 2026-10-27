// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DEFAULTS, prefsFixture } from '../dom.js';
import { mount } from './mount.js';
import { loadGasWith } from '../harness.js';
import { createFakeGas } from '../fakegas.js';
import { APP_SOURCES } from '../sources.js';

/*
 * 待つあいだの推し (js-oshi の oshiWaitInto。やること #103)。
 * ホームのあなたの番の骨組み (スケルトン) を出しているあいだ、使っている推しの絵と一言を添えて待ち時間を退屈にしない。
 * 推しがオンのときだけ。設定が届く前は前回の覚え (localStorage) で出す。覚えは本人のものだけ使い、覚えが無ければ出さない (待たない)。
 * 絵はメモリと IndexedDB だけを見て、無ければ最初の波が閉じてから取る (最初の波に呼び出しを足さない)。
 * 返事の形は仕込みで写さず、本物のサーバ (疑似GAS) の apiOshiGet から作る。
 */

let server = null;
/** 本物のサーバ (疑似GAS) の apiOshiGet。最初からいるキャラを使う */
function oshiGet(char) {
  if (!server) {
    const ctx = loadGasWith(createFakeGas(), ...APP_SOURCES);
    ctx.repoInit('agentic-management');
    server = { ctx };
  }
  server.ctx.apiPrefSet('oshi.char', char || 'builtin:taku');
  return JSON.parse(JSON.stringify(server.ctx.apiOshiGet()));
}

const defaultUrl = (char, style, state) => 'data:image/webp;base64,' + Buffer.from(char + ':' + style + ':' + state).toString('base64');
const decoded = (src) => Buffer.from(src.split(',')[1], 'base64').toString();

/** タクを使う人。ホームのカードは止め、骨組みの推しだけを見る */
const TAKU = { 'oshi.on': true, 'oshi.char': 'builtin:taku', 'oshi.home': false };
const OFF = { 'oshi.on': false, 'oshi.char': 'builtin:taku', 'oshi.home': false };
const ME = 'me@example.com';

/** 返事を止めておき、あとで返す */
function hold(value) {
  const box = { deliver: null };
  box.response = () => ({ later: (ok) => { box.deliver = () => ok(structuredClone(value)); } });
  return box;
}

function mountWait(values, over) {
  return mount(Object.assign({
    apiPrefs: prefsFixture({ values }),
    apiOshiGet: oshiGet(values['oshi.char']),
    apiOshiDefaultImage: (char, style, state) => ({ char, style, state, dataUrl: defaultUrl(char, style, state),
      version: oshiGet().defaultImageVersion }),
    apiPrefSet: (key, value) => prefsFixture({ values: Object.assign({}, values, { [key]: value }) }),
  }, over || {}));
}

/** 骨組みに出せるせりふ (あいさつ3つと考え中。どの時刻に走らせても当たるように全部) */
function waitLines(char) {
  return oshiGet(char).events.filter((e) => ['morning', 'day', 'night', 'spinner'].includes(e.key))
    .flatMap((e) => (e.mine || []).concat(e.lines || []));
}

/**
 * IndexedDB の小さな疑似 (読むだけ。返事は本物と同じく後から届く)。pics に置いたものを返す。
 * 書き込みは受けて捨てる (このテストは読む道だけを見る)。
 */
function fakeIndexedDB(pics) {
  const later = (fn) => setTimeout(fn, 0);
  const request = (fn) => {
    const r = { result: undefined, onsuccess: null, onerror: null };
    later(() => { r.result = fn(); if (r.onsuccess) r.onsuccess({ target: r }); });
    return r;
  };
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore() { return {}; },
    close() {},
    transaction() {
      const tx = { oncomplete: null, onerror: null, onabort: null };
      tx.objectStore = (n) => ({
        get: (key) => request(() => (n === 'pics' && pics.has(key) ? structuredClone(pics.get(key)) : undefined)),
        put: () => request(() => undefined),
        delete: () => request(() => undefined),
        getAllKeys: () => request(() => []),
        getAll: () => request(() => []),
      });
      return tx;
    },
  };
  return {
    open() {
      const r = { result: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
      later(() => { r.result = db; if (r.onsuccess) r.onsuccess({ target: r }); });
      return r;
    },
  };
}
const settle = () => new Promise((r) => setTimeout(r, 40));

const turn = () => document.getElementById('home-turn');
const wait = () => turn().querySelector('.home-skel .oshi-wait');
const calls = (app, name) => app.calls.filter((c) => c.name === name);
const memo = () => JSON.parse(window.localStorage.getItem('oshiWaitMemo'));

describe('待つあいだの推し', () => {
  beforeEach(() => { window.localStorage.clear(); });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete window.indexedDB;
  });

  it('推しがオンなら、あなたの番の骨組みに一言が出て、返事が届くと一緒に消える', () => {
    const summary = hold(DEFAULTS.apiHomeSummary);
    mountWait(TAKU, { apiHomeSummary: summary.response });
    const el = wait();
    expect(el, '骨組みに推しが出る').toBeTruthy();
    expect(waitLines()).toContain(el.querySelector('.oshi-wait-line').textContent);
    // 絵が届くまでは名前の頭文字
    expect(el.querySelector('.oshi-wait-fig .oshi-avatar').textContent).toBe('タ');
    // 一言は飾りなので読ませない (読み上げには骨組みの「読み込んでいます」だけ)。絵はなでられるボタン (oshi-wait-pat.test.js)
    expect(el.querySelector('.oshi-wait-line').getAttribute('aria-hidden')).toBe('true');
    // 骨組みの棒の数はそのまま
    expect(turn().querySelectorAll('.home-skel-line').length).toBe(3);

    summary.deliver();
    expect(turn().querySelector('.home-skel')).toBe(null);
    expect(document.querySelector('.oshi-wait')).toBe(null);
  });

  it('絵のサーバへの取りは最初の波に乗せない。手元に無ければ、最初の波が閉じてから取る', () => {
    vi.useFakeTimers();
    const summary = hold(DEFAULTS.apiHomeSummary);
    const app = mountWait(TAKU, { apiHomeSummary: summary.response });
    expect(wait()).toBeTruthy();
    expect(calls(app, 'apiOshiDefaultImage'), '最初の波のあいだは取らない').toEqual([]);
    vi.advanceTimersByTime(14999);
    expect(wait().querySelector('img.oshi-img'), '最初の波が閉じるまでは頭文字のまま').toBe(null);
    // 返事がそろわないまま最初の波が閉じる (15秒)。骨組みはまだ出ているので、そこで出す
    vi.advanceTimersByTime(1);
    const img = wait().querySelector('.oshi-wait-fig img.oshi-img');
    expect(img, '絵が出る').toBeTruthy();
    expect(decoded(img.getAttribute('src'))).toMatch(/^taku:chibi:/);
  });

  it('骨組みが消えてから最初の波が閉じたら、絵を取りに行かない', () => {
    const summary = hold(DEFAULTS.apiHomeSummary);
    const app = mountWait(TAKU, { apiHomeSummary: summary.response });
    expect(wait()).toBeTruthy();
    // 要約が届くと骨組みが消え、最初の波も閉じる (急がないものが走る)
    summary.deliver();
    expect(calls(app, 'apiOshiDefaultImage')).toEqual([]);
    expect(document.querySelector('.oshi-wait')).toBe(null);
  });

  it('IndexedDB に絵があれば、最初の波のあいだでもサーバを呼ばずに出す', async () => {
    const v = oshiGet().defaultImageVersion;
    const pics = new Map();
    oshiGet().states.forEach((s) => pics.set('d:taku:chibi:' + s.key, { dataUrl: defaultUrl('taku', 'chibi', s.key), v }));
    window.indexedDB = fakeIndexedDB(pics);
    const summary = hold(DEFAULTS.apiHomeSummary);
    const app = mountWait(TAKU, { apiHomeSummary: summary.response });
    await settle();
    const img = wait().querySelector('img.oshi-img');
    expect(img).toBeTruthy();
    expect(decoded(img.getAttribute('src'))).toMatch(/^taku:chibi:/);
    expect(calls(app, 'apiOshiDefaultImage')).toEqual([]);
  });

  it('推しがオフなら出さない', () => {
    const summary = hold(DEFAULTS.apiHomeSummary);
    mountWait(OFF, { apiHomeSummary: summary.response });
    expect(turn().querySelector('.home-skel')).toBeTruthy();
    expect(document.querySelector('.oshi-wait')).toBe(null);
  });

  it('前回の覚えが無く設定もまだ届いていなければ出さず、絵も取りに行かない (待たない)', () => {
    const prefs = hold(prefsFixture({ values: TAKU }));
    const summary = hold(DEFAULTS.apiHomeSummary);
    const app = mountWait(TAKU, { apiPrefs: prefs.response, apiHomeSummary: summary.response });
    expect(turn().querySelector('.home-skel')).toBeTruthy();
    expect(document.querySelector('.oshi-wait')).toBe(null);
    expect(calls(app, 'apiOshiDefaultImage').length).toBe(0);
    expect(calls(app, 'apiOshiGet').length).toBe(0);
    // 設定と推しが届いたとき、まだ骨組みが出ていればそこで出す
    prefs.deliver();
    expect(wait()).toBeTruthy();
  });

  it('推しが届いたら本人の印と一緒に覚え、次に開いたときは設定が届く前から覚えで一言を出す (サーバは呼ばない)。オフと分かれば外して覚えも消す', () => {
    // 1回目: 推しが届いて覚える
    mountWait(TAKU);
    expect(memo().who).toBe(ME);
    expect(memo().char).toBe('builtin:taku');
    expect(memo().name).toBe('タク');
    expect(memo().scenes.spinner.lines.length).toBeGreaterThan(0);
    expect(memo().scenes.spinner.pic.builtin).toBe('taku');

    // 2回目: 設定がまだ届かない
    const prefs = hold(prefsFixture({ values: OFF }));
    const summary = hold(DEFAULTS.apiHomeSummary);
    const app = mountWait(TAKU, { apiPrefs: prefs.response, apiHomeSummary: summary.response });
    const el = wait();
    expect(el, '覚えで出る').toBeTruthy();
    expect(el.dataset.from).toBe('memo');
    expect(waitLines()).toContain(el.querySelector('.oshi-wait-line').textContent);
    expect(calls(app, 'apiOshiDefaultImage').length).toBe(0);
    expect(calls(app, 'apiOshiGet').length).toBe(0);

    // 設定が届いたらオフだった: 外して、覚えも消す
    prefs.deliver();
    expect(document.querySelector('.oshi-wait')).toBe(null);
    expect(turn().querySelector('.home-skel.has-oshi')).toBe(null);
    expect(window.localStorage.getItem('oshiWaitMemo')).toBe(null);
  });

  it('別の人の覚えは使わずに消す (同じブラウザで別の人が開いても、前の人の名前とせりふを出さない)', () => {
    mountWait(TAKU);
    const m = memo();
    m.who = 'other@example.com';
    m.name = '前の人のキャラ';
    window.localStorage.setItem('oshiWaitMemo', JSON.stringify(m));
    const prefs = hold(prefsFixture({ values: TAKU }));
    const summary = hold(DEFAULTS.apiHomeSummary);
    mountWait(TAKU, { apiPrefs: prefs.response, apiHomeSummary: summary.response });
    expect(document.querySelector('.oshi-wait')).toBe(null);
    expect(window.localStorage.getItem('oshiWaitMemo')).toBe(null);
  });

  it('本人がまだ分からないあいだは覚えで出さず、本人と分かって覚えと合えば出す', () => {
    mountWait(TAKU);
    const who = hold(DEFAULTS.apiWhoAmI);
    const prefs = hold(prefsFixture({ values: TAKU }));
    const summary = hold(DEFAULTS.apiHomeSummary);
    mountWait(TAKU, { apiWhoAmI: who.response, apiPrefs: prefs.response, apiHomeSummary: summary.response });
    expect(document.querySelector('.oshi-wait')).toBe(null);
    who.deliver();
    expect(wait()).toBeTruthy();
    expect(wait().dataset.from).toBe('memo');
  });

  it('覚えで出したあと推しが届いたら、一言はそのままで、届いた推しのものになる', () => {
    mountWait(TAKU);
    const summary = hold(DEFAULTS.apiHomeSummary);
    const prefs = hold(prefsFixture({ values: TAKU }));
    mountWait(TAKU, { apiPrefs: prefs.response, apiHomeSummary: summary.response });
    const before = wait().querySelector('.oshi-wait-line').textContent;
    prefs.deliver();
    expect(wait().querySelector('.oshi-wait-line').textContent).toBe(before);
    expect(wait().dataset.from).toBe('live');
  });

  it('骨組みが出ているあいだにキャラを選び直したら、前のキャラを残さず、届いたキャラで出し直す', () => {
    vi.useFakeTimers();
    const summary = hold(DEFAULTS.apiHomeSummary);
    const app = mountWait({ 'oshi.on': true, 'oshi.home': false, 'oshi.char': 'builtin:taku' },
      { apiHomeSummary: summary.response });
    expect(wait().dataset.char).toBe('builtin:taku');
    // 選び直した推しの返事は止めておく
    const next = hold(oshiGet('builtin:itsuki'));
    app.respond('apiOshiGet', next.response);
    // 設定の画面は最初の波が閉じてから開ける (名前の先取りを待つ)。要約は止めたままなので骨組みは残る
    vi.advanceTimersByTime(15000);
    document.querySelector('.nav-item[data-tab="settings"]').click();
    [...document.querySelectorAll('[data-pref="oshi.char"] .oshi-choice')].find((b) => b.dataset.char === 'builtin:itsuki').click();
    expect(wait(), '取り直しているあいだ、前のキャラは外す').toBe(null);
    next.deliver();
    expect(wait().dataset.char).toBe('builtin:itsuki');
    expect(waitLines('builtin:itsuki')).toContain(wait().querySelector('.oshi-wait-line').textContent);
  });
});
