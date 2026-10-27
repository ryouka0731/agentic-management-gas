// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { prefsFixture } from '../dom.js';
import { mount } from './mount.js';

/*
 * 左上のロゴ (印と名前) を押すと、自分の設定 nav.logo の画面へ移る (やること #106)。既定はホーム。
 */
const logo = () => document.querySelector('#brand .brand-home');
const shown = (tab) => !document.getElementById('panel-' + tab).hidden;
const key = (el, k, opts) => {
  const e = new window.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, opts || {}));
  el.dispatchEvent(e);
  return e;
};

describe('ロゴを押したときに開く画面', () => {
  it('既定ではホームへ。押せる形 (link・Tab で届く) で、行き先を読み上げる', () => {
    mount();
    document.querySelector('.nav-item[data-tab="issues"]').click();
    expect(shown('home')).toBe(false);
    expect(logo().getAttribute('role')).toBe('link');
    expect(logo().tabIndex).toBe(0);
    expect(logo().getAttribute('aria-label')).toMatch(/ホームへ$/);
    logo().click();
    expect(shown('home')).toBe(true);
  });

  it('設定を変えればその画面へ。読み上げの字も行き先に合わせる', () => {
    mount({ apiPrefs: prefsFixture({ values: { 'nav.logo': 'pulls' } }) });
    expect(logo().getAttribute('aria-label')).toMatch(/確認依頼へ$/);
    logo().click();
    expect(shown('pulls')).toBe(true);
    expect(shown('home')).toBe(false);
  });

  it('Enter でも Space でも動く。Space は画面を流さず、押しっぱなしでは移り直さない', () => {
    mount({ apiPrefs: prefsFixture({ values: { 'nav.logo': 'issues' } }) });
    expect(key(logo(), 'Enter').defaultPrevented).toBe(true);
    expect(shown('issues')).toBe(true);

    document.querySelector('.nav-item[data-tab="home"]').click();
    expect(key(logo(), ' ').defaultPrevented).toBe(true);
    expect(shown('issues')).toBe(true);

    document.querySelector('.nav-item[data-tab="home"]').click();
    key(logo(), 'Enter', { repeat: true });
    expect(shown('home')).toBe(true);
    key(logo(), 'a');
    expect(shown('home')).toBe(true);
  });

  it('行き先が隠れている画面 (スクラムがオフ) ならホームへ', () => {
    mount({ apiPrefs: prefsFixture({ values: { 'nav.logo': 'sprint' } }) });
    document.querySelector('.nav-item[data-tab="issues"]').click();
    logo().click();
    expect(shown('home')).toBe(true);
  });

  it('設定の画面で選ぶと、そのまま行き先が変わる', () => {
    const app = mount();
    document.querySelector('.nav-item[data-tab="settings"]').click();
    const sel = document.querySelector('[data-pref="nav.logo"] select');
    expect(Array.from(sel.options).map((o) => o.value)).toEqual(['home', 'issues', 'pulls']);
    sel.value = 'issues';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    expect(app.calls.filter((c) => c.name === 'apiPrefSet').pop().args).toEqual(['nav.logo', 'issues']);
    expect(logo().getAttribute('aria-label')).toMatch(/やることへ$/);
    logo().click();
    expect(shown('issues')).toBe(true);
  });
});
