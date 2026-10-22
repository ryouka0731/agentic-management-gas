// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createServer, mountFullstack, go, click, byText, OWNER } from './fullstack.js';

/*
 * 完了にしたやることを、右の読む形から「完了を取り消す」で戻し、そのまま「今から始める」まで通す。
 */

const $ = (s) => document.querySelector(s);
const LONG = 30000;

describe('完了を取り消してから始める', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('読む形から取り消す → 一覧が対応中になる → 今から始めるが出て、始められる', async () => {
    const server = createServer();
    server.fake._setUser(OWNER);
    const n = server.ctx.apiIssueCreate('慶弔規程の見直し', '', []).number;
    server.ctx.apiIssueClose(n);
    expect(server.ctx.dbReadAll('issues')[0].state).toBe('closed');

    const e2e = mountFullstack({ server });
    await e2e.settle();

    // 集中のしかたをオンにする
    go('settings'); await e2e.settle();
    click($('[data-pref="focus.start"] button[role="switch"]')); await e2e.settle();

    // 一覧には完了として出て、「今から始める」は無い
    go('issues'); await e2e.settle();
    expect($('#issue-list').textContent).toContain('完了');
    expect($('#issue-list [aria-label="#' + n + ' を今から始める"]')).toBe(null);

    // 読む形から「完了を取り消す」
    click(byText('#issue-list .row-open', '慶弔規程の見直し')); await e2e.settle();
    expect($('#side-title').textContent).toBe('やること #' + n);
    click(byText('#side-body .btn', '完了を取り消す')); await e2e.settle();

    expect(e2e.failures).toEqual([]);
    expect(e2e.snacks).toContain('#' + n + ' をやることに戻しました閉じる');
    expect(e2e.rows('issues')[0].state).toBe('open');
    expect($('#issue-list').textContent).toContain('対応中');

    // そのまま「今から始める」
    const start = $('#issue-list [aria-label="#' + n + ' を今から始める"]');
    expect(start).toBeTruthy();
    click(start);
    click($('#focus-dock .seg[data-minutes="25"]'));
    click($('#focus-dock .focus-go')); await e2e.settle();
    expect(e2e.failures).toEqual([]);
    expect($('#focus-dock').classList.contains('is-running')).toBe(true);
  }, LONG);

  it('一覧の行の矢印からも取り消せる', async () => {
    const server = createServer();
    server.fake._setUser(OWNER);
    const n = server.ctx.apiIssueCreate('慶弔規程の見直し', '', []).number;
    server.ctx.apiIssueClose(n);

    const e2e = mountFullstack({ server });
    await e2e.settle();
    go('issues'); await e2e.settle();
    click($('#issue-list [aria-label="#' + n + ' の完了を取り消す"]')); await e2e.settle();
    expect(e2e.failures).toEqual([]);
    expect(e2e.rows('issues')[0].state).toBe('open');
  }, LONG);
});
