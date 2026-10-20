// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from './mount.js';

/*
 * 起動のときに付ける聞き手と、起動のときに取りに行くもの (js-init)。
 * 取れなかったときに黙って既定に倒すところも、倒した先で使えるかまで見る。
 */

const $ = (s) => document.querySelector(s);
const snack = () => (document.getElementById('snackbar') || { textContent: '' }).textContent;

describe('はじめの案内を畳む', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('見出しを押すと畳み、もう一度押すと開く。畳んだことを覚えている', () => {
    mount();
    const toggle = $('#guideline-toggle');
    toggle.click();
    expect($('#guideline-body').hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.querySelector('.guideline-mark').textContent).toBe('▸');
    expect(window.localStorage.getItem('guideline')).toBe('closed');

    toggle.click();
    expect($('#guideline-body').hidden).toBe(false);
    expect(toggle.querySelector('.guideline-mark').textContent).toBe('▾');
    expect(window.localStorage.getItem('guideline')).toBe('open');
  });

  it('畳んだまま開き直すと、畳んだ形で出る', () => {
    window.localStorage.setItem('guideline', 'closed');
    mount();
    expect($('#guideline-body').hidden).toBe(true);
  });

  it('端末が覚えられなくても畳める', () => {
    mount();
    const set = window.localStorage.setItem;
    window.localStorage.setItem = () => { throw new Error('quota'); };
    try {
      $('#guideline-toggle').click();
      expect($('#guideline-body').hidden).toBe(true);
    } finally {
      window.localStorage.setItem = set;
    }
  });
});

describe('「改訂版を作る」(改訂中の版の画面)', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('文書を開いていなければ、先に選ぶよう言って文書の一覧へ移す', () => {
    const app = mount();
    $('.nav-item[data-tab="branches"]').click();
    $('#branch-create-btn').click();
    expect(snack()).toContain('先に文書を選んでください');
    expect($('#panel-docs').hidden).toBe(false);
    expect(app.calls.some((c) => c.name === 'apiBranchCreate')).toBe(false);
  });

  it('文書を開いていれば、その文書の改訂版の画面で作る欄を開く', () => {
    mount();
    $('.nav-item[data-tab="docs"]').click();
    $('.doc-open').click();
    $('.nav-item[data-tab="branches"]').click();
    $('#branch-create-btn').click();
    expect($('#panel-drafts').hidden).toBe(false);
    expect($('#side-title').textContent).toBe('この文書の改訂版を作る');
  });
});

describe('起動のときに取るものが取れなかったら', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('優先度の一覧が取れなくても、画面の控えの並びで作れる', () => {
    mount({ apiIssuePriorities: new Error('混み合っています') });
    $('.nav-item[data-tab="issues"]').click();
    $('#issue-create-btn').click();
    const opts = [...document.querySelectorAll('#side-body select[name="priority"] option')].map((o) => o.value);
    expect(opts.length).toBeGreaterThan(1);
    expect(opts).toContain('normal');
  });

  it('サーバの優先度の一覧が届けば、その並びで出す', () => {
    mount({ apiIssuePriorities: [['urgent', '至急'], ['normal', 'ふつう']] });
    $('.nav-item[data-tab="issues"]').click();
    $('#issue-create-btn').click();
    expect([...document.querySelectorAll('#side-body select[name="priority"] option')].map((o) => o.textContent))
      .toEqual(['至急', 'ふつう']);
  });

  it('名前・名簿・ひな形・札・置き場の日数が取れなくても、画面は組める', () => {
    const fail = new Error('取れません');
    mount({
      apiPeopleNames: fail, apiKnownPeople: fail, apiTemplateList: fail, apiTagList: fail,
      apiArchiveKeepDays: fail, apiTallyScope: fail, apiWhoAmI: fail, apiKitStatus: fail,
    });
    // 名前が無ければアドレスの手前で出す
    $('.nav-item[data-tab="issues"]').click();
    expect($('#issue-list').textContent).toContain('通勤手当の見直し');
    expect($('#issue-list').textContent).not.toContain('山田 太郎');
  });

  it('道具が古ければ、自分の欄に知らせる', () => {
    mount({ apiKitStatus: { print: 'new', mine: 'old', outdated: true } });
    $('#me-btn').click();
    expect($('#me-panel').textContent).toMatch(/道具/);
  });
});

describe('知らせの窓', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('ベルで開け閉めでき、閉じるボタンでも閉じる', () => {
    mount();
    const bell = $('#bell-btn');
    bell.click();
    expect($('#notice-panel').hidden).toBe(false);
    expect(bell.getAttribute('aria-expanded')).toBe('true');
    bell.click();
    expect($('#notice-panel').hidden).toBe(true);

    bell.click();
    $('#notice-close').click();
    expect($('#notice-panel').hidden).toBe(true);
    expect(bell.getAttribute('aria-expanded')).toBe('false');
  });

  it('デスクトップ通知の許可を頼めなくても、ボタンの形を描き直す', () => {
    mount();
    const keep = window.Notification;
    window.Notification = { permission: 'default', requestPermission: () => { throw new Error('no'); } };
    try {
      $('#bell-btn').click();
      expect(() => $('#notice-desktop').click()).not.toThrow();
    } finally {
      window.Notification = keep;
    }
  });
});

describe('どこからでも Escape', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('右のペインが開いていれば閉じる', () => {
    mount();
    $('.nav-item[data-tab="issues"]').click();
    $('#issue-create-btn').click();
    expect($('#side-panel').hidden).toBe(false);
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    expect($('#side-panel').hidden).toBe(true);
  });

  it('Escape 以外のキーでは何もしない', () => {
    mount();
    $('.nav-item[data-tab="issues"]').click();
    $('#issue-create-btn').click();
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a' }));
    expect($('#side-panel').hidden).toBe(false);
  });
});

describe('自分だけ・期限切れだけの絞り込み', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('「自分の」を押すと、担当が自分のものだけになる。もう一度押すと戻る', () => {
    mount({ apiWhoAmI: { activeUser: 'me@example.com', effectiveUser: 'me@example.com', sameUser: true } });
    $('.nav-item[data-tab="issues"]').click();
    const mine = $('#mine-btn');
    const count = () => document.querySelectorAll('#issue-list .row-item').length;
    const all = count();
    mine.click();
    expect(mine.getAttribute('aria-checked') || mine.getAttribute('aria-pressed')).toBe('true');
    expect(count()).toBeLessThan(all);
    mine.click();
    expect(count()).toBe(all);
  });
});
