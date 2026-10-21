// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULTS, prefsFixture } from '../dom.js';
import { mount } from './mount.js';

describe('エージェンティックスクラム (既定はオフ)', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const ON = {
    scrumEnabled: true, canEdit: true, productGoal: '紙の稟議をなくす', definitionOfDone: '',
    glossary: { velocity: '1つの作業期間で終えた大きさの合計。' }, 
  };
  const VIEW = {
    sprint: 'sprint001',
    sprints: [{ name: 'sprint001', goal: '申請の流れ', startDate: '2026-10-01', endDate: '2026-10-03', notes: '' }],
    summary: { current: 'sprint001', goal: '申請の流れ', planned: 5, completed: 2, openImpediments: 1, average: '' },
    velocity: [{ name: 'sprint001', goal: '申請の流れ', startDate: '2026-10-01', endDate: '2026-10-03',
      planned: 5, completed: 2, carriedOver: '' }],
    burndown: { days: ['2026-10-01', '2026-10-02', '2026-10-03'], remaining: [5, 3, null], ideal: [5, 2.5, 0], notice: '' },
    roadmap: { sprints: ['sprint001'], rows: [{ number: 1, title: '申請画面', col: 0, state: 'open' }],
      unknown: [], unplanned: 2, notice: '' },
    texts: { productGoal: '紙の稟議をなくす', definitionOfDone: '' },
  };

  it('オフのときは、左にスクラムの節を出さない', () => {
    mount();
    expect(document.getElementById('nav-scrum').hidden).toBe(true);
  });

  it('オンなら、左にスプリントと障害物が出る', () => {
    mount({ apiSettings: ON });
    expect(document.getElementById('nav-scrum').hidden).toBe(false);
  });

  it('設定で、持ち主はオンにできる', () => {
    const app = mount({ apiSetScrumEnabled: ON });
    document.querySelector('[data-tab="settings"]').click();

    const toggle = document.getElementById('scrum-toggle');
    // 名前は状態で変えない。状態はトグルの形 (role=switch / aria-checked) で示す
    expect(toggle.getAttribute('role')).toBe('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(toggle.textContent).toBe('「期間で進める」を使う');
    app.respond('apiSettings', ON);
    toggle.click();

    expect(app.calls.filter((c) => c.name === 'apiSetScrumEnabled')[0].args).toEqual([true]);
    expect(document.getElementById('nav-scrum').hidden).toBe(false);
    const after = document.getElementById('scrum-toggle');
    expect(after.getAttribute('aria-checked')).toBe('true');
    expect(after.textContent).toBe('「期間で進める」を使う');
  });

  it('切り替えに失敗したら、トグルの形を元に戻す', () => {
    mount({ apiSetScrumEnabled: new Error('混み合っています') });
    document.querySelector('[data-tab="settings"]').click();
    const toggle = document.getElementById('scrum-toggle');
    toggle.click();

    // 押した結果をすぐ形で返すが、届かなければ嘘にならないよう戻す
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(toggle.disabled).toBe(false);
  });

  it('キューが止まっていれば、引き継ぎ方を出す', () => {
    mount({ apiSettings: Object.assign({}, ON, {
      queue: { runner: 'boss@example.com', lastRun: '2026-10-19T00:00:00.000Z', stale: true } }) });
    document.querySelector('[data-tab="settings"]').click();
    const box = document.getElementById('queue-settings');
    expect(box.textContent).toContain('boss@example.com');
    expect(box.textContent).toContain('setupCommandQueue()');
    // setupCommandQueue() は持ち主にしか動かない。投稿者などの管理者に頼ませない
    expect(box.querySelector('.row-meta').textContent).toContain('持ち主');
    expect(box.querySelector('.row-meta').textContent).not.toMatch(/^管理者が/);
    // 札が「止まっています」なのに、本文で「動いています」と言わない
    expect(box.querySelector('p').textContent).not.toContain('動いています');
    expect(box.querySelector('p').textContent).toContain('止まっているようです');
  });

  it('仕掛けた人の記録が無くても、回った時刻があれば動いていると出す', () => {
    mount({ apiSettings: Object.assign({}, ON, {
      queue: { runner: '', lastRun: '2026-10-19T00:00:00.000Z', stale: false } }) });
    document.querySelector('[data-tab="settings"]').click();
    const box = document.getElementById('queue-settings');
    expect(box.querySelector('h2').textContent).toContain('動いています');
    expect(box.textContent).not.toContain('未設定');
    expect(box.textContent).toContain('仕掛けた人は分かりません');
    expect(box.textContent).not.toContain('まだ仕掛けていません');
  });

  it('記録が無く止まっていれば「止まっています」と引き継ぎ方を出す', () => {
    mount({ apiSettings: Object.assign({}, ON, {
      queue: { runner: '', lastRun: '2026-10-19T00:00:00.000Z', stale: true } }) });
    document.querySelector('[data-tab="settings"]').click();
    const box = document.getElementById('queue-settings');
    expect(box.querySelector('h2').textContent).toContain('止まっています');
    expect(box.querySelector('.row-meta').textContent).toContain('setupCommandQueue()');
    expect(box.querySelector('p').textContent).not.toContain('動いています');
    expect(box.querySelector('p').textContent).toContain('仕掛けた人は分かりません');
  });

  it('回った時刻が読めなければ「不明」と出す (Invalid Date と出さない)', () => {
    mount({ apiSettings: Object.assign({}, ON, {
      queue: { runner: 'boss@example.com', lastRun: 'あとで', stale: true } }) });
    document.querySelector('[data-tab="settings"]').click();
    const box = document.getElementById('queue-settings');
    expect(box.textContent).toContain('最後に動いたのは 不明。');
    expect(box.textContent).not.toContain('Invalid Date');
  });

  it('一度も仕掛けていなければ「未設定」', () => {
    mount({ apiSettings: Object.assign({}, ON, { queue: { runner: '', lastRun: '', stale: false } }) });
    document.querySelector('[data-tab="settings"]').click();
    const box = document.getElementById('queue-settings');
    expect(box.querySelector('h2').textContent).toContain('未設定');
    expect(box.textContent).toContain('まだ仕掛けていません');
  });

  it('管理者でなければキューの節を出さない', () => {
    mount({ apiSettings: Object.assign({}, ON, { canEdit: false, queue: null }) });
    document.querySelector('[data-tab="settings"]').click();
    expect(document.getElementById('queue-settings')).toBe(null);
  });

  it('持ち主でなければ、切り替えの入口は出さず、頼む先を書く', () => {
    mount({ apiSettings: Object.assign({}, ON, { scrumEnabled: false, canEdit: false }) });
    document.querySelector('[data-tab="settings"]').click();

    expect(document.getElementById('scrum-toggle')).toBeNull();
    expect(document.getElementById('settings').textContent).toContain('管理者');
  });

  it('設定には、手元の道具の案内を出す (オフでも)', () => {
    mount();
    document.querySelector('[data-tab="settings"]').click();
    expect(document.getElementById('settings').textContent).toContain('node agent.mjs scrum');
  });

  it('スプリントのタブに、要約・バーンダウン・ベロシティ・ロードマップを描く', () => {
    mount({ apiSettings: ON, apiScrumView: VIEW });
    document.querySelector('[data-tab="sprint"]').click();

    const view = document.getElementById('sprint-view');
    // 結論のカードを先に置く (集計の画面と同じ順)
    const cards = [...view.querySelectorAll('.scrum-summary .tally-card')].map((c) => c.textContent);
    expect(cards[0]).toContain('今の作業期間');
    expect(cards[0]).toContain('sprint001');
    expect(cards[1]).toContain('2 / 5');
    expect(view.textContent).toContain('申請の流れ');
    expect(view.querySelector('svg.burndown-chart')).not.toBeNull();
    expect(view.querySelector('.velocity-table').textContent).toContain('sprint001');
    expect(view.querySelector('.roadmap-mark').textContent).toBe('予定');
  });

  it('用語の「?」を押すと、その下に説明が出る', () => {
    mount({ apiSettings: ON, apiScrumView: VIEW });
    document.querySelector('[data-tab="sprint"]').click();

    const btn = document.querySelector('.term-help-btn[aria-label="期間ごとに終えた量 とは"]');
    const note = btn.parentNode.querySelector('.term-help-text');
    expect(note.hidden).toBe(true);
    btn.click();
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain('終えた大きさ');
  });

  it('スプリントを作れる', () => {
    const app = mount({ apiSettings: ON, apiScrumView: VIEW, apiSprintCreate: { name: 'sprint002' } });
    document.querySelector('[data-tab="sprint"]').click();
    document.getElementById('sprint-create-btn').click();

    const form = document.querySelector('#side-body form');
    form.querySelector('input').value = 'sprint002';
    form.querySelector('.btn-primary').click();

    expect(app.calls.filter((c) => c.name === 'apiSprintCreate')[0].args[0].name).toBe('sprint002');
  });

  it('障害物を並べ、開いて解決できる', () => {
    const imp = { number: 3, title: '承認者が不在', body: '', reportedBy: 'a@example.com',
      reportedAt: '2026-10-02T00:00:00.000Z', state: 'open', resolvedAt: '', resolution: '',
      sprint: '', updatedAt: '', commentCount: 1 };
    const app = mount({ apiSettings: ON, apiImpedimentList: [imp],
      apiImpedimentResolve: Object.assign({}, imp, { state: 'resolved', resolution: '代理が承認' }) });
    document.querySelector('[data-tab="impediments"]').click();

    expect(document.getElementById('impediments').textContent).toContain('承認者が不在');
    expect(document.getElementById('count-impediments').textContent).toBe('1');

    document.querySelector('.impediment-row').click();
    [...document.querySelectorAll('#side-body button')].find((b) => b.textContent === '解決する').click();
    const form = document.querySelector('#side-body form');
    form.querySelector('textarea').value = '代理が承認';
    form.querySelector('.btn-primary').click();

    expect(app.calls.filter((c) => c.name === 'apiImpedimentResolve')[0].args).toEqual([3, '代理が承認']);
    // ほかを開いていなければ、解決したあとの詳細に戻る
    expect(document.getElementById('side-title').textContent).toBe('困りごと #3');
    expect(document.getElementById('side-body').textContent).toContain('解決済み');
  });

  it('スプリントが無いときは、作る入口を真ん中に出す', () => {
    mount({ apiSettings: ON, apiScrumView: { sprint: '', sprints: [], summary: {}, velocity: [],
      burndown: { days: [] }, roadmap: { sprints: [], rows: [] }, texts: {} } });
    document.querySelector('[data-tab="sprint"]').click();

    // 空の表と「?」だけ並べても、何をすればよいか分からない
    const blank = document.querySelector('#sprint-view .blank-state');
    expect(blank.textContent).toContain('作業期間がまだありません');
    blank.querySelector('.btn-primary').click();
    expect(document.getElementById('side-body').textContent).toContain('この期間の目標');
  });

  it('スプリントを素早く切り替えても、前の返事で描き直さない', () => {
    const pending = [];
    const OTHER = Object.assign({}, VIEW, { sprint: 'sprint002',
      sprints: VIEW.sprints.concat([{ name: 'sprint002', goal: '通知', startDate: '', endDate: '', notes: '' }]) });
    // 選択肢に両方が無いと select.value を変えても切り替わらない
    const app = mount({ apiSettings: ON, apiScrumView: Object.assign({}, OTHER, { sprint: 'sprint001' }) });
    document.querySelector('[data-tab="sprint"]').click();

    app.respond('apiScrumView', (name) => ({ later: (ok, ng) => pending.push({ name, ok, ng }) }));
    const select = document.getElementById('sprint-select');
    select.value = 'sprint001';
    select.dispatchEvent(new window.Event('change'));
    select.value = 'sprint002';
    select.dispatchEvent(new window.Event('change'));

    expect(pending.map((p) => p.name)).toEqual(['sprint001', 'sprint002']);
    // 後に頼んだぶんが先に、前に頼んだぶんが後から届く
    pending[1].ok(OTHER);
    pending[0].ok(Object.assign({}, OTHER, { sprint: 'sprint001' }));
    expect(document.getElementById('sprint-select').value).toBe('sprint002');

    // 前のぶんが失敗で返っても、描いたものを消さない
    pending[0].ng(new Error('古い失敗'));
    expect(document.querySelector('#sprint-view .scrum-summary')).not.toBeNull();
  });

  it('ロードマップの行から、そのやることを開ける', () => {
    const app = mount({ apiSettings: ON, apiScrumView: VIEW,
      apiIssueList: [Object.assign({}, DEFAULTS.apiIssueList[0], { number: 1, title: '申請画面' })] });
    document.querySelector('[data-tab="sprint"]').click();

    document.querySelector('.roadmap-open').click();
    expect(app.calls.some((c) => c.name === 'apiIssueList')).toBe(true);
    expect(document.getElementById('side-title').textContent).toContain('#1');
  });

  it('一覧に無いスプリントに入っているやることを直しても、スプリントを外さない', () => {
    // 画面を開いたあとに手元の Claude が作ったスプリントは、選択肢の一覧に無い
    const issue = Object.assign({}, DEFAULTS.apiIssueList[0], { sprint: 'sprint009', points: 3, acceptance: '' });
    const app = mount({ apiSettings: ON, apiSprintList: [], apiIssueList: [issue] });
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list .row-item .row-open').click();
    document.getElementById('side-edit').click();
    document.querySelector('#side-body form')
      .dispatchEvent(new window.Event('submit', { cancelable: true }));

    const call = app.calls.filter((c) => c.name === 'apiIssueUpdate').pop();
    expect(call.args[1].sprint).toBe('sprint009');
  });

  it('障害物の返事が届いたとき、別のものを開いていたら乗っ取らない', () => {
    const imp = { number: 3, title: '承認者が不在', body: '', reportedBy: 'a@example.com',
      reportedAt: '2026-10-02T00:00:00.000Z', state: 'resolved', resolvedAt: '2026-10-03T00:00:00.000Z',
      resolution: '代理', sprint: '', updatedAt: '', commentCount: 0 };
    let reply = null;
    mount({ apiSettings: ON, apiImpedimentList: [imp],
      apiImpedimentReopen: () => ({ later: (ok) => { reply = ok; } }) });
    document.querySelector('[data-tab="impediments"]').click();
    document.querySelector('.impediment-row').click();
    [...document.querySelectorAll('#side-body button')].find((b) => b.textContent === '未解決に戻す').click();

    // 返事を待つあいだに、やることを開く
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list .row-item .row-open').click();
    const title = document.getElementById('side-title').textContent;
    reply(Object.assign({}, imp, { state: 'open' }));
    expect(document.getElementById('side-title').textContent).toBe(title);
  });

  const IMP = { number: 3, title: '承認者が不在', body: '', reportedBy: 'a@example.com',
    reportedAt: '2026-10-06T23:30:00.000Z', state: 'resolved', resolvedAt: '2026-10-06T16:00:00.000Z',
    resolution: '代理', sprint: '', updatedAt: '', commentCount: 0 };

  it('返事を待つあいだに閉じたら、返事が届いても開き直さない', () => {
    let reply = null;
    mount({ apiSettings: ON, apiImpedimentList: [IMP],
      apiImpedimentReopen: () => ({ later: (ok) => { reply = ok; } }) });
    document.querySelector('[data-tab="impediments"]').click();
    document.querySelector('.impediment-row').click();
    [...document.querySelectorAll('#side-body button')].find((b) => b.textContent === '未解決に戻す').click();

    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    reply(Object.assign({}, IMP, { state: 'open' }));
    expect(document.getElementById('side-panel').hidden).toBe(true);
  });

  it('別の障害物を開いたら、前の行の選んでいる印を外す', () => {
    const other = Object.assign({}, IMP, { number: 5, title: '別のもの' });
    mount({ apiSettings: ON, apiImpedimentList: [IMP, other] });
    document.querySelector('[data-tab="impediments"]').click();
    const rows = () => [...document.querySelectorAll('.impediment-row')];
    rows()[0].click();
    expect(rows()[0].getAttribute('aria-current')).toBe('true');

    rows()[1].click();
    expect(rows()[0].getAttribute('aria-current')).not.toBe('true');
    expect(rows()[1].getAttribute('aria-current')).toBe('true');
  });

  it('日付と時刻は東京の暦で出す', () => {
    // 08:30 JST に書いたものは UTC では前の日の 23:30。字のまま切ると1日前に見える
    mount({ apiSettings: ON, apiImpedimentList: [IMP],
      apiImpedimentComments: [{ id: 1, impedimentNumber: 3, body: 'x', by: 'a@example.com',
        at: '2026-10-06T23:30:00.000Z', editedAt: '' }],
      apiHistory: [{ id: 1, at: '2026-10-06T23:30:00.000Z', actor: 'a@example.com',
        target: 'impediment:3', action: 'create', field: '', before: '', after: '' }] });
    document.querySelector('[data-tab="impediments"]').click();
    expect(document.querySelector('.impediment-row').textContent).toContain('2026-10-07');
    document.querySelector('.impediment-row').click();

    const side = document.getElementById('side-body');
    expect(side.querySelector('.comment').textContent).toContain('2026-10-07');
    const history = side.querySelector('.change-history');
    history.open = true;
    history.dispatchEvent(new window.Event('toggle'));
    expect(history.textContent).toContain('2026-10-07 08:30');
  });

  it('暦に無い日付のスプリントでも、日数に NaN を出さない', () => {
    const bad = Object.assign({}, VIEW, {
      sprints: [{ name: 'sprint001', goal: '', startDate: '2026-02-30', endDate: '2026-03-05', notes: '' }],
      burndown: { days: ['2026-10-01'], ideal: [5], notice: '' },
    });
    mount({ apiSettings: ON, apiScrumView: bad });
    document.querySelector('[data-tab="sprint"]').click();

    const view = document.getElementById('sprint-view');
    expect(view.textContent).not.toContain('NaN');
    expect(view.textContent).toContain('期間が決まっていません');
  });

  it('見ているスプリントが無いとき、押せないボタンへ案内しない', () => {
    mount({ apiSettings: ON, apiScrumView: Object.assign({}, VIEW, { sprint: '' }) });
    document.querySelector('[data-tab="sprint"]').click();

    expect(document.getElementById('sprint-edit-btn').disabled).toBe(true);
    expect(document.getElementById('sprint-view').textContent).not.toContain('「この作業期間を直す」から');
  });

  it('ホバーで出る説明が、ほかの画面と同じ仕組みで付く', () => {
    // 付いていないと、そこだけ押す前に何が起きるか分からない
    const hinted = (el, what) => {
      expect(el, what).not.toBeNull();
      expect(el.classList.contains('has-hint'), what).toBe(true);
      expect(el.dataset.hint.length, what).toBeGreaterThan(8);
    };
    const imp = { number: 3, title: '承認者が不在', body: '', reportedBy: 'a@example.com',
      reportedAt: '2026-10-02T00:00:00.000Z', state: 'open', resolvedAt: '', resolution: '',
      sprint: '', updatedAt: '', commentCount: 0 };
    mount({ apiSettings: ON, apiScrumView: VIEW, apiImpedimentList: [imp] });

    ['settings', 'sprint', 'impediments'].forEach((tab) => {
      hinted(document.querySelector('.sidebar [data-tab="' + tab + '"]'), 'nav:' + tab);
    });

    document.querySelector('[data-tab="sprint"]').click();
    hinted(document.getElementById('sprint-select').parentNode, 'sprint-select');
    hinted(document.getElementById('sprint-edit-btn'), 'sprint-edit-btn');
    hinted(document.getElementById('sprint-create-btn'), 'sprint-create-btn');
    document.querySelectorAll('#sprint-view .scrum-summary .tally-card').forEach((c, i) => hinted(c, 'card ' + i));
    hinted(document.querySelector('.roadmap-open'), 'roadmap-open');

    // 用語の「?」は、ブラウザ既定の吹き出し (title) ではなく同じ仕組みで出す
    const help = document.querySelector('.term-help-btn[aria-label="期間ごとに終えた量 とは"]');
    hinted(help, 'term-help');
    expect(help.getAttribute('title')).toBeNull();
    expect(help.dataset.hint).toContain('終えた大きさ');

    document.querySelector('[data-tab="impediments"]').click();
    hinted(document.getElementById('impediment-create-btn'), 'impediment-create-btn');
    document.querySelector('.impediment-row').click();
    hinted([...document.querySelectorAll('#side-body button')].find((b) => b.textContent === '解決する'), 'resolve');

    document.querySelector('[data-tab="settings"]').click();
    hinted(document.getElementById('scrum-toggle'), 'scrum-toggle');
  });

  describe('変更の履歴', () => {
    const at = '2026-10-06T23:30:00.000Z';
    function openHistory(rows) {
      const imp = { number: 3, title: 'x', body: '', reportedBy: 'a@example.com',
        reportedAt: at, state: 'open', resolvedAt: '', resolution: '', sprint: '', updatedAt: '', commentCount: 0 };
      mount({ apiSettings: ON, apiImpedimentList: [imp], apiHistory: rows });
      document.querySelector('[data-tab="impediments"]').click();
      document.querySelector('.impediment-row').click();
      const h = document.querySelector('#side-body .change-history');
      h.open = true;
      h.dispatchEvent(new window.Event('toggle'));
      return h;
    }
    const row = (id, field, before, after, extra) => Object.assign({ id, at, actor: 'a@example.com',
      target: 'impediment:3', action: 'update', field, before, after, lines: null }, extra || {});

    it('1回の書き込みを1つのまとまりにする', () => {
      const h = openHistory([row(2, 'title', 'a', 'b'), row(1, 'sprint', '', 's1')]);
      expect(h.querySelectorAll('.history-item')).toHaveLength(1);
      expect(h.querySelectorAll('.history-change')).toHaveLength(2);
      expect(h.querySelector('.history-head').textContent).toContain('直しました');
    });

    it('複数行の値は行ごとの差分で、色だけに頼らず印を付ける', () => {
      const h = openHistory([row(1, 'body', 'a\nb', 'a\nc', { lines: [
        { op: 'same', text: 'a' }, { op: 'del', text: 'b' }, { op: 'add', text: 'c' }] })]);
      const del = h.querySelector('.history-del');
      const add = h.querySelector('.history-add');
      expect(del.tagName).toBe('DEL');
      expect(del.textContent).toBe('−b');
      // 取り消し線は字だけに引く (印は読めるまま)
      expect(del.querySelector('.history-text').textContent).toBe('b');
      expect(add.textContent).toBe('＋c');
    });

    it('多いときは 50 件ずつ出し、さらに表示で足す', () => {
      const rows = Array.from({ length: 120 }, (_, i) =>
        row(120 - i, 'title', 'a', 'b', { at: new Date(Date.UTC(2026, 9, 1, 0, 120 - i)).toISOString() }));
      const h = openHistory(rows);
      expect(h.querySelectorAll('.history-item')).toHaveLength(50);
      const more = h.querySelector('.history-more');
      expect(more.textContent).toContain('残り 70 件');
      more.click();
      expect(h.querySelectorAll('.history-item')).toHaveLength(100);
      expect(h.querySelector('.history-more').textContent).toContain('残り 20 件');
    });
  });

  describe('やることの一覧とボードで、積んだ量を見比べる', () => {
    const ISSUES = [
      Object.assign({}, DEFAULTS.apiIssueList[0], { number: 2, sprint: 'sprint002', points: 5 }),
      Object.assign({}, DEFAULTS.apiIssueList[1], { number: 1, parent: '', sprint: 'sprint001', points: 3 }),
      Object.assign({}, DEFAULTS.apiIssueList[1], { number: 3, parent: '', title: '未定のもの', sprint: '', points: '' }),
    ];

    it('オンなら、行にスプリントとポイントを出し、スプリントごとに束ねられる', () => {
      mount({ apiSettings: ON, apiIssueList: ISSUES });
      document.querySelector('[data-tab="issues"]').click();

      const row = document.querySelector('#issue-list .row-item[data-number="2"]');
      expect(row.querySelector('.scrum-chips').textContent).toContain('sprint002');
      expect(row.querySelector('.scrum-chips').textContent).toContain('大きさ 5');

      const sel = document.getElementById('issue-group');
      sel.value = 'sprint';
      sel.dispatchEvent(new window.Event('change'));
      // スプリントは名前の順、未定は最後。見出しに積んだポイントの合計
      const heads = [...document.querySelectorAll('#issue-list .group-head')].map((h) => h.textContent);
      expect(heads[0]).toContain('sprint001');
      expect(heads[0]).toContain('大きさ 3');
      expect(heads[1]).toContain('sprint002');
      expect(heads[2]).toContain('作業期間未定');
    });

    it('設定が一覧より遅れて届いても、届いたら札を付けて描き直す', () => {
      let reply = null;
      mount({ apiSettings: { later: (ok) => { reply = ok; } }, apiIssueList: ISSUES });
      document.querySelector('[data-tab="issues"]').click();
      expect(document.querySelector('#issue-list .scrum-chips')).toBeNull();

      reply(ON);
      expect(document.querySelector('#issue-list .scrum-chips')).not.toBeNull();
    });

    it('オフなら、スプリントの札も束ね方も出さない', () => {
      mount({ apiIssueList: ISSUES });
      document.querySelector('[data-tab="issues"]').click();

      expect(document.querySelector('#issue-list .scrum-chips')).toBeNull();
      expect(document.querySelector('#issue-group option[value="sprint"]')).toBeNull();
    });

    it('ボードの列にポイントの合計を、カードにスプリントとポイントを出す', () => {
      const board = {
        Backlog: [{ issueNumber: 2, order: 0, title: 'a', state: 'open', assignee: '', labels: '',
          dueDate: '', sprint: 'sprint001', points: 5 },
        { issueNumber: 3, order: 1, title: 'b', state: 'open', assignee: '', labels: '',
          dueDate: '', sprint: '', points: 2 }],
        'In Progress': [], 'In Review': [], Done: [],
      };
      mount({ apiSettings: ON, apiProjectBoard: board });
      document.querySelector('[data-tab="issues"]').click();
      document.getElementById('view-board').click();

      const col = document.querySelector('.board-column h3');
      expect(col.textContent).toContain('大きさ 7');
      expect(document.querySelector('.board-card .scrum-chips').textContent).toContain('sprint001');
    });
  });

  describe('はじめての人のための案内', () => {
    const day = (offset) => new Date(Date.now() + 9 * 3600 * 1000 + offset * 86400000).toISOString().substring(0, 10);
    const running = (over) => Object.assign({}, VIEW, {
      sprints: [{ name: 'sprint001', goal: '申請の流れ', startDate: day(-3), endDate: day(3), notes: '' }],
      velocity: [{ name: 'sprint001', goal: '申請の流れ', startDate: day(-3), endDate: day(3),
        planned: 5, completed: 2, carriedOver: '' }],
      summary: { current: 'sprint001', planned: 5, completed: 2, openImpediments: 0, average: '' },
    }, over || {});
    const nextTitle = () => document.querySelector('.scrum-next strong').textContent;
    const current = () => [...document.querySelectorAll('.scrum-cycle-step.is-current strong')].map((e) => e.textContent);

    it('スプリントが無ければ、計画するの段で作る入口だけを出す', () => {
      mount({ apiSettings: ON, apiScrumView: { sprint: '', sprints: [], summary: {}, velocity: [],
        burndown: { days: [] }, roadmap: { sprints: [], rows: [] }, texts: {} } });
      document.querySelector('[data-tab="sprint"]').click();

      expect(current()).toEqual(['計画する']);
      expect(document.querySelector('.scrum-intro').open).toBe(true);
      // 入口は空の案内のボタンが兼ねる。同じボタンを2つ並べない
      expect(document.querySelector('.scrum-next')).toBeNull();
    });

    it('期間の途中なら進めるの段で、残りのポイントとボードへの入口を出す', () => {
      mount({ apiSettings: ON, apiScrumView: running() });
      document.querySelector('[data-tab="sprint"]').click();

      expect(current()).toEqual(['進める']);
      expect(nextTitle()).toContain('残りの大きさ 3');
      document.querySelector('.scrum-next .btn-primary').click();
      expect(document.getElementById('panel-issues').hidden).toBe(false);
      expect(document.getElementById('view-board').getAttribute('aria-pressed')).toBe('true');
    });

    it('障害物があれば、それを先に片付けるよう出す', () => {
      mount({ apiSettings: ON, apiScrumView: running({ summary: { current: 'sprint001', planned: 5,
        completed: 2, openImpediments: 2, average: '' } }) });
      document.querySelector('[data-tab="sprint"]').click();

      expect(nextTitle()).toContain('困りごとが 2件');
      document.querySelector('.scrum-next .btn-primary').click();
      expect(document.getElementById('panel-impediments').hidden).toBe(false);
    });

    it('ゴールが空なら、まずゴールを書くよう出す', () => {
      const v = running();
      v.sprints = [Object.assign({}, v.sprints[0], { goal: '' })];
      mount({ apiSettings: ON, apiScrumView: v });
      document.querySelector('[data-tab="sprint"]').click();

      expect(current()).toEqual(['計画する']);
      expect(nextTitle()).toContain('この期間の目標');
      document.querySelector('.scrum-next .btn-primary').click();
      expect(document.getElementById('side-title').textContent).toContain('sprint001 を直す');
    });

    it('終わったら、見せてふりかえり、次を作るよう出す', () => {
      const v = running();
      v.sprints = [Object.assign({}, v.sprints[0], { startDate: day(-10), endDate: day(-1) })];
      mount({ apiSettings: ON, apiScrumView: v });
      document.querySelector('[data-tab="sprint"]').click();

      expect(current()).toEqual(['見せる', 'ふりかえる']);
      // 読み上げの「いまの段」は1つ
      expect(document.querySelectorAll('.scrum-cycle-step[aria-current="step"]')).toHaveLength(1);
      expect(nextTitle()).toContain('終わりました');
      expect(document.querySelector('.scrum-next .btn-primary').textContent).toBe('次の作業期間を作る');
    });

    it('済んだ段には印を付ける (色だけに頼らない)', () => {
      const v = running();
      v.sprints = [Object.assign({}, v.sprints[0], { startDate: day(-10), endDate: day(-1) })];
      mount({ apiSettings: ON, apiScrumView: v });
      document.querySelector('[data-tab="sprint"]').click();

      const done = [...document.querySelectorAll('.scrum-cycle-step.is-done')];
      expect(done.map((li) => li.querySelector('strong').textContent)).toEqual(['計画する', '進める']);
      expect(done[0].querySelector('.scrum-cycle-num').textContent).toBe('✓');
      expect(done[0].textContent).toContain('済み');
    });

    it('押せないボタンには、押せない理由を出す', () => {
      mount({ apiSettings: ON, apiScrumView: { sprint: '', sprints: [], summary: {}, velocity: [],
        burndown: { days: [] }, roadmap: { sprints: [], rows: [] }, texts: {} } });
      document.querySelector('[data-tab="sprint"]').click();

      const btn = document.getElementById('sprint-edit-btn');
      expect(btn.disabled).toBe(true);
      expect(btn.dataset.hint).toContain('まず作業期間を作る');
      // 押せないボタンには焦点が当たらない。理由は見える字でも隣に出す
      const reason = document.getElementById('sprint-edit-reason');
      expect(reason.hidden).toBe(false);
      expect(reason.textContent).toContain('まず作業期間を作る');
    });

    it('スプリントの入力欄は、必須・見本・決まりを入れる前に見せる', () => {
      mount({ apiSettings: ON, apiScrumView: running() });
      document.querySelector('[data-tab="sprint"]').click();
      document.getElementById('sprint-create-btn').click();

      const form = document.querySelector('#side-body form');
      const name = form.querySelector('input');
      expect(name.placeholder).toBe('sprint001');
      expect(name.parentNode.querySelector('.field-required').textContent).toBe('必須');
      // 補足と入力時の知らせの両方を結ぶ。補足が先
      const note = document.getElementById(name.getAttribute('aria-describedby').split(' ')[0]);
      expect(note.textContent).toContain('あとから変えられません');
    });

    describe('スプリントの日付の入力', () => {
      const S = [
        { name: 'sprint001', goal: '', startDate: '2026-10-01', endDate: '2026-10-07', notes: '' },
        { name: 'sprint002', goal: '', startDate: '2026-10-08', endDate: '2026-10-14', notes: '' },
      ];
      const V = () => Object.assign({}, VIEW, { sprint: 'sprint002', sprints: S, velocity: [] });
      function openCreate(app) {
        document.querySelector('[data-tab="sprint"]').click();
        document.getElementById('sprint-create-btn').click();
        const form = document.querySelector('#side-body form');
        const get = (n) => form.querySelector('[name="' + n + '"]');
        const set = (n, value, ev) => {
          get(n).value = value;
          get(n).dispatchEvent(new window.Event(ev || 'change', { bubbles: true }));
        };
        const msg = (n) => get(n).parentNode.querySelector('.field-msg');
        return { form, get, set, msg, submit: form.querySelector('button[type="submit"]'), app };
      }

      it('名前と期間を前のスプリントから補い、日付は選ばせる', () => {
        mount({ apiSettings: ON, apiScrumView: V() });
        const f = openCreate();
        expect(f.get('name').value).toBe('sprint003');
        expect(f.get('startDate').type).toBe('date');
        // 前の終わりの翌日から、前と同じ7日間
        expect(f.get('startDate').value).toBe('2026-10-15');
        expect(f.get('endDate').value).toBe('2026-10-21');
        expect(f.get('endDate').min).toBe('2026-10-15');
      });

      it('始まりの日を変えると終わりもついてくる。自分で直した終わりは動かさない', () => {
        mount({ apiSettings: ON, apiScrumView: V() });
        const f = openCreate();
        f.set('startDate', '2026-10-20');
        expect(f.get('endDate').value).toBe('2026-10-26');

        f.set('endDate', '2026-10-31');
        f.set('startDate', '2026-10-22');
        expect(f.get('endDate').value).toBe('2026-10-31');
      });

      it('番号で終わらない名前しか無くても、空いている sprintNNN を補う', () => {
        mount({ apiSettings: ON, apiScrumView: Object.assign(V(), {
          sprints: [{ name: '申請の入口', goal: '', startDate: '2026-10-01', endDate: '2026-10-07', notes: '' }] }) });
        const f = openCreate();
        expect(f.get('name').value).toBe('sprint001');
        expect(f.submit.disabled).toBe(false);
      });

      it('名前の「入れてください」は、触るまで出さない', () => {
        mount({ apiSettings: ON, apiScrumView: V() });
        const f = openCreate();
        f.get('name').value = '';
        f.set('startDate', '2026-10-20');
        expect(f.msg('name') ? f.msg('name').hidden : true).toBe(true);
        f.set('name', '', 'input');
        expect(f.msg('name').textContent).toContain('名前を入れてください');
      });

      it('直すときも、始まりの日を変えると終わりの日が同じ長さでついてくる', () => {
        mount({ apiSettings: ON, apiScrumView: V() });
        document.querySelector('[data-tab="sprint"]').click();
        document.getElementById('sprint-edit-btn').click();
        const form = document.querySelector('#side-body form');
        const start = form.querySelector('[name="startDate"]');
        start.value = '2026-10-10';
        start.dispatchEvent(new window.Event('change', { bubbles: true }));
        // sprint002 は 10/08〜10/14 の7日間
        expect(form.querySelector('[name="endDate"]').value).toBe('2026-10-16');
      });

      it('期間の1押しはラベルの外に置く (欄の名前に混ざらない)', () => {
        mount({ apiSettings: ON, apiScrumView: V() });
        const f = openCreate();
        expect(f.get('endDate').parentNode.querySelector('.sprint-quick')).toBeNull();
        expect(f.form.querySelector('.sprint-quick')).not.toBeNull();
      });

      it('「2週間」で終わりの日を1押しで決める', () => {
        mount({ apiSettings: ON, apiScrumView: V() });
        const f = openCreate();
        [...f.form.querySelectorAll('.sprint-quick-btn')].find((b) => b.textContent === '2週間').click();
        expect(f.get('endDate').value).toBe('2026-10-28');
      });

      it('終わりが始まりより前なら、欄のすぐ下に理由を出し、送らせない', () => {
        const app = mount({ apiSettings: ON, apiScrumView: V() });
        const f = openCreate();
        f.set('endDate', '2026-10-10');

        expect(f.msg('endDate').hidden).toBe(false);
        expect(f.msg('endDate').textContent).toContain('エラー');
        expect(f.msg('endDate').getAttribute('role')).toBe('alert');
        expect(f.get('endDate').getAttribute('aria-invalid')).toBe('true');
        expect(f.submit.disabled).toBe(true);
        f.form.dispatchEvent(new window.Event('submit', { cancelable: true }));
        expect(app.calls.some((c) => c.name === 'apiSprintCreate')).toBe(false);

        f.set('endDate', '2026-10-21');
        expect(f.msg('endDate').hidden).toBe(true);
        expect(f.submit.disabled).toBe(false);
      });

      it('同じ名前は打ったその場で止める', () => {
        mount({ apiSettings: ON, apiScrumView: V() });
        const f = openCreate();
        f.set('name', 'sprint001', 'input');
        expect(f.msg('name').textContent).toContain('既にあります');
        expect(f.submit.disabled).toBe(true);
      });

      it('ほかのスプリントと期間が重なれば注意を出す (送るのは止めない)', () => {
        mount({ apiSettings: ON, apiScrumView: V() });
        const f = openCreate();
        f.set('startDate', '2026-10-12');
        f.set('endDate', '2026-10-18');
        expect(f.msg('endDate').textContent).toContain('注意');
        expect(f.msg('endDate').textContent).toContain('sprint002');
        expect(f.submit.disabled).toBe(false);
      });
    });

    it('説明は閉じたら閉じたまま覚えておく', () => {
      mount({ apiSettings: ON, apiScrumView: running() });
      document.querySelector('[data-tab="sprint"]').click();
      const intro = document.querySelector('.scrum-intro');
      intro.open = false;
      intro.dispatchEvent(new window.Event('toggle'));

      mount({ apiSettings: ON, apiScrumView: running() });
      document.querySelector('[data-tab="sprint"]').click();
      expect(document.querySelector('.scrum-intro').open).toBe(false);
    });

    it('ポイントは数を打たせず、言葉の付いた段階から選ばせる', () => {
      const issue = Object.assign({}, DEFAULTS.apiIssueList[0], { sprint: '', points: 4, acceptance: '' });
      const app = mount({ apiSettings: ON, apiIssueList: [issue] });
      document.querySelector('[data-tab="issues"]').click();
      document.querySelector('#issue-list .row-item .row-open').click();
      document.getElementById('side-edit').click();

      const select = [...document.querySelectorAll('#side-body select')]
        .find((el) => [...el.options].some((o) => o.textContent.includes('大きすぎる')));
      // 段階に無い値 (4) も選択肢に残し、選び直さない限り変えない
      expect(select.value).toBe('4');
      select.value = '8';
      document.querySelector('#side-body form').dispatchEvent(new window.Event('submit', { cancelable: true }));
      expect(app.calls.filter((c) => c.name === 'apiIssueUpdate').pop().args[1].points).toBe('8');
    });
  });

  it('言葉の表し方: 既定は一般の言葉。スクラムの言葉を選ぶと、その場で言い換える', () => {
    const app = mount({ apiSettings: ON, apiScrumView: VIEW });
    const navLabel = () => document.querySelector('[data-tab="sprint"] .nav-label').textContent;
    expect(navLabel()).toBe('作業期間');
    expect(document.querySelector('#nav-scrum h2').textContent).toBe('期間で進める');
    expect(document.getElementById('sprint-create-btn').textContent).toBe('作業期間を作る');
    document.querySelector('[data-tab="sprint"]').click();
    expect(document.getElementById('sprint-view').textContent).toContain('今の作業期間');

    // 設定の画面で切り替える (書いたあとの apiPrefs が届く)
    app.respond('apiPrefSet', prefsFixture({ values: { 'terms.style': 'scrum' } }));
    document.querySelector('[data-tab="settings"]').click();
    const select = [...document.querySelectorAll('#settings select')]
      .find((el) => [...el.options].some((o) => o.value === 'scrum'));
    select.value = 'scrum';
    select.dispatchEvent(new window.Event('change'));
    expect(app.calls.filter((c) => c.name === 'apiPrefSet').pop().args).toEqual(['terms.style', 'scrum']);
    expect(navLabel()).toBe('スプリント');
    expect(document.getElementById('sprint-create-btn').textContent).toBe('スプリントを作る');
    expect(document.getElementById('settings').textContent).toContain('エージェンティックスクラム');

    document.querySelector('[data-tab="sprint"]').click();
    expect(document.getElementById('sprint-view').textContent).toContain('今のスプリント');
    // 用語の「?」もスクラムの言葉で名乗る
    expect(document.querySelector('.term-help-btn[aria-label="ベロシティ とは"]')).not.toBeNull();
  });

  describe('言葉の表し方が届いたとき (起動の設定が遅れて届く)', () => {
    const SCRUM = () => prefsFixture({ values: { 'terms.style': 'scrum' } });
    const IMP = { number: 3, title: '承認者が不在', body: '', reportedBy: 'a@example.com',
      reportedAt: '2026-10-02T00:00:00.000Z', state: 'open', resolvedAt: '', resolution: '',
      sprint: 'sprint001', updatedAt: '', commentCount: 0 };
    const ISSUES = [{ number: 2, title: '通勤手当の見直し', body: '', state: 'open', assignee: '', assignees: [],
      labels: '', linkedFileIds: '', linkedPr: '', createdAt: '2026-09-01T00:00:00.000Z', closedAt: '',
      dueDate: '', startDate: '', parent: '', estimate: '', plannedHours: '', actualHours: '',
      sprint: 'sprint001', points: 3, acceptance: '承認まで通る' }];
    const BOARD = { Backlog: [{ issueNumber: 2, order: 0, title: '通勤手当の見直し', state: 'open',
      assignee: '', labels: '', dueDate: '', sprint: 'sprint001', points: 3 }],
    'In Progress': [], 'In Review': [], Done: [] };

    function late(over) {
      let deliver = null;
      const app = mount(Object.assign({ apiSettings: ON, apiScrumView: VIEW, apiImpedimentList: [IMP],
        apiIssueList: ISSUES, apiProjectBoard: BOARD,
        apiPrefs: () => ({ later: (ok) => { deliver = ok; } }) }, over));
      return { app, deliver: (res) => deliver(res) };
    }
    // 推しは既定でオンなので、設定が初めて届いたときに推しを取る (一覧の取り直しではない)
    // 実績は設定が届いたときに1回だけ数え直す (描き直しの取り直しではない)。
    // 道具の更新 (apiKitStatus) は急がない波で、最初の波 (ここでは止めていた設定) の返事がそろったときに1回だけ取る
    const LATER = ['apiUsageRecord', 'apiOshiGet', 'apiAchievementsCheck', 'apiKitStatus'];
    const callsSince = (app, n) => app.calls.slice(n).map((c) => c.name).filter((x) => LATER.indexOf(x) < 0);

    it('作業期間の画面は、取り直さずに描き直す', () => {
      const { app, deliver } = late();
      document.querySelector('[data-tab="sprint"]').click();
      expect(document.getElementById('sprint-view').textContent).toContain('今の作業期間');
      const n = app.calls.length;
      deliver(SCRUM());
      expect(callsSince(app, n)).toEqual([]);
      expect(document.getElementById('sprint-view').textContent).toContain('今のスプリント');
      expect(document.getElementById('doc-title').textContent).toBe('スプリント');
    });

    it('困りごとの一覧と、開いている詳細を、取り直さずに描き直す。開いているかは番号で見る', () => {
      const { app, deliver } = late({
        apiImpedimentResolve: Object.assign({}, IMP, { state: 'resolved', resolution: '代理が承認' }) });
      document.querySelector('[data-tab="impediments"]').click();
      document.querySelector('.impediment-row').click();
      expect(document.getElementById('side-title').textContent).toBe('困りごと #3');
      const n = app.calls.length;
      deliver(SCRUM());
      expect(callsSince(app, n)).toEqual([]);
      expect(document.getElementById('side-title').textContent).toBe('障害物 #3');
      expect(document.getElementById('side-body').textContent).toContain('スプリント');
      expect(document.getElementById('impediments').textContent).not.toContain('困りごと');

      // 切り替えたあとも、解決したら同じ詳細に戻る
      [...document.querySelectorAll('#side-body button')].find((b) => b.textContent === '解決する').click();
      const form = document.querySelector('#side-body form');
      form.querySelector('textarea').value = '代理が承認';
      form.querySelector('.btn-primary').click();
      expect(document.getElementById('side-title').textContent).toBe('障害物 #3');
      expect(document.getElementById('side-body').textContent).toContain('解決済み');
    });

    it('やることの一覧・ボード・開いている詳細を、取り直さずに描き直す', () => {
      const { app, deliver } = late();
      document.querySelector('[data-tab="issues"]').click();
      document.querySelector('.row-item[data-number="2"] .row-open').click();
      expect(document.getElementById('side-body').textContent).toContain('できたと言える条件');
      const n = app.calls.length;
      deliver(SCRUM());
      expect(callsSince(app, n)).toEqual([]);
      expect(document.getElementById('side-body').textContent).toContain('受け入れ条件');
      expect(document.getElementById('side-body').textContent).not.toContain('できたと言える条件');
      expect(document.getElementById('issue-list').textContent).toContain('3pt');

      document.getElementById('view-board').click();
      expect(document.getElementById('board').textContent).toContain('3pt');
    });

    it('大きさの札: 一般の言葉では「大きさ 3」、スクラムの言葉では 3pt', () => {
      mount({ apiSettings: ON, apiIssueList: ISSUES, apiProjectBoard: BOARD });
      document.querySelector('[data-tab="issues"]').click();
      const list = document.getElementById('issue-list').textContent;
      expect(list).toContain('大きさ 3');
      expect(list).not.toContain('3pt');
      document.getElementById('view-board').click();
      expect(document.getElementById('board').textContent).toContain('大きさ 3');
      expect(document.getElementById('board').textContent).not.toContain('3pt');
    });

    it('使い方の絞り込みは、どちらの言葉でも節が見つかる', () => {
      for (const prefsRes of [prefsFixture(), SCRUM()]) {
        mount({ apiPrefs: prefsRes });
        document.querySelector('.nav-item[data-tab="help"]').click();
        for (const word of ['スプリント', '作業期間']) {
          const input = document.getElementById('guide-filter');
          input.value = word;
          input.dispatchEvent(new window.Event('input'));
          const shown = [...document.querySelectorAll('#guide h2')].filter((h) => !h.hidden).map((h) => h.id);
          expect(shown, word).toContain('guide-sec-scrum');
        }
      }
    });
  });

  it('言葉の表し方は、期間で進めるがオフなら設定の画面に出さない', () => {
    const items = () => [...document.querySelectorAll('#settings select')]
      .filter((el) => [...el.options].some((o) => o.value === 'scrum'));
    mount();
    document.querySelector('[data-tab="settings"]').click();
    expect(items()).toHaveLength(0);
    mount({ apiSettings: ON });
    document.querySelector('[data-tab="settings"]').click();
    expect(items()).toHaveLength(1);
  });

  it('最初に出す画面の選択肢は、サーバの {key} を言葉の表し方で埋める', () => {
    const start = (res) => {
      const p = res.items.filter((x) => x.key === 'start.tab')[0];
      p.options = p.options.concat([{ value: 'sprint', label: '{sprint}' }, { value: 'impediments', label: '{impediment}' }]);
      return res;
    };
    const labels = () => {
      const sel = [...document.querySelectorAll('#settings select')]
        .find((el) => [...el.options].some((o) => o.value === 'impediments'));
      return [...sel.options].map((o) => o.textContent);
    };
    mount({ apiSettings: ON, apiPrefs: () => start(prefsFixture()) });
    document.querySelector('[data-tab="settings"]').click();
    expect(labels()).toContain('作業期間');
    expect(labels()).toContain('困りごと');
    mount({ apiSettings: ON, apiPrefs: () => start(prefsFixture({ values: { 'terms.style': 'scrum' } })) });
    document.querySelector('[data-tab="settings"]').click();
    expect(labels()).toContain('スプリント');
    expect(labels()).toContain('障害物');
  });

  it('やることの入力欄は、オンのときだけスクラムの欄が出る', () => {
    mount();
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('issue-create-btn').click();
    expect(document.getElementById('side-body').textContent).not.toContain('できたと言える条件');

    mount({ apiSettings: ON });
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('issue-create-btn').click();
    expect(document.getElementById('side-body').textContent).toContain('ほかのやることと比べて選ぶ');
    expect(document.getElementById('side-body').textContent).toContain('できたと言える条件');
  });
});
