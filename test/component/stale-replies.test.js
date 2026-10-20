// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULTS } from '../dom.js';
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
});
