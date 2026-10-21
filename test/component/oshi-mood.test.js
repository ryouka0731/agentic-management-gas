// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prefsFixture } from '../dom.js';
import { mount } from './mount.js';
import { loadGasWith } from '../harness.js';
import { createFakeGas } from '../fakegas.js';
import { APP_SOURCES } from '../sources.js';

/*
 * 推しの機嫌 (js-oshi)。自分の設定 oshi.mood をオンにした人にだけ、ホームのカードと推しの頁で機嫌の顔とせりふを出す。
 * 返事の形は仕込みで写さず、本物のサーバ (疑似GAS) の apiOshiGet / apiOshiMood から作る。
 */

const DAY = 86400000;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PNG_URL = 'data:image/png;base64,' + PNG.toString('base64');

/** 疑似の CacheService (直ったかを見るのに要る) */
function fakeCache(ctx) {
  const store = new Map();
  ctx.CacheService = { getScriptCache: () => ({
    get: (k) => (store.has(k) ? store.get(k) : null),
    put: (k, v) => { store.set(k, String(v)); },
    remove: (k) => { store.delete(k); },
  }) };
}

/**
 * 本物のサーバ。最初からいるキャラ (タク) を使い、機嫌をオンにし、本人の担当のやることの期限を n 件過ぎさせる。
 *
 * @returns {{ctx: object, numbers: number[], get: function(): object}}
 */
function server(n) {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...APP_SOURCES);
  ctx.repoInit('agentic-management');
  fakeCache(ctx);
  ctx.apiPrefSet('oshi.mood', true);
  const past = ctx.plainDay(new Date(Date.now() - 3 * DAY));
  const numbers = [];
  for (let k = 0; k < n; k++) {
    const num = ctx.issueCreate('やること', '', []).number;
    ctx.dbUpdate('issues', 'number', num, { assignee: 'tester@example.com', dueDate: past, updatedAt: new Date() });
    numbers.push(num);
  }
  const plain = (v) => JSON.parse(JSON.stringify(v));
  return { ctx, numbers, get: () => plain(ctx.apiOshiGet()), mood: () => plain(ctx.apiOshiMood()) };
}

/** 最初からいるキャラの絵 (疑似)。むっ の絵はまだ無い (本物と同じく null) */
const defaultUrl = (char, style, state) => 'data:image/webp;base64,' + Buffer.from(char + ':' + style + ':' + state).toString('base64');
const defaultImage = (char, style, state) => (state === 'pout' ? null : { char, style, state, dataUrl: defaultUrl(char, style, state) });

const MOOD_ON = { 'oshi.on': true, 'oshi.mood': true };

function mountMood(values, over) {
  const v = values || {};
  return mount(Object.assign({
    apiPrefs: prefsFixture({ values: v }),
    apiOshiDefaultImage: defaultImage,
    apiPrefSet: (key, value) => prefsFixture({ values: Object.assign({}, v, { [key]: value }) }),
  }, over || {}));
}

const card = () => document.querySelector('.oshi-card');
const bubble = () => document.getElementById('oshi-bubble');
const names = (app) => app.calls.map((c) => c.name);

function closeOneIssue() {
  document.querySelector('[data-tab="issues"]').click();
  document.querySelector('#issue-list [aria-label$="を完了にする"]').click();
}

describe('推しの機嫌', () => {
  beforeEach(() => {
    window.localStorage.clear();
    // 「思いがけない当たり」にしない (ほめる場面がまれに当たりに変わる)
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('しょんぼりのとき、ホームのカードはあいさつの代わりに機嫌のせりふと「しんぱい」の顔。「どうして？」でわけを数だけ出す', () => {
    const s = server(1);
    const d = s.get();
    expect(d.mood.level).toBe('sulky');
    mountMood(MOOD_ON, { apiOshiGet: d });
    const c = card();
    expect(c.dataset.mood).toBe('sulky');
    expect(c.dataset.event).toBe('mood_sulky');
    expect(c.querySelector('.oshi-line').textContent).toBe(d.mood.line);
    expect(c.querySelector('img.oshi-img').getAttribute('src')).toBe(defaultUrl('taku', 'chibi', 'worry'));

    const why = c.querySelector('.oshi-mood-why button');
    expect(why.textContent).toBe('どうして？');
    const list = c.querySelector('.oshi-mood-reasons');
    expect(list.hidden).toBe(true);
    why.click();
    expect(list.hidden).toBe(false);
    expect(why.getAttribute('aria-expanded')).toBe('true');
    const li = list.querySelector('li[data-kind="overdue"]');
    expect(li.querySelector('span').textContent).toBe('期限を過ぎたやること 1件');

    // 「見る」で自分の担当の期限切れだけの一覧を開く (改善のヒントと同じ道)
    li.querySelector('button').click();
    expect(document.getElementById('panel-issues').hidden).toBe(false);
    expect(document.getElementById('overdue-only').hidden).toBe(false);
  });

  it('むっ の絵が無いキャラ (最初からいるキャラ) は、しんぱいの絵に代える。絵の無い表情は2回取りに行かない', () => {
    const s = server(3);
    const d = s.get();
    expect(d.mood).toMatchObject({ level: 'pouty', state: 'pout' });
    const app = mountMood(MOOD_ON, { apiOshiGet: d });
    expect(card().dataset.mood).toBe('pouty');
    expect(card().querySelector('img.oshi-img').getAttribute('src')).toBe(defaultUrl('taku', 'chibi', 'worry'));
    const asked = app.calls.filter((c) => c.name === 'apiOshiDefaultImage').map((c) => c.args[2]);
    expect(asked).toContain('pout');
    expect(asked).toContain('worry');

    // 推しの頁にも機嫌の節が出る。むっ の絵はもう取りに行かない
    document.getElementById('me-btn').click();
    [...document.querySelectorAll('#me-body button')].find((b) => b.textContent === '推し').click();
    const sec = document.querySelector('.oshi-page .oshi-mood');
    expect(sec.dataset.mood).toBe('pouty');
    expect(sec.querySelector('.oshi-mood-label').textContent).toBe('むっ');
    expect(sec.querySelector('.oshi-mood-line').textContent).toBe(d.mood.line);
    expect(sec.querySelector('img.oshi-img').getAttribute('src')).toBe(defaultUrl('taku', 'chibi', 'worry'));
    expect(sec.textContent).toContain('Lv・実績・ポイントは減りません');
    const again = app.calls.filter((c) => c.name === 'apiOshiDefaultImage').map((c) => c.args[2]);
    expect(again.filter((k) => k === 'pout').length).toBe(1);
  });

  it('自分のキャラに むっ の絵が無く、ほかの絵も出さない人は、自分のキャラのしんぱいの絵に代える', () => {
    const s = server(3);
    const c = s.ctx.apiOshiCharCreate('ルナ', 'genki').charId;
    s.ctx.apiOshiSetImage(c, 'worry', PNG_URL);
    s.ctx.apiPrefSet('oshi.char', 'mine:' + c);
    s.ctx.apiPrefSet('oshi.fallback', 'none');
    const d = s.get();
    expect(d.mood).toMatchObject({ level: 'pouty', state: 'pout' });
    const app = mountMood(Object.assign({ 'oshi.char': 'mine:' + c, 'oshi.fallback': 'none' }, MOOD_ON), {
      apiOshiGet: d,
      apiOshiImage: (charId, state) => ({ charId, state, sha: 'f'.repeat(64), dataUrl: PNG_URL }),
    });
    expect(card().querySelector('img.oshi-img').getAttribute('src')).toBe(PNG_URL);
    expect(app.calls.filter((x) => x.name === 'apiOshiImage').map((x) => x.args[1])).toEqual(['worry']);
    expect(names(app)).not.toContain('apiOshiDefaultImage');
  });

  it('済ませて機嫌が直ったら、済ませたほめ言葉のあとにお祝いのせりふを言い、カードもあいさつに戻る', () => {
    const s = server(1);
    const app = mountMood(MOOD_ON, {
      apiOshiGet: s.get(),
      apiIssueClose: () => { s.ctx.apiIssueClose(s.numbers[0]); return {}; },
      apiOshiMood: () => s.mood(),
    });
    expect(card().dataset.mood).toBe('sulky');
    closeOneIssue();
    expect(names(app)).toContain('apiOshiMood');
    // 済ませたほめ言葉が先 (重ねない)
    expect(bubble().dataset.event).toBe('done');
    bubble().querySelector('.oshi-close').click();
    expect(bubble().hidden).toBe(false);
    expect(bubble().dataset.event).toBe('mood_recover');
    // カードは直ったばかりのせりふ。わけは無い
    expect(card().dataset.mood).toBe('happy');
    expect(card().dataset.event).toBe('mood_recover');
    expect(card().querySelector('.oshi-mood-why')).toBe(null);
  });

  it('むっ の代わりに出したしんぱいの絵には「しんぱい」と名乗る (出した絵と字を合わせる)', () => {
    const s = server(3);
    mountMood(MOOD_ON, { apiOshiGet: s.get() });
    expect(card().querySelector('img.oshi-img').alt).toBe('タクの「しんぱい」');
  });

  it('自分のキャラに むっ の絵が無くしんぱいの絵があれば、最初からいるキャラの絵より自分のしんぱいの絵を出す', () => {
    const s = server(3);
    const c = s.ctx.apiOshiCharCreate('ルナ', 'genki').charId;
    s.ctx.apiOshiSetImage(c, 'worry', PNG_URL);
    s.ctx.apiPrefSet('oshi.char', 'mine:' + c);
    const d = s.get();
    expect(d.fallback).toBe('taku');
    const app = mountMood(Object.assign({ 'oshi.char': 'mine:' + c }, MOOD_ON), {
      apiOshiGet: d,
      apiOshiImage: (charId, state) => ({ charId, state, sha: 'f'.repeat(64), dataUrl: PNG_URL }),
    });
    expect(card().querySelector('img.oshi-img').getAttribute('src')).toBe(PNG_URL);
    expect(card().querySelector('img.oshi-img').alt).toBe('ルナの「しんぱい」');
    expect(app.calls.filter((x) => x.name === 'apiOshiDefaultImage').map((x) => x.args[2])).not.toContain('pout');
  });

  it('取り直している間に推しを取り直した (別の返事になった) ら、遅れて届いた機嫌は捨てる', () => {
    const s = server(1);
    const held = [];
    const app = mountMood(MOOD_ON, {
      apiOshiGet: s.get(),
      apiIssueClose: () => { s.ctx.apiIssueClose(s.numbers[0]); return {}; },
      apiOshiMood: () => ({ later: (ok) => held.push(ok) }),
    });
    closeOneIssue();
    expect(held.length).toBe(1);
    // 推しの頁を開くと、推しを取り直す (oshiData が替わる)
    document.getElementById('me-btn').click();
    [...document.querySelectorAll('#me-body button')].find((b) => b.textContent === '推し').click();
    const sec = document.querySelector('.oshi-page .oshi-mood');
    expect(sec.dataset.mood).toBe('sulky');
    held[0](s.mood());
    expect(document.querySelector('.oshi-page .oshi-mood').dataset.mood).toBe('sulky');
    expect(card().dataset.mood).toBe('sulky');
    expect(names(app).filter((n) => n === 'apiOshiMood').length).toBe(1);
  });

  it('ボードで「完了」の列に移したときも機嫌を取り直す', () => {
    const s = server(1);
    const app = mountMood(MOOD_ON, {
      apiOshiGet: s.get(),
      apiOshiMood: () => s.mood(),
      apiProjectBoard: { Backlog: [{ issueNumber: 5, order: 0, title: 'a', state: 'open', assignee: '', labels: '', dueDate: '' }],
        'In Progress': [], 'In Review': [], Done: [] },
    });
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('view-board').click();
    const done = document.querySelectorAll('.board-column')[3];
    const drop = new window.Event('drop', { cancelable: true });
    drop.clientY = 0;
    drop.dataTransfer = { getData: () => '5' };
    done.dispatchEvent(drop);
    expect(app.calls.find((c) => c.name === 'apiProjectMove').args.slice(0, 2)).toEqual([5, 'Done']);
    expect(names(app)).toContain('apiOshiMood');
  });

  it('自分のキャラのせりふの欄に、機嫌の場面は機嫌を見ている人にだけ出す', () => {
    const s = server(0);
    const c = s.ctx.apiOshiCharCreate('ルナ', 'genki').charId;
    s.ctx.apiPrefSet('oshi.char', 'mine:' + c);
    const open = (values) => {
      mountMood(Object.assign({ 'oshi.char': 'mine:' + c }, values), { apiOshiGet: s.get() });
      document.getElementById('me-btn').click();
      [...document.querySelectorAll('#me-body button')].find((b) => b.textContent === '推し').click();
      return [...document.querySelectorAll('.oshi-page .oshi-lines')].map((x) => x.dataset.event);
    };
    const on = open(MOOD_ON);
    expect(on).toContain('mood_pouty');
    document.body.textContent = '';
    const off = open({ 'oshi.on': true });
    expect(off).toContain('done');
    expect(off.filter((k) => k.startsWith('mood_'))).toEqual([]);
  });

  it('機嫌を見ていない人には、ホームはいつものあいさつで、済ませても機嫌を取りに行かない', () => {
    const s = server(1);
    const d = s.get();
    d.mood = null;
    const app = mountMood({ 'oshi.on': true }, { apiOshiGet: d });
    expect(card().dataset.mood).toBe(undefined);
    expect(['morning', 'day', 'night']).toContain(card().dataset.event);
    expect(card().querySelector('.oshi-mood-why')).toBe(null);
    closeOneIssue();
    expect(names(app)).not.toContain('apiOshiMood');
  });

  it('設定の「推しの機嫌を見る」は、推しがオンのときだけ推しの節に出る (既定はオフ)', () => {
    mountMood({ 'oshi.on': true });
    document.querySelector('.nav-item[data-tab="settings"]').click();
    const box = document.querySelector('#settings-mine [data-pref="oshi.mood"]');
    expect(box).toBeTruthy();
    expect(box.querySelector('button[role="switch"]').getAttribute('aria-checked')).toBe('false');
    expect(document.querySelector('#settings-team [data-pref="oshi.mood"]')).toBe(null);
  });

  it('推しがオフなら、設定に「推しの機嫌を見る」を出さない', () => {
    mountMood({ 'oshi.on': false, 'oshi.mood': true });
    document.querySelector('.nav-item[data-tab="settings"]').click();
    expect(document.querySelector('[data-pref="oshi.on"]')).toBeTruthy();
    expect(document.querySelector('[data-pref="oshi.mood"]')).toBe(null);
  });
});
