// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { mountFullstack, createServer, go, click, byText, OWNER } from './fullstack.js';

/*
 * 集中のしかたを通しで: 設定でオンにする → 今から始める → やりとりを書く → 「始めた」になる →
 * 終わった (完了にする) → 自分まわりの技の図鑑に出る。返事は本物のサーバが返す。
 */

const $ = (s) => document.querySelector(s);
const LONG = 30000;

describe('今から始めて、やりきるまで', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('始める → やりとり → 始めた → 終わった → 図鑑に技が出る', async () => {
    const server = createServer();
    server.fake._setUser(OWNER);
    const n = server.ctx.apiIssueCreate('慶弔規程の見直し', '', []).number;

    const e2e = mountFullstack({ server });
    await e2e.settle();

    // 1. 設定の「集中のしかた」でオンにする (既定はオフなので、入口はまだ無い)
    go('issues'); await e2e.settle();
    expect($('.focus-start-btn')).toBe(null);
    go('settings'); await e2e.settle();
    click($('[data-pref="focus.start"] button[role="switch"]')); await e2e.settle();

    // 2. 一覧の行から「今から始める」。長さを選んで、一手は書かずに始める
    go('issues'); await e2e.settle();
    click($('#issue-list [aria-label="#' + n + ' を今から始める"]'));
    click($('#focus-dock .seg[data-minutes="25"]'));
    click($('#focus-dock .focus-go')); await e2e.settle();
    expect($('#focus-dock').classList.contains('is-running')).toBe(true);
    expect($('#focus-dock .focus-left').textContent).toBe('25');
    let row = e2e.rows('focus_sessions')[0];
    expect(Number(row.plannedMinutes)).toBe(25);
    expect(row.provedAt).toBeFalsy();
    expect($('#focus-dock .focus-proved')).toBe(null);

    // 3. やりとりを書くと、台帳に手が見つかって「始めた」になる
    click(byText('#issue-list .row-open', '慶弔規程の見直し')); await e2e.settle();
    $('#side-panel .comment-form textarea').value = '弔事の日数から確かめる';
    click($('#side-panel .comment-form .btn-primary')); await e2e.settle();
    expect($('#focus-dock .focus-proved').textContent).toBe('始めた');
    row = e2e.rows('focus_sessions')[0];
    expect(row.proofKind).toBe('comment');
    expect(row.provedAt).toBeTruthy();

    // 4. 終わった (完了にする): やることが完了になり、集中は「やりきった」で終わる
    click($('#focus-dock .focus-done')); await e2e.settle();
    expect($('#focus-dock')).toBe(null);
    expect(e2e.rows('issues').find((i) => Number(i.number) === n).state).toBe('closed');
    row = e2e.rows('focus_sessions')[0];
    expect(row.result).toBe('done');
    expect(row.endedAt).toBeTruthy();

    // 5. 自分まわりの「集中の記録と技の図鑑」に、得た技が出る。まだのものは ???
    click($('#me-btn'));
    click($('.focus-record-btn')); await e2e.settle();
    const names = [...document.querySelectorAll('#side-panel .focus-badge-name')].map((el) => el.textContent);
    expect(names).toContain('電光石火');
    expect(names).toContain('やりきった');
    expect(names).toContain('???');
    expect($('#side-panel .focus-week').textContent).toContain('1');
    expect(e2e.failures).toEqual([]);
  }, LONG);

  it('ほかの人の画面には、あなたの集中は出ない', async () => {
    const server = createServer();
    server.fake._setUser(OWNER);
    server.ctx.apiPrefSet('focus.start', true);
    const n = server.ctx.apiIssueCreate('見直し', '', []).number;
    server.ctx.apiFocusStart(n, 25, '第3条を開く', '');

    const other = mountFullstack({ server, user: 'b@example.com' });
    await other.settle();
    // ほかの人は設定がオフのまま: 入口も、続いている集中も出ない
    go('issues'); await other.settle();
    expect($('.focus-start-btn')).toBe(null);
    expect($('#focus-dock')).toBe(null);
    // サーバも、名指しされても断る (オンにしていても、ほかの人の記録は扱えない)
    server.fake._setUser('b@example.com');
    server.ctx.apiPrefSet('focus.start', true);
    let err = null;
    window.google.script.run.withFailureHandler((e) => { err = e; }).apiFocusEnd(1, 'stopped');
    await other.settle();
    expect(err.message).toContain('ほかの人の集中の記録');
  }, LONG);
});
