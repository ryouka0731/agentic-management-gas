// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  mountFullstack, go, click, byText, type, fillSideForm, submitSideForm,
} from './fullstack.js';

/*
 * やることを作って、話して、ボードで動かして、終える。
 */

const $ = (s) => document.querySelector(s);
const LONG = 30000;

/** 列の見出しの字で列を探す */
function column(label) {
  return [...document.querySelectorAll('.board-column')]
    .find((c) => c.querySelector('h3').textContent.indexOf(label) === 0);
}

/** カードを掴んで、別の列に落とす (dragstart → drop)。どちらも同じ dataTransfer を運ぶ */
function dragCard(card, to) {
  const store = {};
  const dataTransfer = {
    setData: (k, v) => { store[k] = v; },
    getData: (k) => store[k] || '',
  };
  const start = new window.Event('dragstart', { bubbles: true });
  start.dataTransfer = dataTransfer;
  card.dispatchEvent(start);
  const drop = new window.Event('drop', { bubbles: true, cancelable: true });
  drop.dataTransfer = dataTransfer;
  drop.clientY = 0;
  to.dispatchEvent(drop);
}

describe('やることを最後まで進める', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('優先度と担当を付けて作る → 話す → ボードで動かす → 完了にする', async () => {
    const e2e = mountFullstack();
    await e2e.settle();

    // 1. 作る。担当は「@」で探して選ぶ (名簿はサーバの apiKnownPeople)
    go('issues'); await e2e.settle();
    click($('#issue-create-btn')); await e2e.settle();
    fillSideForm({ title: '慶弔規程の見直し', body: '弔事の日数を確かめる', priority: 'high' });
    type($('#side-body [name="assignee"]'), '@tes');
    click($('#side-body .assignee-picker .mention-option'));
    expect($('#side-body [name="assignee"]').value).toContain('@tester@example.com');
    submitSideForm(); await e2e.settle();

    expect(e2e.snacks).toContain('やることを作りました閉じる');
    const row = e2e.rows('issues')[0];
    expect(row.title).toBe('慶弔規程の見直し');
    expect(String(row.assignee)).toBe('tester@example.com');
    expect(String(row.priority)).toBe('high');
    expect($('#issue-list').textContent).toContain('慶弔規程の見直し');

    // 2. 開いて話す
    click($('#issue-list .row-item .row-open')); await e2e.settle();
    expect($('#side-title').textContent).toBe('やること #1');
    expect($('#side-body').textContent).toContain('弔事の日数を確かめる');
    type($('#side-body .comment-form textarea'), '人事に日数を確認します');
    click(byText('#side-body .comment-form .btn', '書き込む')); await e2e.settle();

    expect(e2e.snacks).toContain('書き込みました閉じる');
    expect(e2e.rows('issue_comments').map((c) => c.body)).toEqual(['人事に日数を確認します']);
    expect($('#side-body .issue-talk-list').textContent).toContain('人事に日数を確認します');

    // 3. ボードで「これから」から「作業中」へ動かす
    click($('#side-close'));
    click($('#view-board')); await e2e.settle();
    const card = [...column('これから').querySelectorAll('.board-card')]
      .find((c) => c.textContent.indexOf('慶弔規程の見直し') > -1);
    expect(card).toBeTruthy();
    dragCard(card, column('作業中')); await e2e.settle();

    expect(column('作業中').textContent).toContain('慶弔規程の見直し');
    expect(column('これから').textContent).not.toContain('慶弔規程の見直し');
    expect(e2e.rows('project_items').map((c) => c.column)).toEqual(['In Progress']);

    // 4. カードから開いて完了にする
    click([...column('作業中').querySelectorAll('.board-card')][0]); await e2e.settle();
    click(byText('#side-body .btn', '完了にする')); await e2e.settle();

    expect(e2e.rows('issues')[0].state).toBe('closed');
    expect(column('完了').textContent).toContain('慶弔規程の見直し');
    expect(e2e.failures).toEqual([]);
  }, LONG);
});
