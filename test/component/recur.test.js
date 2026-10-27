// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from './mount.js';

/*
 * やることの頁の見え方「繰り返し」(js-recur。やること #110)。返事の形はサーバの apiRecurrence*
 * (test/recurrence.test.js) に合わせてある。
 */

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const MINE = {
  id: 1, title: '勤怠の締め', body: '', assignee: 'me@example.com', kind: 'monthly', weekday: '', day: 31, month: '',
  dueDays: 0, leadDays: 3, active: true, ruleText: '毎月31日 (無い月は末日)', nextOn: '2026-10-31', issueOn: '2026-10-28',
  lastIssuedFor: '', lastIssueNumber: '', createdBy: 'me@example.com', createdAt: '', canEdit: true,
};
const THEIRS = Object.assign({}, MINE, {
  id: 2, title: '<b>社会保険</b>', kind: 'yearly', month: 7, day: 10, ruleText: '毎年7月10日', nextOn: '2027-07-10',
  issueOn: '2027-07-07', lastIssueNumber: 12, createdBy: 'other@example.com', canEdit: false, active: false,
});

function openRecur(over) {
  const app = mount(Object.assign({ apiRecurrenceList: [MINE, THEIRS] }, over || {}));
  document.querySelector('.nav-item[data-tab="issues"]').click();
  $('#view-recur').click();
  return app;
}

describe('繰り返し', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('一覧に周期・次の対象日・作る日・前回の番号を出す。題名は字のまま', () => {
    openRecur();
    expect($('#recur-list').hidden).toBe(false);
    expect($('#issue-list').hidden).toBe(true);
    const rows = $$('#recur-list .recur-item');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('毎月31日 (無い月は末日)');
    expect(rows[0].textContent).toContain('次は 10月31日 の分 (10月28日 に作ります)');
    expect(rows[1].querySelector('.row-title').textContent).toBe('<b>社会保険</b>');
    expect(rows[1].querySelector('b')).toBe(null);
    expect(rows[1].textContent).toContain('止めています');
    expect(rows[1].textContent).toContain('前回 #12');
    // 絞り込みと束ね方は効かないので隠す
    expect($('#issue-filter').parentNode.hidden).toBe(true);
  });

  it('ほかの人が作ったものは、直す・止める・消すを押せない', () => {
    openRecur();
    const rows = $$('#recur-list .recur-item');
    expect(Array.from(rows[1].querySelectorAll('button')).every((b) => b.disabled)).toBe(true);
    expect(Array.from(rows[0].querySelectorAll('button')).some((b) => b.disabled)).toBe(false);
  });

  it('止めるを押すと active: false で送り、一覧を読み直す', () => {
    const app = openRecur({ apiRecurrenceUpdate: Object.assign({}, MINE, { active: false }) });
    const stop = Array.from($$('#recur-list .recur-item')[0].querySelectorAll('button'))
      .find((b) => b.textContent === '止める');
    const before = app.calls.filter((c) => c.name === 'apiRecurrenceList').length;
    stop.click();
    const sent = app.calls.find((c) => c.name === 'apiRecurrenceUpdate');
    expect(sent.args).toEqual([1, { active: false }]);
    expect(app.calls.filter((c) => c.name === 'apiRecurrenceList').length).toBe(before + 1);
  });

  it('作る欄は周期の種類に合わない欄を隠し、書いたものを送る', () => {
    const app = openRecur({ apiRecurrenceList: [], apiRecurrenceCreate: MINE });
    expect($('#recur-list').textContent).toContain('繰り返しのやることはまだありません');
    Array.from($$('#recur-list button')).find((b) => b.textContent === '繰り返しを作る').click();
    const form = $('#side-body form');
    const field = (n) => form.querySelector('[name="' + n + '"]');
    // 既定は毎月: 曜日と月は隠れる
    expect(field('weekday').parentNode.hidden).toBe(true);
    expect(field('month').parentNode.hidden).toBe(true);
    expect(field('day').parentNode.hidden).toBe(false);
    field('kind').value = 'weekly';
    field('kind').dispatchEvent(new window.Event('change'));
    expect(field('weekday').parentNode.hidden).toBe(false);
    expect(field('day').parentNode.hidden).toBe(true);
    field('kind').value = 'monthly';
    field('kind').dispatchEvent(new window.Event('change'));
    field('title').value = '勤怠の締め';
    field('day').value = '31';
    form.dispatchEvent(new window.Event('submit', { cancelable: true }));
    const sent = app.calls.find((c) => c.name === 'apiRecurrenceCreate');
    expect(sent.args[0]).toMatchObject({ title: '勤怠の締め', kind: 'monthly', day: '31', leadDays: '3', dueDays: '0' });
  });
});
