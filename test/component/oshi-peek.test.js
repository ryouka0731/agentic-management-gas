// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { prefsFixture, DEFAULTS } from '../dom.js';
import { mount } from './mount.js';

/*
 * 推しのひょっこり (js-oshi の oshiPeekTick。やること #102「推しが画面の端にひょっこり現れて、お知らせ・助言・賞賛をくれる」)。
 * 何も操作していないときに、右下から推しが出て1つだけ伝えて引っ込む。開いて10分後から、30分に1回・1日4回まで。
 *
 * 最初の mount は本物の時計で (test/dom.js が setInterval を包むのは最初の1回だけ。oshi-motion.test.js と同じ作法)。
 * そのあとは偽の時計にしてから組む (ひょっこりの時計は組んだときに仕掛ける)。始まりは東京の 10:00。
 */

const START = new Date('2026-10-27T01:00:00.000Z');
const MIN = 60000;

/** せりふは場面 peek だけを持つ推し (タク)。形はサーバの apiOshiGet と同じ */
const OSHI = Object.assign({}, DEFAULTS.apiOshiGet, {
  events: [{ key: 'peek', label: 'ひょっこり (ねぎらい)', state: 'praise', lines: ['見に来たよ！'], mine: [] }],
});

const ME = 'me@example.com';

function mountPeek(values, over) {
  const v = Object.assign({ 'oshi.on': true, 'oshi.home': false }, values || {});
  return mount(Object.assign({
    apiPrefs: prefsFixture({ values: v }),
    apiPrefSet: (key, value) => prefsFixture({ values: Object.assign({}, v, { [key]: value }) }),
    apiOshiGet: OSHI,
    apiOshiDefaultImage: null,
  }, over || {}));
}

const q = (sel) => document.querySelector(sel);
const peek = () => document.getElementById('oshi-peek');
const shown = () => !!peek() && !peek().hidden;
const line = () => peek().querySelector('.oshi-peek-line').textContent;
const memo = () => JSON.parse(window.localStorage.getItem('oshiPeekMemo') || 'null');

describe('推しのひょっこり', () => {
  beforeAll(() => {
    // 本物の時計で1回組む (setInterval を包むのは最初の1回だけ)。推しはオフなので何も仕掛けない
    mount({ apiPrefs: prefsFixture({ values: { 'oshi.on': false } }) });
  });
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers({ now: START });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete document.hidden;
  });

  it('開いて10分後に右下に出て、ねぎらいを一言だけ言い、8秒で引っ込む', () => {
    mountPeek();
    vi.advanceTimersByTime(10 * MIN - 1000);
    expect(shown(), '10分たつまでは出ない').toBe(false);
    vi.advanceTimersByTime(1000);
    expect(shown()).toBe(true);
    expect(line()).toBe('見に来たよ！');
    expect(peek().querySelector('.oshi-name').textContent).toBe('タク');
    expect(peek().dataset.kind).toBe('praise');
    // 絵を覚えていないので頭文字の丸。絵を取りに行かない
    expect(peek().querySelector('.oshi-avatar').textContent).toBe('タ');
    // 読み上げは一言だけ
    const say = document.getElementById('oshi-peek-say');
    expect(say.getAttribute('aria-live')).toBe('polite');
    expect(say.textContent).toBe('見に来たよ！');
    vi.advanceTimersByTime(7999);
    expect(shown(), '8秒までは出ている').toBe(true);
    vi.advanceTimersByTime(1 + 400);
    expect(shown(), '8秒で引っ込む').toBe(false);
    expect(say.textContent).toBe('');
    expect(memo()).toMatchObject({ who: ME, day: '2026-10-27', count: 1 });
  });

  it('押すとすぐ引っ込む (ねぎらいのときはどこへも移らない)', () => {
    mountPeek();
    vi.advanceTimersByTime(10 * MIN);
    q('.oshi-peek-btn').click();
    expect(shown()).toBe(false);
    expect(q('#notice-panel').hidden).toBe(true);
  });

  it('次に出るのは30分たってから。1日4回までで、日が変われば (東京の0時) また出る', () => {
    mountPeek();
    vi.advanceTimersByTime(10 * MIN);
    expect(memo().count).toBe(1);
    vi.advanceTimersByTime(30 * MIN - 1000);
    expect(memo().count, '30分たつまでは出ない').toBe(1);
    vi.advanceTimersByTime(1000);
    expect(shown()).toBe(true);
    expect(memo().count).toBe(2);
    vi.advanceTimersByTime(60 * MIN);
    expect(memo().count).toBe(4);
    // 4回出したら、その日はもう出ない (11:40 に4回目。夜まで待っても出ない)
    vi.advanceTimersByTime(12 * 60 * MIN);
    expect(memo().count).toBe(4);
    expect(shown()).toBe(false);
    // いまは東京の 23:40。0:00 を過ぎたら数え直す
    vi.advanceTimersByTime(19 * MIN);
    expect(memo()).toMatchObject({ day: '2026-10-27', count: 4 });
    vi.advanceTimersByTime(2 * MIN);
    expect(memo()).toMatchObject({ day: '2026-10-28', count: 1 });
  });

  it('開き直しても、前に出してから30分たつまでは出ない (覚えは本人のもの)', () => {
    window.localStorage.setItem('oshiPeekMemo', JSON.stringify({ who: ME, day: '2026-10-27', count: 1, last: START.getTime() - 5 * MIN, tips: [] }));
    mountPeek();
    vi.advanceTimersByTime(10 * MIN);
    expect(shown(), '前に出してから15分').toBe(false);
    vi.advanceTimersByTime(15 * MIN);
    expect(shown(), '前に出してから30分').toBe(true);
    expect(memo().count).toBe(2);
  });

  it('別のアカウントの覚えは使わない (回数も時刻も数えず、本人の覚えに書き直す)', () => {
    window.localStorage.setItem('oshiPeekMemo', JSON.stringify({ who: 'other@example.com', day: '2026-10-27', count: 4, last: START.getTime(), tips: [] }));
    mountPeek();
    vi.advanceTimersByTime(10 * MIN);
    expect(shown()).toBe(true);
    expect(memo()).toMatchObject({ who: ME, count: 1 });
  });

  it('画面が隠れているあいだは出さず、戻ったら次の見直し (1分) で出す', () => {
    mountPeek();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    vi.advanceTimersByTime(15 * MIN);
    expect(shown()).toBe(false);
    expect(memo()).toBe(null);
    delete document.hidden;
    vi.advanceTimersByTime(MIN);
    expect(shown()).toBe(true);
  });

  it('入力しているあいだ (焦点が入力欄) は出さない', () => {
    mountPeek();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);
    vi.advanceTimersByTime(15 * MIN);
    expect(shown()).toBe(false);
    expect(memo(), '一度も出していない').toBe(null);
    input.blur();
    vi.advanceTimersByTime(MIN);
    expect(shown()).toBe(true);
  });

  it('集中しているあいだは出さない', () => {
    mountPeek({ 'focus.start': true }, {
      apiFocusMine: {
        active: { id: 7, issueNumber: 2, title: '通勤手当の見直し', plannedMinutes: 120, extendedMinutes: 0,
          startedAt: START.toISOString(), openedAt: START.toISOString(), provedAt: '', endedAt: '', result: '',
          firstStep: '', proofKind: '', points: 0 },
        week: {}, toStart: [], measured: 0, badges: [],
      },
    });
    expect(q('#focus-dock').classList.contains('is-running')).toBe(true);
    vi.advanceTimersByTime(60 * MIN);
    expect(shown()).toBe(false);
    expect(memo()).toBe(null);
  });

  it('作業部屋が開いているあいだは出さない', () => {
    mountPeek({ 'room.on': true });
    q('#me-btn').click();
    q('.room-open-btn').click();
    expect(document.getElementById('room')).toBeTruthy();
    vi.advanceTimersByTime(30 * MIN);
    expect(shown()).toBe(false);
    expect(memo()).toBe(null);
  });

  it('文書のリンクで開いた画面では出さない', () => {
    mountPeek();
    document.body.classList.add('doc-link');
    vi.advanceTimersByTime(30 * MIN);
    expect(shown()).toBe(false);
    expect(memo(), '一度も出していない').toBe(null);
  });

  it('未読の知らせがあれば、ヒントより先に数だけ伝え (中身は言わない)、押すとベルを開く', () => {
    mountPeek({}, {
      apiNotifications: { items: [{ id: 3, kind: 'mention', title: '#4 で呼ばれました', at: START.toISOString(), read: false }], unread: 2 },
      apiHomeSummary: Object.assign({}, DEFAULTS.apiHomeSummary, {
        advice: [{ id: 'wip', title: '抱えすぎています', why: 'わけ', tip: 'こつ', action: { kind: 'board', label: 'ボードを開く' } }],
      }),
    });
    vi.advanceTimersByTime(10 * MIN);
    expect(shown()).toBe(true);
    expect(line()).toBe('知らせが 2 件あるよ');
    expect(line()).not.toContain('呼ばれました');
    expect(q('#notice-panel').hidden).toBe(true);
    q('.oshi-peek-btn').click();
    expect(shown()).toBe(false);
    expect(q('#notice-panel').hidden, 'ベルが開く').toBe(false);
  });

  it('知らせが無ければ改善のヒントを伝え、押すとホームへ。同じヒントは同じ日にもう言わない', () => {
    mountPeek({}, {
      apiHomeSummary: Object.assign({}, DEFAULTS.apiHomeSummary, {
        advice: [{ id: 'wip', title: '抱えすぎています', why: 'わけ', tip: 'こつ', action: { kind: 'board', label: 'ボードを開く' } }],
      }),
    });
    q('.nav-item[data-tab="issues"]').click();
    expect(q('#panel-home').hidden).toBe(true);
    vi.advanceTimersByTime(10 * MIN);
    expect(line()).toBe('ひとつヒント: 抱えすぎています');
    expect(peek().dataset.kind).toBe('tip');
    q('.oshi-peek-btn').click();
    expect(shown()).toBe(false);
    expect(q('#panel-home').hidden, 'ホームへ移る').toBe(false);
    expect(memo().tips).toEqual(['wip']);
    vi.advanceTimersByTime(30 * MIN);
    expect(shown()).toBe(true);
    expect(line(), '2回目はねぎらい').toBe('見に来たよ！');
  });

  it('設定 (oshi.peek) を切っていれば時計を仕掛けず、何時間たっても出ない。推しがオフでも同じ', () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    const armed = () => spy.mock.calls.some((c) => c[0] && c[0].name === 'oshiPeekTick');
    mountPeek({ 'oshi.peek': false });
    expect(armed()).toBe(false);
    vi.advanceTimersByTime(5 * 60 * MIN);
    expect(shown()).toBe(false);

    spy.mockClear();
    mountPeek({ 'oshi.on': false });
    expect(armed()).toBe(false);

    // 確かめ方が当たっていること: オンなら仕掛ける
    spy.mockClear();
    mountPeek();
    expect(armed()).toBe(true);
  });

  it('設定の推しの節に切り替えがあり (既定はオン)、推しがオフなら出さない', () => {
    mountPeek();
    q('.nav-item[data-tab="settings"]').click();
    const box = q('#settings-mine [data-pref="oshi.peek"]');
    expect(box).toBeTruthy();
    expect(box.querySelector('button[role="switch"]').getAttribute('aria-checked')).toBe('true');
    mountPeek({ 'oshi.on': false });
    q('.nav-item[data-tab="settings"]').click();
    expect(q('[data-pref="oshi.on"]')).toBeTruthy();
    expect(q('[data-pref="oshi.peek"]')).toBe(null);
  });
});
