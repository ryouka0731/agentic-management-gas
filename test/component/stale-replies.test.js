// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULTS, prefsFixture } from '../dom.js';
import { mount } from './mount.js';

/*
 * 続けて2回頼んだとき、先に頼んだぶんの返事があとから届いても、新しい描画を
 * 上書きしない (画面の latest(key) が見分ける)。
 *
 * どの一覧も「2回頼む → 新しいほうを先に返す → 古いほうを後から返す」で確かめる。
 * 頼んだ順に返すと、見分けていなくても最後に描くのは新しいほうになり、何も守らない。
 */
describe('遅れて届いた古い返事で、新しい一覧を描き直さない', () => {
  beforeEach(() => { window.localStorage.clear(); });

  /**
   * name の返事を預かる形にして trigger を2回呼ぶ。
   *
   * @returns {{older: object[], newer: object[]}} それぞれの回に頼んだぶんの返事の口
   */
  function askTwice(app, name, trigger) {
    const held = [];
    app.respond(name, () => ({ later: (ok, ng) => held.push({ ok, ng }) }));
    trigger();
    const first = held.length;
    trigger();
    const older = held.slice(0, first);
    const newer = held.slice(first);
    expect(older.length).toBeGreaterThan(0);
    expect(newer.length).toBeGreaterThan(0);
    return { older, newer };
  }

  /** 新しいほうを先に返し、古いほうを後から返す */
  function deliverOutOfOrder(t, newValue, oldValue) {
    t.newer.forEach((r) => r.ok(newValue));
    t.older.forEach((r) => r.ok(oldValue));
  }

  function retitle(list, title) {
    return list.map((i) => Object.assign({}, i, { title: title + i.number }));
  }

  function openIssuesView(view, over) {
    const app = mount(over);
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('view-' + view).click();
    return app;
  }

  it('やることの一覧', () => {
    const app = openIssuesView('list');
    const t = askTwice(app, 'apiIssueList', () => document.getElementById('view-list').click());
    deliverOutOfOrder(t, retitle(DEFAULTS.apiIssueList, '新しい'), retitle(DEFAULTS.apiIssueList, '古い'));

    const text = document.getElementById('issue-list').textContent;
    expect(text).toContain('新しい2');
    expect(text).not.toContain('古い');
  });

  it('古い返事が失敗でも、新しい一覧を消さない', () => {
    const app = openIssuesView('list');
    const t = askTwice(app, 'apiIssueList', () => document.getElementById('view-list').click());
    t.newer.forEach((r) => r.ok(retitle(DEFAULTS.apiIssueList, '新しい')));
    t.older.forEach((r) => r.ng(new Error('古い失敗')));

    const text = document.getElementById('issue-list').textContent;
    expect(text).toContain('新しい2');
    expect(text).not.toContain('古い失敗');
  });

  it('目標 (自分の目標)', () => {
    const goal = (title) => ({ period: '2026H2', periodLabel: '2026年度 下期', linkable: [], goals: [{
      id: 1, who: 'me@example.com', whoName: '私', mine: true, period: '2026H2', periodLabel: '2026年度 下期',
      kind: 'okr', kindLabel: 'OKR', title, status: 'draft', statusLabel: '下書き', changedAfterApproval: false,
      managerNote: '', selfReview: '', finalGrade: '', gradedBy: '', percent: 0, progress: 0,
      auto: { kind: 'okr', score: 0, percent: 0, grade: '', text: '0.0', note: '' },
      pace: { key: 'ok', label: '順調です', elapsed: 0 }, items: [],
      canEdit: true, canDelete: true, canSubmit: true, canInput: true, canReview: false, canDecide: false, canGrade: false,
    }] });
    const state = { enabled: true, period: '2026H2', periodLabel: '2026年度 下期', unit: 'half', fyStart: 4,
      periods: [{ key: '2026H2', label: '2026年度 下期' }], kinds: [], measures: [], grades: [], statuses: {} };
    const app = mount({ apiGoalState: state, apiPrefs: prefsFixture({ values: { 'goals.enabled': true } }) });
    document.querySelector('[data-tab="goals"]').click();
    const t = askTwice(app, 'apiGoalMine', () => document.querySelector('[data-goal-view="mine"]').click());
    deliverOutOfOrder(t, goal('新しい目標'), goal('古い目標'));

    const text = document.getElementById('goals').textContent;
    expect(text).toContain('新しい目標');
    expect(text).not.toContain('古い目標');
  });

  it('成果の数 (設定の画面)', () => {
    const app = mount();
    const weeks = (moved) => ({ minPeople: 3, since: '2026-10-01', weeks: [{ start: '2026-10-12', end: '2026-10-18',
      days: 7, people: 4, hidden: false, moved, closedClean: 0, mergedClean: 0, reopened: 0, busyErrors: 0,
      timeoutErrors: 0, overdue: 0, fxOff: 0 }] });
    document.querySelector('[data-tab="settings"]').click();
    // 同じ器 (#outcomes-body) に描き直す「読み込み直す」を2回押す
    const t = askTwice(app, 'apiOutcomes', () => document.getElementById('outcomes-refresh').click());
    deliverOutOfOrder(t, weeks(7), weeks(1));
    expect(document.querySelector('[data-outcome="moved"] .outcome-now').textContent).toBe('先週 7');
    expect(document.querySelectorAll('#outcomes-body .outcome-row')).toHaveLength(8);
  });

  it('進捗ボード', () => {
    const app = openIssuesView('board');
    const card = (title) => ({
      Backlog: [Object.assign({}, DEFAULTS.apiProjectBoard.Backlog[0], { title })],
      'In Progress': [], 'In Review': [], Done: [],
    });
    const t = askTwice(app, 'apiProjectBoard', () => document.getElementById('view-board').click());
    deliverOutOfOrder(t, card('新しいカード'), card('古いカード'));

    const text = document.getElementById('board').textContent;
    expect(text).toContain('新しいカード');
    expect(text).not.toContain('古いカード');
  });

  it('捨てたもの', () => {
    const app = openIssuesView('trash');
    const row = (title) => [{ number: 5, title, archivedAt: '2026-10-01T00:00:00.000Z', daysLeft: 20 }];
    const t = askTwice(app, 'apiIssueArchivedList', () => document.getElementById('view-trash').click());
    deliverOutOfOrder(t, row('新しく捨てた'), row('古く捨てた'));

    const text = document.getElementById('trash-list').textContent;
    expect(text).toContain('新しく捨てた');
    expect(text).not.toContain('古く捨てた');
  });

  it('集計', () => {
    const app = openIssuesView('tally');
    const res = (count) => Object.assign({}, DEFAULTS.apiTallyEffort,
      { total: Object.assign({}, DEFAULTS.apiTallyEffort.total, { count }) });
    const t = askTwice(app, 'apiTallyEffort', () => document.getElementById('view-tally').click());
    deliverOutOfOrder(t, res(7), res(3));

    expect(document.getElementById('issue-count').textContent).toContain('チーム全体 7件');
  });

  const REPORT = {
    number: 3, kind: 'bug', kindLabel: 'うまく動かない', title: '棒が伸びない',
    body: '棒が伸びない', by: 'other@example.com', state: 'open',
    context: '', answer: '', at: '2026-09-09T00:00:00.000Z',
    answeredAt: '', mine: false, canClose: false, replyCount: 0,
  };

  it('報告の一覧', () => {
    const app = mount({ apiInquiryThread: { inquiry: REPORT, replies: [] } });
    const tab = document.querySelector('[data-tab="report"]');
    tab.click();
    const t = askTwice(app, 'apiInquiryList', () => tab.click());
    deliverOutOfOrder(t,
      [Object.assign({}, REPORT, { title: '新しい報告' })],
      [Object.assign({}, REPORT, { title: '古い報告' })]);

    const text = document.getElementById('report-list').textContent;
    expect(text).toContain('新しい報告');
    expect(text).not.toContain('古い報告');
  });

  it('報告を続けて開いたとき、前の話で中身を上書きしない', () => {
    const other = Object.assign({}, REPORT, { number: 4, title: '印刷できない', body: '印刷できない' });
    const app = mount({
      apiInquiryList: [REPORT, other],
      apiInquiryThread: { inquiry: REPORT, replies: [] },
    });
    document.querySelector('[data-tab="report"]').click();

    const held = [];
    app.respond('apiInquiryThread', (number) => ({ later: (ok) => held.push({ number, ok }) }));
    document.querySelector('#report-list .row-item[data-number="3"]').click();
    document.querySelector('#report-list .row-item[data-number="4"]').click();

    held.find((h) => h.number === 4).ok({ inquiry: other, replies: [] });
    held.find((h) => h.number === 3).ok({ inquiry: REPORT, replies: [] });

    const text = document.getElementById('report-detail').textContent;
    expect(text).toContain('印刷できない');
    expect(text).not.toContain('棒が伸びない');
  });

  it('知らせ', () => {
    const app = mount();
    const bell = document.getElementById('bell-btn');
    const notice = (title) => ({
      items: [{ id: 9, kind: 'mention', title, body: '', link: '', at: '2026-10-01T00:00:00.000Z', read: false }],
      unread: 1,
    });
    // 開くたびに取り直す (開く → 閉じる → 開く)
    const t = askTwice(app, 'apiNotifications', () => {
      if (!document.getElementById('notice-panel').hidden) bell.click();
      bell.click();
    });
    deliverOutOfOrder(t, notice('新しい知らせ'), notice('古い知らせ'));

    const text = document.getElementById('notice-body').textContent;
    expect(text).toContain('新しい知らせ');
    expect(text).not.toContain('古い知らせ');
  });

  it('ホームの数', () => {
    const app = mount();
    const tab = document.querySelector('[data-tab="home"]');
    const t = askTwice(app, 'apiOverview', () => tab.click());
    deliverOutOfOrder(t,
      Object.assign({}, DEFAULTS.apiOverview, { openIssues: 9 }),
      Object.assign({}, DEFAULTS.apiOverview, { openIssues: 4 }));

    expect(document.getElementById('flow-issues').textContent).toBe('9');
  });

  it('改訂中の版の一覧', () => {
    const app = mount();
    const tab = document.querySelector('[data-tab="branches"]');
    tab.click();
    const list = (name) => [DEFAULTS.apiBranchList[0], Object.assign({}, DEFAULTS.apiBranchList[1], { name })];
    const t = askTwice(app, 'apiBranchList', () => tab.click());
    deliverOutOfOrder(t, list('新しい版'), list('古い版'));

    const text = document.getElementById('branch-list').textContent;
    expect(text).toContain('新しい版');
    expect(text).not.toContain('古い版');
  });

  it('困りごとの一覧', () => {
    const ON = { scrumEnabled: true, canEdit: true, productGoal: '', definitionOfDone: '', glossary: {} };
    const app = mount({ apiSettings: ON });
    const tab = document.querySelector('[data-tab="impediments"]');
    tab.click();
    const imp = (title) => [{ number: 3, title, body: '', reportedBy: 'a@example.com',
      reportedAt: '2026-10-02T00:00:00.000Z', state: 'open', resolvedAt: '', resolution: '',
      sprint: '', updatedAt: '', commentCount: 0 }];
    const t = askTwice(app, 'apiImpedimentList', () => tab.click());
    deliverOutOfOrder(t, imp('新しい困りごと'), imp('古い困りごと'));

    const text = document.getElementById('impediments').textContent;
    expect(text).toContain('新しい困りごと');
    expect(text).not.toContain('古い困りごと');
  });
  it('知らせ: 1分ごとの頼みの返事を捨てても、後の返事で新しい知らせを前に出す', () => {
    // 1分ごとの取り直しを手で回せるように、組むときに預かる
    const every = window.setInterval;
    let poll = null;
    window.setInterval = function (fn, ms, ...rest) {
      if (ms === 60000 && String(fn).includes('loadNotices')) poll = fn;
      return every.call(window, fn, ms, ...rest);
    };
    let app;
    try { app = mount(); } finally { window.setInterval = every; }
    expect(poll).not.toBeNull();

    const fresh = {
      items: [{ id: 9, kind: 'mention', title: '新しく呼ばれました', body: '', link: '', at: '2026-10-01T00:00:00.000Z', read: false }],
      unread: 1,
    };
    const held = [];
    app.respond('apiNotifications', () => ({ later: (ok) => held.push(ok) }));
    poll();                                          // 知らせて出す頼み
    document.getElementById('bell-btn').click();     // 返事の前に、黙って取る頼み
    expect(held.length).toBe(2);
    held[1](fresh);   // 後の頼みの返事が先に届く
    held[0](fresh);   // 先の頼みの返事は捨てられる

    expect(document.getElementById('snackbar').textContent).toContain('新しく呼ばれました');
  });

  const PRS = [
    Object.assign({}, DEFAULTS.apiPrList[0], { number: 1, title: '第2条の改訂' }),
    Object.assign({}, DEFAULTS.apiPrList[0], { number: 2, title: '賃金規程の見直し' }),
  ];

  it('確認依頼の一覧', () => {
    const app = mount();
    const tab = document.querySelector('[data-tab="pulls"]');
    tab.click();
    const t = askTwice(app, 'apiPrList', () => tab.click());
    deliverOutOfOrder(t,
      [Object.assign({}, PRS[0], { title: '新しい依頼' })],
      [Object.assign({}, PRS[0], { title: '古い依頼' })]);

    const text = document.getElementById('pr-list').textContent;
    expect(text).toContain('新しい依頼');
    expect(text).not.toContain('古い依頼');
  });

  it('確認依頼を続けて開いたとき、前の依頼の中身で上書きしない', () => {
    const app = mount({ apiPrList: PRS });
    document.querySelector('[data-tab="pulls"]').click();

    const held = [];
    app.respond('apiPrPreview', (number) => ({ later: (ok) => held.push({ number, ok }) }));
    const rows = [...document.querySelectorAll('#pr-list button')];
    rows.find((b) => b.textContent.includes('第2条の改訂')).click();
    rows.find((b) => b.textContent.includes('賃金規程の見直し')).click();

    held.find((h) => h.number === 2).ok(DEFAULTS.apiPrPreview);
    held.find((h) => h.number === 1).ok(DEFAULTS.apiPrPreview);

    const text = document.getElementById('pr-detail').textContent;
    expect(text).toContain('賃金規程の見直し');
    expect(text).not.toContain('第2条の改訂');
  });

  it('推しの機嫌 (済ませたあとに取り直す)', () => {
    const mood = (level, line) => ({ level, label: level, event: 'mood_' + level, state: 'worry', recovered: false, line,
      reasons: [{ kind: 'overdue', count: 1, text: '期限を過ぎたやること 1件' }] });
    const values = { 'oshi.on': true, 'oshi.mood': true };
    const app = mount({
      apiPrefs: prefsFixture({ values }),
      apiOshiGet: Object.assign({}, DEFAULTS.apiOshiGet, { mood: mood('sulky', 'はじめ') }),
    });
    const t = askTwice(app, 'apiOshiMood', () => {
      document.querySelector('[data-tab="issues"]').click();
      document.querySelector('#issue-list [aria-label$="を完了にする"]').click();
    });
    deliverOutOfOrder(t, mood('pouty', '新しい'), mood('sulky', '古い'));
    const card = document.querySelector('.oshi-card');
    expect(card.dataset.mood).toBe('pouty');
    expect(card.querySelector('.oshi-line').textContent).toBe('新しい');
  });
});
