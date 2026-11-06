// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prefsFixture } from '../dom.js';
import { mount } from './mount.js';
import { loadGas, loadGasWith } from '../harness.js';
import { createFakeGas } from '../fakegas.js';
import { APP_SOURCES } from '../sources.js';

/*
 * 知らせのタブの名前と推しの一言 (やること #108。docs/dev/notifications.md)。
 *
 * - タブの名前に未読の数を付ける (`(2) SoftBanto`)。0 件なら付けない
 * - 集中しているあいだは集中の残り時間が名前を描き、数は焼き込まない。終わったら数付きの名前に戻す
 * - 新しい知らせが届いたとき (1分ごとの頼み)、推しがオンなら場面 notice の一言を言う
 */

const OSHI_LINES = loadGas('src/core/Oshi.js').OSHI_LINES();

let oshiServer = null;
/** 本物のサーバ (疑似GAS) が返す推し。何も選んでいないので最初からいるキャラ (タク) */
function oshiReply() {
  if (!oshiServer) {
    const ctx = loadGasWith(createFakeGas(), ...APP_SOURCES);
    ctx.repoInit('agentic-management');
    oshiServer = ctx;
  }
  return JSON.parse(JSON.stringify(oshiServer.apiOshiGet()));
}

/** 組むときに、1分ごとの知らせの取り直しを預かる (手で回すため) */
function mountWithPoll(over) {
  const every = window.setInterval;
  let poll = null;
  window.setInterval = function (fn, ms, ...rest) {
    if (ms === 60000 && String(fn).includes('loadNotices')) poll = fn;
    return every.call(window, fn, ms, ...rest);
  };
  let app;
  try { app = mount(over); } finally { window.setInterval = every; }
  expect(poll).not.toBeNull();
  return { app, poll };
}

function notices(n, firstId) {
  const items = [];
  for (let i = 0; i < n; i++) {
    items.push({ id: (firstId || 1) + i, kind: 'mention', title: '呼ばれています ' + i, body: '', link: 'issue:1',
      at: '2026-10-01T00:00:00.000Z', read: false });
  }
  return { items, unread: n };
}

const bubble = () => document.getElementById('oshi-bubble');

describe('タブの名前に未読の数', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('未読があれば (2) SoftBanto、0 件なら数を付けない', () => {
    const { app, poll } = mountWithPoll({ apiNotifications: notices(2) });
    expect(document.title).toBe('(2) SoftBanto');

    app.respond('apiNotifications', () => notices(0));
    poll();
    expect(document.title).toBe('SoftBanto');

    // 数が減っても前の数を焼き込まない (元の名前は app.js の titleBase の1か所)
    app.respond('apiNotifications', () => notices(3, 10));
    poll();
    expect(document.title).toBe('(3) SoftBanto');
    app.respond('apiNotifications', () => notices(1, 10));
    poll();
    expect(document.title).toBe('(1) SoftBanto');
  });
});

describe('集中しているあいだのタブの名前', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.classList.remove('focus-mode');
  });

  const session = (over) => Object.assign({
    id: 7, issueNumber: 2, title: '通勤手当の見直し', plannedMinutes: 25, extendedMinutes: 0,
    startedAt: new Date().toISOString(), openedAt: new Date().toISOString(), provedAt: '', endedAt: '',
    result: '', firstStep: '', proofKind: '', points: 0,
  }, over || {});

  it('集中の残り時間に知らせの数を焼き込まず、終わったら数付きの名前に戻す', () => {
    const { app, poll } = mountWithPoll({
      apiPrefs: prefsFixture({ values: { 'focus.start': true } }),
      apiNotifications: notices(2),
      apiFocusStart: (n, minutes) => session({ issueNumber: n, plannedMinutes: minutes }),
      apiFocusMine: { active: null, week: { started: 0, proved: 0, finished: 0 }, toStart: [], measured: 0, badges: [] },
      apiFocusEnd: (id, result) => session({ id, result, endedAt: new Date().toISOString() }),
    });
    expect(document.title).toBe('(2) SoftBanto');

    document.querySelector('.nav-item[data-tab="issues"]').click();
    document.querySelector('#issue-list [aria-label="#2 を今から始める"]').click();
    const dock = document.getElementById('focus-dock');
    dock.querySelector('.seg[data-minutes="25"]').click();
    dock.querySelector('.focus-go').click();
    expect(document.title).toBe('残り25分 · SoftBanto');

    // 集中のあいだに届いた知らせは、数だけ覚えて名前は集中の残り時間のまま
    app.respond('apiNotifications', () => notices(3, 10));
    poll();
    expect(document.title).toBe('残り25分 · SoftBanto');
    vi.advanceTimersByTime(60000);
    expect(document.title).toBe('残り24分 · SoftBanto');

    // 終えたら数付きの名前に戻す (集中する前の「(2)」ではなく、いまの数)
    const end = [...document.querySelectorAll('#focus-dock button')].find((b) => /やめる|終える|終わった/.test(b.textContent));
    expect(end, '集中を終えるボタン').toBeTruthy();
    end.click();
    const confirmBtn = [...document.querySelectorAll('#focus-dock button, .dialog button')].find((b) => /やめる|終える/.test(b.textContent) && b !== end);
    if (confirmBtn) confirmBtn.click();
    expect(document.getElementById('focus-dock')).toBe(null);
    expect(document.title).toBe('(3) SoftBanto');
  });
});

describe('知らせが届いたときの推しの一言 (場面 notice)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  function hideBubble() {
    const el = bubble();
    if (el) el.hidden = true;
  }

  it('推しがオンなら、新しい知らせが届いたときに notice の一言を言う。開いたときの前からあるぶんでは言わない', () => {
    const { app, poll } = mountWithPoll({
      apiPrefs: prefsFixture({ values: { 'oshi.on': true, 'oshi.home': false } }),
      apiOshiGet: oshiReply(),
      apiNotifications: notices(1),
    });
    // 開いたときは前からあるぶんなので、帯も一言も出さない
    expect(bubble() && !bubble().hidden && bubble().dataset.event === 'notice').toBeFalsy();
    hideBubble();

    app.respond('apiNotifications', () => notices(1, 5));
    poll();
    const el = bubble();
    expect(el && !el.hidden, '吹き出しが出る').toBe(true);
    expect(el.dataset.event).toBe('notice');
    const tone = oshiReply().tone;
    expect(OSHI_LINES[tone].notice).toContain(el.querySelector('.oshi-line').textContent);
  });

  it('推しがオフの人には出ない', () => {
    const { app, poll } = mountWithPoll({
      apiPrefs: prefsFixture({ values: { 'oshi.on': false } }),
      apiNotifications: notices(0),
    });
    app.respond('apiNotifications', () => notices(1, 5));
    poll();
    expect(document.getElementById('snackbar').textContent).toContain('呼ばれています 0');
    const el = bubble();
    expect(!el || el.hidden).toBe(true);
    expect(app.calls.map((c) => c.name)).not.toContain('apiOshiGet');
  });

  it('新しい知らせが無ければ言わない (数が同じまま取り直しただけ)', () => {
    const { app, poll } = mountWithPoll({
      apiPrefs: prefsFixture({ values: { 'oshi.on': true, 'oshi.home': false } }),
      apiOshiGet: oshiReply(),
      apiNotifications: notices(1),
    });
    hideBubble();
    app.respond('apiNotifications', () => notices(1));
    poll();
    const el = bubble();
    expect(!el || el.hidden || el.dataset.event !== 'notice').toBe(true);
  });
});
