// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { mountFullstack, createServer, go, click, type, choose, OWNER } from './fullstack.js';

/*
 * 目標を通しで: 管理者がオンにする → 本人が OKR (主な結果2つ) を立てて承認を頼む → 上長が承認する →
 * 本人がやることをつなぎ、完了にする → 進み具合と自動の見立てが上がる → 振り返りを書く → 上長が評価を付ける →
 * 期末のまとめを写す。返事は本物のサーバが返す。
 */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const LONG = 60000;
const MEMBER = 'member@example.com';
const BOSS = 'boss@example.com';

describe('目標を立ててから、期末のまとめまで', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('OKR を立てる → 承認 → やることを済ませる → 振り返り → 評価 → まとめ', async () => {
    const server = createServer();
    server.fake._setUser(OWNER);
    server.ctx.memberSet(MEMBER, BOSS, '山田');
    server.ctx.memberSet(BOSS, '', '佐藤');
    const n = server.ctx.apiIssueCreate('慶弔規程の見直し', '', []).number;
    server.ctx.apiIssueUpdate(n, { assignee: MEMBER });

    // 1. 管理者が設定の「チームの設定」でオンにする (既定はオフで、左に「目標」は無い)
    const admin = mountFullstack({ server });
    await admin.settle();
    expect($('#nav-goals').hidden).toBe(true);
    go('settings'); await admin.settle();
    click($('[data-pref="goals.enabled"] button[role="switch"]')); await admin.settle();
    expect($('#nav-goals').hidden).toBe(false);

    // 2. 本人が OKR を立てる。主な結果は「つないだやることの完了」と「数を入れる」
    const me = admin.as(MEMBER);
    await me.settle();
    go('goals'); await me.settle();
    click($('#goal-create-btn'));
    type($('.goal-title-input'), '手続きを速くする');
    type($('.goal-item-title-input'), '規程の見直しを済ませる');
    click($('.goal-item-add'));
    const second = $$('.goal-item-editor')[1];
    type(second.querySelector('.goal-item-title-input'), '問い合わせを減らす');
    choose(second.querySelector('.goal-item-measure'), 'number');
    type(second.querySelector('.goal-item-target'), '10');
    click($('.goal-save')); await me.settle();
    expect($('.goal-status').textContent).toBe('下書き');

    // 3. やることをつないで、承認を頼む
    click($('.goal-link-btn')); await me.settle();
    expect($('.goal-link').textContent).toContain('慶弔規程の見直し');
    click($('.goal-submit')); await me.settle();
    expect($('.goal-status').textContent).toBe('承認を待っています');
    expect(me.rows('notifications').some((r) => r.to === BOSS && r.kind === 'goal')).toBe(true);

    // 4. 上長が「承認を待つもの」から承認する
    const boss = me.as(BOSS);
    await boss.settle();
    go('goals'); await boss.settle();
    click($('[data-goal-view="pending"]')); await boss.settle();
    type($('.goal-decide-note'), '進めてください');
    click($('.goal-approve')); await boss.settle();
    expect(boss.rows('goals')[0].status).toBe('approved');

    // 5. 本人がやることを完了にし、今の値を入れる → 進み具合と見立てが上がる
    const me2 = boss.as(MEMBER);
    await me2.settle();
    go('goals'); await me2.settle();
    expect($('.goal-meter-num').textContent).toBe('0%');
    expect($('.goal-card').textContent).toContain('上長のひとこと: 進めてください');
    go('issues'); await me2.settle();
    server.fake._setUser(MEMBER);
    server.ctx.apiIssueClose(n);
    go('goals'); await me2.settle();
    expect($('.goal-meter-num').textContent).toBe('50%');
    type($('.goal-actual'), '4');
    click($('.goal-input .btn')); await me2.settle();
    // (1.0 + 0.4) / 2 = 0.7 → 狙いどおり
    expect($('.goal-meter-num').textContent).toBe('70%');
    expect($('.goal-auto').textContent).toContain('自動の見立て: 0.7');
    expect($('.goal-auto').textContent).toContain('狙いどおり');
    // 値を入れても承認し直しは要らない
    expect($('.goal-status').textContent).toBe('承認済み');

    // 6. 振り返りを書く
    click($('.goal-review-btn'));
    type($('.goal-note-form textarea'), '規程は直せた。問い合わせは4件減った');
    click($('.goal-note-form .btn-primary')); await me2.settle();

    // 7. 上長が評価を付ける (見立ては目安。決めるのは上長)
    const boss2 = me2.as(BOSS);
    await boss2.settle();
    go('goals'); await boss2.settle();
    click($('[data-goal-view="pending"]')); await boss2.settle();
    expect($('.goal-card').textContent).toContain('規程は直せた');
    choose($('.goal-grade-select'), 'A');
    type($('.goal-grade-note'), '手続きが目に見えて速くなった');
    click($('.goal-grade-btn')); await boss2.settle();
    const row = boss2.rows('goals')[0];
    expect(row.status).toBe('closed');
    expect(row.finalGrade).toBe('A');
    expect(String(row.autoScore)).toBe('0.7');

    // 8. 本人が期末のまとめを開く。評価と振り返りが1つの字に入っている
    const me3 = boss2.as(MEMBER);
    await me3.settle();
    go('goals'); await me3.settle();
    expect($('.goal-status').textContent).toBe('評価済み');
    expect($('.goal-edit')).toBe(null);
    click($('[data-goal-view="report"]')); await me3.settle();
    const text = $('.goal-report-text').textContent;
    expect(text).toContain('# 目標のまとめ: 手続きを速くする');
    expect(text).toContain('- 評価: A');
    expect(text).toContain('規程は直せた');
    expect(text).toContain('評価を決めるのは上長です');
    expect(me3.rows('notifications').filter((r) => r.to === MEMBER && r.kind === 'goal').length).toBe(2);
    [admin, me, boss, me2, boss2, me3].forEach((s) => expect(s.failures).toEqual([]));
  }, LONG);

  it('ほかの人には、左に目標があっても人の目標は出ない', async () => {
    const server = createServer();
    server.fake._setUser(OWNER);
    server.ctx.apiPrefSet('goals.enabled', true);
    server.ctx.memberSet(MEMBER, BOSS, '山田');
    server.fake._setUser(MEMBER);
    server.ctx.apiGoalSave({ kind: 'kpi', title: '見せない目標', items: [{ title: 'x', measure: 'check' }] });

    const other = mountFullstack({ server, user: 'other@example.com' });
    await other.settle();
    go('goals'); await other.settle();
    click($('[data-goal-view="team"]')); await other.settle();
    expect(document.body.textContent).not.toContain('見せない目標');
    click($('[data-goal-view="pending"]')); await other.settle();
    expect(document.body.textContent).not.toContain('見せない目標');
    expect(other.failures).toEqual([]);
  }, LONG);
});
