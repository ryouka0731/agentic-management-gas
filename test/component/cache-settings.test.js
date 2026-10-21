// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULTS } from '../dom.js';
import { mount } from './mount.js';

/*
 * 設定の画面の「台帳の読み取りの覚え」(管理者だけ)。押すと apiCacheClear を呼び、済んだら帯で知らせる。
 * サーバ側 (管理者だけが捨てられる) は test/db-cache.test.js が見る。
 */

const $ = (s) => document.querySelector(s);

function openSettings(over) {
  const app = mount(over);
  $('[data-tab="settings"]').click();
  return app;
}

describe('台帳の読み取りの覚え', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('管理者には欄を出し、押すと覚えを捨てて知らせる。押しているあいだは押せない', () => {
    const app = openSettings();
    const box = $('#cache-settings');
    expect(box).not.toBe(null);
    expect(box.textContent).toContain('5分');
    const btn = $('#cache-clear');
    btn.click();
    expect(app.calls.filter((c) => c.name === 'apiCacheClear')).toHaveLength(1);
    expect(btn.disabled).toBe(false);
    expect(document.body.textContent).toContain('覚えを捨てました');
  });

  it('管理者でなければ欄を出さない', () => {
    openSettings({ apiSettings: Object.assign({}, DEFAULTS.apiSettings, { canEdit: false }) });
    expect($('#cache-settings')).toBe(null);
  });

  it('断られたら知らせて、もう一度押せるように戻す', () => {
    openSettings({ apiCacheClear: new Error('読み取りの覚えを捨てることは、このアプリの管理者 (持ち主と、入れ物のフォルダを編集できる人) だけが行えます') });
    const btn = $('#cache-clear');
    btn.click();
    expect(btn.disabled).toBe(false);
    expect(document.body.textContent).toContain('覚えを捨てられませんでした');
  });
});
