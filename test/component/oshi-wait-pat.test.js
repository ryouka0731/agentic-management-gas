// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DEFAULTS, prefsFixture } from '../dom.js';
import { mount } from './mount.js';
import { loadGasWith } from '../harness.js';
import { createFakeGas } from '../fakegas.js';
import { APP_SOURCES } from '../sources.js';

/*
 * 待つあいだに推しをなでる (js-oshi の oshiWaitPat*。やること #93「推しキャラを使ったミニゲームをロード時間に出す」)。
 * ホームのあなたの番の骨組みに出ている推し (oshiWaitInto) の絵を押す (タップ・Enter・Space) たびに回数が増え、絵が少し弾む。
 * 10回ごとに推しの一言 (場面 pat「なでられた」のせりふ)。読み込みが終わると骨組みと一緒に消える。
 * 実績・ポイント・サーバ呼び出しには一切結び付けない (回数も覚えない)。
 * 返事の形は仕込みで写さず、本物のサーバ (疑似GAS) の apiOshiGet から作る。
 */

let server = null;
function oshiGet(char) {
  if (!server) {
    const ctx = loadGasWith(createFakeGas(), ...APP_SOURCES);
    ctx.repoInit('agentic-management');
    server = { ctx };
  }
  server.ctx.apiPrefSet('oshi.char', char || 'builtin:taku');
  return JSON.parse(JSON.stringify(server.ctx.apiOshiGet()));
}

const TAKU = { 'oshi.on': true, 'oshi.char': 'builtin:taku', 'oshi.home': false };
const OFF = { 'oshi.on': false, 'oshi.char': 'builtin:taku', 'oshi.home': false };

function hold(value) {
  const box = { deliver: null };
  box.response = () => ({ later: (ok) => { box.deliver = () => ok(structuredClone(value)); } });
  return box;
}

/** 骨組みを出したままにして組む (要約の返事を止める) */
function mountPat(values, over) {
  const summary = hold(DEFAULTS.apiHomeSummary);
  const app = mount(Object.assign({
    apiPrefs: prefsFixture({ values }),
    apiOshiGet: oshiGet(values['oshi.char']),
    apiHomeSummary: summary.response,
    apiPrefSet: (key, value) => prefsFixture({ values: Object.assign({}, values, { [key]: value }) }),
  }, over || {}));
  return { app, summary };
}

/** 場面 pat (なでられた) のせりふ */
function patLines() {
  const ev = oshiGet().events.find((e) => e.key === 'pat');
  return (ev.mine || []).concat(ev.lines || []);
}

const wait = () => document.querySelector('#home-turn .home-skel .oshi-wait');
const fig = () => wait().querySelector('.oshi-wait-fig');
const count = () => wait().querySelector('.oshi-wait-count');
const live = () => wait().querySelector('.oshi-wait-live');
const line = () => wait().querySelector('.oshi-wait-line');
const key = (el, k, opts) => {
  const e = new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, opts || {}));
  el.dispatchEvent(e);
  return e;
};

/** 動きを減らす設定の疑似 (jsdom には matchMedia が無い。無いと減らす側に倒すので、弾むのを見るときは置く) */
function motion(reduce) {
  window.matchMedia = (q) => ({ matches: /reduce/.test(q) ? reduce : false, addEventListener() {}, removeEventListener() {} });
}

describe('待つあいだに推しをなでる', () => {
  beforeEach(() => { window.localStorage.clear(); });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete window.matchMedia;
  });

  it('絵は押せるボタンとして読み上げられる。一言は飾りのまま読ませない', () => {
    mountPat(TAKU);
    expect(fig().getAttribute('role')).toBe('button');
    expect(fig().getAttribute('tabindex')).toBe('0');
    expect(fig().getAttribute('aria-label')).toBe('推しをなでる');
    // 押せるものを aria-hidden の中に置かない
    expect(fig().closest('[aria-hidden="true"]')).toBe(null);
    expect(line().getAttribute('aria-hidden')).toBe('true');
    expect(live().getAttribute('aria-live')).toBe('polite');
    // まだなでていないので回数は出さない
    expect(count().hidden).toBe(true);
    expect(live().textContent).toBe('');
  });

  it('押すたびに回数が増え、読み上げにも届く', () => {
    mountPat(TAKU);
    fig().click();
    expect(count().hidden).toBe(false);
    expect(count().textContent).toBe('1回');
    expect(live().textContent).toBe('1回なでた');
    fig().click();
    fig().click();
    expect(count().textContent).toBe('3回');
    expect(live().textContent).toBe('3回なでた');
  });

  it('10回ごとに、推しが「なでられた」のせりふを一言いう', () => {
    mountPat(TAKU);
    const before = line().textContent;
    for (let i = 0; i < 9; i++) fig().click();
    expect(line().textContent, '節目の前は一言を変えない').toBe(before);
    fig().click();
    expect(patLines()).toContain(line().textContent);
    expect(live().textContent).toBe('10回なでた。' + line().textContent);
    const first = line().textContent;
    for (let i = 0; i < 10; i++) fig().click();
    expect(patLines()).toContain(line().textContent);
    expect(line().textContent, '次の節目は別のせりふ').not.toBe(first);
    expect(count().textContent).toBe('20回');
  });

  it('Enter と Space でも押せる (Space で画面が流れない。押しっぱなしは数えない)', () => {
    mountPat(TAKU);
    key(fig(), 'Enter');
    const sp = key(fig(), ' ');
    expect(sp.defaultPrevented).toBe(true);
    expect(count().textContent).toBe('2回');
    key(fig(), 'Enter', { repeat: true });
    key(fig(), 'a');
    expect(count().textContent).toBe('2回');
  });

  it('押すと絵が少し弾む。動きを減らす設定では弾まない', () => {
    vi.useFakeTimers();
    motion(false);
    mountPat(TAKU);
    fig().click();
    expect(fig().classList.contains('is-patted')).toBe(true);
    vi.advanceTimersByTime(400);
    expect(fig().classList.contains('is-patted')).toBe(false);

    motion(true);
    fig().click();
    expect(fig().classList.contains('is-patted')).toBe(false);
    expect(count().textContent, '回数は数える').toBe('2回');
  });

  it('サーバを呼ばず、回数をどこにも覚えない (実績・ポイントに結び付けない)', () => {
    const { app } = mountPat(TAKU);
    const calls = app.calls.length;
    const stored = JSON.stringify(Object.assign({}, window.localStorage));
    for (let i = 0; i < 12; i++) fig().click();
    expect(app.calls.length).toBe(calls);
    expect(JSON.stringify(Object.assign({}, window.localStorage))).toBe(stored);
  });

  it('読み込みが終わると、骨組みと一緒に静かに消える。次に開いたら0回から', () => {
    const { summary } = mountPat(TAKU);
    fig().click();
    fig().click();
    summary.deliver();
    expect(document.querySelector('.oshi-wait')).toBe(null);
    expect(document.querySelector('.oshi-wait-fig')).toBe(null);
    mountPat(TAKU);
    expect(count().hidden).toBe(true);
    fig().click();
    expect(count().textContent).toBe('1回');
  });

  it('推しがオフなら出さない', () => {
    mountPat(OFF);
    expect(document.querySelector('#home-turn .home-skel')).toBeTruthy();
    expect(document.querySelector('[aria-label="推しをなでる"]')).toBe(null);
  });

  it('前回の覚えで出したとき (推しが届く前) も、節目に覚えたせりふを言う', () => {
    mountPat(TAKU);
    const prefs = hold(prefsFixture({ values: TAKU }));
    mountPat(TAKU, { apiPrefs: prefs.response });
    expect(wait().dataset.from).toBe('memo');
    for (let i = 0; i < 10; i++) fig().click();
    expect(patLines()).toContain(line().textContent);
  });

  it('効果音をオンにした人には、節目でだけ小さく鳴らす', () => {
    const made = [];
    class FakeAudio {
      constructor() { this.currentTime = 0; this.state = 'running'; this.destination = {}; this.oscs = []; made.push(this); }
      createOscillator() {
        const osc = { frequency: { setValueAtTime: (v) => { osc.freq = v; } }, connect() {}, disconnect() {}, start() {}, stop() {} };
        this.oscs.push(osc);
        return osc;
      }
      createGain() {
        return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} };
      }
      resume() { return Promise.resolve(); }
    }
    const saved = window.AudioContext;
    window.AudioContext = FakeAudio;
    try {
      mountPat(Object.assign({ 'sound.effects': true }, TAKU));
      const notes = () => made.flatMap((c) => c.oscs).length;
      for (let i = 0; i < 9; i++) fig().click();
      expect(notes(), '節目の前は鳴らさない').toBe(0);
      fig().click();
      expect(notes()).toBeGreaterThan(0);
    } finally {
      window.AudioContext = saved;
    }
  });
});
