// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULTS, prefsFixture } from '../dom.js';
import { mount } from './mount.js';
import { loadGasWith } from '../harness.js';
import { createFakeGas } from '../fakegas.js';
import { APP_SOURCES } from '../sources.js';

/*
 * 待つあいだの推し (js-oshi の oshiWaitInto。やること #103)。
 * ホームのあなたの番の骨組み (スケルトン) を出しているあいだ、使っている推しの絵と一言を添えて待ち時間を退屈にしない。
 * 推しがオンのときだけ。設定が届く前は前回の覚え (localStorage) で出し、覚えが無ければ出さない (待たない)。
 * 返事の形は仕込みで写さず、本物のサーバ (疑似GAS) の apiOshiGet から作る。
 */

let server = null;
/** 本物のサーバ (疑似GAS) の apiOshiGet。最初からいるキャラ (タク) を使う */
function oshiGet() {
  if (!server) {
    const ctx = loadGasWith(createFakeGas(), ...APP_SOURCES);
    ctx.repoInit('agentic-management');
    server = { ctx };
  }
  server.ctx.apiPrefSet('oshi.char', 'builtin:taku');
  return JSON.parse(JSON.stringify(server.ctx.apiOshiGet()));
}

const defaultUrl = (char, style, state) => 'data:image/webp;base64,' + Buffer.from(char + ':' + style + ':' + state).toString('base64');

/** タクを使う人。ホームのカードは止め、骨組みの推しだけを見る */
const TAKU = { 'oshi.on': true, 'oshi.char': 'builtin:taku', 'oshi.home': false };
const OFF = { 'oshi.on': false, 'oshi.char': 'builtin:taku', 'oshi.home': false };

/** 返事を止めておき、あとで返す */
function hold(value) {
  const box = { deliver: null, called: false };
  box.response = (...args) => {
    box.called = true;
    return { later: (ok) => { box.deliver = () => ok(typeof value === 'function' ? value(...args) : structuredClone(value)); } };
  };
  return box;
}

function mountWait(values, over) {
  return mount(Object.assign({
    apiPrefs: prefsFixture({ values }),
    apiOshiGet: oshiGet(),
    apiOshiDefaultImage: (char, style, state) => ({ char, style, state, dataUrl: defaultUrl(char, style, state),
      version: oshiGet().defaultImageVersion }),
  }, over || {}));
}

/** 骨組みに出せるせりふ (あいさつ3つと考え中。どの時刻に走らせても当たるように全部) */
function waitLines() {
  const got = oshiGet();
  return got.events.filter((e) => ['morning', 'day', 'night', 'spinner'].includes(e.key))
    .flatMap((e) => (e.mine || []).concat(e.lines || []));
}

const turn = () => document.getElementById('home-turn');
const wait = () => turn().querySelector('.home-skel .oshi-wait');
const calls = (app, name) => app.calls.filter((c) => c.name === name);

describe('待つあいだの推し', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('推しがオンなら、あなたの番の骨組みに推しの絵と一言が出て、返事が届くと一緒に消える', () => {
    const summary = hold(DEFAULTS.apiHomeSummary);
    mountWait(TAKU, { apiHomeSummary: summary.response });
    const el = wait();
    expect(el, '骨組みに推しが出る').toBeTruthy();
    expect(waitLines()).toContain(el.querySelector('.oshi-wait-line').textContent);
    const img = el.querySelector('.oshi-wait-fig img.oshi-img');
    expect(img, '絵が出る').toBeTruthy();
    expect(Buffer.from(img.src.split(',')[1], 'base64').toString()).toMatch(/^taku:chibi:/);
    // 飾りなので読ませない (読み上げには骨組みの「読み込んでいます」だけ)
    expect(el.getAttribute('aria-hidden')).toBe('true');
    // 骨組みの棒の数はそのまま
    expect(turn().querySelectorAll('.home-skel-line').length).toBe(3);

    summary.deliver();
    expect(turn().querySelector('.home-skel')).toBe(null);
    expect(document.querySelector('.oshi-wait')).toBe(null);
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

  it('絵が届く前に骨組みが消えたら、届いても差し込まない', () => {
    const summary = hold(DEFAULTS.apiHomeSummary);
    const pics = [];
    mountWait(TAKU, {
      apiHomeSummary: summary.response,
      apiOshiDefaultImage: (char, style, state) => ({ later: (ok) => { pics.push(() => ok({ char, style, state,
        dataUrl: defaultUrl(char, style, state) })); } }),
    });
    expect(wait()).toBeTruthy();
    expect(wait().querySelector('img')).toBe(null);
    expect(pics.length).toBeGreaterThan(0);
    summary.deliver();
    pics.forEach((fn) => fn());
    expect(document.querySelector('.oshi-wait')).toBe(null);
    expect(turn().querySelector('.oshi-img')).toBe(null);
  });

  it('推しが届いたら覚え、次に開いたときは設定が届く前から覚えで一言を出す (サーバは呼ばない)。オフと分かれば外して覚えも消す', () => {
    // 1回目: 推しが届いて覚える
    mountWait(TAKU);
    const memo = JSON.parse(window.localStorage.getItem('oshiWaitMemo'));
    expect(memo.char).toBe('builtin:taku');
    expect(memo.name).toBe('タク');
    expect(memo.scenes.spinner.lines.length).toBeGreaterThan(0);
    expect(memo.scenes.spinner.pic.builtin).toBe('taku');

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

  it('覚えで出したあと推しが届いたら、一言はそのままで絵を取る', () => {
    mountWait(TAKU);
    const summary = hold(DEFAULTS.apiHomeSummary);
    const prefs = hold(prefsFixture({ values: TAKU }));
    mountWait(TAKU, { apiPrefs: prefs.response, apiHomeSummary: summary.response });
    const before = wait().querySelector('.oshi-wait-line').textContent;
    expect(wait().querySelector('img')).toBe(null);
    prefs.deliver();
    expect(wait().querySelector('.oshi-wait-line').textContent).toBe(before);
    expect(wait().querySelector('img.oshi-img')).toBeTruthy();
    expect(wait().dataset.from).toBe('live');
  });
});
