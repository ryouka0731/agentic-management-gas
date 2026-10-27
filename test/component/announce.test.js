// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { mountApp, DEFAULTS } from '../dom.js';
import { mount } from './mount.js';

/*
 * ホームのお知らせ・アンケート・案内 (js-announce) と、設定の画面の「お知らせ」の節 (管理者だけ)。
 * 返事の形はサーバの apiAnnouncement* (test/api/announcement.test.js) に合わせてある。
 */

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const names = (app) => app.calls.map((c) => c.name);

const POLL = { id: 3, kind: 'poll', title: '忘年会の日', body: 'どちらがよいですか\n<b>太字ではない</b>',
  options: ['12/20', '12/27'], startAt: '', endAt: '' };
const NOTICE = { id: 4, kind: 'notice', title: '健康診断', body: '11月に行います', options: [], startAt: '', endAt: '' };

/** 返事を止めておき、あとで返す */
function hold(value) {
  const box = { deliver: null };
  box.response = { later: (ok) => { box.deliver = () => ok(structuredClone(value)); } };
  return box;
}

describe('ホームのお知らせ', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('あなたの番の上に1枚だけ出す。本文は字のまま (タグにしない・改行を残す)', () => {
    mount({ apiAnnouncementNext: POLL });
    const card = $('#home-announce .announce-card');
    expect(card).not.toBe(null);
    // あなたの番より上
    expect($('#home-announce').nextElementSibling.id).toBe('home-turn');
    expect(card.querySelector('.home-section-head').textContent).toBe('アンケート');
    expect(card.querySelector('.announce-title').textContent).toBe('忘年会の日');
    expect(card.querySelector('.announce-text').textContent).toBe('どちらがよいですか\n<b>太字ではない</b>');
    expect(card.querySelector('b')).toBe(null);
    expect($$('#home-announce .announce-option').map((b) => b.textContent)).toEqual(['12/20', '12/27']);
    expect($('#home-announce .announce-close')).not.toBe(null);
  });

  it('急がない波で取る (最初の波の返事がそろうまで呼ばない)', () => {
    const summary = hold(DEFAULTS.apiHomeSummary);
    const app = mount({ apiHomeSummary: summary.response, apiAnnouncementNext: NOTICE });
    expect(names(app)).not.toContain('apiAnnouncementNext');
    expect($('#home-announce').textContent).toBe('');
    summary.deliver();
    expect(names(app).filter((n) => n === 'apiAnnouncementNext')).toHaveLength(1);
    expect($('#home-announce .announce-title').textContent).toBe('健康診断');
  });

  it('無ければ何も出さない (区画は空のまま隠れる)', () => {
    mount();
    expect($('#home-announce').children).toHaveLength(0);
  });

  it('選択肢を押すと答えを送り、ありがとうの一言でカードが消える', () => {
    const app = mount({ apiAnnouncementNext: POLL, apiAnnouncementReply: { id: 3, answer: '12/27', already: false } });
    $$('#home-announce .announce-option')[1].click();
    const sent = app.calls.filter((c) => c.name === 'apiAnnouncementReply');
    expect(sent).toHaveLength(1);
    expect(sent[0].args).toEqual([3, '12/27']);
    expect($('#home-announce').children).toHaveLength(0);
    expect($('#snackbar').textContent).toContain('ありがとう');
  });

  it('お知らせは「読んだ」で消える', () => {
    const app = mount({ apiAnnouncementNext: NOTICE, apiAnnouncementReply: { id: 4, answer: '', already: false } });
    $('#home-announce .announce-read').click();
    expect(app.calls.filter((c) => c.name === 'apiAnnouncementReply')[0].args).toEqual([4, '']);
    expect($('#home-announce').children).toHaveLength(0);
  });

  it('閉じると消える (閉じた印を送る。お礼は出さない)', () => {
    const app = mount({ apiAnnouncementNext: POLL, apiAnnouncementReply: { id: 3, answer: 'closed', already: false } });
    $('#home-announce .announce-close').click();
    expect(app.calls.filter((c) => c.name === 'apiAnnouncementReply')[0].args).toEqual([3, 'closed']);
    expect($('#home-announce').children).toHaveLength(0);
    expect($('#snackbar')).toBe(null);
  });

  it('送れなければカードを残し、ボタンを押せるように戻して断りを出す', () => {
    mount({ apiAnnouncementNext: POLL, apiAnnouncementReply: new Error('このお知らせはもう終わっています') });
    $$('#home-announce .announce-option')[0].click();
    expect($('#home-announce .announce-card')).not.toBe(null);
    $$('#home-announce button').forEach((b) => expect(b.disabled).toBe(false));
    expect($('#snackbar').textContent).toContain('終わっています');
  });

  it('文書のリンクで開いた画面では取らない・出さない', () => {
    const app = mountApp(Object.assign({}, DEFAULTS, { apiAnnouncementNext: POLL }), { link: { doc: 'DOC1' } });
    expect(names(app)).not.toContain('apiAnnouncementNext');
    expect($('#home-announce').children).toHaveLength(0);
  });
});

describe('設定の画面の「お知らせ」(管理者だけ)', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const LIST = { items: [
    { id: 3, kind: 'poll', title: '忘年会の日', body: '', options: ['12/20', '12/27'], startAt: '2026-11-01', endAt: '',
      counts: [{ option: '12/20', count: 2 }, { option: '12/27', count: 1 }], read: 0, closed: 1, total: 4,
      active: true, archived: false, createdAt: '2026-10-27T00:00:00.000Z' },
    { id: 1, kind: 'notice', title: '古いお知らせ', body: '', options: [], startAt: '', endAt: '',
      counts: [], read: 5, closed: 0, total: 5, active: false, archived: true, createdAt: '2026-10-01T00:00:00.000Z' },
  ] };

  function openSettings(over) {
    const app = mount(over);
    $('[data-tab="settings"]').click();
    return app;
  }

  it('一覧に答えの数を選択肢ごとに出す。終えたものには「終える」を出さない', () => {
    openSettings({ apiAnnouncementList: LIST });
    const box = $('#announce-settings');
    expect(box).not.toBe(null);
    const poll = box.querySelector('[data-announce-item="3"]');
    expect(poll.textContent).toContain('12/20: 2人');
    expect(poll.textContent).toContain('12/27: 1人');
    expect(poll.textContent).toContain('片づけた人 4人');
    expect(poll.querySelector('.announce-archive')).not.toBe(null);
    expect(box.querySelector('[data-announce-item="1"] .announce-archive')).toBe(null);
    expect(box.querySelector('[data-announce-item="1"]').textContent).toContain('終えた');
  });

  it('置く: 種類・題名・本文・選択肢・期間を送り、届いた一覧で描き直す', () => {
    const app = openSettings({ apiAnnouncementCreate: LIST });
    // 選択肢の欄はアンケートのときだけ
    expect($('#announce-options').closest('label').hidden).toBe(true);
    const kind = $('#announce-kind');
    kind.value = 'poll';
    kind.dispatchEvent(new Event('change'));
    expect($('#announce-options').closest('label').hidden).toBe(false);
    $('#announce-title').value = '忘年会の日';
    $('#announce-body').value = 'どちらが\nよいですか';
    $('#announce-options').value = '12/20\n12/27';
    $('#announce-start').value = '2026-11-01';
    $('#announce-create').click();
    const sent = app.calls.filter((c) => c.name === 'apiAnnouncementCreate');
    expect(sent).toHaveLength(1);
    expect(sent[0].args[0]).toEqual({ kind: 'poll', title: '忘年会の日', body: 'どちらが\nよいですか',
      options: '12/20\n12/27', startAt: '2026-11-01', endAt: '' });
    expect($('#announce-title').value).toBe('');
    expect($('[data-announce-item="3"]')).not.toBe(null);
  });

  it('終える: 番号を送り、届いた一覧で描き直す', () => {
    const done = { items: [Object.assign({}, LIST.items[0], { archived: true, active: false })] };
    const app = openSettings({ apiAnnouncementList: LIST, apiAnnouncementArchive: done });
    $('[data-announce-item="3"] .announce-archive').click();
    expect(app.calls.filter((c) => c.name === 'apiAnnouncementArchive')[0].args).toEqual([3]);
    expect($('[data-announce-item="3"] .announce-archive')).toBe(null);
  });

  it('管理者でなければ節を出さず、尋ねもしない', () => {
    const app = openSettings({ apiSettings: Object.assign({}, DEFAULTS.apiSettings, { canEdit: false }) });
    expect($('#announce-settings')).toBe(null);
    expect(names(app)).not.toContain('apiAnnouncementList');
  });
});
