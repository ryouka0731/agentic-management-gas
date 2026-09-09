// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { mountApp, DEFAULTS } from './dom.js';

/**
 * 画面を実際に動かして確かめる。
 *
 * ui-structure.test.js はソースを文字列で検査するだけなので、描画も応答も
 * 確かめられない。null で落ちる、初期化が別の場所に紛れる、といった実際に
 * 起きた不具合はそこでは捕まらなかった。ここでは本当に走らせる。
 */

function mount(over) {
  return mountApp(Object.assign({}, DEFAULTS, over || {}));
}

describe('起動', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('文書の一覧から始まる', () => {
    mount();

    expect(document.getElementById('panel-docs').hidden).toBe(false);
    expect(document.getElementById('panel-issues').hidden).toBe(true);
    expect(document.querySelectorAll('.doc-card').length).toBe(1);
    expect(document.querySelector('.doc-name').textContent).toBe('就業規則.doc');
  });

  it('文書を選ぶまでタブを出さない', () => {
    mount();
    expect(document.getElementById('tabs').hidden).toBe(true);
  });

  it('テーマの切り替えが効く', () => {
    // 初期化がハンドラの中に紛れ込んでいたとき、この切り替えは死んでいた
    mount();
    const btn = document.getElementById('theme-btn');

    expect(btn.querySelector('svg')).not.toBeNull();
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();

    btn.click();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    btn.click();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    btn.click();
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });

  it('左のメニューとタブにアイコンが付く', () => {
    mount();
    document.querySelectorAll('.nav-item').forEach((el) => {
      expect(el.querySelector('svg.icon')).not.toBeNull();
    });
  });

  it('関係の流れに実数が入る', () => {
    mount();
    expect(document.getElementById('flow-issues').textContent).toBe('2');
    expect(document.getElementById('flow-prs').textContent).toBe('1');
  });
});

describe('やること', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openIssues() {
    const app = mount();
    document.querySelector('[data-tab="issues"]').click();
    return app;
  }

  it('一覧に行が並ぶ', () => {
    openIssues();

    const rows = document.querySelectorAll('#issue-list .row-item');
    expect(rows.length).toBe(2);
    expect(document.getElementById('issue-count').textContent).toBe('2 / 2件');
  });

  it('親子が入れ子になる', () => {
    openIssues();

    const rows = [...document.querySelectorAll('#issue-list .row-item')];
    const child = rows.find((r) => r.textContent.indexOf('#1') >= 0);

    expect(child.classList.contains('nested')).toBe(true);
    expect(child.style.marginLeft).toBe('40px');
  });

  it('子の工数を親に足し上げて出す', () => {
    openIssues();

    const parent = [...document.querySelectorAll('#issue-list .row-item')]
      .find((r) => r.textContent.indexOf('#2') >= 0);

    // 親8h + 子4h
    expect(parent.querySelector('.effort').textContent).toContain('予定 12h');
  });

  it('絞り込むと件数と行が減る', () => {
    openIssues();

    const box = document.getElementById('issue-filter');
    box.value = '通勤';
    box.dispatchEvent(new window.Event('input'));

    expect(document.querySelectorAll('#issue-list .row-item').length).toBe(1);
    expect(document.getElementById('issue-count').textContent).toBe('1 / 2件');
  });

  it('束ねを畳める', () => {
    openIssues();

    const head = document.querySelector('#issue-list .group-head');
    expect(head.getAttribute('aria-expanded')).toBe('true');

    head.click();
    expect(document.querySelectorAll('#issue-list .row-item').length).toBe(0);
  });

  it('サーバが null を返しても落ちない', () => {
    // 実際に起きた不具合。1つの値が欠けただけで画面全体が止まっていた
    const app = mount({ apiIssueList: null });
    document.querySelector('[data-tab="issues"]').click();

    expect(document.getElementById('fatal-error')).toBeNull();
    expect(document.getElementById('issue-count').textContent).toBe('0 / 0件');
  });

  it('見え方を切り替えられる', () => {
    openIssues();

    document.getElementById('view-board').click();
    expect(document.getElementById('board').hidden).toBe(false);
    expect(document.getElementById('issue-list').hidden).toBe(true);

    document.getElementById('view-gantt').click();
    expect(document.getElementById('gantt').hidden).toBe(false);
  });
});

describe('入力は右のパネルで受ける', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('行を押すと右に開き、対象に印が付く', () => {
    mount();
    document.querySelector('[data-tab="issues"]').click();

    const row = document.querySelector('#issue-list .row-item');
    row.querySelector('.row-open').click();

    const panel = document.getElementById('side-panel');
    expect(panel.hidden).toBe(false);
    expect(document.getElementById('side-title').textContent).toBe('やること #2');
    expect(row.classList.contains('editing')).toBe(true);
  });

  it('閉じると印も外れる', () => {
    mount();
    document.querySelector('[data-tab="issues"]').click();

    const row = document.querySelector('#issue-list .row-item');
    row.querySelector('.row-open').click();
    document.getElementById('side-close').click();

    expect(document.getElementById('side-panel').hidden).toBe(true);
    expect(document.querySelectorAll('.editing').length).toBe(0);
  });

  it('担当と期限を入れて保存できる', () => {
    const app = mount();
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list .row-item .row-open').click();

    const inputs = document.querySelectorAll('#side-body input, #side-body textarea');
    expect(inputs[2].value).toBe('me@example.com');
    expect(inputs[4].value).toBe('2026-09-30');

    inputs[2].value = 'other@example.com';
    document.querySelector('#side-body form')
      .dispatchEvent(new window.Event('submit', { cancelable: true }));

    const call = app.calls.filter((c) => c.name === 'apiIssueUpdate').pop();
    expect(call.args[0]).toBe(2);
    expect(call.args[1].assignee).toBe('other@example.com');
  });

  it('Escape で閉じられる', () => {
    mount();
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list .row-item .row-open').click();

    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.getElementById('side-panel').hidden).toBe(true);
  });
});

describe('文書', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('開くとタブが出て、正式版では直せない', () => {
    mount({ apiGetMarkdown: { markdown: '# 就業規則\n', branch: 'main', editable: false } });

    document.querySelector('.doc-open').click();

    expect(document.getElementById('tabs').hidden).toBe(false);
    expect(document.getElementById('doc-title').textContent).toBe('就業規則.doc');

    document.getElementById('mode-edit').click();
    expect(document.getElementById('editor').disabled).toBe(true);
    expect(document.getElementById('mode-hint').textContent)
      .toContain('正式版は直接なおせません');
  });

  it('文書を見ている間は左の「文書」が現在地になる', () => {
    mount();
    document.querySelector('.doc-open').click();
    document.querySelector('[data-tab="history"]').click();

    const nav = document.querySelector('.nav-item[data-tab="docs"]');
    expect(nav.getAttribute('aria-current')).toBe('true');
  });

  it('戻る道がある', () => {
    mount();
    document.querySelector('.doc-open').click();
    expect(document.getElementById('crumb-back').hidden).toBe(false);

    document.getElementById('crumb-back').click();
    expect(document.getElementById('panel-docs').hidden).toBe(false);
    expect(document.getElementById('tabs').hidden).toBe(true);
  });
});

describe('改訂中の版', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('捨てるボタンは赤い塗りで、名前を持つ', () => {
    mount();
    document.querySelector('[data-tab="branches"]').click();

    const del = document.querySelector('#branch-list .btn-danger');
    expect(del.getAttribute('aria-label')).toContain('捨てる');
    expect(del.textContent).toBe('');
    expect(del.querySelector('svg')).not.toBeNull();
  });

  it('捨てる前に確認を挟む', () => {
    const app = mount();
    document.querySelector('[data-tab="branches"]').click();
    document.querySelector('#branch-list .btn-danger').click();

    expect(document.querySelector('.confirm-strip')).not.toBeNull();
    expect(app.calls.some((c) => c.name === 'apiBranchDelete')).toBe(false);
  });
});

describe('確認依頼', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('承認が無いうちは反映できない', () => {
    mount();
    document.querySelector('[data-tab="pulls"]').click();

    const merge = [...document.querySelectorAll('#pr-detail .btn')]
      .find((b) => b.textContent.indexOf('反映') >= 0);

    expect(merge.disabled).toBe(true);
    expect(merge.title).toContain('承認');
  });

  it('自分が出した依頼は自分で承認できない', () => {
    mount({
      apiPrList: [{
        number: 1, title: '第2条の改訂', sourceBranch: '見直し', targetBranch: 'main',
        state: 'open', author: 'me@example.com', createdAt: '',
      }],
    });
    document.querySelector('[data-tab="pulls"]').click();

    const approve = [...document.querySelectorAll('#pr-detail .btn')]
      .find((b) => b.textContent.indexOf('承認') >= 0);

    expect(approve.disabled).toBe(true);
  });
});

describe('改訂の履歴', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const GRAPH = {
    rows: [{
      sha: 'bbb81520000000000000000000000000000000000000000000000000000000aa',
      parentSha: '', diffFrom: '', branch: 'main', message: '最初の記録',
      author: 'me@example.com', timestamp: '2026-09-09T07:53:00.000Z',
      lane: 0, activeLanes: [0], fork: false, forkLane: -1, merge: false,
    }],
    laneCount: 1, branches: ['main'],
  };

  function openHistory(over) {
    const app = mountApp(Object.assign({}, DEFAULTS, { apiCommitGraph: GRAPH }, over || {}));
    document.querySelector('.doc-open').click();
    document.querySelector('[data-tab="history"]').click();
    return app;
  }

  it('列見出しと行が同じ器に入る', () => {
    // 見出しだけを外に出すと、差分の幅まで含めて列が置かれ、行とずれる
    openHistory();

    const pane = document.getElementById('graph-pane');
    expect(pane.contains(document.querySelector('.graph-head'))).toBe(true);
    expect(pane.contains(document.getElementById('history-list'))).toBe(true);
  });

  it('消えた行が無い差分は1列で見せる', () => {
    openHistory({
      apiCommitDiff: [
        { type: 'insert', line: '<h1>就業規則</h1>' },
        { type: 'insert', line: '<p>第1条</p>' },
      ],
    });

    const table = document.querySelector('#diff-view .diff-split');
    expect(table.classList.contains('single')).toBe(true);
    expect(table.querySelectorAll('.diff-row')[0].children.length).toBe(1);
  });

  it('両側に中身がある差分は2列で見せる', () => {
    openHistory({
      apiCommitDiff: [
        { type: 'delete', line: '<p>古い</p>' },
        { type: 'insert', line: '<p>新しい</p>' },
      ],
    });

    const table = document.querySelector('#diff-view .diff-split');
    expect(table.classList.contains('single')).toBe(false);
    expect(table.querySelectorAll('.diff-row')[0].children.length).toBe(2);
  });

  it('差分はタグではなく種別と本文で見せる', () => {
    openHistory({
      apiCommitDiff: [{ type: 'insert', line: '<h2>第1章 総則</h2>' }],
    });

    const cell = document.querySelector('#diff-view .diff-cell');
    expect(cell.querySelector('.diff-kind').textContent).toBe('見出し2');
    expect(cell.querySelector('.diff-text').textContent).toBe('第1章 総則');
  });

  it('履歴と差分の分け目を掴んで動かせる', () => {
    openHistory();

    const handle = document.getElementById('diff-resizer');
    expect(handle.getAttribute('role')).toBe('separator');

    handle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
    const width = document.documentElement.style.getPropertyValue('--graph-pane-w');

    expect(width).not.toBe('');
    expect(window.localStorage.getItem('graphPaneWidth')).toBe(parseInt(width, 10) + '');
  });

  it('左のペインの幅も掴んで動かせる', () => {
    mount();

    const handle = document.getElementById('resizer');
    handle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));

    expect(window.localStorage.getItem('sidebarWidth')).not.toBeNull();
  });
});

describe('掴んで親子を付け替える', () => {
  beforeEach(() => { window.localStorage.clear(); });

  /** jsdom には dataTransfer が無いので、同じ形のものを持たせる */
  function dragEvent(type, number) {
    const ev = new window.Event(type, { bubbles: true, cancelable: true });
    ev.dataTransfer = {
      data: String(number),
      setData(_, v) { this.data = v; },
      getData() { return this.data; },
    };
    return ev;
  }

  function rows() {
    return [...document.querySelectorAll('#issue-list .row-item')];
  }

  function openIssues(over) {
    const app = mount(over);
    document.querySelector('[data-tab="issues"]').click();
    return app;
  }

  it('行を掴める', () => {
    openIssues();
    expect(rows()[0].draggable).toBe(true);
    expect(rows()[0].dataset.number).toBe('2');
  });

  it('掴むと解除の置き場所が出る', () => {
    openIssues();
    const zone = document.getElementById('drop-root');

    expect(zone.hidden).toBe(true);
    rows()[0].dispatchEvent(dragEvent('dragstart', 2));
    expect(zone.hidden).toBe(false);

    rows()[0].dispatchEvent(dragEvent('dragend', 2));
    expect(zone.hidden).toBe(true);
  });

  it('別のやることの上に落とすと子になる', () => {
    const app = openIssues();

    // #1 を掴んで #2 の上に落とす
    const child = rows().find((r) => r.dataset.number === '1');
    const parent = rows().find((r) => r.dataset.number === '2');

    child.dispatchEvent(dragEvent('dragstart', 1));
    parent.dispatchEvent(dragEvent('drop', 1));

    const call = app.calls.filter((c) => c.name === 'apiIssueUpdate').pop();
    expect(call.args[0]).toBe(1);
    expect(call.args[1].parent).toBe(2);
  });

  it('解除の置き場所に落とすと親が外れる', () => {
    const app = openIssues();

    document.getElementById('drop-root').dispatchEvent(dragEvent('drop', 1));

    const call = app.calls.filter((c) => c.name === 'apiIssueUpdate').pop();
    expect(call.args[0]).toBe(1);
    expect(call.args[1].parent).toBe('');
  });

  it('自分の子を親にはできない', () => {
    const app = openIssues();

    // #1 は #2 の子。#2 を #1 の上に落とそうとする
    const parent = rows().find((r) => r.dataset.number === '2');
    const child = rows().find((r) => r.dataset.number === '1');

    parent.dispatchEvent(dragEvent('dragstart', 2));
    child.dispatchEvent(dragEvent('drop', 2));

    expect(app.calls.some((c) => c.name === 'apiIssueUpdate')).toBe(false);
    expect(document.getElementById('snackbar').textContent).toContain('親にはできません');
  });
});

describe('やることの絞り込み', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openIssues(over) {
    const app = mount(over);
    document.querySelector('[data-tab="issues"]').click();
    return app;
  }

  function titles() {
    return [...document.querySelectorAll('#issue-list .row-title')]
      .map((el) => el.textContent);
  }

  it('文書名で絞り込める', () => {
    openIssues();
    const input = document.getElementById('issue-filter');

    // どちらの題名にも「就業規則」は無い。紐づく文書 DOC1 の名前で当たる
    input.value = '就業規則';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(titles()).toHaveLength(2);

    input.value = '賃金規程';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(titles()).toHaveLength(0);
  });

  it('改訂版の写しの名前では二重に数えない', () => {
    openIssues();

    const input = document.getElementById('issue-filter');
    input.value = '見直し';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));

    // 「通勤手当の見直し」の題名だけが当たる
    expect(titles()).toHaveLength(1);
  });

  it('自分の担当ボタンで自分の分だけになる', () => {
    openIssues({
      apiIssueList: [
        { ...DEFAULTS.apiIssueList[0], assignee: 'me@example.com' },
        { ...DEFAULTS.apiIssueList[1], assignee: 'other@example.com' },
      ],
    });

    document.getElementById('mine-btn').click();

    expect(titles()).toHaveLength(1);
    expect(titles()[0]).toContain('#2');
    expect(document.getElementById('mine-btn').getAttribute('aria-pressed')).toBe('true');
  });

  it('もう一度押すと全部に戻る', () => {
    openIssues();

    const btn = document.getElementById('mine-btn');
    btn.click();
    btn.click();

    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(titles().length).toBeGreaterThan(1);
  });
});

describe('やることを捨てる', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openIssues(over) {
    const app = mount(over);
    document.querySelector('[data-tab="issues"]').click();
    return app;
  }

  it('捨てるボタンは赤塗りのアイコンだけで、名前を持つ', () => {
    openIssues();
    const row = document.querySelector('#issue-list .row-item');
    const del = row.querySelector('.btn-danger');

    expect(del.textContent).toBe('');
    expect(del.querySelector('svg')).toBeTruthy();
    expect(del.getAttribute('aria-label')).toContain('捨てる');
  });

  it('確かめてからでないと捨てない', () => {
    const app = openIssues();
    document.querySelector('#issue-list .row-item .btn-danger').click();

    expect(app.calls.some((c) => c.name === 'apiIssueArchive')).toBe(false);

    const strip = document.querySelector('#panel-issues .confirm-strip');
    expect(strip.textContent).toContain('戻せます');

    strip.querySelector('.btn-primary').click();
    expect(app.calls.filter((c) => c.name === 'apiIssueArchive').pop().args[0]).toBe(2);
  });

  it('捨てたものは置き場に並び、残り日数が出る', () => {
    openIssues({
      apiIssueArchivedList: [{
        number: 7, title: '要らなくなった', state: 'open',
        archivedAt: '2026-09-01T00:00:00.000Z', daysLeft: 22,
      }],
    });
    document.getElementById('view-trash').click();

    const row = document.querySelector('#trash-list .row-item');
    expect(row.textContent).toContain('#7');
    expect(row.textContent).toContain('あと22日');
  });

  it('置き場から元に戻せる', () => {
    const app = openIssues({
      apiIssueArchivedList: [{
        number: 7, title: '戻す', state: 'open',
        archivedAt: '2026-09-01T00:00:00.000Z', daysLeft: 22,
      }],
    });
    document.getElementById('view-trash').click();

    [...document.querySelectorAll('#trash-list .btn')]
      .find((b) => b.textContent.includes('元に戻す')).click();

    expect(app.calls.filter((c) => c.name === 'apiIssueRestore').pop().args[0]).toBe(7);
  });

  it('完全に消すのは確かめてから', () => {
    const app = openIssues({
      apiIssueArchivedList: [{
        number: 7, title: '消す', state: 'open',
        archivedAt: '2026-09-01T00:00:00.000Z', daysLeft: 22,
      }],
    });
    document.getElementById('view-trash').click();
    document.querySelector('#trash-list .btn-danger').click();

    expect(app.calls.some((c) => c.name === 'apiIssuePurge')).toBe(false);

    const strip = document.querySelector('#panel-issues .confirm-strip');
    expect(strip.textContent).toContain('もう戻せません');
    strip.querySelector('.btn-primary').click();

    expect(app.calls.filter((c) => c.name === 'apiIssuePurge').pop().args[0]).toBe(7);
  });

  it('置き場では絞り込みと束ね方を隠す', () => {
    openIssues();
    document.getElementById('view-trash').click();

    expect(document.getElementById('issue-filter').parentNode.hidden).toBe(true);
    expect(document.getElementById('mine-btn').hidden).toBe(true);
  });

  it('置き場が空なら何が起きるかを説明する', () => {
    openIssues();
    document.getElementById('view-trash').click();

    expect(document.getElementById('trash-list').textContent).toContain('30日');
  });
});

describe('動きのないやることの見た目', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openIssues(over) {
    const app = mount(over);
    document.querySelector('[data-tab="issues"]').click();
    return app;
  }

  function withStale(level, days) {
    return {
      apiIssueList: [{
        ...DEFAULTS.apiIssueList[0], parent: '',
        staleLevel: level, staleDays: days,
      }],
    };
  }

  it('動きがあるうちは何も付かない', () => {
    openIssues(withStale(0, 2));
    const row = document.querySelector('#issue-list .row-item');

    expect(row.className).not.toContain('rot-');
    expect(row.querySelector('.stale-badge')).toBe(null);
  });

  it('放っておくほど段階が上がる', () => {
    openIssues(withStale(3, 40));
    const row = document.querySelector('#issue-list .row-item');

    expect(row.classList.contains('rot-3')).toBe(true);
  });

  it('色だけに頼らず日数も出す', () => {
    openIssues(withStale(2, 20));
    const badge = document.querySelector('#issue-list .stale-badge');

    expect(badge.textContent).toContain('20日動きなし');
    expect(document.querySelector('#issue-list .row-item').title).toContain('20日間');
  });

  it('ボードのカードも傷む', () => {
    openIssues({
      apiProjectBoard: {
        Backlog: [{
          issueNumber: 5, order: 0, title: '忘れられた', state: 'open',
          assignee: '', labels: '', dueDate: '', staleLevel: 3, staleDays: 60,
        }],
        'In Progress': [], 'In Review': [], Done: [],
      },
    });
    document.getElementById('view-board').click();

    const card = document.querySelector('.board-card');
    expect(card.classList.contains('rot-3')).toBe(true);
    expect(card.textContent).toContain('60日動きなし');
  });
});

describe('改訂の履歴の列', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openHistory() {
    const app = mount();
    document.querySelector('[data-tab="docs"]').click();
    document.querySelector('#doc-list .doc-open').click();
    document.querySelector('.tab[data-tab="history"]').click();
    return app;
  }

  it('見出しと行の列がひとつずつ対応する', () => {
    openHistory();

    const head = [...document.querySelectorAll('.graph-head > *')]
      .map((el) => el.className);
    const row = [...document.querySelectorAll('#history-list .graph-row')[0].children]
      .map((el) => el.getAttribute('class'));

    // 先頭は系統。見出しは span、行は SVG なので別のクラス名になる
    expect(head[0]).toBe('graph-col-graph');
    expect(row[0]).toBe('graph-cell');
    expect(head.slice(1)).toEqual(row.slice(1).map((c) => c.split(' ')[0]));
  });

  it('系統の列幅は見出しと行で同じ変数から引く', () => {
    openHistory();
    const css = document.querySelector('style').textContent;

    expect(css).toContain('.graph-col-graph { flex: 0 0 var(--graph-w); }');
    expect(css).toContain('.graph-cell { flex: 0 0 var(--graph-w); }');
  });

  it('履歴の一覧は幅を固定しない', () => {
    openHistory();
    const list = document.getElementById('history-list');

    // 320px 固定のままだと、見出しだけが広がって列がずれる
    expect(window.getComputedStyle(list).width).not.toBe('320px');
  });

  it('境界を掴むと幅が変わる', () => {
    openHistory();
    const handle = document.getElementById('diff-resizer');

    handle.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    const move = new window.Event('pointermove', { bubbles: true });
    move.clientX = 700;
    handle.dispatchEvent(move);

    expect(document.documentElement.style.getPropertyValue('--graph-pane-w'))
      .toMatch(/px$/);
  });
});

describe('改訂中の版', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openDrafts() {
    const app = mount();
    document.querySelector('[data-tab="branches"]').click();
    return app;
  }

  it('版を押すとその版の本文が開く', () => {
    const app = openDrafts();

    document.querySelector('#branch-list .row-open').click();

    // 見直しの版の写しは W1
    const call = app.calls.filter((c) => c.name === 'apiGetFileHtml').pop();
    expect(call.args[0]).toBe('W1');
    expect(document.getElementById('doc-title').textContent).toBe('就業規則.doc');
  });

  it('どの文書の版かが一覧で分かる', () => {
    openDrafts();
    const row = document.querySelector('#branch-list .row-item');

    expect(row.textContent).toContain('就業規則.doc');
  });

  it('文書のない版は押せない', () => {
    const app = mount({
      apiBranchList: [
        { name: 'main', headSha: 'a', baseSha: '', state: 'open', createdBy: 'me@example.com', createdAt: '' },
        { name: '空の版', headSha: 'b', baseSha: 'a', state: 'open', createdBy: 'me@example.com', createdAt: '' },
      ],
    });
    document.querySelector('[data-tab="branches"]').click();

    const open = document.querySelector('#branch-list .row-open');
    expect(open.disabled).toBe(true);
    expect(app.calls.some((c) => c.name === 'apiGetFileHtml')).toBe(false);
  });
});
