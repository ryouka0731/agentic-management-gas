// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prefsFixture } from '../dom.js';
import { mount } from './mount.js';

/*
 * 思いがけない当たり・ノリノリタイム・自分へのご褒美 (js-luck)。どれも自分の設定でオンにした人だけ。
 * 確率は見た目の演出だけに使い、外れ・ニアミスは描かない。上限 (1日3回・30分空ける) と、失敗では引かないことを固定する。
 */

const MIN = 60 * 1000;
const q = (s) => document.querySelector(s);
const layer = () => document.getElementById('fun-layer');
const wins = () => (layer() ? [...layer().querySelectorAll('.luck-win')] : []);
const banners = () => (layer() ? [...layer().querySelectorAll('.fun-banner')].map((b) => b.textContent) : []);

function mountLuck(values, over) {
  return mount(Object.assign({ apiPrefs: prefsFixture({ values: values || {} }) }, over || {}));
}

/** やることの一覧から1つ完了にする (一覧は同じものを返すので、何度でも押せる) */
function closeOne() {
  if (q('#panel-issues') && q('#panel-issues').hidden !== false) q('[data-tab="issues"]').click();
  q('#issue-list [aria-label$="を完了にする"]').click();
}

/** 当たりの札を消して、次の当たりを見分けられるようにする */
function clearWins() {
  wins().forEach((w) => w.remove());
}

function reduceMotion() {
  window.matchMedia = (qq) => ({ matches: /reduce/.test(qq), media: qq, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {} });
}

describe('思いがけない当たり', () => {
  let savedMatch;
  let rnd;
  beforeEach(() => {
    window.localStorage.clear();
    savedMatch = window.matchMedia;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T01:00:00Z'));
    rnd = vi.spyOn(Math, 'random').mockReturnValue(0);
  });
  afterEach(() => {
    window.matchMedia = savedMatch;
    rnd.mockRestore();
    vi.useRealTimers();
    document.body.classList.remove('luck-fever-on');
  });

  it('既定はオフ。必ず当たる乱数でも、何度済ませても何も出さず、端末にも覚えない', () => {
    mountLuck({ 'fun.cheer': true });
    for (let i = 0; i < 5; i++) closeOne();
    expect(wins()).toEqual([]);
    expect(q('#luck-fever')).toBe(null);
    expect(window.localStorage.getItem('bantoLuck')).toBe(null);
    expect(banners()).toContain('CLEAR!');
    // 自分まわりにも入口が無い
    q('#me-btn').click();
    expect(q('.reward-me-btn')).toBe(null);
  });

  it('当たると「大当たり！」と、3つとも同じ絵のリールを出す。いつものお祝いは重ねない', () => {
    mountLuck({ 'luck.on': true, 'fun.cheer': true });
    closeOne();
    const w = wins();
    expect(w.length).toBe(1);
    expect(w[0].querySelector('.luck-win-title').textContent).toBe('大当たり！');
    const reels = w[0].querySelectorAll('.luck-reel');
    expect(reels.length).toBe(3);
    const sym = w[0].dataset.symbol;
    const cells = [...w[0].querySelectorAll('.luck-cell')].map((c) => c.textContent);
    expect(cells.length).toBeGreaterThan(3);
    // 揃わない絵は回っている帯にも1つも無い (ニアミスを描かない)
    expect(cells.every((c) => c === sym)).toBe(true);
    expect(banners()).not.toContain('CLEAR!');
    // 押せず、読み上げにも載らない重ねに描く
    expect(layer().getAttribute('aria-hidden')).toBe('true');
    // しばらくで消える
    vi.advanceTimersByTime(3000);
    expect(wins()).toEqual([]);
  });

  it('外れのときは何も描かない (外れのリールも「惜しい」も無い)。いつものお祝いだけ', () => {
    rnd.mockReturnValue(0.5);
    mountLuck({ 'luck.on': true, 'fun.cheer': true });
    for (let i = 0; i < 2; i++) closeOne();
    expect(wins()).toEqual([]);
    expect(document.querySelectorAll('.luck-reel, .luck-cell').length).toBe(0);
    expect(document.body.textContent).not.toMatch(/惜しい|ハズレ|はずれ|外れ/);
    expect(banners()).toContain('CLEAR!');
  });

  it('失敗した操作では引かない (数えもしない)', () => {
    mountLuck({ 'luck.on': true }, { apiIssueClose: new Error('混み合っています') });
    for (let i = 0; i < 4; i++) closeOne();
    expect(wins()).toEqual([]);
    expect(q('#luck-fever')).toBe(null);
    expect(window.localStorage.getItem('bantoLuck')).toBe(null);
  });

  it('前の当たりから30分は空ける。1日3回まで。日が替われば数え直す', () => {
    mountLuck({ 'luck.on': true });
    closeOne();
    expect(wins().length).toBe(1);
    clearWins();
    vi.advanceTimersByTime(10 * MIN);
    closeOne();
    expect(wins()).toEqual([]);
    vi.advanceTimersByTime(21 * MIN);
    closeOne();
    expect(wins().length).toBe(1);
    clearWins();
    vi.advanceTimersByTime(31 * MIN);
    closeOne();
    expect(wins().length).toBe(1);
    clearWins();
    // 4回目は、30分空けても出さない
    vi.advanceTimersByTime(31 * MIN);
    closeOne();
    expect(wins()).toEqual([]);
    // 次の日
    vi.setSystemTime(new Date('2026-10-22T01:00:00Z'));
    closeOne();
    expect(wins().length).toBe(1);
  });

  it('当たるかは 1/8。乱数がそれより大きければ出さない', () => {
    rnd.mockReturnValue(0.13);
    mountLuck({ 'luck.on': true });
    closeOne();
    expect(wins()).toEqual([]);
    rnd.mockReturnValue(0.12);
    closeOne();
    expect(wins().length).toBe(1);
  });

  it('端末に覚えられなくても動く (localStorage が投げる)', () => {
    const get = vi.spyOn(window.Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const set = vi.spyOn(window.Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    try {
      mountLuck({ 'luck.on': true });
      closeOne();
      expect(wins().length).toBe(1);
      clearWins();
      closeOne();
      // 覚えられなくても、この画面のあいだは30分空ける
      expect(wins()).toEqual([]);
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });

  it('動きを減らす設定では、字の札だけ (リールも粒も縁の光も無い)', () => {
    reduceMotion();
    mountLuck({ 'luck.on': true });
    closeOne();
    const w = wins();
    expect(w.length).toBe(1);
    expect(w[0].classList.contains('is-static')).toBe(true);
    expect(w[0].querySelector('.luck-reels')).toBe(null);
    expect(layer().querySelector('.fun-flash').classList.contains('is-on')).toBe(false);
  });
});

describe('ノリノリタイム', () => {
  let savedMatch;
  let rnd;
  beforeEach(() => {
    window.localStorage.clear();
    savedMatch = window.matchMedia;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T01:00:00Z'));
    // 当たりは出さない (ノリノリタイムだけを見る)
    rnd = vi.spyOn(Math, 'random').mockReturnValue(0.99);
  });
  afterEach(() => {
    window.matchMedia = savedMatch;
    rnd.mockRestore();
    vi.useRealTimers();
    document.body.classList.remove('luck-fever-on');
  });

  it('1時間に3つ済ませると15分のあいだ入り、黙って終わる', () => {
    mountLuck({ 'luck.on': true });
    closeOne();
    vi.advanceTimersByTime(20 * MIN);
    closeOne();
    expect(q('#luck-fever')).toBe(null);
    vi.advanceTimersByTime(20 * MIN);
    closeOne();
    expect(q('#luck-fever')).toBeTruthy();
    expect(document.body.classList.contains('luck-fever-on')).toBe(true);
    expect(q('#luck-fever .luck-fever-frame').getAttribute('aria-hidden')).toBe('true');
    expect(q('#luck-fever .luck-fever-label').textContent).toBe('ノリノリタイム');
    expect(q('#luck-fever .luck-fever-left').textContent).toBe('あと 15 分');
    // 秒は出さない。分の刻みで書き直す
    vi.advanceTimersByTime(10 * MIN);
    expect(q('#luck-fever .luck-fever-left').textContent).toBe('あと 5 分');
    vi.advanceTimersByTime(5 * MIN);
    expect(q('#luck-fever')).toBe(null);
    expect(document.body.classList.contains('luck-fever-on')).toBe(false);
    // 「終わりました」の知らせは出さない (字の札も帯も出ない)
    expect(banners()).toEqual([]);
    expect(document.body.textContent).not.toContain('ノリノリタイム');
  });

  it('1時間より間が空いた3つでは入らない', () => {
    mountLuck({ 'luck.on': true });
    closeOne();
    vi.advanceTimersByTime(35 * MIN);
    closeOne();
    vi.advanceTimersByTime(35 * MIN);
    closeOne();
    expect(q('#luck-fever')).toBe(null);
  });

  it('ノリノリタイムのあいだは、お祝いの字が大きくなる', () => {
    mountLuck({ 'luck.on': true, 'fun.cheer': true });
    closeOne();
    expect(layer().querySelector('.fun-banner.is-fever')).toBe(null);
    closeOne();
    closeOne();
    closeOne();
    const big = [...layer().querySelectorAll('.fun-banner')].filter((b) => b.textContent === 'CLEAR!');
    expect(big[big.length - 1].classList.contains('is-fever')).toBe(true);
  });

  it('札は × で隠せ、次のノリノリタイムでも隠れたまま', () => {
    mountLuck({ 'luck.on': true });
    closeOne(); closeOne(); closeOne();
    q('#luck-fever .luck-fever-hide').click();
    expect(q('#luck-fever .luck-fever-chip').hidden).toBe(true);
    // 枠の光は残る
    expect(document.body.classList.contains('luck-fever-on')).toBe(true);
    vi.advanceTimersByTime(16 * MIN);
    closeOne(); closeOne(); closeOne();
    expect(q('#luck-fever .luck-fever-chip').hidden).toBe(true);
  });

  it('開き直しても続きを描き、オフにすれば消える', () => {
    mountLuck({ 'luck.on': true });
    closeOne(); closeOne(); closeOne();
    vi.advanceTimersByTime(3 * MIN);
    const app = mountLuck({ 'luck.on': true });
    expect(q('#luck-fever')).toBeTruthy();
    expect(q('#luck-fever .luck-fever-left').textContent).toBe('あと 12 分');
    app.respond('apiPrefSet', () => prefsFixture({ values: {} }));
    q('.nav-item[data-tab="settings"]').click();
    q('[data-pref="luck.on"] button[role="switch"]').click();
    expect(q('#luck-fever')).toBe(null);
  });

  it('動きを減らす設定では、縁を光らせず札だけ', () => {
    reduceMotion();
    mountLuck({ 'luck.on': true });
    closeOne(); closeOne(); closeOne();
    expect(q('#luck-fever .luck-fever-frame')).toBe(null);
    expect(q('#luck-fever .luck-fever-chip')).toBeTruthy();
  });
});

describe('自分へのご褒美', () => {
  const STATE = {
    rule: 'closed', since: '2026-10-20', earned: 7, spent: 2, available: 5, costMin: 1, costMax: 50, itemsMax: 20,
    titleMax: 40,
    items: [{ id: 1, title: '好きなコーヒー', cost: 5 }, { id: 2, title: '<b>映画</b>', cost: 30 }],
    spends: [{ id: 3, title: '散歩', cost: 2, at: '2026-10-21T00:58:00.000Z' }],
    undoId: 3, undoUntil: '2026-10-21T01:03:00.000Z',
  };

  beforeEach(() => {
    window.localStorage.clear();
    // ほかの節と同じく偽の時計で組む (本物と偽物の時計で組み分けると、jsdom の時計の口が食い違う)
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T01:00:00Z'));
  });
  afterEach(() => { vi.useRealTimers(); });

  function openReward(over) {
    const app = mountLuck({ 'luck.reward': true }, Object.assign({
      apiRewardGet: STATE, apiRewardSpend: STATE, apiRewardUndo: STATE, apiRewardItemSave: STATE,
      apiRewardItemDelete: STATE,
    }, over || {}));
    q('#me-btn').click();
    q('.reward-me-btn').click();
    return app;
  }

  it('オンの人にだけ、自分まわりに入口を出す。開くと本人のぶんを取りに行く', () => {
    const app = openReward();
    expect(app.calls.filter((c) => c.name === 'apiRewardGet').map((c) => c.args)).toEqual([[]]);
    const box = q('#side-panel .reward-view');
    expect(box.querySelector('.reward-available').textContent).toBe('5');
    expect(box.textContent).toContain('給与や評価とも関係ありません');
    expect(box.textContent).toContain('あなたにだけ見えます');
    expect(box.textContent).toContain('済ませたやること1件を1ポイント');
    // 他人が読むことは無いが、字は textContent だけで置く
    expect(box.querySelector('.reward-item[data-id="2"] .reward-item-title').textContent).toBe('<b>映画</b>');
    expect(box.querySelector('b')).toBe(null);
  });

  it('残りが足りないご褒美は押せない。足りるものは交換を頼む', () => {
    const app = openReward();
    const box = q('#side-panel .reward-view');
    expect(box.querySelector('.reward-item[data-id="2"] .reward-spend').disabled).toBe(true);
    const spend = box.querySelector('.reward-item[data-id="1"] .reward-spend');
    expect(spend.disabled).toBe(false);
    spend.click();
    expect(app.calls.filter((c) => c.name === 'apiRewardSpend').map((c) => c.args)).toEqual([[1]]);
  });

  it('最後の交換を取り消せる (取り消せるかはサーバが決める)', () => {
    const app = openReward();
    const bar = q('#side-panel .reward-undo');
    expect(bar.textContent).toContain('「散歩」と交換しました');
    bar.querySelector('button').click();
    expect(app.calls.filter((c) => c.name === 'apiRewardUndo').map((c) => c.args)).toEqual([[3]]);
    openReward({ apiRewardGet: Object.assign({}, STATE, { undoId: 0 }) });
    expect(q('#side-panel .reward-undo')).toBe(null);
  });

  it('足す・直す・外す', () => {
    const app = openReward();
    let box = q('#side-panel .reward-view');
    box.querySelector('.reward-title-in').value = '15分の散歩';
    box.querySelector('.reward-cost-in').value = '3';
    box.querySelector('.reward-form button[type="submit"]').click();
    expect(app.calls.filter((c) => c.name === 'apiRewardItemSave').map((c) => c.args)).toEqual([[{ title: '15分の散歩', cost: 3 }]]);
    box = q('#side-panel .reward-view');
    box.querySelector('.reward-item[data-id="1"] .reward-edit').click();
    box = q('#side-panel .reward-view');
    expect(box.querySelector('.reward-title-in').value).toBe('好きなコーヒー');
    box.querySelector('.reward-cost-in').value = '6';
    box.querySelector('.reward-form button[type="submit"]').click();
    expect(app.calls.filter((c) => c.name === 'apiRewardItemSave').map((c) => c.args)[1])
      .toEqual([{ title: '好きなコーヒー', cost: 6, id: 1 }]);
    q('#side-panel .reward-item[data-id="2"] .reward-delete').click();
    expect(app.calls.filter((c) => c.name === 'apiRewardItemDelete').map((c) => c.args)).toEqual([[2]]);
  });

  it('断られたら押せるように戻す', () => {
    openReward({ apiRewardSpend: new Error('ポイントが足りないので交換できません (残り 0、このご褒美は 5)') });
    const spend = q('#side-panel .reward-item[data-id="1"] .reward-spend');
    spend.click();
    expect(spend.disabled).toBe(false);
  });
});
