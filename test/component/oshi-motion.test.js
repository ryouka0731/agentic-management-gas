// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prefsFixture } from '../dom.js';
import { mount } from './mount.js';
import { loadGasWith } from '../harness.js';
import { createFakeGas } from '../fakegas.js';
import { APP_SOURCES } from '../sources.js';

/*
 * 推しの絵の小さな動き (js-oshi の oshiMotionStart。やること #101「推しの絵に動いている感を出す」)。
 * 推しの頁の顔 (makeOshiHero) と吹き出しの絵に、いまある表情の絵の組み合わせと CSS の小さな動きで動いている感を出す。
 *
 * 最初の mount は本物の時計で (test/dom.js が setInterval を包むのは最初の1回だけ。room.test.js と同じ作法)。
 * 頁を開く前に偽の時計にして、動きの時計だけ偽の時計で進める。Math.random は「次までの間」と「どの動きか」に使う
 * (0 → 最短 4 秒・まばたき、0.5 → 6.5 秒・うなずき)。
 */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PNG_URL = 'data:image/png;base64,' + PNG.toString('base64');

let server = null;
/** 本物のサーバ (疑似GAS) の apiOshiGet。自分のキャラ「ルナ」(絵なし) がいる */
function oshiGet(charPref, fallback) {
  if (!server) {
    const fake = createFakeGas();
    const ctx = loadGasWith(fake, ...APP_SOURCES);
    ctx.repoInit('agentic-management');
    ctx.apiOshiCharCreate('ルナ', 'genki');
    server = { ctx };
  }
  server.ctx.apiPrefSet('oshi.char', charPref);
  server.ctx.apiPrefSet('oshi.fallback', fallback || null);
  return JSON.parse(JSON.stringify(server.ctx.apiOshiGet()));
}

const defaultUrl = (char, style, state) => 'data:image/webp;base64,' + Buffer.from(char + ':' + style + ':' + state).toString('base64');

/** タクを使う人 (最初からいるキャラ。表情の絵がそろっている) */
const TAKU = { 'oshi.on': true, 'oshi.char': 'builtin:taku', 'oshi.home': false };
/** 自分のキャラ (ルナ。絵を入れていない) だけを使い、最初からいるキャラの絵を出さない人 */
const LUNA = { 'oshi.on': true, 'oshi.char': 'mine:1', 'oshi.fallback': 'none', 'oshi.home': false };

/**
 * 動きを減らす設定の疑似 (jsdom には matchMedia が無い。無い環境では動かさないので、動きを見るテストは必ず置く)。
 * set(true/false) で途中で切り替え、聞き手に change を送る。
 */
function motionPref(reduce) {
  const mq = {
    matches: !!reduce,
    listeners: [],
    addEventListener(type, fn) { if (type === 'change') this.listeners.push(fn); },
    removeEventListener(type, fn) { this.listeners = this.listeners.filter((f) => f !== fn); },
    set(v) {
      this.matches = !!v;
      this.listeners.slice().forEach((fn) => fn({ matches: this.matches }));
    },
  };
  window.matchMedia = (query) => (/reduce/.test(query) ? mq : { matches: false, addEventListener() {}, removeEventListener() {} });
  return mq;
}

function mountOshi(values, over) {
  const v = values;
  return mount(Object.assign({
    apiPrefs: prefsFixture({ values: v }),
    apiOshiGet: oshiGet(v['oshi.char'], v['oshi.fallback']),
    apiOshiImage: (charId, state) => ({ charId, state, sha: 'f'.repeat(64), dataUrl: PNG_URL }),
    apiOshiDefaultImage: (char, style, state) => ({ char, style, state, dataUrl: defaultUrl(char, style, state) }),
    apiPrefSet: (key, value) => prefsFixture({ values: Object.assign({}, v, { [key]: value }) }),
  }, over || {}));
}

function openPage() {
  document.getElementById('me-btn').click();
  const btn = [...document.querySelectorAll('#me-body button')].find((b) => b.textContent === '推し');
  expect(btn, '自分のところに「推し」がある').toBeTruthy();
  btn.click();
  return document.querySelector('.oshi-page');
}

const hero = () => document.querySelector('.oshi-page .oshi-hero');
const heroFig = () => hero().querySelector('.oshi-hero-figure');
const heroSrc = () => {
  const img = heroFig().querySelector('img');
  return img ? img.getAttribute('src') : '';
};
const MOVES = ['is-blink', 'is-nod', 'is-tilt-l', 'is-tilt-r'];
const moving = (fig) => MOVES.some((k) => fig.classList.contains(k)) || !!fig.dataset.motion;
const defaultCalls = (app) => app.calls.filter((c) => c.name === 'apiOshiDefaultImage').length;

/** 推しの頁を開き、「なでる」を押して笑顔の絵を覚えさせ、ふつうの顔に戻るまで待つ */
function openTakuAndCachePraise() {
  const app = mountOshi(TAKU);
  vi.useFakeTimers();
  openPage();
  hero().querySelector('.oshi-pat').click();
  expect(heroSrc()).toBe(defaultUrl('taku', 'chibi', 'praise'));
  vi.advanceTimersByTime(4000);
  expect(hero().dataset.state).toBe('idle');
  return app;
}

describe('推しの絵の小さな動き', () => {
  let pref = null;
  beforeEach(() => {
    window.localStorage.clear();
    pref = motionPref(false);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete window.matchMedia;
    delete document.hidden;
  });

  it('時間が進むと、覚えてある近い表情の絵 (笑顔) に一瞬だけ切り替わって戻る。サーバへは取りに行かない', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const app = openTakuAndCachePraise();
    const idle = heroSrc();
    expect(idle).not.toBe(defaultUrl('taku', 'chibi', 'praise'));
    const asked = defaultCalls(app);
    let seen = false;
    for (let t = 0; t < 10000 && !seen; t += 50) {
      vi.advanceTimersByTime(50);
      if (heroSrc() === defaultUrl('taku', 'chibi', 'praise')) seen = true;
    }
    expect(seen, '一瞬だけ笑顔の絵になる').toBe(true);
    expect(heroFig().dataset.motion).toBe('blink');
    expect(hero().dataset.state, '表情 (なでた・場面) は変えない').toBe('idle');
    vi.advanceTimersByTime(150);
    expect(heroSrc()).toBe(idle);
    expect(moving(heroFig())).toBe(false);
    expect(defaultCalls(app), '動きのために絵を取りに行かない').toBe(asked);
  });

  it('絵の無いキャラは、CSS の class だけ変わる (まばたき・うなずき)。絵は取りに行かない', () => {
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0);
    const app = mountOshi(LUNA);
    vi.useFakeTimers();
    openPage();
    const fig = heroFig();
    expect(fig.querySelector('img')).toBe(null);
    expect(fig.querySelector('.oshi-avatar')).toBeTruthy();
    vi.advanceTimersByTime(3999);
    expect(moving(fig)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(fig.classList.contains('is-blink')).toBe(true);
    vi.advanceTimersByTime(150);
    expect(fig.classList.contains('is-blink')).toBe(false);
    // 次 (まばたきが戻ったときに 4 秒後へ仕掛けた) は、選ぶときの 0.5 でうなずき、しばらくで戻る
    rnd.mockReturnValue(0.5);
    vi.advanceTimersByTime(3999);
    expect(moving(fig)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(fig.classList.contains('is-nod')).toBe(true);
    vi.advanceTimersByTime(700);
    expect(fig.classList.contains('is-nod')).toBe(false);
    expect(fig.querySelector('img')).toBe(null);
    expect(app.calls.filter((c) => c.name === 'apiOshiImage' || c.name === 'apiOshiDefaultImage')).toEqual([]);
  });

  it('動きを減らす設定では、絵の切り替えも動きもしない', () => {
    pref.set(true);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    openTakuAndCachePraise();
    const idle = heroSrc();
    for (let t = 0; t < 30000; t += 50) {
      vi.advanceTimersByTime(50);
      expect(moving(heroFig())).toBe(false);
      expect(heroSrc()).toBe(idle);
    }
  });

  it('要素を外すと時計が止まり、付け直しても動かない (時計を残さない)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    mountOshi(LUNA);
    vi.useFakeTimers();
    openPage();
    const sec = hero();
    const fig = heroFig();
    const parent = sec.parentNode;
    sec.remove();
    vi.advanceTimersByTime(10000);
    parent.appendChild(sec);
    for (let t = 0; t < 30000; t += 50) {
      vi.advanceTimersByTime(50);
      expect(moving(fig)).toBe(false);
    }
  });

  it('画面が隠れているあいだは動かず、戻ったら再び動く', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    mountOshi(LUNA);
    vi.useFakeTimers();
    openPage();
    const fig = heroFig();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    for (let t = 0; t < 20000; t += 50) {
      vi.advanceTimersByTime(50);
      expect(moving(fig)).toBe(false);
    }
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(4000);
    expect(fig.classList.contains('is-blink')).toBe(true);
  });

  it('なでた直後は動きで上書きしない。動きの最中になでたら、なでた方を出す', () => {
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0);
    openTakuAndCachePraise();
    const praise = defaultUrl('taku', 'chibi', 'praise');
    // まばたきで笑顔の絵になっている最中になでる → 150ms 後に戻されず、笑顔のまま
    let t = 0;
    while (heroSrc() !== praise && t < 10000) { vi.advanceTimersByTime(50); t += 50; }
    expect(heroFig().dataset.motion).toBe('blink');
    hero().querySelector('.oshi-pat').click();
    expect(hero().dataset.state).toBe('praise');
    expect(moving(heroFig())).toBe(false);
    // 笑顔のあいだ (4秒) は動かさない
    rnd.mockReturnValue(0.5);
    for (let s = 0; s < 3950; s += 50) {
      vi.advanceTimersByTime(50);
      expect(moving(heroFig())).toBe(false);
      expect(heroSrc()).toBe(praise);
    }
    vi.advanceTimersByTime(50);
    expect(hero().dataset.state).toBe('idle');
    // うなずきの最中になでる → うなずきを外して笑顔
    while (!heroFig().classList.contains('is-nod') && t < 40000) { vi.advanceTimersByTime(50); t += 50; }
    expect(heroFig().classList.contains('is-nod')).toBe(true);
    hero().querySelector('.oshi-pat').click();
    expect(heroFig().classList.contains('is-nod')).toBe(false);
    expect(hero().classList.contains('is-patted')).toBe(true);
    expect(heroSrc()).toBe(praise);
  });

  it('吹き出しの小さい絵は、まばたき (CSS) だけ。絵は切り替えない', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    mountOshi(TAKU);
    vi.useFakeTimers();
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list [aria-label$="を完了にする"]').click();
    const b = document.getElementById('oshi-bubble');
    expect(b.hidden).toBe(false);
    const fig = b.querySelector('.oshi-figure');
    const src = fig.querySelector('img').getAttribute('src');
    let blinked = false;
    // 0.99 → 8.95 秒後。吹き出しは 6 秒で消えるので、マウスを載せて出しておく
    b.dispatchEvent(new Event('mouseenter'));
    for (let t = 0; t < 9500; t += 50) {
      vi.advanceTimersByTime(50);
      expect(fig.classList.contains('is-nod') || fig.classList.contains('is-tilt-l') || fig.classList.contains('is-tilt-r')).toBe(false);
      expect(fig.querySelector('img').getAttribute('src')).toBe(src);
      if (fig.classList.contains('is-blink')) blinked = true;
    }
    expect(blinked).toBe(true);
  });

  // ----- レビュー (Sourcery) の指摘で足した決まり -----

  it('頁を開いたまま選ぶキャラを変えても、前の顔のまばたきに新しいキャラの絵を差し込まない (CSS だけ)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.useFakeTimers();
    const app = mountOshi(TAKU);
    // 設定の画面は最初の波が閉じてから開ける
    vi.advanceTimersByTime(15000);
    openPage();
    const sec = hero();
    const fig = heroFig();
    app.respond('apiOshiGet', oshiGet('builtin:itsuki'));
    document.querySelector('.nav-item[data-tab="settings"]').click();
    [...document.querySelectorAll('[data-pref="oshi.char"] .oshi-choice')].find((b) => b.dataset.char === 'builtin:itsuki').click();
    // 頁を開いたまま (前の顔が付いたまま) 選び直した形にする。設定の画面へ移ると頁は外れるので、前の顔を付け直して見る
    // (頁の中の「使う」から選び直したときは、届いた推しで頁を描き直すまで前の顔が付いたまま)
    if (!sec.isConnected) document.body.appendChild(sec);
    expect(sec.isConnected, '前の顔はまだ付いている').toBe(true);
    const decoded = (src) => Buffer.from(src.split(',')[1], 'base64').toString();
    let blinked = false;
    for (let t = 0; t < 20000; t += 50) {
      vi.advanceTimersByTime(50);
      const img = fig.querySelector('img');
      expect(decoded(img.getAttribute('src')).startsWith('itsuki:'), '新しいキャラの絵が前の顔に出る').toBe(false);
      if (fig.classList.contains('is-blink')) blinked = true;
    }
    expect(blinked, '絵は切り替えず、CSS のまばたきだけ').toBe(true);
    // 新しいキャラの笑顔の絵はメモリにある (無ければこのテストは何も見ていない)
    expect(app.calls.some((c) => c.name === 'apiOshiDefaultImage' && c.args[0] === 'itsuki' && c.args[2] === 'praise')).toBe(true);
  });

  it('うなずきの最中に外れたら、戻したあとに次の時計を仕掛けない', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    mountOshi(LUNA);
    vi.useFakeTimers();
    openPage();
    const fig = heroFig();
    vi.advanceTimersByTime(6500);
    expect(fig.classList.contains('is-nod')).toBe(true);
    hero().remove();
    const before = vi.getTimerCount();
    vi.advanceTimersByTime(700);
    expect(vi.getTimerCount(), '戻す時計が終わり、次は仕掛けない').toBe(before - 1);
  });

  it('隠れているあいだに外れたら、戻ったときに次の時計を仕掛けない', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    mountOshi(LUNA);
    vi.useFakeTimers();
    openPage();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    vi.advanceTimersByTime(4000);
    hero().remove();
    const before = vi.getTimerCount();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(vi.getTimerCount()).toBe(before);
  });

  it('吹き出しを閉じたら、絵の動きの時計も止める', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    mountOshi(TAKU);
    vi.useFakeTimers();
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list [aria-label$="を完了にする"]').click();
    const b = document.getElementById('oshi-bubble');
    expect(b.hidden).toBe(false);
    const before = vi.getTimerCount();
    b.querySelector('.oshi-close').click();
    expect(b.hidden).toBe(true);
    expect(vi.getTimerCount(), '消す時計と動きの時計の2つが止まる').toBe(before - 2);
  });

  it('動きを減らす設定が途中でオンになったら、まばたきの途中でもすぐ絵を戻して止め、オフに戻したら始め直す', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    openTakuAndCachePraise();
    const idle = heroSrc();
    const praise = defaultUrl('taku', 'chibi', 'praise');
    let t = 0;
    while (heroSrc() !== praise && t < 10000) { vi.advanceTimersByTime(50); t += 50; }
    expect(heroSrc()).toBe(praise);
    pref.set(true);
    expect(heroSrc(), 'まばたきの絵をすぐ戻す').toBe(idle);
    expect(moving(heroFig())).toBe(false);
    for (let s = 0; s < 30000; s += 50) {
      vi.advanceTimersByTime(50);
      expect(moving(heroFig())).toBe(false);
      expect(heroSrc()).toBe(idle);
    }
    pref.set(false);
    vi.advanceTimersByTime(4000);
    expect(heroSrc(), 'オフに戻すと始め直す').toBe(praise);
  });

  it('動きを減らす設定が分からない (matchMedia が無い) 環境では動かさない', () => {
    delete window.matchMedia;
    vi.spyOn(Math, 'random').mockReturnValue(0);
    openTakuAndCachePraise();
    const idle = heroSrc();
    for (let s = 0; s < 30000; s += 50) {
      vi.advanceTimersByTime(50);
      expect(moving(heroFig())).toBe(false);
      expect(heroSrc()).toBe(idle);
    }
  });

  it('止まったら、動きを減らす設定の聞き手も外す', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    mountOshi(LUNA);
    vi.useFakeTimers();
    const n0 = pref.listeners.length;
    openPage();
    expect(pref.listeners.length).toBe(n0 + 1);
    hero().remove();
    vi.advanceTimersByTime(10000);
    expect(pref.listeners.length).toBe(n0);
  });
});
