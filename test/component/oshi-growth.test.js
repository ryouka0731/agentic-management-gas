// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prefsFixture } from '../dom.js';
import { mount } from './mount.js';
import { loadGasWith } from '../harness.js';
import { createFakeGas } from '../fakegas.js';
import { APP_SOURCES } from '../sources.js';

/*
 * 推しの育ち (Lv・段・段ごとの絵) と、実績を取ったときの知らせ。返事は本物のサーバ (疑似GAS) から作る。
 * 守ること: ふつうの顔はいまの段の絵で出す (場面の表情はそのまま)・前の段を保っているときは「あと N Lv」と棒が揃う・
 * 棒は「次の段まで」(下がらないのは Lv と段)・最後の実績で「クリア」と言う・推しがオフなら「Lv ◯」だけ。
 */

const ME = 'tester@example.com';
const PNG_URL = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64');
const wire = (v) => JSON.parse(JSON.stringify(v));
const defaultUrl = (char, style, state) => 'data:image/webp;base64,' + Buffer.from(char + ':' + style + ':' + state).toString('base64');

/** 本物のサーバ。実績を n 個取った人 (Lv = 1 + n)。floor は前の育ちの段 (OSHI_STAGE_MAX:) */
function server(n, floor) {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...APP_SOURCES);
  ctx.repoInit('agentic-management');
  const got = {};
  ctx.ACHIEVEMENTS().map((a) => a.key).filter((k) => k !== 'days-1').slice(0, n)
    .forEach((k) => { got[k] = '2026-10-20'; });
  fake.PropertiesService.getScriptProperties().setProperty('ACH:' + ME, JSON.stringify({ days: { n: 0, last: '' }, got }));
  if (floor) ctx.PropertiesService.getUserProperties().setProperty('OSHI_STAGE_MAX:' + ME, String(floor));
  return ctx;
}

function mountOshi(values, over) {
  const v = Object.assign({ 'oshi.on': true }, values || {});
  return mount(Object.assign({
    apiPrefs: prefsFixture({ values: v }),
    apiPrefSet: (key, value) => prefsFixture({ values: Object.assign({}, v, { [key]: value }) }),
    apiOshiImage: (charId, state) => ({ charId, state, sha: 'f'.repeat(64), dataUrl: PNG_URL }),
    apiOshiDefaultImage: (char, style, state) => ({ char, style, state, dataUrl: defaultUrl(char, style, state) }),
  }, over || {}));
}

/** サーバの今の推しと実績で組む (開いたときの数え直しも同じ Lv を返す) */
function mountWith(ctx, values, over) {
  const ach = wire(ctx.apiAchievements());
  return mountOshi(values, Object.assign({ apiOshiGet: wire(ctx.apiOshiGet()), apiAchievementsCheck: ach, apiAchievements: ach }, over || {}));
}

function openPage(label) {
  document.getElementById('me-btn').click();
  [...document.querySelectorAll('#me-body button')].find((b) => b.textContent === label).click();
}
const homeImg = () => document.querySelector('#home-cards .oshi-card .oshi-figure img');
const toast = () => document.getElementById('ach-toast');
const bubble = () => document.getElementById('oshi-bubble');

describe('推しの育ち', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    // 東京の朝 (あいさつは ふつう の顔の場面)
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-21T01:00:00Z') });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('ホームのあいさつ (ふつうの顔) は、いまの段の絵で出す', () => {
    const ctx = server(4); // Lv5 = 一人前
    mountWith(ctx);
    expect(homeImg().getAttribute('src')).toBe(defaultUrl('taku', 'chibi', 'grow2'));
  });

  it('自分のキャラは、その段の絵を入れていればその絵、無ければ自分のふつうの絵のまま', () => {
    const ctx = server(4);
    const c = ctx.apiOshiCharCreate('ルナ', 'genki').charId;
    ctx.apiOshiSetImage(c, 'idle', PNG_URL);
    ctx.apiPrefSet('oshi.char', 'mine:' + c);
    let app = mountWith(ctx, { 'oshi.char': 'mine:' + c });
    const asked = () => app.calls.filter((x) => x.name === 'apiOshiImage').map((x) => x.args[1]);
    expect(asked()).toContain('idle');
    expect(asked()).not.toContain('grow2');
    ctx.apiOshiSetImage(c, 'grow2', PNG_URL);
    app = mountWith(ctx, { 'oshi.char': 'mine:' + c });
    expect(asked()).toContain('grow2');
    expect(asked()).not.toContain('idle');
  });

  it('達人・師範の絵が無いキャラは、持っているいちばん上の段の絵で出す (最初からいるキャラは名人)', () => {
    const ctx = server(34); // Lv35 = 師範
    expect(wire(ctx.apiOshiGet()).growth.key).toBe('grow5');
    // 最初からいるキャラには 達人・師範 の絵が無い (サーバは null を返す)
    mountWith(ctx, {}, {
      apiOshiDefaultImage: (char, style, state) => (/grow[45]/.test(state) ? null
        : { char, style, state, dataUrl: defaultUrl(char, style, state) }),
    });
    expect(homeImg().getAttribute('src')).toBe(defaultUrl('taku', 'chibi', 'grow3'));
  });

  it('自分のキャラは、師範の段でも、自分が入れたいちばん上の段の絵 (名人) を出す', () => {
    const ctx = server(34);
    const c = ctx.apiOshiCharCreate('ルナ', 'genki').charId;
    ctx.apiOshiSetImage(c, 'idle', PNG_URL);
    ctx.apiOshiSetImage(c, 'grow3', PNG_URL);
    ctx.apiPrefSet('oshi.char', 'mine:' + c);
    const app = mountWith(ctx, { 'oshi.char': 'mine:' + c });
    const asked = app.calls.filter((x) => x.name === 'apiOshiImage').map((x) => x.args[1]);
    expect(asked).toContain('grow3');
    expect(asked).not.toContain('idle');
  });

  it('場面の表情 (夜の ねむい) は、段の絵に置き換えない', () => {
    vi.setSystemTime(new Date('2026-10-21T14:00:00Z')); // 東京の23時
    const ctx = server(4);
    mountWith(ctx);
    expect(homeImg().getAttribute('src')).toBe(defaultUrl('taku', 'chibi', 'sleepy'));
  });

  it('推しの頁の説明は、段の絵がどこに出るかを決まりどおりに書く', () => {
    const ctx = server(4);
    mountWith(ctx);
    openPage('推し');
    const text = document.querySelector('.oshi-page').textContent;
    expect(text).toContain('ふつうの顔の代わりに、その段の姿で出ます');
    expect(text).not.toContain('ホームと吹き出しでその段の姿になります');
  });

  it('前の段を保っているときは、そう書き、棒と「あと N Lv」を出している段の次の段に揃える', () => {
    const ctx = server(2, 1); // Lv3 だが前に一人前まで育てた
    mountWith(ctx);
    const card = document.querySelector('#home-cards .oshi-card');
    const head = card.querySelector('.oshi-stage').textContent;
    expect(head).toContain('一人前');
    expect(head).toContain('次の段まであと 12 Lv');
    expect(card.querySelector('.oshi-growth').textContent).toContain('以前に育てたぶんを保っています');
    const bar = card.querySelector('[role="progressbar"]');
    expect(bar.getAttribute('aria-valuenow')).toBe(String(Math.floor(2 / 14 * 100)));
  });

  it('棒は「次の段まで」。「下がりません」は Lv と段のこと', () => {
    const ctx = server(4);
    mountWith(ctx);
    const g = document.querySelector('#home-cards .oshi-growth');
    expect(g.querySelector('[role="progressbar"]').getAttribute('aria-label')).toBe('次の段まで');
    expect(g.textContent).not.toContain('なかよし');
    expect(g.textContent).toContain('次の段まで 0%');
    expect(g.textContent).toContain('Lv と段は下がりません');
    expect(g.textContent).not.toContain('以前に育てた');
  });
});

describe('実績を取ったときの知らせ', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('最後の実績を取ったら、推しは「実績を全部取った」を言う', () => {
    const ctx = server(1000); // はじめの一日のほかは全部
    const oshi = wire(ctx.apiOshiGet());
    const check = wire(ctx.apiAchievementsCheck());
    expect(check.newly.map((a) => a.key)).toEqual(['days-1']);
    mountOshi({}, { apiOshiGet: oshi, apiAchievementsCheck: check, apiAchievements: check });
    expect(toast().textContent).toContain('全部取りました');
    expect(bubble().dataset.event).toBe('clear');
  });

  it('推しがオフなら「Lv ◯」だけ (推しの言葉も段も出さない)', () => {
    const ctx = server(0);
    const check = wire(ctx.apiAchievementsCheck());
    mountOshi({ 'oshi.on': false }, { apiAchievementsCheck: check, apiAchievements: check });
    expect(toast().textContent).toContain('Lv 2');
    expect(toast().textContent).not.toContain('推し');
    openPage('実績');
    const head = document.querySelector('.ach-level-head').textContent;
    expect(head).toBe('Lv 2');
    expect(document.querySelector('.ach-page').textContent).not.toContain('推し');
  });

  it('プロフィールは「N 項目分かりました」と数える', () => {
    const ctx = server(0);
    ctx.apiOshiBuiltinProfileSet('taku', { items: [{ lv: 2, label: 'テストの口ぐせ', text: 'テスト' }] });
    const oshi = wire(ctx.apiOshiGet());
    const check = wire(ctx.apiAchievementsCheck());
    let first = true;
    mountOshi({}, {
      apiOshiGet: () => { if (first) { first = false; return oshi; } return wire(ctx.apiOshiGet()); },
      apiAchievementsCheck: check, apiAchievements: check,
    });
    expect(toast().textContent).toContain('推しのプロフィールが 1 項目分かりました');
  });
});

describe('推しの頁のプロフィールと、まとめて消す', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('最高の Lv を超える項目は「クリアで分かる」', () => {
    const ctx = server(0);
    // 最高の Lv は 1 + この環境で取れる実績の数 (疑似GASの入れ物は持ち主1人なので、いっしょに などは数えない)
    const max = 1 + ctx.ACHIEVEMENTS().length - Object.keys(ctx.achUnavailable_(ME)).length;
    expect(max).toBeLessThan(ctx.ACHIEVEMENTS().length + 1);
    ctx.apiOshiBuiltinProfileSet('taku', { items: [
      { lv: max, label: 'テストの最後', text: 'テスト' },
      { lv: max + 1, label: 'テストのおまけ', text: 'テスト' },
    ] });
    mountWith(ctx);
    openPage('推し');
    const r = [...document.querySelectorAll('.oshi-reveal-item')].map((li) => li.textContent);
    expect(r[0]).toContain('Lv ' + max + ' で分かる');
    expect(r[1]).toContain('クリアで分かる');
    expect(r[1]).not.toContain('Lv ' + (max + 1));
  });

  it('まとめて消す前の確かめに、プロフィールとクリアの動画も消えると書く', () => {
    const ctx = server(0);
    ctx.apiOshiCharCreate('ルナ', 'genki');
    mountWith(ctx);
    openPage('推し');
    document.querySelector('.oshi-forget').click();
    const strip = document.querySelector('.oshi-page .confirm-strip').textContent;
    expect(strip).toContain('プロフィール');
    expect(strip).toContain('動画');
  });
});
