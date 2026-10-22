// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prefsFixture } from '../dom.js';
import { mount } from './mount.js';
import { loadGasWith } from '../harness.js';
import { createFakeGas } from '../fakegas.js';
import { APP_SOURCES } from '../sources.js';

/*
 * 自分のキャラを「みんなに公開する」(js-oshi)。返事の形は本物のサーバ (疑似GAS) の apiOshiGet から作る。
 * a (テストのエー) がルナを作って公開し、b (開いている人) は自分のキャラ ソラ を持っている。
 */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PNG_URL = 'data:image/png;base64,' + PNG.toString('base64');
const defaultUrl = (char, style, state) => 'data:image/webp;base64,' + Buffer.from(char + ':' + style + ':' + state).toString('base64');

let server = null;
function srv() {
  if (server) return server;
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...APP_SOURCES);
  ctx.repoInit('agentic-management');
  fake._setUser('a@example.com');
  ctx.memberSet('a@example.com', '', 'テストのエー');
  const luna = ctx.apiOshiCharCreate('ルナ', 'cool').charId;
  ctx.apiOshiSetImage(luna, 'idle', PNG_URL);
  ctx.apiOshiSetLines(luna, 'done', ['テストのルナのせりふ']);
  ctx.apiOshiSetShared(luna, true);
  // 名前を決めていない2人目 (公開できない)
  ctx.apiOshiCharCreate('', 'polite');
  const sid = ctx.dbReadAll('oshi').find((r) => String(r.name) === 'ルナ').id;
  fake._setUser('b@example.com');
  ctx.apiOshiCharCreate('ソラ', 'genki');
  server = { ctx, fake, char: 'shared:' + sid };
  return server;
}

/** その人の apiOshiGet (who: 'a' / 'b')。char でその人の使うキャラを決めてから取る */
function oshiAs(who, char) {
  const s = srv();
  s.fake._setUser(who + '@example.com');
  s.ctx.apiPrefSet('oshi.char', char || null);
  return JSON.parse(JSON.stringify(s.ctx.apiOshiGet()));
}

function mountAs(who, values, over) {
  const v = Object.assign({ 'oshi.on': true, 'oshi.home': false }, values || {});
  return mount(Object.assign({
    apiPrefs: prefsFixture({ values: v }),
    apiOshiGet: oshiAs(who, v['oshi.char']),
    apiOshiImage: (charId, state) => ({ charId: 0, state, sha: 'e'.repeat(64), dataUrl: PNG_URL }),
    apiOshiDefaultImage: (char, style, state) => ({ char, style, state, dataUrl: defaultUrl(char, style, state) }),
    apiPrefSet: (key, value) => prefsFixture({ values: Object.assign({}, v, { [key]: value }) }),
  }, over || {}));
}

function openPage() {
  document.getElementById('me-btn').click();
  [...document.querySelectorAll('#me-body button')].find((b) => b.textContent === '推し').click();
  return document.querySelector('.oshi-page');
}

const picker = () => document.querySelector('[data-pref="oshi.char"]');
const cards = () => [...picker().querySelectorAll('.oshi-choice')];
const openSettings = () => document.querySelector('.nav-item[data-tab="settings"]').click();

describe('みんなに公開する', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('ほかの人の「使うキャラ」に、自分のキャラのあとで「みんなのキャラ」として作った人の名前つきで並び、絵は公開の名指しで取る', () => {
    const app = mountAs('b');
    openSettings();
    const { char } = srv();
    expect(cards().map((b) => b.dataset.char)).toEqual(['builtin:taku', 'builtin:itsuki', 'mine:1', char]);
    const luna = cards()[3];
    expect(luna.querySelector('.oshi-choice-name').textContent).toBe('ルナ');
    expect(luna.querySelector('.oshi-choice-kind').textContent).toBe('みんなのキャラ ・ テストのエー さん');
    expect(luna.querySelector('img').getAttribute('src')).toBe(PNG_URL);
    expect(app.calls.filter((c) => c.name === 'apiOshiImage').map((c) => c.args)).toEqual([[char, 'idle']]);
    // 押すと apiPrefSet で選ぶ (書くのはここだけ)
    luna.click();
    expect(app.calls.filter((c) => c.name === 'apiPrefSet').map((c) => c.args)).toEqual([['oshi.char', char]]);
  });

  it('借りているキャラは「◯◯ さんのキャラを使っています」と出し、直す欄は自分のキャラのぶんだけ。吹き出しも借りたキャラで出る', () => {
    const { char } = srv();
    const app = mountAs('b', { 'oshi.char': char });
    const page = openPage();
    expect(page.querySelector('.oshi-using').textContent).toContain('ルナ');
    expect(page.querySelector('.oshi-borrowed').textContent).toContain('テストのエー さんのキャラを使っています');
    // 頁の顔は、作った人が入れたふつうの絵 (公開の名指しで取る)
    expect(page.querySelector('.oshi-hero-figure img').getAttribute('src')).toBe(PNG_URL);
    expect(app.calls.filter((c) => c.name === 'apiOshiImage').map((c) => c.args)).toContainEqual([char, 'idle']);
    // 直す欄は自分のキャラ (ソラ) のもので、ルナの名前は欄に入らない
    expect(page.querySelector('.oshi-name-input').value).toBe('ソラ');
    expect([...page.querySelectorAll('.oshi-profile .oshi-h')].map((h) => h.textContent)).toEqual(['ソラ の名前と口調']);
    // 済ませると、ルナのせりふとルナの絵 (公開の名指しで取る)
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list [aria-label$="を完了にする"]').click();
    const bubble = document.getElementById('oshi-bubble');
    expect(bubble.querySelector('.oshi-name').textContent).toBe('ルナ');
    expect(bubble.querySelector('.oshi-line').textContent).toBe('テストのルナのせりふ');
    expect(app.calls.filter((c) => c.name === 'apiOshiImage').every((c) => c.args[0] === char)).toBe(true);
  });

  it('作った人の頁: 切り替えでオンにするときは確かめ、オンなら「公開中」の札。オフは確かめずに止める', () => {
    const app = mountAs('a', { 'oshi.char': 'mine:1' });
    let page = openPage();
    const toggle = () => document.querySelector('.oshi-page .oshi-share-toggle');
    expect(toggle().getAttribute('role')).toBe('switch');
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    expect(page.querySelector('.oshi-profile .oshi-h .oshi-shared-pill').textContent).toBe('公開中');
    expect(page.querySelector('.oshi-mine-tab .oshi-shared-pill')).toBeTruthy();

    // 止める (確かめない)。使っていた人は最初のキャラに戻ると知らせる
    app.respond('apiOshiSetShared', (id, on) => ({ charId: id, shared: on }));
    toggle().click();
    expect(app.calls.filter((c) => c.name === 'apiOshiSetShared').map((c) => c.args)).toEqual([[1, false]]);
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    expect(document.querySelector('.oshi-page .oshi-shared-pill')).toBe(null);
    expect(document.getElementById('snackbar').textContent).toContain('使っていた人はタクに戻ります');

    // オンにする前に確かめる。やめれば送らない
    toggle().click();
    page = document.querySelector('.oshi-page');
    const strip = page.querySelector('.oshi-profile .confirm-strip');
    expect(strip.textContent).toContain('同じ入れ物を使う人が、このキャラを使うキャラとして選べます');
    expect(strip.textContent).toContain('作った人としてあなたの名前が出ます');
    [...strip.querySelectorAll('button')].find((b) => b.textContent === 'やめる').click();
    expect(app.calls.filter((c) => c.name === 'apiOshiSetShared').length).toBe(1);
    toggle().click();
    [...page.querySelectorAll('.confirm-strip button')].find((b) => b.textContent === '公開する').click();
    expect(app.calls.filter((c) => c.name === 'apiOshiSetShared').map((c) => c.args)).toEqual([[1, false], [1, true]]);
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector('.oshi-page .oshi-profile .oshi-shared-pill').textContent).toBe('公開中');
  });

  it('名前を決めていないキャラは公開の切り替えを押せない', () => {
    mountAs('a', { 'oshi.char': 'mine:1' });
    const page = openPage();
    [...page.querySelectorAll('.oshi-mine-tab')].find((b) => b.dataset.charId === '2').click();
    const p = document.querySelector('.oshi-page .oshi-profile');
    expect(p.dataset.charId).toBe('2');
    expect(p.querySelector('.oshi-share-toggle').disabled).toBe(true);
    expect(p.querySelector('.oshi-share').textContent).toContain('名前を決めると公開できます');
  });
});
