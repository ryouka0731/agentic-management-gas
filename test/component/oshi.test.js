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

const servers = {};
/**
 * サーバが返す形そのもの。自分のキャラ「ルナ」(1人目) に「おいわい」の絵だけ入れてあり、使うキャラはルナ。
 * opts.char / opts.fallback で、使うキャラと絵が無い表情の設定を変えて返す。opts.two なら2人目「ソラ」もいる。
 */
function oshiFixture(opts) {
  const o = opts || {};
  const key = o.two ? 'two' : 'one';
  if (!servers[key]) {
    const fake = createFakeGas();
    const ctx = loadGasWith(fake, ...APP_SOURCES);
    ctx.repoInit('agentic-management');
    const c = ctx.apiOshiCharCreate('ルナ', 'genki').charId;
    ctx.apiOshiSetImage(c, 'celebrate', PNG_URL);
    ctx.apiOshiSetLines(c, 'done', ['自分のせりふ！']);
    if (o.two) ctx.apiOshiSetImage(ctx.apiOshiCharCreate('ソラ', 'cool').charId, 'idle', PNG_URL);
    servers[key] = { ctx, fake };
  }
  const ctx = servers[key].ctx;
  ctx.apiPrefSet('oshi.char', o.char || 'mine:1');
  ctx.apiPrefSet('oshi.fallback', o.fallback || null);
  const got = JSON.parse(JSON.stringify(ctx.apiOshiGet()));
  if (o.noImages) {
    got.images = [];
    got.mine.forEach((m) => { m.images = []; });
  }
  if (o.growth) Object.assign(got.growth, o.growth);
  return got;
}

/** 最初からいるキャラの絵 (疑似)。キャラ・形・表情で字が変わる */
const defaultUrl = (char, style, state) => 'data:image/webp;base64,' + Buffer.from(char + ':' + style + ':' + state).toString('base64');

function mountOshi(values, over) {
  const v = values || {};
  return mount(Object.assign({
    apiPrefs: prefsFixture({ values: v }),
    apiOshiGet: oshiFixture({ char: v['oshi.char'], fallback: v['oshi.fallback'] }),
    apiOshiImage: (charId, state) => ({ charId, state, sha: 'f'.repeat(64), dataUrl: PNG_URL }),
    apiOshiDefaultImage: (char, style, state) => ({ char, style, state, dataUrl: defaultUrl(char, style, state) }),
    // 書いたあとの設定は、それまでの値に重ねて返す (疑似の既定は1つだけ返すので、推しがオフに戻ってしまう)
    apiPrefSet: (key, value) => prefsFixture({ values: Object.assign({}, v, { [key]: value }) }),
  }, over || {}));
}

/** 自分のキャラ (ルナ) を使う人 */
const ON = { 'oshi.on': true, 'oshi.char': 'mine:1' };
/** 自分のキャラだけを使い、絵が無い表情に最初からいるキャラを出さない人 */
const OWN_ONLY = { 'oshi.on': true, 'oshi.char': 'mine:1', 'oshi.fallback': 'none' };
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

  it('オフにした人には、取りにも行かず、自分のところにもホームにも出ず、済ませても吹き出しは出ない', () => {
    const app = mountOshi({ 'oshi.on': false });
    expect(names(app)).not.toContain('apiOshiGet');
    document.getElementById('me-btn').click();
    expect([...document.querySelectorAll('#me-body button')].some((b) => b.textContent === '推し')).toBe(false);
    expect(document.querySelector('.oshi-card')).toBe(null);
    closeOneIssue();
    expect(bubble()).toBe(null);
    expect(names(app)).not.toContain('apiOshiGet');
  });

  it('設定の「推し」の見出しに、自分の設定として並ぶ。既定でオン (利用者が決めた)', () => {
    mountOshi();
    document.querySelector('.nav-item[data-tab="settings"]').click();
    const box = document.querySelector('[data-pref="oshi.on"]');
    expect(box).toBeTruthy();
    // 選び方はどれも自分の設定 (チームの設定には出さない)
    for (const k of ['oshi.on', 'oshi.char', 'oshi.fallback', 'oshi.style']) {
      expect(document.querySelector('#settings-mine [data-pref="' + k + '"]'), k).toBeTruthy();
      expect(document.querySelector('#settings-team [data-pref="' + k + '"]'), k).toBe(null);
    }
    expect(box.querySelector('button[role="switch"]').getAttribute('aria-checked')).toBe('true');
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

  it('絵が無い表情に何も出さない人は、その表情の絵が無ければ名前の頭文字を出す (外から何も取ってこない)', () => {
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

  it('キーボードで吹き出しの中に入っているあいだは消さず、出たらまた数え始める', () => {
    vi.useFakeTimers();
    mountOshi(ON);
    closeOneIssue();
    const close = bubble().querySelector('.oshi-close');
    close.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    vi.advanceTimersByTime(7000);
    expect(bubble().hidden).toBe(false);
    close.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
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
    mountOshi(ON, { apiOshiGet: oshiFixture({ growth: { key: 'grow2', label: 'なれてきた', meter: 40, toNext: 18 } }) });
    const card = document.querySelector('#home-cards .oshi-card');
    expect(card).toBeTruthy();
    expect(['morning', 'day', 'night']).toContain(card.dataset.event);
    expect(card.querySelector('.oshi-line').textContent).not.toBe('');
    expect(card.querySelector('.oshi-stage').dataset.stage).toBe('grow2');
    expect(card.querySelector('.oshi-stage').textContent).toContain('なれてきた');
    expect(card.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('40');

    mountOshi({ 'oshi.on': true, 'oshi.char': 'mine:1', 'oshi.home': false });
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

    app.respond('apiOshiSetImage', (id, state) => ({ charId: id, state, sha: 'a'.repeat(64), mime: 'image/png' }));
    pick(new window.File([PNG], 'a.png', { type: 'image/png' }));
    for (let i = 0; i < 50 && !names(app).includes('apiOshiSetImage'); i++) await new Promise((r) => setTimeout(r, 10));
    const sent = app.calls.find((c) => c.name === 'apiOshiSetImage');
    expect(sent.args).toEqual([1, 'praise', PNG_URL]);
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
    app.respond('apiOshiSetProfile', (id, n, t) => ({ charId: id, name: n, tone: t }));
    page.querySelector('.oshi-profile-save').click();
    expect(app.calls.find((c) => c.name === 'apiOshiSetProfile').args).toEqual([1, 'ソラ', 'butler']);

    const page2 = document.querySelector('.oshi-page');
    const item = page2.querySelector('.oshi-lines[data-event="merge"]');
    item.querySelector('textarea').value = 'おめでとう\n\nすごい';
    app.respond('apiOshiSetLines', (id, e, l) => ({ charId: id, event: e, lines: l.filter((x) => x) }));
    item.querySelector('button').click();
    expect(app.calls.find((c) => c.name === 'apiOshiSetLines').args).toEqual([1, 'merge', ['おめでとう', '', 'すごい']]);
    expect(item.querySelector('summary').textContent).toContain('自分のせりふ 2');
  });

  it('考え中のせりふも自分のせりふの欄で直せ、24字までと Claude Code で使うことが添えてある', () => {
    const app = mountOshi(ON);
    const page = openPage();
    const item = page.querySelector('.oshi-lines[data-event="spinner"]');
    expect(item.textContent).toContain('1つ24字まで');
    expect(item.textContent).toContain('oshi-spinner on');
    expect(page.querySelector('.oshi-lines[data-event="done"]').textContent).not.toContain('oshi-spinner');
    item.querySelector('textarea').value = 'テストを考え中';
    app.respond('apiOshiSetLines', (id, e, l) => ({ charId: id, event: e, lines: l }));
    item.querySelector('button').click();
    expect(app.calls.find((c) => c.name === 'apiOshiSetLines').args).toEqual([1, 'spinner', ['テストを考え中']]);
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

  const NO_HOME = { 'oshi.on': true, 'oshi.char': 'mine:1', 'oshi.home': false };

  it('自分のキャラの絵が無い表情には、絵が無い表情の設定のキャラ (既定はタクの 2頭身) を出す', () => {
    const app = mountOshi(NO_HOME, { apiOshiGet: oshiFixture({ noImages: true }) });
    closeOneIssue();
    expect(bubble().querySelector('img.oshi-img').getAttribute('src')).toBe(defaultUrl('taku', 'chibi', 'celebrate'));
    expect(defaultCalls(app)).toEqual([['taku', 'chibi', 'celebrate']]);
  });

  it('入れた表情だけ自分の絵になり、ほかの表情は最初からいるキャラのまま', () => {
    const app = mountOshi(NO_HOME, { apiIssueClose: new Error('混み合っています') });
    closeOneIssue();
    // 断られた → 「しんぱい」は自分の絵が無いので最初からいるキャラ
    expect(bubble().dataset.state).toBe('worry');
    expect(bubble().querySelector('img').getAttribute('src')).toBe(defaultUrl('taku', 'chibi', 'worry'));

    app.respond('apiIssueClose', () => null);
    closeOneIssue();
    // 「おいわい」は自分の絵 (取りに行かない)
    expect(bubble().dataset.state).toBe('celebrate');
    expect(bubble().querySelector('img').getAttribute('src')).toBe(PNG_URL);
    expect(defaultCalls(app)).toEqual([['taku', 'chibi', 'worry']]);
  });

  it('設定で等身を選ぶと、等身の絵を取る', () => {
    const app = mountOshi(Object.assign({ 'oshi.style': 'normal' }, NO_HOME), { apiOshiGet: oshiFixture({ noImages: true }) });
    closeOneIssue();
    expect(bubble().querySelector('img').getAttribute('src')).toBe(defaultUrl('taku', 'normal', 'celebrate'));
    expect(defaultCalls(app)).toEqual([['taku', 'normal', 'celebrate']]);
  });

  it('「出さない」なら、最初からいるキャラの絵を1度も取らない (吹き出し・ホーム・頁のどれでも)', () => {
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
    expect(defaultCalls(app)).toEqual([['taku', 'chibi', 'celebrate']]);
    expect(bubble().querySelector('img').getAttribute('src')).toBe(defaultUrl('taku', 'chibi', 'celebrate'));
  });

  // ----- 推しの頁の顔。頭をなでると笑顔になる (makeOshiHero) -----
  const hero = () => document.querySelector('.oshi-page .oshi-hero');
  /** jsdom の PointerEvent は clientX を持たせにくいので、同じ名前の MouseEvent を送る */
  const move = (el, x, y) => el.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
  const patLines = (data) => data.events.find((e) => e.key === 'pat').lines;

  it('推しの頁のいちばん上に、いま使うキャラの絵が大きく出て、「なでる」を押すと笑顔になってひとこと言い、しばらくで戻る', () => {
    vi.useFakeTimers();
    const data = oshiFixture({ noImages: true });
    mountOshi(NO_HOME, { apiOshiGet: data });
    openPage();
    const sec = hero();
    expect(sec).toBeTruthy();
    expect(sec.dataset.state).toBe('idle');
    expect(sec.querySelector('.oshi-hero-figure img').getAttribute('alt')).toContain('ルナ');
    expect(sec.querySelector('.oshi-hero-line').textContent).toContain('なでると喜びます');
    sec.querySelector('.oshi-pat').click();
    expect(sec.dataset.state).toBe('praise');
    expect(sec.classList.contains('is-patted')).toBe(true);
    expect(sec.querySelector('.oshi-hero-figure img').getAttribute('src')).toBe(defaultUrl('taku', 'chibi', 'praise'));
    expect(patLines(data)).toContain(sec.querySelector('.oshi-hero-line').textContent);
    vi.advanceTimersByTime(4000);
    expect(sec.dataset.state).toBe('idle');
    expect(sec.classList.contains('is-patted')).toBe(false);
    expect(sec.querySelector('.oshi-hero-line').textContent).toContain('なでると喜びます');
  });

  it('絵の上で指を動かしても、画像のドラッグ&ドロップにならない', () => {
    mountOshi(NO_HOME, { apiOshiGet: oshiFixture({ noImages: true }) });
    openPage();
    const img = hero().querySelector('.oshi-hero-figure img');
    const ev = new Event('dragstart', { bubbles: true, cancelable: true });
    img.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('絵の上半分で指を左右に往復させると、なでたと数える。下半分や笑顔のあいだは数えない', () => {
    vi.useFakeTimers();
    const data = oshiFixture({ noImages: true });
    mountOshi(NO_HOME, { apiOshiGet: data });
    openPage();
    const sec = hero();
    const fig = sec.querySelector('.oshi-hero-figure');
    fig.getBoundingClientRect = () => ({ top: 0, left: 0, width: 200, height: 200, right: 200, bottom: 200 });
    // 下半分 (体) をなでても変わらない
    move(fig, 20, 150); move(fig, 80, 150); move(fig, 20, 150); move(fig, 80, 150);
    expect(sec.dataset.state).toBe('idle');
    // 頭を一往復半 (向きが2回変わる)
    move(fig, 20, 40); move(fig, 80, 40); move(fig, 20, 40); move(fig, 80, 40);
    expect(sec.dataset.state).toBe('praise');
    const said = sec.querySelector('.oshi-hero-line').textContent;
    expect(patLines(data)).toContain(said);
    // 笑顔のあいだにもう一度なでても、せりふは変わらない
    move(fig, 20, 40); move(fig, 80, 40); move(fig, 20, 40); move(fig, 80, 40);
    expect(sec.querySelector('.oshi-hero-line').textContent).toBe(said);
    vi.advanceTimersByTime(4000);
    expect(sec.dataset.state).toBe('idle');
  });

  // 絵は要るときに取る作りなので、そのままだと場面が来た瞬間にせりふの後から絵が遅れて出る。
  // 読み込んでから少し待ち、いま使うキャラの絵を全部の表情ぶん裏で取っておく (oshiWarmImages)
  it('読み込んでから少し待つと、いま使うキャラの絵を全部の表情ぶん裏で取っておく。場面が来たときは取りに行かず、すぐ出す', () => {
    vi.useFakeTimers();
    const data = oshiFixture({ noImages: true });
    const app = mountOshi(NO_HOME, { apiOshiGet: data });
    expect(names(app)).not.toContain('apiOshiDefaultImage');
    vi.advanceTimersByTime(1499);
    expect(names(app)).not.toContain('apiOshiDefaultImage'); // 最初の画面の呼び出しと重ねない
    vi.advanceTimersByTime(1 + 150 * data.states.length);
    const states = data.states.map((s) => s.key);
    expect(defaultCalls(app).map((a) => a[2]).sort()).toEqual(states.slice().sort());
    expect(defaultCalls(app).every((a) => a[0] === 'taku' && a[1] === 'chibi')).toBe(true);
    const before = defaultCalls(app).length;
    closeOneIssue();
    expect(bubble().querySelector('img').getAttribute('src')).toBe(defaultUrl('taku', 'chibi', 'celebrate'));
    expect(defaultCalls(app).length).toBe(before);
  });

  it('自分のキャラなら、入れてある絵は自分の絵を、無い表情は代わりのキャラの絵を裏で取っておく', () => {
    vi.useFakeTimers();
    const data = oshiFixture();
    const app = mountOshi(ON, { apiOshiGet: data });
    vi.advanceTimersByTime(1500 + 150 * data.states.length);
    expect(app.calls.filter((c) => c.name === 'apiOshiImage').map((c) => c.args)).toEqual([[1, 'celebrate']]);
    expect(defaultCalls(app).map((a) => a[2])).not.toContain('celebrate');
    expect(defaultCalls(app).length).toBe(data.states.length - 1);
  });

  it('オフの人と、絵を出さない設定の人は、裏でも取らない', () => {
    vi.useFakeTimers();
    const off = mountOshi({ 'oshi.on': false });
    vi.advanceTimersByTime(10000);
    expect(names(off)).not.toContain('apiOshiDefaultImage');
    expect(names(off)).not.toContain('apiOshiImage');
    const own = mountOshi(OWN_ONLY, { apiOshiGet: oshiFixture({ noImages: true, fallback: 'none' }) });
    vi.advanceTimersByTime(10000);
    expect(names(own)).not.toContain('apiOshiDefaultImage');
    expect(names(own)).not.toContain('apiOshiImage');
  });

  it('取りに行っている最中に同じ絵が要っても、2回取りに行かない', () => {
    let reply = null;
    const app = mountOshi(NO_HOME, {
      apiOshiGet: oshiFixture({ noImages: true }),
      apiOshiDefaultImage: (char, style, state) => ({ later: (ok) => { reply = () => ok({ char, style, state, dataUrl: defaultUrl(char, style, state) }); } }),
    });
    closeOneIssue();
    closeOneIssue();
    expect(defaultCalls(app)).toEqual([['taku', 'chibi', 'celebrate']]);
    reply();
    expect(bubble().querySelector('img').getAttribute('src')).toBe(defaultUrl('taku', 'chibi', 'celebrate'));
  });

  it('推しの頁: 自分の絵の無い表情は最初からいるキャラの絵で、そう書いてある', () => {
    mountOshi(NO_HOME);
    const page = openPage();
    expect(page.querySelector('.oshi-state[data-state="celebrate"]').dataset.picture).toBe('mine');
    const idle = page.querySelector('.oshi-state[data-state="idle"]');
    expect(idle.dataset.picture).toBe('default');
    expect(idle.querySelector('img').getAttribute('src')).toBe(defaultUrl('taku', 'chibi', 'idle'));
    expect(idle.textContent).toContain('いまは最初からいるキャラの絵');
    expect(page.textContent).toContain('自分のキャラの絵が無い表情');
  });

  it('ホームのカードも最初からいるキャラで出し、「絵を入れる」は急かさない', () => {
    const app = mountOshi(ON, { apiOshiGet: oshiFixture({ noImages: true }) });
    const card = document.querySelector('#home-cards .oshi-card');
    expect(card.querySelector('img.oshi-img')).toBeTruthy();
    expect([...card.querySelectorAll('button')].some((b) => b.textContent === '推しの絵を入れる')).toBe(false);
    expect(defaultCalls(app).length).toBe(1);
  });
});

describe('キャラを選ぶ', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  const TAKU = { 'oshi.on': true, 'oshi.char': 'builtin:taku', 'oshi.home': false };
  const picker = () => document.querySelector('[data-pref="oshi.char"]');
  const cards = () => [...picker().querySelectorAll('.oshi-choice')];
  const checked = () => cards().filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.dataset.char);
  const openSettings = () => document.querySelector('.nav-item[data-tab="settings"]').click();

  it('タクを使う人は、済ませるとタクの絵と明るい相棒のせりふで吹き出しが出る (自分の絵は取りに行かない)', () => {
    const app = mountOshi(TAKU);
    closeOneIssue();
    const b = bubble();
    expect(b.dataset.char).toBe('builtin:taku');
    expect(b.querySelector('.oshi-name').textContent).toBe('タク');
    expect(oshiFixture({ char: 'builtin:taku' }).events.find((e) => e.key === 'done').lines)
      .toContain(b.querySelector('.oshi-line').textContent);
    expect(b.querySelector('.oshi-line').textContent).toBe(loadGasWith(createFakeGas(), 'src/core/Oshi.js').OSHI_LINES().buddy.done[0]);
    expect(b.querySelector('img').getAttribute('src')).toBe(defaultUrl('taku', 'chibi', 'celebrate'));
    expect(b.querySelector('img').alt).toBe('タクの「おいわい」');
    expect(defaultCalls(app)).toEqual([['taku', 'chibi', 'celebrate']]);
    expect(names(app)).not.toContain('apiOshiImage');
  });

  it('設定の「使うキャラ」に、最初からいるキャラと自分のキャラがふつうの顔の絵つきのカードで並ぶ', () => {
    const app = mountOshi({ 'oshi.on': true, 'oshi.home': false });
    openSettings();
    expect(cards().map((b) => b.dataset.char)).toEqual(['builtin:taku', 'builtin:itsuki', 'mine:1']);
    expect(cards().map((b) => b.querySelector('.oshi-choice-name').textContent)).toEqual(['タク', 'イツキ', 'ルナ']);
    expect(picker().querySelector('[role="radiogroup"]')).toBeTruthy();
    expect(checked()).toEqual(['builtin:taku']);
    // 最初からいるキャラは「ふつう」の絵、自分のキャラは「ふつう」の絵が無いので頭文字
    expect(cards()[0].querySelector('img').getAttribute('src')).toBe(defaultUrl('taku', 'chibi', 'idle'));
    expect(cards()[1].querySelector('img').getAttribute('src')).toBe(defaultUrl('itsuki', 'chibi', 'idle'));
    expect(cards()[2].querySelector('img')).toBe(null);
    expect(cards()[2].querySelector('.oshi-avatar').textContent).toBe('ル');
    expect(defaultCalls(app)).toEqual([['taku', 'chibi', 'idle'], ['itsuki', 'chibi', 'idle']]);
  });

  it('カードを押すと apiPrefSet で保存し、選んだしるしが移る。吹き出しもそのキャラになる', () => {
    const app = mountOshi({ 'oshi.on': true, 'oshi.home': false });
    openSettings();
    app.respond('apiOshiGet', oshiFixture({ char: 'builtin:itsuki' }));
    cards()[1].click();
    expect(app.calls.filter((c) => c.name === 'apiPrefSet').map((c) => c.args)).toEqual([['oshi.char', 'builtin:itsuki']]);
    expect(checked()).toEqual(['builtin:itsuki']);
    expect(document.getElementById('snackbar').textContent).toContain('「イツキ」を使います');
    // 選び直すと推しを取り直す (名前・口調・絵が変わる)
    closeOneIssue();
    expect(bubble().querySelector('.oshi-name').textContent).toBe('イツキ');
    // 同じカードをもう一度押しても書かない (開き直すと、設定は書いたあとの値で届く)
    app.respond('apiPrefs', prefsFixture({ values: { 'oshi.on': true, 'oshi.home': false, 'oshi.char': 'builtin:itsuki' } }));
    openSettings();
    expect(checked()).toEqual(['builtin:itsuki']);
    cards().find((b) => b.dataset.char === 'builtin:itsuki').click();
    expect(app.calls.filter((c) => c.name === 'apiPrefSet').length).toBe(1);
  });

  it('断られたら、選んだしるしは動かさない', () => {
    const app = mountOshi({ 'oshi.on': true, 'oshi.home': false }, { apiPrefSet: new Error('そのキャラは選べません') });
    openSettings();
    cards()[2].click();
    expect(names(app)).toContain('apiPrefSet');
    expect(checked()).toEqual(['builtin:taku']);
    expect(document.getElementById('snackbar').textContent).toContain('選べませんでした');
  });

  it('矢印のキーで選び直せる。押せる場所は選んでいるカード1つだけ (Tab で一覧を素通りできる)', () => {
    const app = mountOshi({ 'oshi.on': true, 'oshi.home': false });
    openSettings();
    const tabbable = () => cards().filter((b) => b.tabIndex === 0).map((b) => b.dataset.char);
    expect(tabbable()).toEqual(['builtin:taku']);
    const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    key(cards()[0], 'ArrowRight');
    expect(app.calls.filter((c) => c.name === 'apiPrefSet').map((c) => c.args)).toEqual([['oshi.char', 'builtin:itsuki']]);
    expect(checked()).toEqual(['builtin:itsuki']);
    expect(document.activeElement.dataset.char).toBe('builtin:itsuki');
    expect(tabbable()).toEqual(['builtin:itsuki']);
    // 先頭から戻ると末尾へ回る
    key(cards()[1], 'ArrowUp');
    key(cards()[0], 'ArrowLeft');
    expect(document.activeElement.dataset.char).toBe('mine:1');
    expect(checked()).toEqual(['mine:1']);
    key(cards()[2], 'ArrowDown');
    expect(document.activeElement.dataset.char).toBe('builtin:taku');
  });

  it('推しがオフでも、選んである自分のキャラは選んだしるしで出す (取りには行かない)', () => {
    const app = mountOshi({ 'oshi.on': false, 'oshi.char': 'mine:1' });
    openSettings();
    expect(cards().map((b) => b.dataset.char)).toEqual(['builtin:taku', 'builtin:itsuki', 'mine:1']);
    expect(checked()).toEqual(['mine:1']);
    expect(names(app)).not.toContain('apiOshiGet');
  });

  it('推しがオフなら、選び方は出るが絵も自分のキャラも取りに行かない。選んでも吹き出しは出さない', () => {
    const app = mountOshi({ 'oshi.on': false });
    openSettings();
    expect(cards().map((b) => b.dataset.char)).toEqual(['builtin:taku', 'builtin:itsuki']);
    expect(picker().textContent).toContain('オンにすると');
    cards()[1].click();
    expect(names(app)).toContain('apiPrefSet');
    expect(bubble()).toBe(null);
    expect(names(app)).not.toContain('apiOshiGet');
    expect(names(app)).not.toContain('apiOshiDefaultImage');
    expect(names(app)).not.toContain('apiOshiImage');
  });
});

describe('選んだキャラがあいさつする', () => {
  beforeEach(() => { window.localStorage.clear(); });
  afterEach(() => { vi.restoreAllMocks(); });

  const pure = loadGasWith(createFakeGas(), 'src/core/Oshi.js');
  // 決まった場面でだけ出す表情 (作業中) は、でたらめには選ばない
  const STATES = pure.OSHI_STATES().filter((x) => !x.scene).map((x) => x.key);
  const picker = () => document.querySelector('[data-pref="oshi.char"]');
  const card = (v) => [...picker().querySelectorAll('.oshi-choice')].find((b) => b.dataset.char === v);
  const openSettings = () => document.querySelector('.nav-item[data-tab="settings"]').click();

  it('最初からいるキャラを選ぶと、そのキャラの口調の「選んでもらった」と、そのキャラのでたらめな表情の絵を出す', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.75);
    const app = mountOshi({ 'oshi.on': true, 'oshi.home': false });
    openSettings();
    app.respond('apiOshiGet', oshiFixture({ char: 'builtin:itsuki' }));
    const focused = document.activeElement;
    card('builtin:itsuki').click();
    const b = bubble();
    expect(b.hidden).toBe(false);
    expect(b.dataset.event).toBe('chosen');
    expect(b.querySelector('.oshi-name').textContent).toBe('イツキ');
    expect(pure.OSHI_LINES().gothic.chosen).toContain(b.querySelector('.oshi-line').textContent);
    const want = STATES[Math.floor(0.75 * STATES.length)];
    expect(b.dataset.state).toBe(want);
    expect(b.querySelector('img').getAttribute('src')).toBe(defaultUrl('itsuki', 'chibi', want));
    expect(defaultCalls(app)).toContainEqual(['itsuki', 'chibi', want]);
    // 吹き出しは焦点を奪わない
    expect(document.activeElement).toBe(focused);
  });

  it('でたらめに選ぶ表情に、作業中 (作業部屋でだけ出す) を入れない', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9999);
    const app = mountOshi({ 'oshi.on': true, 'oshi.home': false });
    openSettings();
    app.respond('apiOshiGet', oshiFixture({ char: 'builtin:itsuki' }));
    card('builtin:itsuki').click();
    expect(bubble().dataset.state).not.toBe('work');
    expect(bubble().dataset.state).toBe(STATES[STATES.length - 1]);
  });

  it('等身を選んでいれば、等身の絵から', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const app = mountOshi({ 'oshi.on': true, 'oshi.home': false, 'oshi.style': 'normal' });
    openSettings();
    app.respond('apiOshiGet', oshiFixture({ char: 'builtin:itsuki' }));
    card('builtin:itsuki').click();
    // 選ばれたのは ふつう (STATES[0])。ふつうの顔はいまの段の絵で出す (oshiPickState)
    expect(STATES[0]).toBe('idle');
    expect(bubble().querySelector('img').getAttribute('src')).toBe(defaultUrl('itsuki', 'normal', 'grow1'));
  });

  it('自分のキャラを選ぶと、そのキャラの口調のせりふと、入れてある絵の中から出す', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const app = mountOshi({ 'oshi.on': true, 'oshi.home': false });
    openSettings();
    app.respond('apiOshiGet', oshiFixture({ char: 'mine:1' }));
    card('mine:1').click();
    const b = bubble();
    expect(b.dataset.event).toBe('chosen');
    expect(b.querySelector('.oshi-name').textContent).toBe('ルナ');
    expect(pure.OSHI_LINES().genki.chosen).toContain(b.querySelector('.oshi-line').textContent);
    // ルナに入れてある絵は「おいわい」だけ
    expect(b.dataset.state).toBe('celebrate');
    expect(b.querySelector('img').getAttribute('src')).toBe(PNG_URL);
    expect(app.calls.filter((c) => c.name === 'apiOshiImage').map((c) => c.args)).toContainEqual([1, 'celebrate']);
  });

  it('絵を1枚も入れていない自分のキャラなら、絵が無い表情に出す最初からいるキャラのどれかの表情', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    const app = mountOshi({ 'oshi.on': true, 'oshi.home': false });
    openSettings();
    app.respond('apiOshiGet', oshiFixture({ char: 'mine:1', noImages: true }));
    card('mine:1').click();
    const want = STATES[Math.floor(0.1 * STATES.length)];
    expect(bubble().dataset.state).toBe(want);
    expect(bubble().querySelector('img').getAttribute('src')).toBe(defaultUrl('taku', 'chibi', want));
  });

  it('推しの頁の「このキャラを使う」でも、選んだキャラがあいさつする', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const app = mountOshi({ 'oshi.on': true, 'oshi.char': 'mine:1', 'oshi.home': false }, { apiOshiGet: oshiFixture({ two: true }) });
    let page = openPage();
    [...page.querySelectorAll('.oshi-mine-tab')][1].click();
    page = document.querySelector('.oshi-page');
    app.respond('apiOshiGet', oshiFixture({ two: true, char: 'mine:2' }));
    page.querySelector('.oshi-use').click();
    const b = bubble();
    expect(b.dataset.event).toBe('chosen');
    expect(b.querySelector('.oshi-name').textContent).toBe('ソラ');
    expect(pure.OSHI_LINES().cool.chosen).toContain(b.querySelector('.oshi-line').textContent);
    // ソラに入れてある絵は「ふつう」だけ
    expect(b.dataset.state).toBe('idle');
  });
});

describe('推しの頁: 自分のキャラを何人も', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  const TWO = { 'oshi.on': true, 'oshi.char': 'mine:1', 'oshi.home': false };
  const tabs = (page) => [...page.querySelectorAll('.oshi-mine-tab')];

  function mountTwo(over) {
    return mountOshi(TWO, Object.assign({ apiOshiGet: oshiFixture({ two: true }) }, over || {}));
  }

  it('自分のキャラが並び、押したキャラの名前・絵・せりふを直す。使っているキャラにはしるしが付く', () => {
    const app = mountTwo();
    const page = openPage();
    expect(tabs(page).map((b) => b.textContent)).toEqual(['ルナ ・ 使用中', 'ソラ']);
    expect(page.querySelector('.oshi-profile').dataset.charId).toBe('1');
    expect(page.querySelector('.oshi-name-input').value).toBe('ルナ');
    expect(page.querySelector('.oshi-use').disabled).toBe(true);
    tabs(page)[1].click();
    const p2 = document.querySelector('.oshi-page');
    expect(p2.querySelector('.oshi-profile').dataset.charId).toBe('2');
    expect(p2.querySelector('.oshi-name-input').value).toBe('ソラ');
    expect(p2.querySelector('.oshi-tone').value).toBe('cool');
    expect(tabs(p2)[1].getAttribute('aria-pressed')).toBe('true');
    expect(p2.querySelector('.oshi-state[data-state="idle"]').dataset.picture).toBe('mine');
    expect(p2.querySelector('.oshi-state[data-state="celebrate"]').dataset.picture).toBe('default');
    // ソラの絵は ソラの番号で取る
    expect(app.calls.filter((c) => c.name === 'apiOshiImage').map((c) => c.args)).toContainEqual([2, 'idle']);
    // 名前を決めると、ソラの番号で送る
    p2.querySelector('.oshi-name-input').value = 'ソラ2';
    app.respond('apiOshiSetProfile', (id, n, t) => ({ charId: id, name: n, tone: t }));
    p2.querySelector('.oshi-profile-save').click();
    expect(app.calls.find((c) => c.name === 'apiOshiSetProfile').args).toEqual([2, 'ソラ2', 'cool']);
  });

  it('「このキャラを使う」で使うキャラにする (書くのは apiPrefSet)', () => {
    const app = mountTwo();
    let page = openPage();
    tabs(page)[1].click();
    page = document.querySelector('.oshi-page');
    page.querySelector('.oshi-use').click();
    expect(app.calls.filter((c) => c.name === 'apiPrefSet').map((c) => c.args)).toEqual([['oshi.char', 'mine:2']]);
  });

  it('「新しいキャラを作る」で作り、作ったキャラを直す画面になる。上限なら押せない', () => {
    const app = mountTwo();
    const page = openPage();
    expect(page.textContent).toContain('5人まで作れます (いま 2人)');
    app.respond('apiOshiCharCreate', () => ({ charId: 3, name: '', tone: 'polite' }));
    const after = oshiFixture({ two: true });
    after.mine.push({ charId: 3, name: '', tone: 'polite', images: [], events: after.mine[0].events.map((e) => Object.assign({}, e, { mine: [] })) });
    app.respond('apiOshiGet', after);
    page.querySelector('.oshi-create').click();
    expect(app.calls.find((c) => c.name === 'apiOshiCharCreate').args).toEqual(['', 'polite']);
    const p2 = document.querySelector('.oshi-page');
    expect(p2.querySelector('.oshi-profile').dataset.charId).toBe('3');
    expect(tabs(p2).map((b) => b.textContent)).toContain('名前なし (3人目)');

    const full = oshiFixture({ two: true });
    for (let i = 3; i <= 5; i++) full.mine.push(Object.assign({}, full.mine[1], { charId: i, name: 'キャラ' + i }));
    mountOshi(TWO, { apiOshiGet: full });
    const p3 = openPage();
    expect(p3.querySelector('.oshi-create').disabled).toBe(true);
    expect(p3.textContent).toContain('自分のキャラは5人までです');
  });

  it('「このキャラを消す」は確かめてから、そのキャラの番号だけを消す', () => {
    const app = mountTwo();
    let page = openPage();
    tabs(page)[1].click();
    page = document.querySelector('.oshi-page');
    page.querySelector('.oshi-delete').click();
    expect(names(app)).not.toContain('apiOshiCharDelete');
    const strip = page.querySelector('.oshi-profile');
    expect(strip.textContent).toContain('ほかのキャラは残ります');
    const yes = [...strip.querySelectorAll('button')].find((b) => b.textContent === '消す');
    app.respond('apiOshiGet', oshiFixture());
    yes.click();
    expect(app.calls.find((c) => c.name === 'apiOshiCharDelete').args).toEqual([2]);
    expect(tabs(document.querySelector('.oshi-page')).map((b) => b.textContent)).toEqual(['ルナ ・ 使用中']);
  });

  it('自分のキャラがまだいなければ、作り方と「新しいキャラを作る」だけを出す', () => {
    const none = oshiFixture({ char: 'builtin:taku' });
    none.mine = [];
    mountOshi({ 'oshi.on': true, 'oshi.char': 'builtin:taku', 'oshi.home': false }, { apiOshiGet: none });
    const page = openPage();
    expect(page.textContent).toContain('まだ自分のキャラはいません');
    expect(page.textContent).toContain('いま使っているキャラ: タク');
    expect(page.querySelector('.oshi-profile')).toBe(null);
    expect(page.querySelector('.oshi-state')).toBe(null);
    expect(page.querySelector('.oshi-create').disabled).toBe(false);
    expect(page.querySelector('button.oshi-copy[data-prompt="base"]')).toBeTruthy();
  });
});
