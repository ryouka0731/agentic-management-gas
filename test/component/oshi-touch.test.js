// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prefsFixture } from '../dom.js';
import { mount } from './mount.js';
import { loadGasWith } from '../harness.js';
import { createFakeGas } from '../fakegas.js';
import { APP_SOURCES } from '../sources.js';

/*
 * 推しの絵を、頭以外の場所でも押すと場所ごとに反応する (やること #104)。推しの頁の顔 (makeOshiHero) と作業部屋の推し。
 * 頭 (上) を押す・なでる → なでられた (pat)、顔 (真ん中) → つつかれた (poke)、体 (下) → くすぐられた (tickle)。
 * 返事の形は仕込みで写さず、本物のサーバ (疑似GAS) の apiOshiGet から作る (既定のキャラ タク・明るい相棒)。
 */

let server = null;
function oshiGet() {
  if (!server) {
    const ctx = loadGasWith(createFakeGas(), ...APP_SOURCES);
    ctx.repoInit('agentic-management');
    server = JSON.parse(JSON.stringify(ctx.apiOshiGet()));
  }
  return server;
}
const ev = (key) => oshiGet().events.find((e) => e.key === key);
const img = (a, b, c) => 'data:image/webp;base64,' + Buffer.from(a + ':' + b + ':' + c).toString('base64');

function mountWith(values) {
  const v = Object.assign({ 'oshi.on': true, 'oshi.home': false, 'room.on': true }, values || {});
  return mount({
    apiPrefs: prefsFixture({ values: v }),
    apiPrefSet: (key, value) => prefsFixture({ values: Object.assign({}, v, { [key]: value }) }),
    apiOshiGet: oshiGet(),
    apiOshiDefaultImage: (char, style, state) => ({ char, style, state, dataUrl: img(char, style, state) }),
  });
}

function openPage() {
  document.getElementById('me-btn').click();
  [...document.querySelectorAll('#me-body button')].find((b) => b.textContent === '推し').click();
  const sec = document.querySelector('.oshi-page .oshi-hero');
  const fig = sec.querySelector('.oshi-hero-figure');
  fig.getBoundingClientRect = () => ({ top: 0, left: 0, width: 200, height: 200, right: 200, bottom: 200 });
  return { sec, fig };
}

/** 指をほとんど動かさずに押して離す (jsdom の PointerEvent は座標を持たせにくいので、同じ名前の MouseEvent) */
function tap(el, x, y) {
  el.dispatchEvent(new MouseEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }));
  el.dispatchEvent(new MouseEvent('pointerup', { clientX: x, clientY: y, bubbles: true }));
  el.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true }));
}
const move = (el, x, y) => el.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
/** 頭を一往復半 (向きが2回変わる) なでる。押してはいない */
function stroke(el) {
  move(el, 20, 40); move(el, 80, 40); move(el, 20, 40); move(el, 80, 40);
}

/** 溜めた使われ方を送らせ、送った行 (kind:target → 回数) を返す */
function flushUsage(app) {
  window.dispatchEvent(new window.Event('pagehide'));
  const sent = {};
  app.calls.filter((c) => c.name === 'apiUsageRecord').forEach((c) => {
    c.args[0].forEach((r) => { sent[r.kind + ':' + r.target] = (sent[r.kind + ':' + r.target] || 0) + r.count; });
  });
  return sent;
}
const line = (sec) => sec.querySelector('.oshi-hero-line').textContent;

describe('推しの頁の顔: 場所ごとに違う反応をする', () => {
  beforeEach(() => { window.localStorage.clear(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('場面は Oshi.js の表から届く: つつかれた (びっくり)・くすぐられた (おいわい) と、続けて押したときの一言', () => {
    expect(ev('poke')).toMatchObject({ label: 'つつかれた', state: 'surprise', touch: true });
    expect(ev('tickle')).toMatchObject({ label: 'くすぐられた', state: 'celebrate', touch: true });
    expect(ev('pat')).toMatchObject({ touch: true });
    for (const k of ['pat', 'poke', 'tickle']) expect(ev(k).much, k).toContain('くすぐったい');
    expect(ev('done').much).toBe('');
  });

  it('顔 (真ん中) を押すと びっくりの絵と「つつかれた」のせりふ、しばらくで戻る', () => {
    mountWith();
    const { sec, fig } = openPage();
    tap(fig, 100, 100);
    expect(sec.dataset.state).toBe('surprise');
    expect(sec.dataset.touch).toBe('poke');
    expect(fig.querySelector('img').getAttribute('src')).toBe(img('taku', 'chibi', 'surprise'));
    expect(ev('poke').lines).toContain(line(sec));
    vi.advanceTimersByTime(4000);
    expect(sec.dataset.state).toBe('idle');
    expect(line(sec)).toContain('なでると喜びます');
  });

  it('体 (下) を押すと おいわいの絵と「くすぐられた」のせりふ', () => {
    mountWith();
    const { sec, fig } = openPage();
    tap(fig, 100, 180);
    expect(sec.dataset.state).toBe('celebrate');
    expect(ev('tickle').lines).toContain(line(sec));
  });

  it('頭 (上) を押しただけでも なでた (pat) と同じ。使われ方に数えるのは pat だけで、つつく・くすぐるは数えない', () => {
    const app = mountWith();
    const { sec, fig } = openPage();
    tap(fig, 100, 100);
    vi.advanceTimersByTime(4000);
    tap(fig, 100, 180);
    vi.advanceTimersByTime(4000);
    sec.querySelector('.oshi-poke').click();
    vi.advanceTimersByTime(4000);
    sec.querySelector('.oshi-tickle').click();
    vi.advanceTimersByTime(4000);
    expect(flushUsage(app)['action:oshi-pat']).toBeUndefined();
    tap(fig, 100, 20);
    expect(sec.dataset.state).toBe('praise');
    expect(ev('pat').lines).toContain(line(sec));
    expect(flushUsage(app)['action:oshi-pat']).toBe(1);
    // 押す・なでるのどれも、サーバを呼ばない (使われ方を送る apiUsageRecord のほか)
    const names = app.calls.map((c) => c.name).filter((n) => n !== 'apiUsageRecord');
    const before = names.length;
    tap(fig, 100, 100);
    expect(app.calls.map((c) => c.name).filter((n) => n !== 'apiUsageRecord').length).toBe(before);
  });

  it('なでた直後の click は、押したと二重に数えない (せりふも差し替えない)', () => {
    mountWith();
    const { sec, fig } = openPage();
    stroke(fig);
    expect(sec.dataset.state).toBe('praise');
    const said = line(sec);
    // なでた指を離すと、マウスでは click が続く。押した場所が顔でも反応しない
    fig.dispatchEvent(new MouseEvent('click', { clientX: 100, clientY: 100, bubbles: true }));
    expect(line(sec)).toBe(said);
    expect(sec.dataset.touch).toBe('pat');
    vi.advanceTimersByTime(4000);
    // 押してから大きく動かした (スクロールしかけた) click も、押したと数えない
    fig.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, clientY: 150, bubbles: true }));
    move(fig, 100, 190);
    fig.dispatchEvent(new MouseEvent('click', { clientX: 100, clientY: 190, bubbles: true }));
    expect(sec.dataset.state).toBe('idle');
  });

  it('反応のあいだにもう一度押すと、表情は取り直さず、せりふだけ差し替える (続けて同じ字にしない)', () => {
    mountWith();
    const { sec, fig } = openPage();
    tap(fig, 100, 100);
    const first = line(sec);
    vi.advanceTimersByTime(2000);
    tap(fig, 100, 180);
    expect(sec.dataset.state).toBe('surprise');
    expect(ev('tickle').lines).toContain(line(sec));
    // まだ戻らない (最初の反応の時計のまま)
    vi.advanceTimersByTime(2000);
    expect(sec.dataset.state).toBe('idle');
    expect(first).not.toBe('');
  });

  it('せりふは でたらめに選び、続けて同じ字にならない', () => {
    mountWith();
    const { sec, fig } = openPage();
    const seen = new Set();
    let prev = '';
    for (let i = 0; i < 12; i++) {
      tap(fig, 100, 180);
      const now = line(sec);
      expect(now, i).not.toBe(prev);
      seen.add(now);
      prev = now;
      vi.advanceTimersByTime(4000); // 続けて押したと数えない間を空ける
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });

  it('同じ場所を短い間に3回続けて押すと「くすぐったい」系の一言。間を空けたら元に戻る', () => {
    mountWith();
    const { sec, fig } = openPage();
    tap(fig, 100, 100);
    expect(line(sec)).not.toBe(ev('poke').much);
    vi.advanceTimersByTime(500);
    tap(fig, 100, 100);
    expect(line(sec)).not.toBe(ev('poke').much);
    vi.advanceTimersByTime(500);
    tap(fig, 100, 100);
    expect(line(sec)).toBe(ev('poke').much);
    vi.advanceTimersByTime(5000);
    tap(fig, 100, 100);
    expect(ev('poke').lines).toContain(line(sec));
  });

  it('ちがう場所に替えたら、続けて押したと数え直す', () => {
    mountWith();
    const { sec, fig } = openPage();
    tap(fig, 100, 100);
    tap(fig, 100, 100);
    tap(fig, 100, 180);
    expect(ev('tickle').lines).toContain(line(sec));
  });

  it('指を動かせない人のために「なでる」「つつく」「くすぐる」のボタン。押すと同じ反応で、続けて押すのも同じに数える', () => {
    mountWith();
    const { sec } = openPage();
    const labels = [...sec.querySelectorAll('.oshi-hero-btns button')].map((b) => b.textContent);
    expect(labels).toEqual(['なでる', 'つつく', 'くすぐる']);
    sec.querySelector('.oshi-poke').click();
    expect(sec.dataset.state).toBe('surprise');
    expect(ev('poke').lines).toContain(line(sec));
    vi.advanceTimersByTime(4000);
    sec.querySelector('.oshi-tickle').click();
    expect(sec.dataset.state).toBe('celebrate');
    sec.querySelector('.oshi-tickle').click();
    sec.querySelector('.oshi-tickle').click();
    expect(line(sec)).toBe(ev('tickle').much);
    // 読み上げは絵の下の aria-live の字
    expect(sec.querySelector('.oshi-hero-line').getAttribute('aria-live')).toBe('polite');
  });
});

describe('作業部屋の推しも、場所ごとに違う反応をする', () => {
  beforeEach(() => { window.localStorage.clear(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function openRoom(app) {
    document.getElementById('me-btn').click();
    document.querySelector('.room-open-btn').click();
    const fig = document.getElementById('room').querySelector('.room-oshi');
    fig.getBoundingClientRect = () => ({ top: 0, left: 0, width: 200, height: 200, right: 200, bottom: 200 });
    return fig;
  }
  const say = () => document.querySelector('#room .room-oshi-say');

  it('体を押すと おいわいの顔と「くすぐられた」のせりふ。使われ方には数えず、しばらくで作業中の顔に戻る', () => {
    const app = mountWith();
    const fig = openRoom(app);
    tap(fig, 100, 180);
    expect(fig.dataset.state).toBe('celebrate');
    expect(ev('tickle').lines).toContain(say().textContent);
    vi.advanceTimersByTime(4000);
    expect(say()).toBe(null);
    expect(fig.dataset.state).toBe('work');
    tap(fig, 100, 100);
    expect(fig.dataset.state).toBe('surprise');
    expect(ev('poke').lines).toContain(say().textContent);
    expect(flushUsage(app)['action:oshi-pat']).toBeUndefined();
  });

  it('頭を押すと なでた と同じで、数える。反応のあいだに押すと、せりふだけ差し替える', () => {
    const app = mountWith();
    const fig = openRoom(app);
    tap(fig, 100, 20);
    expect(fig.dataset.state).toBe('praise');
    expect(ev('pat').lines).toContain(say().textContent);
    tap(fig, 100, 20);
    tap(fig, 100, 20);
    expect(say().textContent).toBe(ev('pat').much);
    expect(fig.dataset.state).toBe('praise');
    expect(document.querySelectorAll('#room .room-oshi-say').length).toBe(1);
    expect(flushUsage(app)['action:oshi-pat']).toBe(1);
  });

  it('なでた直後の click は、押したと二重に数えない', () => {
    mountWith();
    const fig = openRoom();
    stroke(fig);
    const said = say().textContent;
    fig.dispatchEvent(new MouseEvent('click', { clientX: 100, clientY: 180, bubbles: true }));
    expect(say().textContent).toBe(said);
  });

  it('推しがオフの人影は、押しても何も起きない', () => {
    mountWith({ 'oshi.on': false });
    const fig = openRoom();
    tap(fig, 100, 180);
    expect(say()).toBe(null);
  });
});
