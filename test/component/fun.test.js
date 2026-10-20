// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prefsFixture } from '../dom.js';
import { mount } from './mount.js';

/*
 * 楽しい演出 (js-fun)。自分の設定の fun.combo / fun.words / fun.cheer をオンにした人の画面にだけ出す。
 * 打った字・カーソル・フォーカスには触らない。
 */

const ALL_ON = { 'fun.combo': true, 'fun.words': true, 'fun.cheer': true };

function mountFun(values, over) {
  return mount(Object.assign({ apiPrefs: prefsFixture({ values: values || {} }) }, over || {}));
}

/** 本文の欄を1つ足して、そこに打つ */
function field(tag) {
  const el = document.createElement(tag || 'textarea');
  document.body.appendChild(el);
  el.focus();
  return el;
}

function typeChar(el, ch, opts) {
  el.value += ch;
  el.dispatchEvent(new window.InputEvent('input', Object.assign({
    bubbles: true, inputType: 'insertText', data: ch, isComposing: false,
  }, opts || {})));
}

function typeText(el, text) {
  [...text].forEach((ch) => typeChar(el, ch));
}

function del(el) {
  el.value = el.value.slice(0, -1);
  el.dispatchEvent(new window.InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
}

const layer = () => document.getElementById('fun-layer');
const combo = () => layer() && layer().querySelector('.fun-combo');
const banners = () => (layer() ? [...layer().querySelectorAll('.fun-banner')].map((b) => b.textContent) : []);

describe('楽しい演出', () => {
  let savedMatch;
  beforeEach(() => {
    window.localStorage.clear();
    savedMatch = window.matchMedia;
  });
  afterEach(() => {
    window.matchMedia = savedMatch;
    vi.useRealTimers();
  });

  it('既定はオフ。打っても消しても何も出ず、重ねも作らない', () => {
    mountFun();
    const el = field();
    typeText(el, 'あいうえおかきくけこさしすせそ完成ありがとう');
    del(el);
    expect(layer()).toBe(null);
  });

  it('設定の画面のトグルで apiPrefSet を呼び、その場で効く', () => {
    const app = mountFun();
    document.querySelector('.nav-item[data-tab="settings"]').click();
    const box = document.querySelector('[data-pref="fun.combo"]');
    expect(box).toBeTruthy();
    const toggle = box.querySelector('button[role="switch"]');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    toggle.click();
    expect(app.calls.filter((c) => c.name === 'apiPrefSet').map((c) => c.args)).toEqual([['fun.combo', true]]);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    const el = field();
    typeText(el, 'abcde');
    expect(combo().hidden).toBe(false);
    expect(combo().dataset.combo).toBe('5');
  });

  it('3つとも「楽しい演出」の見出しの下に、自分の設定として並ぶ', () => {
    mountFun();
    document.querySelector('.nav-item[data-tab="settings"]').click();
    const mine = document.getElementById('settings-mine');
    ['fun.combo', 'fun.words', 'fun.cheer'].forEach((k) => {
      expect(mine.contains(document.querySelector('[data-pref="' + k + '"]'))).toBe(true);
    });
    expect([...mine.querySelectorAll('h3')].map((h) => h.textContent)).toContain('楽しい演出');
  });

  it('続けて打った数と段 (C → B → A → S) を出す', () => {
    mountFun({ 'fun.combo': true });
    const el = field();
    typeText(el, 'ab');
    // 少ないうちは出さない (重ねもまだ作らない)
    expect(layer()).toBe(null);
    typeText(el, 'cde');
    expect(combo().textContent).toBe('5 COMBO C');
    typeText(el, 'fghijkl');
    expect(combo().textContent).toBe('12 COMBO B');
    typeText(el, '12345678');
    expect(combo().dataset.grade).toBe('A');
    expect(combo().textContent).toBe('20 COMBO A');
    typeText(el, '1234567890');
    expect(combo().textContent).toBe('30 COMBO S');
  });

  it('10 と 30 で大きな字を出す', () => {
    mountFun({ 'fun.combo': true });
    const el = field();
    typeText(el, '123456789');
    expect(banners()).toEqual([]);
    typeChar(el, '0');
    expect(banners()).toContain('COMBO x10');
    typeText(el, '12345678901234567890');
    expect(banners()).toContain('ON FIRE x30');
    // 大きな字は同時に1つだけ
    expect(layer().querySelectorAll('.fun-big').length).toBe(1);
  });

  it('続けたあとで消すと COMBO BREAK を出し、数え直す', () => {
    mountFun({ 'fun.combo': true });
    const el = field();
    typeText(el, 'abcdef');
    del(el);
    expect(banners().some((t) => t.indexOf('COMBO BREAK') === 0 && t.includes('DEL'))).toBe(true);
    expect(combo().hidden).toBe(true);
    typeText(el, 'abc');
    expect(combo().dataset.combo).toBe('3');
  });

  it('少しだけ打って消したときは何も出さない', () => {
    mountFun({ 'fun.combo': true });
    const el = field();
    typeText(el, 'ab');
    del(el);
    expect(banners()).toEqual([]);
  });

  it('1.5秒打たないと数え直す', () => {
    vi.useFakeTimers();
    mountFun({ 'fun.combo': true });
    const el = field();
    typeText(el, 'abcd');
    expect(combo().hidden).toBe(false);
    vi.advanceTimersByTime(1600);
    expect(combo().hidden).toBe(true);
    typeText(el, 'abc');
    expect(combo().dataset.combo).toBe('3');
  });

  it('変換中は数えず、決めたときに字数ぶん数える', () => {
    mountFun({ 'fun.combo': true });
    const el = field();
    for (let i = 0; i < 8; i++) {
      el.dispatchEvent(new window.InputEvent('input', {
        bubbles: true, inputType: 'insertCompositionText', data: 'か', isComposing: true,
      }));
    }
    expect(layer()).toBe(null);
    el.value = 'かんせい';
    el.dispatchEvent(new window.CompositionEvent('compositionend', { bubbles: true, data: 'かんせい' }));
    expect(combo().dataset.combo).toBe('4');
  });

  it('探す欄・数の欄・合言葉の欄では出さない', () => {
    mountFun(ALL_ON);
    const search = document.getElementById('search-input');
    typeText(search, 'abcdefghijkl完成');
    const pw = field('input');
    pw.type = 'password';
    typeText(pw, 'abcdefghijkl完成');
    expect(layer()).toBe(null);
  });

  it('言葉に反応する (完成 → SHIPPED!、ありがとう → LOVE ♡、承認 → NICE!、締切 → HURRY!)', () => {
    mountFun({ 'fun.words': true });
    const el = field();
    typeText(el, 'ついに完成');
    expect(banners()).toContain('SHIPPED!');
    typeText(el, 'いつもありがとう');
    expect(banners()).toContain('LOVE ♡');
    typeText(el, 'これで承認');
    expect(banners()).toContain('NICE!');
    typeText(el, '明日が締切');
    expect(banners()).toContain('HURRY!');
    // 数のほうはオフのまま
    expect(combo().hidden).toBe(true);
  });

  it('言葉は変換を決めたときにも見る。オフなら反応しない', () => {
    mountFun({ 'fun.words': true });
    const el = field();
    el.value = 'だいすき好き';
    el.dispatchEvent(new window.CompositionEvent('compositionend', { bubbles: true, data: '好き' }));
    expect(banners()).toContain('LOVE ♡');

    mountFun({ 'fun.combo': true });
    const el2 = field();
    typeText(el2, '完成');
    expect(banners()).toEqual([]);
  });

  it('打った字・カーソル・フォーカスを動かさない。重ねは押せず読み上げにも載らない', () => {
    mountFun(ALL_ON);
    const el = field();
    typeText(el, 'ついに完成しました12345');
    expect(el.value).toBe('ついに完成しました12345');
    expect(el.selectionStart).toBe(el.value.length);
    expect(document.activeElement).toBe(el);
    const l = layer();
    expect(l.getAttribute('aria-hidden')).toBe('true');
    expect(l.hasAttribute('inert')).toBe(true);
    expect(l.querySelector('button, a, input, textarea, [tabindex]')).toBe(null);
    expect(l.contains(document.activeElement)).toBe(false);
  });

  it('打つのを止めない (既定の動きを取り消さない)', () => {
    mountFun(ALL_ON);
    const el = field();
    const ev = new window.InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: 'a' });
    el.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('済ませたらお祝い: やることを完了にすると CLEAR!', () => {
    mountFun({ 'fun.cheer': true });
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list [aria-label$="を完了にする"]').click();
    expect(banners()).toContain('CLEAR!');
  });

  it('失敗したときは祝わない', () => {
    mountFun({ 'fun.cheer': true }, { apiIssueClose: new Error('混み合っています') });
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list [aria-label$="を完了にする"]').click();
    expect(banners()).toEqual([]);
  });

  it('お祝いがオフなら、成功しても出さない', () => {
    mountFun({ 'fun.combo': true });
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list [aria-label$="を完了にする"]').click();
    expect(banners()).toEqual([]);
  });

  it('動きを減らす設定では、短い字の札だけを出す', () => {
    window.matchMedia = (q) => ({ matches: /reduce/.test(q), media: q, addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {} });
    mountFun(ALL_ON);
    const el = field();
    typeText(el, '1234567890');
    const big = layer().querySelectorAll('.fun-big, .fun-small');
    expect(big.length).toBe(0);
    const badges = [...layer().querySelectorAll('.fun-badge')].map((b) => b.textContent);
    expect(badges).toContain('COMBO x10');
    // 枠を光らせない
    expect(layer().querySelector('.fun-flash').classList.contains('is-on')).toBe(false);
  });

  it('オフに戻すと残っている数を隠す', () => {
    const app = mountFun({ 'fun.combo': true });
    const el = field();
    typeText(el, 'abcd');
    expect(combo().hidden).toBe(false);
    app.respond('apiPrefSet', () => prefsFixture({ values: {} }));
    document.querySelector('.nav-item[data-tab="settings"]').click();
    document.querySelector('[data-pref="fun.combo"] button[role="switch"]').click();
    expect(combo().hidden).toBe(true);
    typeText(el, 'abcdef');
    expect(combo().hidden).toBe(true);
  });
});
