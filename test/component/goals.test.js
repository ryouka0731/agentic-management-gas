// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { loadGasWith } from '../harness.js';
import { createFakeGas } from '../fakegas.js';
import { APP_SOURCES } from '../sources.js';
import { prefsFixture } from '../dom.js';
import { mount } from './mount.js';

/*
 * 目標 (js-goals)。左の「目標」・自分の目標・承認を待つもの・チーム・期末のまとめ・やることの詳細の「目標」。
 * 返事は本物のサーバ (疑似GAS) から作る。画面に数え方の写しを持たせないため (style.test.js と同じ)。
 */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const plain = (v) => JSON.parse(JSON.stringify(v));

const OWNER = 'tester@example.com';
const MEMBER = 'member@example.com';
const BOSS = 'boss@example.com';

const GOAL_APIS = ['apiGoalState', 'apiGoalMine', 'apiGoalSave', 'apiGoalDelete', 'apiGoalSubmit', 'apiGoalDecide',
  'apiGoalLink', 'apiGoalUnlink', 'apiGoalProgressInput', 'apiGoalReview', 'apiGoalGrade', 'apiGoalTeam',
  'apiGoalReport', 'apiGoalIssueLinks', 'apiGoalWithdraw', 'apiIssueList'];

/** 目標をオンにしたサーバ。MEMBER の上長は BOSS */
function server() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...APP_SOURCES);
  ctx.repoInit('agentic-management');
  fake._setUser(OWNER);
  ctx.apiPrefSet('goals.enabled', true);
  ctx.memberSet(MEMBER, BOSS, '山田');
  ctx.memberSet(BOSS, '', '佐藤');
  return { ctx, fake };
}

/** 画面をその人として組み、目標の口をサーバにつなぐ */
function open(srv, who, over) {
  const wire = {};
  GOAL_APIS.forEach((name) => {
    wire[name] = (...args) => {
      srv.fake._setUser(who);
      try {
        return plain(srv.ctx[name](...args));
      } catch (e) {
        return new Error(e.message);
      }
    };
  });
  const app = mount(Object.assign({ apiPrefs: prefsFixture({ values: { 'goals.enabled': true } }) }, wire, over || {}));
  return app;
}

function go() {
  $('.nav-item[data-tab="goals"]').click();
}

/** 字を入れる */
function type(el, text) {
  el.value = text;
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
}

/** 画面から OKR を立てる (2つの主な結果: つなぐ項目と数の項目) */
function createOkr() {
  $('#goal-create-btn').click();
  type($('.goal-title-input'), '手続きを速くする');
  type($('.goal-item-title-input'), '規程の見直しを済ませる');
  $('.goal-item-add').click();
  const rows = $$('.goal-item-editor');
  type(rows[1].querySelector('.goal-item-title-input'), '問い合わせを減らす');
  type(rows[1].querySelector('.goal-item-measure'), 'number');
  type(rows[1].querySelector('.goal-item-target'), '100');
  type(rows[1].querySelector('.goal-item-unit'), '件');
  $('.goal-save').click();
}

describe('目標の入口', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('オフ (既定) なら左に出ず、やることの詳細にも目標の欄が無い', () => {
    const app = mount();
    expect($('#nav-goals').hidden).toBe(true);
    $('.nav-item[data-tab="issues"]').click();
    $('#issue-list .row-item .row-open').click();
    expect($('#side-panel .issue-goals')).toBe(null);
    expect(app.calls.some((c) => /^apiGoal/.test(c.name))).toBe(false);
  });

  it('オンなら左に出て、開くと期を選べる', () => {
    const srv = server();
    open(srv, MEMBER);
    expect($('#nav-goals').hidden).toBe(false);
    go();
    expect($('#panel-goals').hidden).toBe(false);
    expect($('#page-title') ? $('#page-title').textContent : '目標').toBe('目標');
    const opts = [...$('#goal-period').options].map((o) => o.value);
    expect(opts).toContain(srv.ctx.apiGoalState().period);
    expect($('#goals .blank-state').textContent).toContain('この期の目標はまだありません');
  });
});

describe('自分の目標', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('立てて、項目を足して保存すると、カードに項目と見立てが出る', () => {
    const srv = server();
    open(srv, MEMBER);
    go();
    createOkr();
    const rows = srv.ctx.dbReadAll('goals');
    expect(rows).toHaveLength(1);
    expect(rows[0].who).toBe(MEMBER);
    const card = $('.goal-card');
    expect(card.querySelector('.goal-title').textContent).toBe('手続きを速くする');
    expect(card.querySelector('.goal-status').textContent).toBe('下書き');
    expect([...card.querySelectorAll('.goal-item-title')].map((e) => e.textContent))
      .toEqual(['規程の見直しを済ませる', '問い合わせを減らす']);
    expect(card.querySelector('.goal-auto').textContent).toContain('自動の見立て: 0.0');
    expect(card.textContent).toContain('評価を決めるのは上長です');
    // 届いていない数は「あと◯」で静かに添える
    expect(card.textContent).toContain('あと 100 件');
  });

  it('承認を頼むと状態が変わり、上長の画面の「承認を待つもの」で承認できる', () => {
    const srv = server();
    open(srv, MEMBER);
    go();
    createOkr();
    $('.goal-submit').click();
    expect($('.goal-status').textContent).toBe('承認を待っています');
    expect($('.goal-submit')).toBe(null);

    open(srv, BOSS);
    go();
    $('[data-goal-view="pending"]').click();
    const card = $('.goal-card');
    expect(card.textContent).toContain('山田');
    type(card.querySelector('.goal-decide-note'), 'よいと思います');
    card.querySelector('.goal-approve').click();
    expect(srv.ctx.dbReadAll('goals')[0].status).toBe('approved');
    expect($('#goals .blank-state').textContent).toContain('承認を待っている目標はありません');
  });

  it('差し戻すにはひとことが要る (書かないとサーバへ行かない)', () => {
    const srv = server();
    open(srv, MEMBER);
    go();
    createOkr();
    $('.goal-submit').click();
    const app = open(srv, BOSS);
    go();
    $('[data-goal-view="pending"]').click();
    $('.goal-return').click();
    expect(app.calls.some((c) => c.name === 'apiGoalDecide')).toBe(false);
    expect($('#snackbar').textContent).toContain('直してほしいこと');
  });

  it('やることをつなぎ、済ませると進み具合が上がる。今の値を入れると見立てが変わる', () => {
    const srv = server();
    srv.fake._setUser(OWNER);
    const n = srv.ctx.apiIssueCreate('第3条の見直し', '', []).number;
    srv.ctx.apiIssueUpdate(n, { assignee: MEMBER });
    open(srv, MEMBER);
    go();
    createOkr();
    const select = $('.goal-link-select');
    expect([...select.options].map((o) => o.textContent)).toEqual(['#' + n + ' 第3条の見直し']);
    $('.goal-link-btn').click();
    expect(srv.ctx.dbReadAll('goal_links')).toHaveLength(1);
    expect($('.goal-link').textContent).toContain('第3条の見直し');

    srv.fake._setUser(OWNER);
    srv.ctx.apiIssueClose(n);
    type($('.goal-actual'), '50');
    $('.goal-input .btn').click();
    const card = $('.goal-card');
    // (1.0 + 0.5) / 2
    expect(card.querySelector('.goal-meter-num').textContent).toBe('75%');
    expect(card.querySelector('.goal-auto').textContent).toContain('0.8');
    expect(card.textContent).toContain('あと 50 件');
  });

  it('外すと結び付きだけが消える', () => {
    const srv = server();
    srv.fake._setUser(OWNER);
    const n = srv.ctx.apiIssueCreate('A', '', []).number;
    srv.ctx.apiIssueUpdate(n, { assignee: MEMBER });
    open(srv, MEMBER);
    go();
    createOkr();
    $('.goal-link-btn').click();
    $('.goal-link .btn').click();
    expect(srv.ctx.dbReadAll('goal_links')).toHaveLength(0);
    expect(srv.ctx.issueGet(n).title).toBe('A');
  });

  it('下書きは確かめてから消せる', () => {
    const srv = server();
    open(srv, MEMBER);
    go();
    createOkr();
    $('.goal-delete').click();
    expect(srv.ctx.dbReadAll('goals')).toHaveLength(1);
    $('.confirm-strip .btn-primary').click();
    expect(srv.ctx.dbReadAll('goals')).toHaveLength(0);
  });

  it('承認済みを直すときは、もう一度承認が要ると断ってから保存する', () => {
    const srv = server();
    open(srv, MEMBER);
    go();
    createOkr();
    $('.goal-submit').click();
    srv.fake._setUser(BOSS);
    srv.ctx.apiGoalDecide(srv.ctx.dbReadAll('goals')[0].id, 'approve', '');
    open(srv, MEMBER);
    go();
    $('.goal-edit').click();
    expect($('.goal-editor').textContent).toContain('もう一度上長の承認を待ちます');
    type($('.goal-title-input'), '手続きをもっと速くする');
    $('.goal-save').click();
    expect($('.goal-status').textContent).toBe('承認を待っています');
    expect($('.goal-card').textContent).toContain('承認のあとに直したので');
  });
});

describe('期末', () => {
  beforeEach(() => { window.localStorage.clear(); });

  /** 承認まで進めた目標の id */
  function approved(srv) {
    srv.fake._setUser(MEMBER);
    const g = srv.ctx.apiGoalSave({ kind: 'mbo', title: '採用を進める', items: [
      { title: '面接', measure: 'number', target: 10, weight: 60 }, { title: '手引き', measure: 'check', weight: 40 }] });
    srv.ctx.apiGoalSubmit(g.id);
    srv.fake._setUser(BOSS);
    srv.ctx.apiGoalDecide(g.id, 'approve', '');
    return g.id;
  }

  it('できたに印を付け、振り返りを書き、上長が評価を付ける。見立ての段が既定に選ばれている', () => {
    const srv = server();
    const id = approved(srv);
    open(srv, MEMBER);
    go();
    $('.goal-check input').click();
    expect(srv.ctx.dbReadAll('goal_items').filter((i) => i.measure === 'check')[0].checked).toBe(true);
    $('.goal-review-btn').click();
    type($('.goal-note-form textarea'), '手引きは書けた。面接は次の期');
    $('.goal-note-form .btn-primary').click();
    expect(srv.ctx.goalGet_(id).selfReview).toBe('手引きは書けた。面接は次の期');

    open(srv, BOSS);
    go();
    $('[data-goal-view="pending"]').click();
    const card = $('.goal-card');
    expect(card.closest('.goal-section').querySelector('h3').textContent).toBe('期末の評価を付けるもの');
    // 40% → D
    expect(card.querySelector('.goal-grade-select').value).toBe('D');
    card.querySelector('.goal-grade-btn').click();
    expect(srv.ctx.goalGet_(id).status).toBe('approved');
    type(card.querySelector('.goal-grade-select'), 'C');
    type(card.querySelector('.goal-grade-note'), '手引きが助かった');
    card.querySelector('.goal-grade-btn').click();
    expect(srv.ctx.goalGet_(id).status).toBe('closed');
    expect(srv.ctx.goalGet_(id).finalGrade).toBe('C');
  });

  it('期末のまとめを写せる。写せないときは字を選んだままにする', () => {
    const srv = server();
    approved(srv);
    open(srv, MEMBER);
    go();
    $('.goal-report-btn').click();
    expect($('[data-goal-view="report"]').getAttribute('aria-pressed')).toBe('true');
    expect($('.goal-report-text').textContent).toContain('# 目標のまとめ: 採用を進める');
    const had = Object.prototype.hasOwnProperty.call(document, 'execCommand');
    const before = document.execCommand;
    try {
      document.execCommand = () => true;
      $('.goal-report-copy').click();
      expect($('#snackbar').textContent).toContain('写しました');
      document.execCommand = () => false;
      $('.goal-report-copy').click();
      expect($('#snackbar').textContent).toContain('写せませんでした');
    } finally {
      if (had) document.execCommand = before;
      else delete document.execCommand;
    }
  });
});

describe('チーム', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('上長には下の人の目標が名前の順で並び、ほかの人には何も出ない', () => {
    const srv = server();
    srv.fake._setUser(OWNER);
    srv.ctx.memberSet('a-member@example.com', BOSS, '青木');
    ['a-member@example.com', MEMBER].forEach((who, i) => {
      srv.fake._setUser(who);
      srv.ctx.apiGoalSave({ kind: 'kpi', title: '目標' + i, items: [{ title: 'x', measure: 'number', target: 10 }] });
    });
    open(srv, BOSS);
    go();
    $('[data-goal-view="team"]').click();
    const names = $$('.goal-team tbody th').map((th) => th.textContent);
    expect(names).toEqual(['山田', '青木'].sort());
    expect($('#goal-create-btn').hidden).toBe(true);

    open(srv, 'other@example.com');
    go();
    $('[data-goal-view="team"]').click();
    expect($('.goal-team')).toBe(null);
    expect($('#goals .blank-state').textContent).toContain('見られる目標はありません');
  });
});

describe('やることの詳細の「目標」', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('自分の項目につなぎ、つながった項目が出る', () => {
    const srv = server();
    srv.fake._setUser(OWNER);
    const n = srv.ctx.apiIssueCreate('慶弔規程', '', []).number;
    srv.ctx.apiIssueUpdate(n, { assignee: MEMBER });
    srv.fake._setUser(MEMBER);
    srv.ctx.apiGoalSave({ kind: 'okr', title: '規程を整える', items: [{ title: '見直しを済ませる', measure: 'issues' }] });
    open(srv, MEMBER);
    $('.nav-item[data-tab="issues"]').click();
    [...document.querySelectorAll('#issue-list .row-item .row-open')]
      .find((el) => el.textContent.indexOf('慶弔規程') > -1).click();
    const box = $('#side-panel .issue-goals');
    expect(box.textContent).toContain('どの目標にもつながっていません');
    expect([...box.querySelector('.issue-goal-select').options][0].textContent).toContain('規程を整える / 見直しを済ませる');
    box.querySelector('.issue-goal-link').click();
    expect(srv.ctx.dbReadAll('goal_links').map((l) => Number(l.issueNumber))).toEqual([n]);
    expect($('#side-panel .goal-linked').textContent).toContain('規程を整える / 見直しを済ませる');
    expect($('#side-panel .issue-goal-select')).toBe(null);
  });
});

describe('取り下げ・外したときの承認し直し', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('承認を待つあいだは取り下げられ、下書きに戻る', () => {
    const srv = server();
    open(srv, MEMBER);
    go();
    createOkr();
    $('.goal-submit').click();
    $('.goal-withdraw').click();
    expect($('.goal-status').textContent).toBe('下書き');
    expect(srv.ctx.dbReadAll('goals')[0].status).toBe('draft');
  });

  it('承認済みから済んだやることを外すと、もう一度承認を待つと知らせる', () => {
    const srv = server();
    srv.fake._setUser(OWNER);
    const n = srv.ctx.apiIssueCreate('A', '', []).number;
    srv.ctx.apiIssueUpdate(n, { assignee: MEMBER });
    open(srv, MEMBER);
    go();
    createOkr();
    $('.goal-link-btn').click();
    $('.goal-submit').click();
    srv.fake._setUser(BOSS);
    srv.ctx.apiGoalDecide(srv.ctx.dbReadAll('goals')[0].id, 'approve', '');
    srv.fake._setUser(OWNER);
    srv.ctx.apiIssueClose(n);
    open(srv, MEMBER);
    go();
    $('.goal-link .btn').click();
    expect($('#snackbar').textContent).toContain('もう一度上長の承認を待ちます');
    expect($('.goal-status').textContent).toBe('承認を待っています');
  });
});
