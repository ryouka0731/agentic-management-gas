// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { mountApp, DEFAULTS } from '../dom.js';
import { mount } from './mount.js';

/*
 * Gemini のメモの取り込み (js-calendar の makeMeetingNotesPanel / meetingNotesAuto)。
 * 手で押すのは設定の「予定に入れる」の節 (予定に入れるがオフでも出す)。開いたときの急がない波で1日1回、裏でも取り込む。
 */

const $ = (s) => document.querySelector(s);
const callsOf = (app, name) => app.calls.filter((c) => c.name === name);
const snack = () => (document.getElementById('snackbar') || { textContent: '' }).textContent;

const DONE = { ok: true, reason: '', skipped: false, found: 2, notes: 1, created: 2, already: 1, unmatched: 1,
  items: [{ number: 41, title: '見積もりを直す', assignee: 'a@example.com' }, { number: 42, title: '資料を送る', assignee: '' }] };

describe('Gemini のメモを取り込む', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('設定の予定に入れるの節にボタンがあり (オフでも)、押すと7日ぶんを取り込んで件数を帯で出す', () => {
    const app = mount();
    $('.nav-item[data-tab="settings"]').click();
    const btn = $('#meeting-notes .meeting-notes-import');
    expect(btn.textContent).toBe('Gemini のメモを取り込む');
    app.respond('apiMeetingNotesImport', DONE);
    btn.click();
    const calls = callsOf(app, 'apiMeetingNotesImport');
    expect(calls[calls.length - 1].args).toEqual([7]);
    expect(snack()).toContain('1 件のメモから 2 個のやることを作りました (1 件は取り込み済み)');
    expect(btn.disabled).toBe(false);
    const items = [...document.querySelectorAll('#meeting-notes .meeting-notes-item')].map((b) => b.textContent);
    expect(items).toEqual(['#41 見積もりを直す', '#42 資料を送る']);
    expect($('#meeting-notes .meeting-notes-result').textContent).toContain('予定に結び付かなかったメモが 1 件');
  });

  it('メモが無い (個人の Gmail など) ときは、見つからなかったと出す', () => {
    const app = mount();
    $('.nav-item[data-tab="settings"]').click();
    app.respond('apiMeetingNotesImport', Object.assign({}, DONE, { found: 0, notes: 0, created: 0, already: 0, unmatched: 0, items: [] }));
    $('#meeting-notes .meeting-notes-import').click();
    expect(snack()).toContain('Gemini のメモは見つかりませんでした');
  });

  it('探せなかったときは理由を帯で出し、ボタンを戻す', () => {
    const app = mount();
    $('.nav-item[data-tab="settings"]').click();
    app.respond('apiMeetingNotesImport', { ok: false, reason: 'Drive を探せませんでした。少し待ってからもう一度押してください' });
    const btn = $('#meeting-notes .meeting-notes-import');
    btn.click();
    expect(snack()).toContain('Drive を探せませんでした');
    expect(btn.disabled).toBe(false);
  });

  it('開いたときに1回だけ裏で取り込み ({auto: true})、作ったときだけ帯で知らせる', () => {
    const app = mount({ apiMeetingNotesImport: DONE });
    const calls = callsOf(app, 'apiMeetingNotesImport');
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual([7, { auto: true }]);
    expect(snack()).toContain('Gemini のメモから 2 個のやることを作りました');
  });

  it('その日にもう取り込んでいれば (skipped) 何も出さない。失敗しても画面は使える', () => {
    mount();
    expect(snack()).not.toContain('Gemini');
    const broken = mount({ apiMeetingNotesImport: new Error('混み合っています') });
    expect(callsOf(broken, 'apiMeetingNotesImport')).toHaveLength(1);
    expect(snack()).not.toContain('混み合っています');
  });

  it('文書のリンクで開いたときは取り込まない', () => {
    const app = mountApp(Object.assign({}, DEFAULTS), { link: { doc: 'DOC1' } });
    expect(callsOf(app, 'apiMeetingNotesImport')).toEqual([]);
  });
});
