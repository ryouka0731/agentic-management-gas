// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prefsFixture } from '../dom.js';
import { mount } from './mount.js';
import { loadGasWith } from '../harness.js';
import { createFakeGas } from '../fakegas.js';
import { APP_SOURCES } from '../sources.js';

/*
 * 推し (js-oshi)。自分の設定の oshi.on をオンにした人の画面にだけ出す。
 * 返事の形は仕込みで写さず、本物のサーバ (疑似GAS) の apiOshiGet から作る。
 */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PNG_URL = 'data:image/png;base64,' + PNG.toString('base64');

let server = null;
/** サーバが返す形そのもの。画像は「ほめる」と「おいわい」だけ入れてある */
function oshiFixture(opts) {
  if (!server) {
    const fake = createFakeGas();
    const ctx = loadGasWith(fake, ...APP_SOURCES);
    ctx.repoInit('agentic-management');
    ctx.apiOshiSetProfile('ルナ', 'genki');
    ctx.apiOshiSetImage('celebrate', PNG_URL);
    ctx.apiOshiSetLines('done', ['自分のせりふ！']);
    server = { ctx, fake };
  }
  const got = JSON.parse(JSON.stringify(server.ctx.apiOshiGet()));
  if (opts && opts.noImages) got.images = [];
  if (opts && opts.growth) Object.assign(got.growth, opts.growth);
  return got;
}

/** 最初からいるキャラの絵 (疑似)。形と表情で字が変わる */
const defaultUrl = (style, state) => 'data:image/webp;base64,' + Buffer.from(style + ':' + state).toString('base64');

function mountOshi(values, over) {
  return mount(Object.assign({
    apiPrefs: prefsFixture({ values: values || {} }),
    apiOshiGet: oshiFixture(),
    apiOshiImage: (state) => ({ state, sha: 'f'.repeat(64), dataUrl: PNG_URL }),
    apiOshiDefaultImage: (style, state) => ({ style, state, dataUrl: defaultUrl(style, state) }),
  }, over || {}));
}

const ON = { 'oshi.on': true };
/** 最初からいるキャラを使わない人 */
const OWN_ONLY = { 'oshi.on': true, 'oshi.useDefault': false };
const defaultCalls = (app) => app.calls.filter((c) => c.name === 'apiOshiDefaultImage').map((c) => c.args);
const bubble = () => document.getElementById('oshi-bubble');
const names = (app) => app.calls.map((c) => c.name);

function closeOneIssue() {
  document.querySelector('[data-tab="issues"]').click();
  document.querySelector('#issue-list [aria-label$="を完了にする"]').click();
}

function openPage() {
  document.getElementById('me-btn').click();
  const btn = [...document.querySelectorAll('#me-body button')].find((b) => b.textContent === '推し');
  expect(btn, '自分のところに「推し」がある').toBeTruthy();
  btn.click();
  return document.querySelector('.oshi-page');
}

describe('推し', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('既定はオフ。取りにも行かず、自分のところにもホームにも出ず、済ませても吹き出しは出ない', () => {
    const app = mountOshi();
    expect(names(app)).not.toContain('apiOshiGet');
    document.getElementById('me-btn').click();
    expect([...document.querySelectorAll('#me-body button')].some((b) => b.textContent === '推し')).toBe(false);
    expect(document.querySelector('.oshi-card')).toBe(null);
    closeOneIssue();
    expect(bubble()).toBe(null);
    expect(names(app)).not.toContain('apiOshiGet');
  });

  it('設定の「推し」の見出しに、自分の設定として並ぶ', () => {
    mountOshi();
    document.querySelector('.nav-item[data-tab="settings"]').click();
    const box = document.querySelector('[data-pref="oshi.on"]');
    expect(box).toBeTruthy();
    expect(box.querySelector('button[role="switch"]').getAttribute('aria-checked')).toBe('false');
  });

  it('やることを済ませると、隅に「おいわい」の絵とせりふの吹き出しが出る (自分のせりふから順に)', () => {
    mountOshi(ON);
    closeOneIssue();
    const b = bubble();
    expect(b.hidden).toBe(false);
    expect(b.dataset.event).toBe('done');
    expect(b.dataset.state).toBe('celebrate');
    expect(b.querySelector('.oshi-name').textContent).toBe('ルナ');
    expect(b.querySelector('.oshi-line').textContent).toBe('自分のせりふ！');
    const img = b.querySelector('img.oshi-img');
    expect(img.getAttribute('src')).toBe(PNG_URL);
    expect(img.alt).toBe('ルナの「おいわい」');
    // 次は口調 (元気) のせりふへ回る
    closeOneIssue();
    expect(bubble().querySelector('.oshi-line').textContent).toBe(oshiFixture().events.find((e) => e.key === 'done').lines[0]);
  });

  it('最初からいるキャラを使わない人は、その表情の絵が無ければ名前の頭文字を出す (外から何も取ってこない)', () => {
    mountOshi(OWN_ONLY, { apiOshiGet: oshiFixture({ noImages: true }) });
    closeOneIssue();
    expect(bubble().querySelector('img')).toBe(null);
    expect(bubble().querySelector('.oshi-avatar').textContent).toBe('ル');
  });

  it('押せば閉じ、しばらくで消える', () => {
    vi.useFakeTimers();
    mountOshi(ON);
    closeOneIssue();
    bubble().querySelector('.oshi-close').click();
    expect(bubble().hidden).toBe(true);
    closeOneIssue();
    expect(bubble().hidden).toBe(false);
    vi.advanceTimersByTime(7000);
    expect(bubble().hidden).toBe(true);
  });

  it('断られたときは叱らず「しんぱい」する', () => {
    mountOshi(ON, { apiIssueClose: new Error('混み合っています') });
    closeOneIssue();
    expect(bubble().dataset.event).toBe('oops');
    expect(bubble().dataset.state).toBe('worry');
  });

  it('まれに「思いがけない当たり」になる', () => {
    mountOshi(ON);
    Math.random.mockReturnValue(0);
    closeOneIssue();
    expect(bubble().dataset.event).toBe('lucky');
    expect(bubble().dataset.state).toBe('surprise');
  });

  it('しばらく開いていなかったら「久しぶり」と言う。毎日開いても数えない', () => {
    window.localStorage.setItem('oshiLastSeen', '2020-01-01');
    mountOshi(ON);
    expect(bubble().dataset.event).toBe('back');
    expect(window.localStorage.getItem('oshiLastSeen')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    mountOshi(ON);
    expect(bubble() === null || bubble().hidden).toBe(true);
  });

  it('ホームに推しのカード (あいさつ・育ちの段・なかよし)。ホームのあいさつを止めると出さない', () => {
    mountOshi(ON, { apiOshiGet: oshiFixture({ growth: { key: 'grow2', label: '一人前', meter: 40, toNext: 18 } }) });
    const card = document.querySelector('#home-cards .oshi-card');
    expect(card).toBeTruthy();
    expect(['morning', 'day', 'night']).toContain(card.dataset.event);
    expect(card.querySelector('.oshi-line').textContent).not.toBe('');
    expect(card.querySelector('.oshi-stage').dataset.stage).toBe('grow2');
    expect(card.querySelector('.oshi-stage').textContent).toContain('一人前');
    expect(card.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('40');

    mountOshi({ 'oshi.on': true, 'oshi.home': false });
    expect(document.querySelector('.oshi-card')).toBe(null);
  });

  it('推しの頁: 気をつけること・最初の頼み文・表情ごとの頼み文を写すボタンが並ぶ', () => {
    mountOshi(ON);
    const page = openPage();
    expect(page.textContent).toContain('使ってよい絵だけ');
    expect(page.textContent).toContain('実在の人の顔');
    expect(page.textContent).toContain('Drive で共有している人は直に開けます');
    const keys = [...page.querySelectorAll('button.oshi-copy')].map((b) => b.dataset.prompt);
    expect(keys).toEqual(['base'].concat(oshiFixture().states.map((s) => s.key)));
  });

  it('「頼み文を写す」で、その表情の頼み文そのものを写す', () => {
    mountOshi(ON);
    const page = openPage();
    let copied = null;
    document.execCommand = vi.fn(() => {
      copied = document.querySelector('textarea[readonly]').value;
      return true;
    });
    page.querySelector('button.oshi-copy[data-prompt="praise"]').click();
    expect(copied).toBe(oshiFixture().states.find((s) => s.key === 'praise').prompt);
    expect(document.getElementById('snackbar').textContent).toContain('写しました');
    delete document.execCommand;
  });

  it('絵を選ぶと、その表情に送る。形式が違えば送らずに断る', async () => {
    const app = mountOshi(ON);
    const page = openPage();
    const row = page.querySelector('.oshi-state[data-state="praise"]');
    const input = row.querySelector('input[type="file"]');
    const pick = (file) => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new window.Event('change', { bubbles: true }));
    };
    pick(new window.File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' }));
    expect(document.getElementById('snackbar').textContent).toContain('受け取れない形式です');
    expect(names(app)).not.toContain('apiOshiSetImage');

    app.respond('apiOshiSetImage', (state) => ({ state, sha: 'a'.repeat(64), mime: 'image/png' }));
    pick(new window.File([PNG], 'a.png', { type: 'image/png' }));
    for (let i = 0; i < 50 && !names(app).includes('apiOshiSetImage'); i++) await new Promise((r) => setTimeout(r, 10));
    const sent = app.calls.find((c) => c.name === 'apiOshiSetImage');
    expect(sent.args).toEqual(['praise', PNG_URL]);
    // その表情の行が「差し替える」に変わる
    const after = document.querySelector('.oshi-state[data-state="praise"]');
    expect(after.querySelector('.oshi-pick').textContent).toContain('差し替える');
    expect(after.querySelector('img').getAttribute('src')).toBe(PNG_URL);
  });

  it('1MB を超える絵は (縮められない環境では) 送らずに断る', async () => {
    const app = mountOshi(ON);
    const page = openPage();
    const input = page.querySelector('.oshi-state[data-state="idle"] input[type="file"]');
    const big = Buffer.concat([PNG, Buffer.alloc(1024 * 1024 + 10)]);
    Object.defineProperty(input, 'files', { value: [new window.File([big], 'b.png', { type: 'image/png' })] });
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    for (let i = 0; i < 50; i++) {
      const s = document.getElementById('snackbar');
      if (s && s.textContent.includes('1MB')) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(document.getElementById('snackbar').textContent).toContain('画像は1MBまでにしてください');
    expect(names(app)).not.toContain('apiOshiSetImage');
  });

  it('名前と口調を決める・自分のせりふを保存する', () => {
    const app = mountOshi(ON);
    const page = openPage();
    page.querySelector('.oshi-name-input').value = 'ソラ';
    page.querySelector('.oshi-tone').value = 'butler';
    app.respond('apiOshiSetProfile', (n, t) => ({ name: n, tone: t }));
    page.querySelector('.oshi-profile-save').click();
    expect(app.calls.find((c) => c.name === 'apiOshiSetProfile').args).toEqual(['ソラ', 'butler']);

    const page2 = document.querySelector('.oshi-page');
    const item = page2.querySelector('.oshi-lines[data-event="merge"]');
    item.querySelector('textarea').value = 'おめでとう\n\nすごい';
    app.respond('apiOshiSetLines', (e, l) => ({ event: e, lines: l.filter((x) => x) }));
    item.querySelector('button').click();
    expect(app.calls.find((c) => c.name === 'apiOshiSetLines').args).toEqual(['merge', ['おめでとう', '', 'すごい']]);
    expect(item.querySelector('summary').textContent).toContain('自分のせりふ 2');
  });

  it('動きを減らす設定でも吹き出しは出る (動きは CSS が止める)', () => {
    window.matchMedia = (q) => ({ matches: /reduce/.test(q), media: q, addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {} });
    mountOshi(ON);
    closeOneIssue();
    expect(bubble().hidden).toBe(false);
  });
});

describe('最初からいるキャラ', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  const NO_HOME = { 'oshi.on': true, 'oshi.home': false };

  it('自分の絵が無い表情には、最初からいるキャラの絵 (既定は 2頭身) を出す', () => {
    const app = mountOshi(NO_HOME, { apiOshiGet: oshiFixture({ noImages: true }) });
    closeOneIssue();
    expect(bubble().querySelector('img.oshi-img').getAttribute('src')).toBe(defaultUrl('chibi', 'celebrate'));
    expect(defaultCalls(app)).toEqual([['chibi', 'celebrate']]);
  });

  it('入れた表情だけ自分の絵になり、ほかの表情は最初からいるキャラのまま', () => {
    const app = mountOshi(NO_HOME, { apiIssueClose: new Error('混み合っています') });
    closeOneIssue();
    // 断られた → 「しんぱい」は自分の絵が無いので最初からいるキャラ
    expect(bubble().dataset.state).toBe('worry');
    expect(bubble().querySelector('img').getAttribute('src')).toBe(defaultUrl('chibi', 'worry'));

    app.respond('apiIssueClose', () => null);
    closeOneIssue();
    // 「おいわい」は自分の絵 (取りに行かない)
    expect(bubble().dataset.state).toBe('celebrate');
    expect(bubble().querySelector('img').getAttribute('src')).toBe(PNG_URL);
    expect(defaultCalls(app)).toEqual([['chibi', 'worry']]);
  });

  it('設定で等身を選ぶと、等身の絵を取る', () => {
    const app = mountOshi(Object.assign({ 'oshi.style': 'normal' }, NO_HOME), { apiOshiGet: oshiFixture({ noImages: true }) });
    closeOneIssue();
    expect(bubble().querySelector('img').getAttribute('src')).toBe(defaultUrl('normal', 'celebrate'));
    expect(defaultCalls(app)).toEqual([['normal', 'celebrate']]);
  });

  it('使わない設定なら、最初からいるキャラの絵を1度も取らない (吹き出し・ホーム・頁のどれでも)', () => {
    const app = mountOshi(OWN_ONLY, { apiOshiGet: oshiFixture({ noImages: true }) });
    closeOneIssue();
    const page = openPage();
    expect(page.querySelector('.oshi-state[data-state="idle"]').dataset.picture).toBe('none');
    expect(page.querySelector('.oshi-state[data-state="idle"] .oshi-empty').textContent).toBe('まだ');
    expect(names(app)).not.toContain('apiOshiDefaultImage');
  });

  it('要るときまで取らず、一度取った絵は取り直さない (最初のページには入れない)', () => {
    const app = mountOshi(NO_HOME, { apiOshiGet: oshiFixture({ noImages: true }) });
    expect(names(app)).toContain('apiOshiGet');
    expect(names(app)).not.toContain('apiOshiDefaultImage');
    closeOneIssue();
    closeOneIssue();
    expect(defaultCalls(app)).toEqual([['chibi', 'celebrate']]);
    expect(bubble().querySelector('img').getAttribute('src')).toBe(defaultUrl('chibi', 'celebrate'));
  });

  it('取りに行っている最中に同じ絵が要っても、2回取りに行かない', () => {
    let reply = null;
    const app = mountOshi(NO_HOME, {
      apiOshiGet: oshiFixture({ noImages: true }),
      apiOshiDefaultImage: (style, state) => ({ later: (ok) => { reply = () => ok({ style, state, dataUrl: defaultUrl(style, state) }); } }),
    });
    closeOneIssue();
    closeOneIssue();
    expect(defaultCalls(app)).toEqual([['chibi', 'celebrate']]);
    reply();
    expect(bubble().querySelector('img').getAttribute('src')).toBe(defaultUrl('chibi', 'celebrate'));
  });

  it('推しの頁: 自分の絵の無い表情は最初からいるキャラの絵で、見本だと書いてある (実在の人には触れない)', () => {
    mountOshi(NO_HOME);
    const page = openPage();
    expect(page.querySelector('.oshi-state[data-state="celebrate"]').dataset.picture).toBe('mine');
    const idle = page.querySelector('.oshi-state[data-state="idle"]');
    expect(idle.dataset.picture).toBe('default');
    expect(idle.querySelector('img').getAttribute('src')).toBe(defaultUrl('chibi', 'idle'));
    expect(idle.textContent).toContain('いまは最初からいるキャラの絵');
    expect(page.textContent).toContain('最初からいるキャラ (クロハ) は見本です');
    expect(page.textContent).toContain('最初からいるキャラを使う');
  });

  it('ホームのカードも最初からいるキャラで出し、「絵を入れる」は急かさない', () => {
    const app = mountOshi(ON, { apiOshiGet: oshiFixture({ noImages: true }) });
    const card = document.querySelector('#home-cards .oshi-card');
    expect(card.querySelector('img.oshi-img')).toBeTruthy();
    expect([...card.querySelectorAll('button')].some((b) => b.textContent === '推しの絵を入れる')).toBe(false);
    expect(defaultCalls(app).length).toBe(1);
  });
});
