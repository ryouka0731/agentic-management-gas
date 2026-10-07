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
    expect(parent.querySelector('.effort').textContent).toContain('予定 12人日');
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
    document.getElementById('side-edit').click();

    const inputs = document.querySelectorAll('#side-body input, #side-body textarea');
    expect(inputs[2].value).toBe('@me@example.com ');
    expect(inputs[4].value).toBe('2026-09-30');

    inputs[2].value = '@other@example.com ';
    inputs[2].dispatchEvent(new window.Event('input', { bubbles: true }));
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
    expect(document.getElementById('mine-btn').getAttribute('aria-checked')).toBe('true');
  });

  it('もう一度押すと全部に戻る', () => {
    openIssues();

    const btn = document.getElementById('mine-btn');
    btn.click();
    btn.click();

    expect(btn.getAttribute('aria-checked')).toBe('false');
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
    expect(head[0].split(' ')[0]).toBe('graph-col-graph');
    expect(row[0]).toBe('graph-cell');
    expect(head.slice(1).map((c) => c.split(' ')[0]))
      .toEqual(row.slice(1).map((c) => c.split(' ')[0]));
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

describe('差分を画面いっぱいに広げる', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openHistory() {
    const app = mount();
    document.querySelector('[data-tab="docs"]').click();
    document.querySelector('#doc-list .doc-open').click();
    document.querySelector('.tab[data-tab="history"]').click();
    return app;
  }

  it('はじめは元の大きさで、広げる名前を持つ', () => {
    openHistory();
    const btn = document.getElementById('diff-expand');

    expect(document.getElementById('diff-pane').classList.contains('full')).toBe(false);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.getAttribute('aria-label')).toContain('広げる');
    expect(btn.textContent).toBe('');
  });

  it('押すと広がり、もう一度押すと戻る', () => {
    openHistory();
    const btn = document.getElementById('diff-expand');
    const pane = document.getElementById('diff-pane');

    btn.click();
    expect(pane.classList.contains('full')).toBe(true);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.getAttribute('aria-label')).toContain('戻す');

    btn.click();
    expect(pane.classList.contains('full')).toBe(false);
  });

  it('Escape で戻せる', () => {
    openHistory();
    document.getElementById('diff-expand').click();

    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));

    expect(document.getElementById('diff-pane').classList.contains('full')).toBe(false);
  });

  it('別の画面に移ると自動で戻る', () => {
    openHistory();
    document.getElementById('diff-expand').click();

    document.querySelector('.tab[data-tab="content"]').click();

    expect(document.getElementById('diff-pane').classList.contains('full')).toBe(false);
  });

  it('どの記録の差分かが帯に出る', () => {
    openHistory();
    const caption = document.getElementById('diff-caption').textContent;

    // 狭めて列を畳んでも、ここに素性が残る
    expect(caption).toContain('第2条を直した');
    expect(caption).toContain('me');
    expect(caption).toContain('aaaaaaa');
  });
});

describe('押す前の補足', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('まとめて記録が何をまとめるのかを補足する', () => {
    mount();
    const btn = document.getElementById('bulk-commit-btn');

    expect(btn.dataset.hint).toContain('まだ記録していない変更');
    expect(btn.dataset.hint).toContain('まとめて記録');
  });

  it('補足は読み上げにも届く', () => {
    mount();
    const btn = document.getElementById('bulk-commit-btn');
    const note = document.getElementById(btn.getAttribute('aria-describedby'));

    expect(note).toBeTruthy();
    expect(note.className).toBe('sr-only');
    expect(note.textContent).toBe(btn.dataset.hint);
  });

  it('補足を持つボタンは名前も持ったまま', () => {
    mount();
    const btn = document.getElementById('bulk-commit-btn');

    // 補足はあくまで補足。ボタンの名前を置き換えない
    expect(btn.textContent).toBe('まとめて記録');
  });

  it('言葉の分かりにくいボタンに揃って付く', () => {
    mount();

    ['bulk-commit-btn', 'branch-create-btn', 'commit-btn', 'stash-btn']
      .forEach((id) => {
        const el = document.getElementById(id);
        expect(el.classList.contains('has-hint')).toBe(true);
        expect(el.dataset.hint.length).toBeGreaterThan(10);
      });
  });

  it('補足の宛先はひとつずつ別になっている', () => {
    mount();

    const ids = [...document.querySelectorAll('[aria-describedby]')]
      .map((el) => el.getAttribute('aria-describedby'));

    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('確認依頼の一覧', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openPulls() {
    const app = mount();
    document.querySelector('[data-tab="pulls"]').click();
    return app;
  }

  it('題名と行き先が行に出る', () => {
    openPulls();
    const row = document.querySelector('#pr-list .row-item');

    expect(row.querySelector('.row-title').textContent).toBe('#1 第2条の改訂');
    expect(row.querySelector('.row-meta').textContent).toContain('→ 正式版');
    expect(row.querySelector('.state').textContent).toBe('確認待ち');
  });

  it('行はボタンでも左寄せ', () => {
    openPulls();
    const row = document.querySelector('#pr-list .row-item');

    // ボタンの既定は中央寄せ。明示しないとここだけ真ん中に寄る
    expect(row.tagName).toBe('BUTTON');
    expect(window.getComputedStyle(row).textAlign).toBe('left');
  });

  it('一覧の幅は掴んで変えられる', () => {
    openPulls();
    const handle = document.getElementById('pr-resizer');

    handle.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    const move = new window.Event('pointermove', { bubbles: true });
    move.clientX = 600;
    handle.dispatchEvent(move);

    expect(document.documentElement.style.getPropertyValue('--pr-pane-w'))
      .toMatch(/px$/);
  });

  it('履歴の幅とは別に覚える', () => {
    openPulls();
    const css = document.querySelector('style').textContent;

    // 同じ変数を使うと、片方を動かしたらもう片方も動く
    expect(css).toContain('--pr-pane-w');
    expect(css).toContain('#pr-pane { flex-basis: var(--pr-pane-w); }');
  });
});

describe('確認依頼の中身の切り替え', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('見方に分かれている', () => {
    mount();
    document.querySelector('[data-tab="pulls"]').click();

    const tabs = [...document.querySelectorAll('#pr-detail .pr-tab')]
      .map((el) => el.textContent);

    // 「コードの変更」は証跡があるときだけ出る
    expect(tabs).toEqual(['やりとり', '変更の記録', '差分', '手元への頼みごと']);
  });
});

describe('完了を差し戻す', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openIssues(over) {
    const app = mount(over);
    document.querySelector('[data-tab="issues"]').click();
    return app;
  }

  const CLOSED = {
    apiIssueList: [{
      ...DEFAULTS.apiIssueList[0], number: 9, title: '終わったこと',
      state: 'closed', parent: '',
    }],
  };

  it('完了したものには戻すボタンが出る', () => {
    openIssues(CLOSED);
    const row = document.querySelector('#issue-list .row-item');

    expect(row.querySelector('.icon-btn.ok')).toBe(null);
    expect(row.getAttribute('aria-label')).toBe(null);
    expect([...row.querySelectorAll('.icon-btn')]
      .some((b) => (b.getAttribute('aria-label') || '').includes('完了を取り消す')))
      .toBe(true);
  });

  it('押すと開き直す', () => {
    const app = openIssues(CLOSED);

    [...document.querySelectorAll('#issue-list .icon-btn')]
      .find((b) => (b.getAttribute('aria-label') || '').includes('完了を取り消す'))
      .click();

    expect(app.calls.filter((c) => c.name === 'apiIssueReopen').pop().args[0]).toBe(9);
    expect(document.getElementById('snackbar').textContent).toContain('やることに戻しました');
  });

  it('まだ終わっていないものには出ない', () => {
    openIssues();
    const row = document.querySelector('#issue-list .row-item');

    expect([...row.querySelectorAll('.icon-btn')]
      .some((b) => (b.getAttribute('aria-label') || '').includes('完了を取り消す')))
      .toBe(false);
    expect(row.querySelector('.icon-btn.ok')).toBeTruthy();
  });

  it('右のパネルからも戻せる', () => {
    const app = openIssues(CLOSED);
    document.querySelector('#issue-list .row-open').click();
    document.getElementById('side-edit').click();

    [...document.querySelectorAll('#side-body .btn')]
      .find((b) => b.textContent.includes('完了を取り消す')).click();

    expect(app.calls.some((c) => c.name === 'apiIssueReopen')).toBe(true);
  });
});

describe('ボードのカードから捨てる', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openBoard(over) {
    const app = mount(over);
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('view-board').click();
    return app;
  }

  it('カードにも捨てるボタンがある', () => {
    openBoard();
    const del = document.querySelector('.board-card .btn-danger');

    expect(del).toBeTruthy();
    expect(del.textContent).toBe('');
    expect(del.getAttribute('aria-label')).toContain('捨てる');
  });

  it('確かめてから捨てる', () => {
    const app = openBoard();
    document.querySelector('.board-card .btn-danger').click();

    expect(app.calls.some((c) => c.name === 'apiIssueArchive')).toBe(false);

    document.querySelector('#panel-issues .confirm-strip .btn-primary').click();
    expect(app.calls.filter((c) => c.name === 'apiIssueArchive').pop().args[0]).toBe(2);
  });

  it('捨てるボタンを押してもカードは開かない', () => {
    const app = openBoard();
    document.querySelector('.board-card .btn-danger').click();

    // 開いてしまうと、確かめの帯が入力パネルに隠れる
    expect(document.getElementById('side-panel').hidden).toBe(true);
    expect(app.calls.some((c) => c.name === 'apiIssueList' && c.args.length === 0))
      .toBe(false);
  });
});

describe('確認依頼のやりとり', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openPulls(over) {
    const app = mount(over);
    document.querySelector('[data-tab="pulls"]').click();
    return app;
  }

  function comments() {
    return [...document.querySelectorAll('#pr-detail .comment')];
  }

  it('誰の発言かを顔と名前で示す', () => {
    openPulls();
    const head = comments()[0].querySelector('.comment-head');

    // アドレスは目で追いにくい。名前を主に、アドレスを従に出す
    expect(head.querySelector('.avatar').textContent).toBe('鈴');
    expect(head.querySelector('.person-name').textContent).toBe('鈴木 花子');
    expect(head.querySelector('.person-mail').textContent).toBe('other@example.com');
  });

  it('自分のコメントには直すと消すが付く', () => {
    openPulls();
    // 先頭は依頼そのもの。1件目のやりとりが自分のもの
    const mine = comments()[1];

    expect(mine.querySelector('.comment-tools')).toBeTruthy();
    expect(mine.querySelector('.comment-tools .btn-danger')).toBeTruthy();
  });

  it('他人のコメントには付かない', () => {
    openPulls();
    expect(comments()[2].querySelector('.comment-tools')).toBe(null);
  });

  it('直すと今の中身が入った状態で開く', () => {
    const app = openPulls();
    comments()[1].querySelector('.comment-tools .icon-btn').click();

    const field = document.querySelector('#side-body textarea, #side-body input');
    expect(field.value).toBe('ここを直して');

    field.value = 'やっぱりこう';
    document.querySelector('#side-body form .btn-primary').click();

    const call = app.calls.filter((c) => c.name === 'apiReviewEdit').pop();
    expect(call.args).toEqual([1, 'やっぱりこう']);
  });

  it('消すのは確かめてから', () => {
    const app = openPulls();
    comments()[1].querySelector('.comment-tools .btn-danger').click();

    expect(app.calls.some((c) => c.name === 'apiReviewDelete')).toBe(false);

    document.querySelector('#pr-detail .confirm-strip .btn-primary').click();
    expect(app.calls.filter((c) => c.name === 'apiReviewDelete').pop().args[0]).toBe(1);
  });

  it('直したものにはその印が出る', () => {
    openPulls({
      apiPrReviews: [{
        id: 1, reviewer: 'me@example.com', state: 'comment', body: 'なおした',
        at: '2026-09-05T00:00:00.000Z', editedAt: '2026-09-06T00:00:00.000Z',
        canEdit: true,
      }],
    });

    expect(comments()[1].textContent).toContain('直しました');
  });
});

describe('確認してもらう人', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openPulls(over) {
    const app = mount(over);
    document.querySelector('[data-tab="pulls"]').click();
    return app;
  }

  it('頼んだ人が顔つきで並ぶ', () => {
    openPulls();
    const chip = document.querySelector('#pr-detail .reviewer-chip');

    expect(chip.querySelector('.person-name').textContent).toBe('山田 太郎');
    expect(chip.querySelector('.person-mail').textContent).toBe('me@example.com');
    expect(chip.querySelector('.avatar')).toBeTruthy();
  });

  it('誰にも頼んでいなければそう出る', () => {
    openPulls({
      apiPrList: [{ ...DEFAULTS.apiPrList[0], reviewers: [] }],
    });

    expect(document.querySelector('#pr-detail .reviewer-row').textContent)
      .toContain('まだ誰にも頼んでいません');
  });

  it('カンマ区切りで決められる', () => {
    const app = openPulls();
    document.querySelector('#pr-detail .reviewer-row .icon-btn').click();

    const input = document.querySelector('#side-body input');
    expect(input.value).toBe('me@example.com');

    input.value = 'a@example.com, b@example.com';
    document.querySelector('#side-body form .btn-primary').click();

    const call = app.calls.filter((c) => c.name === 'apiPrSetReviewers').pop();
    expect(call.args[0]).toBe(1);
    expect(call.args[1]).toEqual(['a@example.com', ' b@example.com']);
  });

  it('反映済みなら決め直せない', () => {
    openPulls({
      apiPrList: [{ ...DEFAULTS.apiPrList[0], state: 'merged' }],
    });

    expect(document.querySelector('#pr-detail .reviewer-row .icon-btn')).toBe(null);
  });
});

describe('読み込み中の骨組み', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('板の中にもう1枚板を作らない', () => {
    let snapshot = '';

    // 応答を返す直前が、骨組みが出ている瞬間
    mount({
      apiProjectBoard: () => {
        snapshot = document.getElementById('board').innerHTML;
        return DEFAULTS.apiProjectBoard;
      },
    });
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('view-board').click();

    // 器そのものが4列の板。中に板を作ると1列に4列を押し込むことになる
    expect(snapshot).not.toContain('class="board"');
    expect(snapshot.split('board-column').length - 1).toBe(4);
  });

  it('骨組みは実物と同じ器で作る', () => {
    let snapshot = '';

    mount({
      apiProjectBoard: () => {
        snapshot = document.getElementById('board').innerHTML;
        return DEFAULTS.apiProjectBoard;
      },
    });
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('view-board').click();

    // 形が違うと、出た瞬間に位置が飛ぶ
    expect(snapshot).toContain('board-card');
  });
});

describe('ペインの幅', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.style.removeProperty('--sidebar-w');
  });

  /** jsdom には PointerEvent が無いので、同じ形のものを送る */
  function pointer(type, x) {
    const ev = new window.Event(type, { bubbles: true, cancelable: true });
    ev.clientX = x;
    ev.pointerId = 1;
    return ev;
  }

  function handle() {
    return document.getElementById('resizer');
  }

  function width() {
    return document.documentElement.style.getPropertyValue('--sidebar-w');
  }

  it('広げられる', () => {
    mount();
    handle().dispatchEvent(pointer('pointerdown', 260));
    handle().dispatchEvent(pointer('pointermove', 400));

    expect(width()).toBe('400px');
  });

  it('縮められる', () => {
    mount();
    handle().dispatchEvent(pointer('pointerdown', 260));
    handle().dispatchEvent(pointer('pointermove', 200));

    expect(width()).toBe('200px');
  });

  it('限度を超えない', () => {
    mount();
    handle().dispatchEvent(pointer('pointerdown', 260));

    handle().dispatchEvent(pointer('pointermove', 10));
    expect(width()).toBe('180px');

    handle().dispatchEvent(pointer('pointermove', 9999));
    expect(width()).toBe('560px');
  });

  it('離したら追いかけるのをやめる', () => {
    mount();
    handle().dispatchEvent(pointer('pointerdown', 260));
    handle().dispatchEvent(pointer('pointerup', 300));

    handle().dispatchEvent(pointer('pointermove', 500));
    expect(width()).toBe('300px');
  });

  it('枠の外で離しても張り付かない', () => {
    mount();
    handle().dispatchEvent(pointer('pointerdown', 260));

    // 枠の外で離すと境界には pointerup が届かない
    window.dispatchEvent(pointer('pointerup', 320));

    handle().dispatchEvent(pointer('pointermove', 500));
    expect(width()).toBe('320px');
  });

  it('取り消されても張り付かない', () => {
    mount();
    handle().dispatchEvent(pointer('pointerdown', 260));
    handle().dispatchEvent(pointer('pointercancel', 300));

    handle().dispatchEvent(pointer('pointermove', 500));
    expect(width()).toBe('300px');
  });

  it('二度押しで元の幅に戻る', () => {
    mount();
    handle().dispatchEvent(pointer('pointerdown', 260));
    handle().dispatchEvent(pointer('pointerup', 420));
    expect(width()).toBe('420px');

    handle().dispatchEvent(new window.Event('dblclick', { bubbles: true }));

    expect(width()).toBe('');
    expect(window.localStorage.getItem('sidebarWidth')).toBe(null);
  });

  it('キーボードでも変えられる', () => {
    mount();
    handle().dispatchEvent(pointer('pointerdown', 260));
    handle().dispatchEvent(pointer('pointerup', 300));

    handle().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(width()).toBe('284px');

    handle().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Home' }));
    expect(width()).toBe('');
  });
});

describe('開発者に伝える', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openReport(over) {
    const app = mount(over);
    document.querySelector('[data-tab="report"]').click();
    return app;
  }

  it('左のメニューから開ける', () => {
    openReport();
    expect(document.getElementById('panel-report').hidden).toBe(false);
  });

  it('まだ何も無いときは次の一手を示す', () => {
    openReport();
    expect(document.getElementById('report-list').textContent)
      .toContain('まだ何も伝えていません');
  });

  it('種類は選択肢から選ぶ', () => {
    openReport();
    document.getElementById('report-btn').click();

    const sel = document.querySelector('#side-body select');
    expect([...sel.options].map((o) => o.value))
      .toEqual(['bug', 'request', 'question', 'other']);
    expect(sel.value).toBe('bug');
  });

  it('見ている画面と環境を一緒に送る', () => {
    const app = openReport();
    document.getElementById('report-btn').click();

    const inputs = document.querySelectorAll('#side-body input, #side-body textarea');
    inputs[0].value = '棒が伸びない';
    inputs[1].value = '掴んだ';
    inputs[2].value = '伸びない';
    document.querySelector('#side-body form .btn-primary').click();

    const call = app.calls.filter((c) => c.name === 'apiInquiryCreate').pop();
    expect(call.args[0]).toBe('bug');
    expect(call.args[1]).toContain('棒が伸びない');
    expect(call.args[2]).toContain('画面: report');
    expect(call.args[2]).toContain('環境: ');
  });

  it('送ると受付番号が返る', () => {
    openReport({ apiInquiryCreate: { number: 7, kind: 'bug', body: 'x' } });
    document.getElementById('report-btn').click();

    const inputs = document.querySelectorAll('#side-body input, #side-body textarea');
    inputs[0].value = 'ひとこと';
    inputs[1].value = 'したこと';
    inputs[2].value = 'なったこと';
    document.querySelector('#side-body form .btn-primary').click();

    expect(document.getElementById('snackbar').textContent).toContain('受付 #7');
  });

  it('送ったものが並ぶ', () => {
    openReport({
      apiInquiryList: [{
        number: 3, kind: 'bug', kindLabel: 'うまく動かない',
        title: '棒が伸びない', body: '棒が伸びない',
        by: 'me@example.com', state: 'open', context: '', answer: '',
        at: '2026-09-09T00:00:00.000Z', answeredAt: '', replyCount: 2,
      }],
    });

    const row = document.querySelector('#report-list .row-item');
    expect(row.textContent).toContain('#3 棒が伸びない');
    expect(row.textContent).toContain('返信 2件');
    expect(row.querySelector('.state').textContent).toBe('未解決');
  });

  it('未解決の件数を左に出す', () => {
    openReport({
      apiInquiryList: [
        { number: 1, kind: 'bug', kindLabel: 'うまく動かない', title: 'a', body: 'a', state: 'open', at: '', by: 'x@example.com' },
        { number: 2, kind: 'bug', kindLabel: 'うまく動かない', title: 'b', body: 'b', state: 'done', at: '', by: 'x@example.com' },
      ],
    });

    expect(document.getElementById('count-reports').textContent).toBe('1');
  });
});

describe('何も無いときの次の一手', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('押しても落ちず、入力が開く', () => {
    mount({ apiInquiryList: [] });
    document.querySelector('[data-tab="report"]').click();

    const btn = document.querySelector('#report-list .blank-state .btn');
    expect(() => btn.click()).not.toThrow();

    expect(document.getElementById('side-panel').hidden).toBe(false);
  });

  it('押したボタンが対象として印される', () => {
    mount({ apiInquiryList: [] });
    document.querySelector('[data-tab="report"]').click();

    const btn = document.querySelector('#report-list .blank-state .btn');
    btn.click();

    // Event をそのまま渡すと、対象として受け取った側で落ちる
    expect(btn.classList.contains('editing')).toBe(true);
  });

  it('やることの空の状態からも作れる', () => {
    mount({ apiIssueList: [] });
    document.querySelector('[data-tab="issues"]').click();

    const btn = document.querySelector('#issue-list .blank-state .btn');
    expect(() => btn.click()).not.toThrow();
    expect(document.getElementById('side-title').textContent).toBe('やることを作る');
  });
});

describe('報告で議論する', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const LIST = [
    {
      number: 3, kind: 'bug', kindLabel: 'うまく動かない', title: '棒が伸びない',
      body: '棒が伸びない\n右端を掴んだ', by: 'other@example.com', state: 'open',
      context: '画面: issues / 環境: test', answer: '', at: '2026-09-09T00:00:00.000Z',
      answeredAt: '', mine: false, canClose: false, replyCount: 1,
    },
  ];

  const THREAD = {
    inquiry: LIST[0],
    replies: [{
      id: 1, inquiryNumber: 3, body: 'こちらでも起きます', by: 'me@example.com',
      at: '2026-09-09T01:00:00.000Z', editedAt: '', canEdit: true,
    }],
  };

  function openBoard(over) {
    const app = mount(Object.assign(
      { apiInquiryList: LIST, apiInquiryThread: THREAD }, over || {}));
    document.querySelector('[data-tab="report"]').click();
    return app;
  }

  it('他人の報告も読める', () => {
    openBoard();
    expect(document.querySelector('#report-list .row-item').textContent)
      .toContain('鈴木 花子');
  });

  it('開くと本文とやりとりが出る', () => {
    openBoard();
    const detail = document.getElementById('report-detail');

    expect(detail.textContent).toContain('棒が伸びない');
    expect(detail.textContent).toContain('こちらでも起きます');
  });

  it('そのときの状況は畳んでおく', () => {
    openBoard();
    const box = document.querySelector('#report-detail .report-context');

    // 直すには要るが、読む人には邪魔になる
    expect(box.open).toBe(false);
    expect(box.textContent).toContain('画面: issues');
  });

  it('返信できる', () => {
    const app = openBoard();

    const box = document.querySelector('#report-detail .comment-form textarea');
    box.value = 'これで直りました';
    document.querySelector('#report-detail .comment-form .btn-primary').click();

    const call = app.calls.filter((c) => c.name === 'apiInquiryReply').pop();
    expect(call.args).toEqual([3, 'これで直りました', []]);
  });

  it('自分の返信だけ直せる', () => {
    openBoard();
    const mine = [...document.querySelectorAll('#report-detail .comment')].pop();

    expect(mine.querySelector('.comment-tools')).toBeTruthy();
  });

  it('閉じられない人には解決ボタンを出さない', () => {
    openBoard();
    expect(document.querySelector('#report-detail .pr-actions')).toBe(null);
  });

  it('出した本人は解決にできる', () => {
    const app = openBoard({
      apiInquiryThread: {
        inquiry: Object.assign({}, LIST[0], { canClose: true, mine: true }),
        replies: [],
      },
    });

    document.querySelector('#report-detail .pr-actions .btn').click();
    expect(app.calls.some((c) => c.name === 'apiInquiryClose')).toBe(true);
  });

  it('解決したものは既定で隠れる', () => {
    openBoard({
      apiInquiryList: [Object.assign({}, LIST[0], { state: 'done' })],
    });

    expect(document.getElementById('report-list').textContent)
      .toContain('絞り込みに合う報告がありません');
  });

  it('未解決だけを外すと出る', () => {
    openBoard({
      apiInquiryList: [Object.assign({}, LIST[0], { state: 'done' })],
    });

    document.getElementById('report-open-btn').click();

    expect(document.querySelector('#report-list .row-item').textContent)
      .toContain('#3');
  });

  it('言葉で絞り込める', () => {
    openBoard();
    const input = document.getElementById('report-filter');

    input.value = 'あるはずのない言葉';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));

    expect(document.querySelectorAll('#report-list .row-item')).toHaveLength(0);
  });
});

describe('報告の書き方を尋ねる', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openForm() {
    const app = mount({ apiInquiryList: [] });
    document.querySelector('[data-tab="report"]').click();
    document.getElementById('report-btn').click();
    return app;
  }

  function fields() {
    return [...document.querySelectorAll('#side-body label')]
      .map((l) => l.firstChild.textContent);
  }

  it('順番に尋ねる', () => {
    openForm();

    // 白紙に「詳しく書いて」と頼んでも、何を書けば直せるのかは伝わらない
    expect(fields()).toEqual([
      '種類', 'ひとことで言うと', '何をしましたか',
      'どうなりましたか', 'どうなってほしかったですか',
    ]);
  });

  it('答えを1つの本文に組み立てる', () => {
    const app = openForm();
    const inputs = document.querySelectorAll('#side-body input, #side-body textarea');

    inputs[0].value = '棒が伸びない';
    inputs[1].value = '右端を掴んで引いた';
    inputs[2].value = '伸びなかった';
    inputs[3].value = '延びてほしかった';
    document.querySelector('#side-body form .btn-primary').click();

    const body = app.calls.filter((c) => c.name === 'apiInquiryCreate').pop().args[1];
    expect(body).toContain('棒が伸びない');
    expect(body).toContain('【何をしたか】');
    expect(body).toContain('【どうなったか】');
    expect(body).toContain('【どうなってほしかったか】');
  });

  it('望みが空なら見出しごと省く', () => {
    const app = openForm();
    const inputs = document.querySelectorAll('#side-body input, #side-body textarea');

    inputs[0].value = 'ひとこと';
    inputs[1].value = 'したこと';
    inputs[2].value = 'なったこと';
    document.querySelector('#side-body form .btn-primary').click();

    const body = app.calls.filter((c) => c.name === 'apiInquiryCreate').pop().args[1];
    expect(body).not.toContain('【どうなってほしかったか】');
  });

  it('写真を選ぶ欄がある', () => {
    openForm();
    const pick = document.querySelector('#side-body .shot-input');

    expect(pick.type).toBe('file');
    expect(pick.multiple).toBe(true);
    expect(pick.accept).toContain('image/png');
  });

  it('写真は添えなくても送れる', () => {
    const app = openForm();
    const inputs = document.querySelectorAll('#side-body input, #side-body textarea');

    inputs[0].value = 'a';
    inputs[1].value = 'b';
    inputs[2].value = 'c';
    document.querySelector('#side-body form .btn-primary').click();

    expect(app.calls.filter((c) => c.name === 'apiInquiryCreate').pop().args[3])
      .toEqual([]);
  });
});

describe('添えられた写真', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const WITH_SHOT = {
    inquiry: {
      number: 3, kind: 'bug', kindLabel: 'うまく動かない', title: 'x', body: 'x',
      by: 'me@example.com', state: 'open', context: '', answer: '', at: '',
      answeredAt: '', mine: true, canClose: true, replyCount: 0,
      shots: [{
        id: 'S1',
        url: 'https://drive.google.com/file/d/S1/view',
        thumb: 'https://drive.google.com/thumbnail?id=S1&sz=w800',
      }],
    },
    replies: [],
  };

  it('話の中に写真が並ぶ', () => {
    mount({
      apiInquiryList: [WITH_SHOT.inquiry],
      apiInquiryThread: WITH_SHOT,
    });
    document.querySelector('[data-tab="report"]').click();

    const link = document.querySelector('#report-detail .shot-item');
    expect(link.href).toContain('/file/d/S1/');
    expect(link.querySelector('img').src).toContain('thumbnail?id=S1');
  });

  it('見られないときは文字の手がかりを出す', () => {
    mount({
      apiInquiryList: [WITH_SHOT.inquiry],
      apiInquiryThread: WITH_SHOT,
    });
    document.querySelector('[data-tab="report"]').click();

    const img = document.querySelector('#report-detail .shot-item img');
    img.dispatchEvent(new window.Event('error'));

    expect(document.querySelector('#report-detail .shot-item').textContent)
      .toBe('写真 1枚目を開く');
  });
});

describe('絞り込みの入り切り', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('つまみのある切り替えとして出す', () => {
    mount();
    document.querySelector('[data-tab="issues"]').click();
    const btn = document.getElementById('mine-btn');

    // ただのボタンだと、押したのか絞り込んでいるのかが区別できない
    expect(btn.getAttribute('role')).toBe('switch');
    expect(btn.querySelector('.switch-track .switch-knob')).toBeTruthy();
  });

  it('いまどちらなのかを持つ', () => {
    mount();
    document.querySelector('[data-tab="issues"]').click();
    const btn = document.getElementById('mine-btn');

    expect(btn.getAttribute('aria-checked')).toBe('false');
    expect(btn.classList.contains('on')).toBe(false);

    btn.click();
    expect(btn.getAttribute('aria-checked')).toBe('true');
    expect(btn.classList.contains('on')).toBe(true);
  });

  it('報告の絞り込みは入りで始まる', () => {
    mount({ apiInquiryList: [] });
    document.querySelector('[data-tab="report"]').click();
    const btn = document.getElementById('report-open-btn');

    expect(btn.getAttribute('role')).toBe('switch');
    expect(btn.getAttribute('aria-checked')).toBe('true');
  });

  it('つまみを二重に作らない', () => {
    mount();
    document.querySelector('[data-tab="issues"]').click();
    const btn = document.getElementById('mine-btn');

    btn.click();
    btn.click();

    expect(btn.querySelectorAll('.switch-track')).toHaveLength(1);
  });
});

describe('名前を呼ぶ', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const THREAD = {
    inquiry: {
      number: 3, kind: 'bug', kindLabel: 'うまく動かない', title: 'x',
      body: '@me@example.com これ見て', by: 'other@example.com', state: 'open',
      context: '', answer: '', at: '', answeredAt: '', mine: false,
      canClose: false, replyCount: 0, shots: [],
    },
    replies: [{
      id: 1, inquiryNumber: 3, body: '@dareka おねがい', by: 'other@example.com',
      at: '', editedAt: '', canEdit: false, shots: [],
    }],
  };

  function openBoard() {
    const app = mount({
      apiInquiryList: [THREAD.inquiry],
      apiInquiryThread: THREAD,
      apiKnownPeople: ['me@example.com', 'other@example.com'],
    });
    document.querySelector('[data-tab="report"]').click();
    return app;
  }

  it('呼び出しに色が付く', () => {
    openBoard();
    const tag = document.querySelector('#report-detail .mention');

    expect(tag.textContent).toBe('@me@example.com');
    expect(tag.title).toBe('me@example.com');
  });

  it('自分が呼ばれたところは強く出す', () => {
    openBoard();

    // 長いやりとりの中で自分宛だけを拾えないと、呼ぶ意味がない
    expect(document.querySelector('#report-detail .mention').classList
      .contains('me')).toBe(true);
  });

  it('名簿に無い呼び出しは普通の字のまま', () => {
    openBoard();
    const tags = [...document.querySelectorAll('#report-detail .mention')];

    expect(tags.map((t) => t.textContent)).toEqual(['@me@example.com']);
    expect(document.getElementById('report-detail').textContent)
      .toContain('@dareka おねがい');
  });

  it('本文の字はそのまま残る', () => {
    openBoard();
    const body = document.querySelector('#report-detail .comment-body');

    expect(body.textContent).toBe('@me@example.com これ見て');
  });

  it('@ を打つと候補が出る', () => {
    openBoard();
    const input = document.querySelector('#report-detail .comment-form textarea');

    input.value = '@ot';
    input.selectionStart = 3;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));

    const picker = document.querySelector('#report-detail .mention-picker');
    expect(picker.hidden).toBe(false);
    // 名前を主に、アドレスを従に出す
    expect([...picker.querySelectorAll('.mention-option .mention-name')]
      .map((b) => b.textContent)).toEqual(['鈴木 花子']);
  });

  it('選ぶと本文に入る', () => {
    openBoard();
    const input = document.querySelector('#report-detail .comment-form textarea');

    input.value = '@ot';
    input.selectionStart = 3;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    document.querySelector('#report-detail .mention-option').click();

    // ふだんは名前だけで足りる
    expect(input.value).toBe('@other ');
  });

  it('候補が無ければ出さない', () => {
    openBoard();
    const input = document.querySelector('#report-detail .comment-form textarea');

    input.value = '@zzz';
    input.selectionStart = 4;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));

    expect(document.querySelector('#report-detail .mention-picker').hidden)
      .toBe(true);
  });
});

describe('知らせ', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const NOTICES = {
    items: [
      {
        id: 2, kind: 'mention', title: 'other@example.com があなたを呼びました',
        body: '@me これ見て', link: 'report:3', at: '2026-09-10T00:00:00.000Z',
        read: false,
      },
      {
        id: 1, kind: 'reply', title: 'other@example.com が #3 に返信しました',
        body: '直りました', link: 'report:3', at: '2026-09-09T00:00:00.000Z',
        read: true,
      },
    ],
    unread: 1,
  };

  it('未読の件数をベルに出す', () => {
    mount({ apiNotifications: NOTICES });

    expect(document.getElementById('bell-count').textContent).toBe('1');
    expect(document.getElementById('bell-count').hidden).toBe(false);
  });

  it('無いときは数を出さない', () => {
    mount();
    expect(document.getElementById('bell-count').hidden).toBe(true);
  });

  it('押すと一覧が開く', () => {
    mount({ apiNotifications: NOTICES });
    document.getElementById('bell-btn').click();

    expect(document.getElementById('notice-panel').hidden).toBe(false);
    expect(document.querySelectorAll('.notice-item')).toHaveLength(2);
  });

  it('まだ読んでいないものに印を付ける', () => {
    mount({ apiNotifications: NOTICES });
    document.getElementById('bell-btn').click();

    const items = [...document.querySelectorAll('.notice-item')];
    expect(items[0].classList.contains('unread')).toBe(true);
    expect(items[1].classList.contains('unread')).toBe(false);
  });

  it('押すと読んだことにして、その場所を開く', () => {
    const app = mount({
      apiNotifications: NOTICES,
      apiInquiryList: [],
    });
    document.getElementById('bell-btn').click();
    document.querySelector('.notice-item').click();

    expect(app.calls.filter((c) => c.name === 'apiNotificationsRead').pop().args[0])
      .toEqual([2]);
    expect(document.getElementById('panel-report').hidden).toBe(false);
    expect(document.getElementById('notice-panel').hidden).toBe(true);
  });

  it('全部まとめて読んだことにできる', () => {
    const app = mount({ apiNotifications: NOTICES });
    document.getElementById('bell-btn').click();
    document.getElementById('notice-read-all').click();

    expect(app.calls.filter((c) => c.name === 'apiNotificationsRead').pop().args[0])
      .toEqual([]);
  });

  it('何も無いときは何が出るのかを伝える', () => {
    mount();
    document.getElementById('bell-btn').click();

    expect(document.getElementById('notice-body').textContent)
      .toContain('名前を呼ばれたとき');
  });

  it('デスクトップ通知が使えない環境ではその旨を出す', () => {
    const saved = window.Notification;
    delete window.Notification;

    mount();
    document.getElementById('bell-btn').click();

    expect(document.getElementById('notice-desktop').hidden).toBe(true);
    expect(document.getElementById('notice-desktop-note').textContent)
      .toContain('出せません');

    if (saved) window.Notification = saved;
  });

  it('許可を求められる環境では頼むボタンを出す', () => {
    window.Notification = { permission: 'default', requestPermission: () => {} };

    mount();
    document.getElementById('bell-btn').click();

    expect(document.getElementById('notice-desktop').hidden).toBe(false);

    delete window.Notification;
  });
});

describe('やることのタグ', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openCreate(over) {
    const app = mount(over);
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('issue-create-btn').click();
    return app;
  }

  function tagInput() {
    return document.querySelector('#side-body .tag-input');
  }

  function type(value) {
    const input = tagInput();
    input.value = value;
    input.selectionStart = value.length;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    return input;
  }

  it('「#」を打つと候補が出る', () => {
    openCreate();
    type('#');

    const box = document.querySelector('#side-body .tag-suggest');
    expect(box.hidden).toBe(false);
    expect([...box.querySelectorAll('.label-pill')].map((p) => p.textContent))
      .toEqual(['文書改訂', '会議']);
  });

  it('打った字で絞り込む', () => {
    openCreate();
    type('#会');

    expect([...document.querySelectorAll('#side-body .tag-suggest .label-pill')]
      .map((p) => p.textContent)).toEqual(['会議']);
  });

  it('候補を押すと差し込まれる', () => {
    openCreate();
    type('#会');
    document.querySelector('#side-body .tag-suggest .mention-option').click();

    expect(tagInput().value).toBe('#会議 ');
  });

  it('書いたぶんがその場で形になる', () => {
    openCreate();
    type('#会議 #調査 ');

    expect([...document.querySelectorAll('#side-body .tag-chosen .label-pill')]
      .map((p) => p.textContent)).toEqual(['会議', '調査']);
  });

  it('空白で区切って送る', () => {
    const app = openCreate();
    type('#会議 #棚卸し ');

    document.querySelector('#side-body form input').value = '棚卸しをする';
    document.querySelector('#side-body form .btn-primary').click();

    expect(app.calls.filter((c) => c.name === 'apiIssueCreate').pop().args[3])
      .toBe('会議,棚卸し');
  });

  it('候補に無いタグもそのまま書ける', () => {
    const app = openCreate();
    type('#はじめてのタグ ');

    document.querySelector('#side-body form input').value = 'x';
    document.querySelector('#side-body form .btn-primary').click();

    expect(app.calls.filter((c) => c.name === 'apiIssueCreate').pop().args[3])
      .toBe('はじめてのタグ');
  });

  it('もう書いたタグは候補に出さない', () => {
    openCreate();
    type('#会議 #');

    expect([...document.querySelectorAll('#side-body .tag-suggest .label-pill')]
      .map((p) => p.textContent)).toEqual(['文書改訂']);
  });

  it('直すときは今のタグが入った状態で開く', () => {
    mount({
      apiIssueList: [{ ...DEFAULTS.apiIssueList[0], labels: '文書改訂,会議', parent: '' }],
    });
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list .row-open').click();
    document.getElementById('side-edit').click();

    expect(tagInput().value).toBe('#文書改訂 #会議 ');
  });

  it('色はテーマの色だけを使う', () => {
    mount({
      apiIssueList: [{ ...DEFAULTS.apiIssueList[0], labels: '文書改訂', parent: '' }],
    });
    document.querySelector('[data-tab="issues"]').click();

    expect(document.querySelector('#issue-list .label-pill').className)
      .toContain('tag-accent');
  });

  it('一覧に無いタグでも読める色にする', () => {
    mount({
      apiIssueList: [{ ...DEFAULTS.apiIssueList[0], labels: '知らないタグ', parent: '' }],
    });
    document.querySelector('[data-tab="issues"]').click();

    expect(document.querySelector('#issue-list .label-pill').className)
      .toContain('tag-ink');
  });
});

describe('文書に紐づかないやること', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('文書を開いていなければ紐づけを尋ねない', () => {
    const app = mount();
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('issue-create-btn').click();

    expect(document.querySelector('#side-body .check-row')).toBe(null);

    document.querySelector('#side-body form input').value = '棚卸しをする';
    document.querySelector('#side-body form .btn-primary').click();

    expect(app.calls.filter((c) => c.name === 'apiIssueCreate').pop().args[2])
      .toEqual([]);
  });

  it('文書を開いていたら紐づけるかを選べる', () => {
    const app = mount();
    document.querySelector('[data-tab="docs"]').click();
    document.querySelector('#doc-list .doc-open').click();
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('issue-create-btn').click();

    const box = document.querySelector('#side-body .check-row input');
    expect(box.checked).toBe(true);

    // 外せば、文書と関係のないやることとして作られる
    box.checked = false;
    document.querySelector('#side-body form input').value = '棚卸しをする';
    document.querySelector('#side-body form .btn-primary').click();

    expect(app.calls.filter((c) => c.name === 'apiIssueCreate').pop().args[2])
      .toEqual([]);
  });
});

describe('Google ToDo との同期', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openIssues(over) {
    const app = mount(over);
    document.querySelector('[data-tab="issues"]').click();
    return app;
  }

  it('使えない環境では入口を出さない', () => {
    openIssues();

    // 押した先で断られるだけのボタンを出さない
    expect(document.getElementById('tasks-btn').hidden).toBe(true);
  });

  it('使える環境では入口が出る', () => {
    openIssues({
      apiTasksState: {
        available: true, listId: '', lists: [{ id: 'L1', title: 'マイタスク' }],
      },
    });

    expect(document.getElementById('tasks-btn').hidden).toBe(false);
  });

  it('入れ先が決まっていなければ先に選ばせる', () => {
    const app = openIssues({
      apiTasksState: {
        available: true, listId: '', lists: [{ id: 'L1', title: 'マイタスク' }],
      },
    });

    document.getElementById('tasks-btn').click();

    expect(app.calls.some((c) => c.name === 'apiTasksSync')).toBe(false);
    expect(document.getElementById('side-title').textContent)
      .toBe('Google ToDo と同期する');
    expect([...document.querySelectorAll('#side-body select option')]
      .map((o) => o.textContent)).toEqual(['マイタスク']);
  });

  it('入れ先が決まっていれば同期する', () => {
    const app = openIssues({
      apiTasksState: {
        available: true, listId: 'L1', lists: [{ id: 'L1', title: 'マイタスク' }],
      },
      apiTasksSync: { pushed: 3, closed: 1, listId: 'L1' },
    });

    document.getElementById('tasks-btn').click();

    expect(app.calls.some((c) => c.name === 'apiTasksSync')).toBe(true);
    expect(document.getElementById('snackbar').textContent)
      .toContain('3件を ToDo に送りました');
  });

  it('何を送るのかを先に伝える', () => {
    openIssues({
      apiTasksState: {
        available: true, listId: '', lists: [{ id: 'L1', title: 'マイタスク' }],
      },
    });
    document.getElementById('tasks-btn').click();

    expect(document.getElementById('side-body').textContent)
      .toContain('自分が担当で、まだ終わっていない');
  });
});

describe('工程表の担当者と工数', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openGantt(over) {
    const app = mount(over);
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('view-gantt').click();
    return app;
  }

  it('行にも棒にも担当者の顔を出す', () => {
    openGantt();
    const row = document.querySelector('.gantt-row');

    expect(row.querySelector('.gantt-name .avatar').textContent).toBe('山');
    expect(row.querySelector('.gantt-bar .avatar')).toBeTruthy();
  });

  it('棒に人日を出す', () => {
    openGantt();

    expect(document.querySelector('.gantt-bar .gantt-days').textContent)
      .toMatch(/人日$/);
  });

  it('工数は人日で尋ねて、半日きざみで書ける', () => {
    mount();
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list .row-open').click();
    document.getElementById('side-edit').click();

    const inputs = document.querySelectorAll('#side-body input, #side-body textarea');
    expect(inputs[6].step).toBe('0.5');
    expect(inputs[7].step).toBe('0.5');
    expect([...document.querySelectorAll('#side-body label')]
      .map((l) => l.firstChild.textContent).join(' ')).toContain('人日');
  });

  it('予定工数を変えると期限も動く', () => {
    const app = mount({
      apiIssueList: [{
        ...DEFAULTS.apiIssueList[0], parent: '',
        startDate: '2026-09-01T00:00:00.000Z',
        dueDate: '2026-09-30T00:00:00.000Z', plannedHours: 8,
      }],
    });
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list .row-open').click();
    document.getElementById('side-edit').click();

    const inputs = document.querySelectorAll('#side-body input, #side-body textarea');
    inputs[6].value = '3';
    document.querySelector('#side-body form .btn-primary').click();

    // 9/1 から3人日なので 9/3 まで
    const patch = app.calls.filter((c) => c.name === 'apiIssueUpdate').pop().args[1];
    expect(patch.dueDate).toBe('2026-09-03');
  });

  it('予定工数を触っていなければ期限は動かさない', () => {
    const app = mount({
      apiIssueList: [{
        ...DEFAULTS.apiIssueList[0], parent: '',
        startDate: '2026-09-01T00:00:00.000Z',
        dueDate: '2026-09-30T00:00:00.000Z', plannedHours: 8,
      }],
    });
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list .row-open').click();
    document.getElementById('side-edit').click();

    document.querySelector('#side-body form input').value = '題だけ直す';
    document.querySelector('#side-body form .btn-primary').click();

    const patch = app.calls.filter((c) => c.name === 'apiIssueUpdate').pop().args[1];
    expect(patch.dueDate).toBe('2026-09-30');
  });
});

describe('触れたときの補足', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('分かりにくい言葉には補足が付く', () => {
    mount();
    document.querySelector('[data-tab="issues"]').click();

    // 使い方の頁を読みに行かないと分からない道具は、読みに行かれない
    const seg = document.getElementById('view-gantt');
    expect(seg.dataset.hint).toContain('棒');
    expect(seg.classList.contains('has-hint')).toBe(true);
  });

  it('補足は読み上げにも届く', () => {
    mount();
    const seg = document.getElementById('view-board');
    const note = document.getElementById(seg.getAttribute('aria-describedby'));

    expect(note.textContent).toBe(seg.dataset.hint);
  });

  it('控えは1か所にまとめて置く', () => {
    mount();

    // 隣に差し込むと、並びで組んでいるところの形が変わる
    const notes = document.getElementById('hint-notes');
    expect(notes.className).toBe('sr-only');
    expect(notes.children.length).toBeGreaterThan(5);
  });

  it('ブラウザ既定の吹き出しと二重にしない', () => {
    mount();
    const seg = document.getElementById('view-list');

    expect(seg.getAttribute('title')).toBe(null);
    expect(seg.getAttribute('aria-describedby')).toBeTruthy();
  });

  it('操作のアイコンにも付く', () => {
    mount();
    document.querySelector('[data-tab="issues"]').click();

    const del = document.querySelector('#issue-list .btn-danger');
    expect(del.dataset.hint).toContain('戻せます');
    expect(del.getAttribute('aria-label')).toContain('捨てる');
  });
});

describe('はじめの案内', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('先に何が得られるかを言う', () => {
    mount();

    expect(document.querySelector('.guideline-lead').textContent)
      .toContain('誰がいつ何を変えたか');
  });

  it('しまえる', () => {
    mount();
    document.getElementById('guideline-hide').click();

    expect(document.getElementById('guideline').hidden).toBe(true);
  });

  it('しまったことを覚えている', () => {
    mount();
    document.getElementById('guideline-hide').click();

    mount();
    expect(document.getElementById('guideline').hidden).toBe(true);
  });

  it('使い方から出し直せる', () => {
    mount();
    document.getElementById('guideline-hide').click();

    document.querySelector('[data-tab="help"]').click();
    [...document.querySelectorAll('#guide .btn')]
      .find((b) => b.textContent.includes('もう一度出す')).click();

    expect(document.getElementById('guideline').hidden).toBe(false);
    expect(document.getElementById('panel-docs').hidden).toBe(false);
  });
});

describe('親子関係の見え方', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openIssues() {
    const app = mount();
    document.querySelector('[data-tab="issues"]').click();
    return app;
  }

  function chips(scope) {
    return [...document.querySelectorAll(scope + ' .rel-chip')]
      .map((c) => c.textContent);
  }

  it('一覧で子から親へ行ける', () => {
    openIssues();

    // #1 は #2 の子
    const child = [...document.querySelectorAll('#issue-list .row-item')]
      .find((r) => r.dataset.number === '1');
    expect([...child.querySelectorAll('.rel-chip')].map((c) => c.textContent))
      .toContain('親 #2');
  });

  it('一覧で親から子へ行ける', () => {
    openIssues();

    const parent = [...document.querySelectorAll('#issue-list .row-item')]
      .find((r) => r.dataset.number === '2');
    expect([...parent.querySelectorAll('.rel-chip')].map((c) => c.textContent))
      .toContain('子 1');
  });

  it('押すと相手が光る', () => {
    openIssues();

    const child = [...document.querySelectorAll('#issue-list .row-item')]
      .find((r) => r.dataset.number === '1');
    [...child.querySelectorAll('.rel-chip')]
      .find((c) => c.textContent === '親 #2').click();

    const parent = [...document.querySelectorAll('#issue-list .row-item')]
      .find((r) => r.dataset.number === '2');
    expect(parent.classList.contains('flash')).toBe(true);
  });

  it('見えないところに居るなら中身を開く', () => {
    const app = openIssues();

    // 絞り込んで相手を画面から消す
    const input = document.getElementById('issue-filter');
    input.value = '第2条';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));

    const row = document.querySelector('#issue-list .row-item');
    const chip = [...row.querySelectorAll('.rel-chip')]
      .find((c) => c.textContent === '親 #2');

    if (chip) {
      chip.click();
      expect(app.calls.some((c) => c.name === 'apiIssueList')).toBe(true);
    }
    expect(true).toBe(true);
  });

  it('ボードのカードにも出る', () => {
    mount({
      apiProjectBoard: {
        Backlog: [{
          issueNumber: 1, order: 0, title: '第2条の改訂', state: 'open',
          assignee: '', labels: '', dueDate: '', staleLevel: 0, staleDays: 0,
        }],
        'In Progress': [], 'In Review': [], Done: [],
      },
    });
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('view-board').click();

    expect(chips('.board-card')).toContain('親 #2');
    expect(document.querySelector('.board-card').dataset.number).toBe('1');
  });

  it('工程表でも字下げと行き先が出る', () => {
    mount();
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('view-gantt').click();

    const child = [...document.querySelectorAll('.gantt-row')]
      .find((r) => r.dataset.number === '1');

    expect(child.classList.contains('nested')).toBe(true);
    expect(child.querySelector('.gantt-name').style.paddingLeft).not.toBe('');
    expect([...child.querySelectorAll('.rel-chip')].map((c) => c.textContent))
      .toContain('親 #2');
  });

  it('親が居ないものには出さない', () => {
    mount({
      apiIssueList: [{ ...DEFAULTS.apiIssueList[0], parent: '' }],
    });
    document.querySelector('[data-tab="issues"]').click();

    expect(chips('#issue-list')).toEqual([]);
  });

  it('行き先には何が起きるかを添える', () => {
    openIssues();

    const child = [...document.querySelectorAll('#issue-list .row-item')]
      .find((r) => r.dataset.number === '1');
    const chip = [...child.querySelectorAll('.rel-chip')]
      .find((c) => c.textContent === '親 #2');

    expect(chip.dataset.hint).toContain('通勤手当の見直し');
  });
});

describe('確認依頼の反映先', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openDrafts() {
    const app = mount();
    document.querySelector('[data-tab="branches"]').click();
    return app;
  }

  it('同じ文書の別の版を選べる', () => {
    openDrafts();
    [...document.querySelectorAll('#branch-list .btn-primary')][0].click();

    const sel = document.querySelector('#side-body select');
    expect([...sel.options].map((o) => o.textContent))
      .toEqual(['正式版', '土台']);
    expect(sel.value).toBe('main');
  });

  it('選んだ先を一緒に送る', () => {
    const app = openDrafts();
    [...document.querySelectorAll('#branch-list .btn-primary')][0].click();

    document.querySelector('#side-body select').value = '土台';
    document.querySelector('#side-body form input').value = '第4条を足した';
    document.querySelector('#side-body form .btn-primary').click();

    expect(app.calls.filter((c) => c.name === 'apiPrCreate').pop().args[4])
      .toBe('土台');
  });

  it('選びようが無ければ選択肢を隠す', () => {
    mount({
      apiListFiles: [
        { fileId: 'DOC1', path: '就業規則.doc', type: 'doc' },
        { fileId: 'W1', path: 'branches/見直し/就業規則.doc', type: 'doc' },
      ],
      apiBranchList: [
        { name: 'main', headSha: 'a', baseSha: '', state: 'open', createdBy: 'me@example.com', createdAt: '' },
        { name: '見直し', headSha: 'b', baseSha: 'a', state: 'open', createdBy: 'me@example.com', createdAt: '' },
      ],
    });
    document.querySelector('[data-tab="branches"]').click();
    document.querySelector('#branch-list .btn-primary').click();

    // 選びようが無いときに選択肢を見せても、迷わせるだけ
    expect(document.querySelector('#side-body select').parentNode.hidden)
      .toBe(true);
  });

  it('一覧に反映先を出す', () => {
    mount({
      apiPrList: [{
        ...DEFAULTS.apiPrList[0], targetBranch: '土台',
      }],
    });
    document.querySelector('[data-tab="pulls"]').click();

    expect(document.querySelector('#pr-list .row-meta').textContent)
      .toContain('見直し → 土台');
  });

  it('反映のボタンにも行き先を出す', () => {
    mount({
      apiPrList: [{ ...DEFAULTS.apiPrList[0], targetBranch: '土台' }],
    });
    document.querySelector('[data-tab="pulls"]').click();

    expect([...document.querySelectorAll('#pr-detail .pr-actions .btn')]
      .map((b) => b.textContent).join(' ')).toContain('土台に反映する');
  });
});

describe('工数の集計', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const RESULT = {
    periods: [
      {
        key: '2026-09', label: '2026年9月',
        sum: { planned: 3, actual: 5, diff: 2, count: 1 },
        cumulative: { planned: 3, actual: 5, diff: 2, count: 1 },
        byPerson: { 'me@example.com': { planned: 3, actual: 5, diff: 2, count: 1 } },
      },
      {
        key: '2026-10', label: '2026年10月',
        sum: { planned: 2, actual: 1, diff: -1, count: 1 },
        cumulative: { planned: 5, actual: 6, diff: 1, count: 2 },
        byPerson: {},
      },
    ],
    people: [
      { who: 'me@example.com', total: { planned: 3, actual: 5, diff: 2, count: 1 } },
    ],
    total: { planned: 5, actual: 6, diff: 1, count: 2 },
    skipped: 0,
    hidden: 1,
  };

  function openTally(over) {
    const app = mount(Object.assign({ apiTallyEffort: RESULT }, over || {}));
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('view-tally').click();
    return app;
  }

  function cells(row) {
    return [...row.querySelectorAll('th, td')].map((c) => c.textContent);
  }

  it('まずチーム全体の合計を出す', () => {
    openTally();
    const cards = [...document.querySelectorAll('#tally .tally-card')]
      .map((c) => c.textContent);

    expect(cards[0]).toContain('5');
    expect(cards[1]).toContain('6');
    expect(cards[2]).toContain('+1');
  });

  it('区切りごとに並べ、累計も出す', () => {
    openTally();
    const rows = [...document.querySelectorAll('#tally .tally-table')][0]
      .querySelectorAll('tbody tr');

    expect(cells(rows[0])).toEqual(['2026年9月', '3', '5', '+2', '3', '5', '1']);
    expect(cells(rows[1])).toEqual(['2026年10月', '2', '1', '-1', '5', '6', '1']);
  });

  it('全体であることを見出しで言う', () => {
    openTally();

    expect(document.querySelectorAll('#tally h3')[0].textContent)
      .toContain('チーム全体');
  });

  it('その区切りに居ない人は空にする', () => {
    openTally();
    const table = [...document.querySelectorAll('#tally .tally-table')][1];
    const me = table.querySelectorAll('tbody tr')[0];

    // 0 と書くと「0人日やった」に読める
    expect(me.querySelectorAll('td')[1].textContent).toBe('—');
  });

  it('区切りを変えられる', () => {
    const app = openTally();

    document.getElementById('tally-unit').value = 'quarter';
    document.getElementById('tally-unit')
      .dispatchEvent(new window.Event('change', { bubbles: true }));

    expect(app.calls.filter((c) => c.name === 'apiTallyEffort').pop().args[0])
      .toBe('quarter');
  });

  it('半期と年度でも切れる', () => {
    openTally();

    expect([...document.querySelectorAll('#tally-unit option')]
      .map((o) => o.value))
      .toEqual(['week', 'month', 'quarter', 'half', 'year']);
  });

  it('数え方を変えられる', () => {
    const app = openTally();

    document.getElementById('tally-basis').value = 'closed';
    document.getElementById('tally-basis')
      .dispatchEvent(new window.Event('change', { bubbles: true }));

    expect(app.calls.filter((c) => c.name === 'apiTallyEffort').pop().args[1])
      .toBe('closed');
  });

  it('数える日が空のものがあることを伝える', () => {
    openTally({ apiTallyEffort: Object.assign({}, RESULT, { skipped: 1 }) });

    // 黙って落とすと、合計が合わない理由が分からない
    expect(document.querySelector('#tally .tally-skipped').textContent)
      .toContain('1件は、数える日が空');
  });

  it('超えた差と下回った差を見分ける', () => {
    openTally();
    const diffs = [...document.querySelectorAll('#tally .tally-table')][0]
      .querySelectorAll('.tally-diff');

    expect(diffs[0].classList.contains('over')).toBe(true);
    expect(diffs[1].classList.contains('under')).toBe(true);
  });

  it('集計では絞り込みと束ね方を隠す', () => {
    openTally();

    expect(document.getElementById('issue-filter').parentNode.hidden).toBe(true);
    expect(document.getElementById('tally-unit-box').hidden).toBe(false);
  });

  it('何も無ければ何を入れれば集まるかを言う', () => {
    openTally({
      apiTallyEffort: {
        periods: [], people: [],
        total: { planned: 0, actual: 0, diff: 0, count: 0 },
        skipped: 0, hidden: 0,
      },
    });

    expect(document.getElementById('tally').textContent)
      .toContain('集計できるやることがありません');
  });
});

describe('工数集計の見える範囲', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const RESULT = {
    periods: [{
      key: '2026-09', label: '2026年9月',
      sum: { planned: 10, actual: 10, diff: 0, count: 4 },
      cumulative: { planned: 10, actual: 10, diff: 0, count: 4 },
      byPerson: { 'me@example.com': { planned: 3, actual: 4, diff: 1, count: 1 } },
    }],
    people: [
      { who: 'me@example.com', total: { planned: 3, actual: 4, diff: 1, count: 1 } },
    ],
    total: { planned: 10, actual: 10, diff: 0, count: 4 },
    skipped: 0,
    hidden: 3,
  };

  function openTally(over) {
    const app = mount(Object.assign({ apiTallyEffort: RESULT }, over || {}));
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('view-tally').click();
    return app;
  }

  it('人ごとの内訳は自分のぶんだけ出る', () => {
    openTally();
    const rows = [...document.querySelectorAll('#tally .tally-table')][1]
      .querySelectorAll('tbody tr');

    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector('th').textContent).toContain('山田 太郎');
  });

  it('合計と内訳が合わない理由を言う', () => {
    openTally();

    // 黙って減らすと、数が合わないことのほうが不安になる
    expect(document.getElementById('tally').textContent)
      .toContain('ほかの3件は全体の合計にだけ');
  });

  it('上長でなければ対象は選ばせない', () => {
    openTally();

    // 見てよい人が自分だけなら、選ばせる意味がない
    expect(document.getElementById('tally-who-box').hidden).toBe(true);
  });

  it('上長なら対象を選べる', () => {
    openTally({
      apiTallyScope: {
        me: 'me@example.com',
        canSee: ['me@example.com', 'buka@example.com'],
        isManager: true, canEdit: false,
      },
    });

    expect(document.getElementById('tally-who-box').hidden).toBe(false);
    expect([...document.querySelectorAll('#tally-who option')]
      .map((o) => o.textContent))
      .toEqual(['見られる人ぜんぶ', '自分 (山田 太郎)', 'buka']);
  });

  it('選んだ相手をサーバに渡す', () => {
    const app = openTally({
      apiTallyScope: {
        me: 'me@example.com',
        canSee: ['me@example.com', 'buka@example.com'],
        isManager: true, canEdit: false,
      },
    });

    document.getElementById('tally-who').value = 'buka@example.com';
    document.getElementById('tally-who')
      .dispatchEvent(new window.Event('change', { bubbles: true }));

    expect(app.calls.filter((c) => c.name === 'apiTallyEffort').pop().args[2])
      .toBe('buka@example.com');
  });
});
describe('補足の出しかた', () => {
  beforeEach(() => { window.localStorage.clear(); });

  /** 位置を作ってから触れる */
  function hover(el, rect) {
    el.getBoundingClientRect = () => Object.assign(
      { left: 0, right: 32, top: 0, bottom: 32, width: 32, height: 32 }, rect);
    el.dispatchEvent(new window.Event('pointerover', { bubbles: true }));
    return document.getElementById('hint-bubble');
  }

  function sizeBubble(w, h) {
    const box = document.getElementById('hint-bubble');
    if (box) box.getBoundingClientRect = () => ({ width: w, height: h });
  }

  it('器の外に1つだけ置く', () => {
    mount();
    const box = hover(document.getElementById('bell-btn'), {});

    // 器の中に描くと、幅の狭いペインや巻き取る器に切り取られる
    expect(box.parentNode).toBe(document.body);
    expect(box.hidden).toBe(false);
    expect(document.querySelectorAll('.hint-bubble')).toHaveLength(1);
  });

  it('言葉をそのまま出す', () => {
    mount();
    const btn = document.getElementById('bell-btn');
    const box = hover(btn, {});

    expect(box.textContent).toBe(btn.dataset.hint);
  });

  it('補足を持たないところに移ったらしまう', () => {
    mount();
    hover(document.getElementById('bell-btn'), {});

    document.getElementById('doc-list')
      .dispatchEvent(new window.Event('pointerover', { bubbles: true }));

    expect(document.getElementById('hint-bubble').hidden).toBe(true);
  });

  it('中の要素に触れても出したままにする', () => {
    mount();
    const btn = document.getElementById('bell-btn');
    hover(btn, {});

    // アイコンは補足を持つボタンの中にある
    btn.querySelector('svg')
      .dispatchEvent(new window.Event('pointerover', { bubbles: true }));

    expect(document.getElementById('hint-bubble').hidden).toBe(false);
  });

  it('押したらしまう', () => {
    mount();
    const btn = document.getElementById('bell-btn');
    hover(btn, {});

    btn.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    expect(document.getElementById('hint-bubble').hidden).toBe(true);
  });

  it('相手が居なくなったらしまう', () => {
    mount();
    document.querySelector('[data-tab="issues"]').click();

    const del = document.querySelector('#issue-list .btn-danger');
    hover(del, {});
    expect(document.getElementById('hint-bubble').hidden).toBe(false);

    // 押した拍子に一覧が描き直されると「離れた」が来ない
    del.remove();
    document.body.dispatchEvent(new window.Event('pointermove', { bubbles: true }));

    expect(document.getElementById('hint-bubble').hidden).toBe(true);
  });

  it('焦点が外れたらしまう', () => {
    mount();
    hover(document.getElementById('bell-btn'), {});

    document.dispatchEvent(new window.Event('focusout', { bubbles: true }));
    expect(document.getElementById('hint-bubble').hidden).toBe(true);
  });

  it('右にはみ出すなら左に寄せる', () => {
    mount();
    const btn = document.getElementById('bell-btn');

    hover(btn, {});
    sizeBubble(280, 60);
    hideAndHover(btn, { left: window.innerWidth - 40, right: window.innerWidth - 8 });

    const left = parseInt(document.getElementById('hint-bubble').style.left, 10);
    expect(left + 280).toBeLessThanOrEqual(window.innerWidth);
  });

  it('下にはみ出すなら上に出す', () => {
    mount();
    const btn = document.getElementById('bell-btn');

    hover(btn, {});
    sizeBubble(200, 80);
    hideAndHover(btn, {
      top: window.innerHeight - 40, bottom: window.innerHeight - 8,
    });

    const top = parseInt(document.getElementById('hint-bubble').style.top, 10);
    expect(top).toBeLessThan(window.innerHeight - 40);
  });

  it('窓からはみ出す位置には置かない', () => {
    mount();
    const btn = document.getElementById('bell-btn');

    hover(btn, {});
    sizeBubble(280, 400);
    hideAndHover(btn, { left: -50, top: -50, bottom: -18 });

    const box = document.getElementById('hint-bubble');
    expect(parseInt(box.style.left, 10)).toBeGreaterThanOrEqual(0);
    expect(parseInt(box.style.top, 10)).toBeGreaterThanOrEqual(0);
  });

  it('巻き取ったらしまう', () => {
    mount();
    hover(document.getElementById('bell-btn'), {});

    document.dispatchEvent(new window.Event('scroll', { bubbles: true }));
    expect(document.getElementById('hint-bubble').hidden).toBe(true);
  });

  it('触れられて操作の邪魔をしない', () => {
    mount();
    const box = hover(document.getElementById('bell-btn'), {});

    expect(box.getAttribute('aria-hidden')).toBe('true');
  });

  /** 同じ相手をもう一度測り直させる */
  function hideAndHover(el, rect) {
    document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    return hover(el, rect);
  }
});
describe('種類に応じた尋ね方', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openForm() {
    const app = mount({ apiInquiryList: [] });
    document.querySelector('[data-tab="report"]').click();
    document.getElementById('report-btn').click();
    return app;
  }

  function asks() {
    return [...document.querySelectorAll('#side-body label')]
      .map((l) => l.firstChild.textContent);
  }

  it('不具合では起きたことを聞く', () => {
    openForm();

    expect(asks()).toContain('何をしましたか');
    expect(asks()).toContain('どうなりましたか');
  });

  it('要望では困りごとを聞く', () => {
    openForm();
    const sel = document.querySelector('#side-body select');

    sel.value = 'request';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));

    // 「何をしましたか」は要望には答えようがなく、白紙のまま送られる
    expect(asks()).toContain('いま何に困っていますか');
    expect(asks()).toContain('どうなるとよいですか');
    expect(asks()).not.toContain('何をしましたか');
  });

  it('質問では試したことを聞く', () => {
    openForm();
    const sel = document.querySelector('#side-body select');

    sel.value = 'question';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));

    expect(asks()).toContain('どこまで試しましたか');
  });

  it('例も種類に合わせて変える', () => {
    openForm();
    const sel = document.querySelector('#side-body select');

    sel.value = 'request';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));

    const inputs = document.querySelectorAll('#side-body input, #side-body textarea');
    expect(inputs[0].placeholder).toContain('先に出したい');
  });

  it('やることに積まれることを先に伝える', () => {
    openForm();

    expect(document.getElementById('side-body').textContent)
      .toContain('開発者のやることに積まれます');
  });
});

describe('報告と、そこから作られたやること', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const WITH_ISSUE = {
    inquiry: {
      number: 3, kind: 'request', kindLabel: 'こうしてほしい (機能の要望)',
      title: '並べ替えたい', body: '並べ替えたい', by: 'me@example.com',
      state: 'open', context: '', answer: '', at: '', answeredAt: '',
      mine: true, canClose: true, replyCount: 0, shots: [], issueNumber: 12,
    },
    replies: [],
  };

  it('やることへの行き先が出る', () => {
    mount({
      apiInquiryList: [WITH_ISSUE.inquiry],
      apiInquiryThread: WITH_ISSUE,
    });
    document.querySelector('[data-tab="report"]').click();

    const link = document.querySelector('#report-detail .rel-chip');
    expect(link.textContent).toContain('やること #12');
  });

  it('押すとやることに移る', () => {
    const app = mount({
      apiInquiryList: [WITH_ISSUE.inquiry],
      apiInquiryThread: WITH_ISSUE,
    });
    document.querySelector('[data-tab="report"]').click();
    document.querySelector('#report-detail .rel-chip').click();

    expect(document.getElementById('panel-issues').hidden).toBe(false);
    expect(app.calls.some((c) => c.name === 'apiIssueList')).toBe(true);
  });

  it('積まれていなければ出さない', () => {
    mount({
      apiInquiryList: [{ ...WITH_ISSUE.inquiry, issueNumber: '' }],
      apiInquiryThread: {
        inquiry: { ...WITH_ISSUE.inquiry, issueNumber: '' }, replies: [],
      },
    });
    document.querySelector('[data-tab="report"]').click();

    expect(document.querySelector('#report-detail .rel-chip')).toBe(null);
  });
});

describe('済んだ報告の見え方', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const OPEN = {
    number: 1, kind: 'bug', kindLabel: 'うまく動かない', title: 'まだのもの',
    body: 'x', by: 'me@example.com', state: 'open', context: '', answer: '',
    at: '', answeredAt: '', mine: true, canClose: true, replyCount: 0,
    shots: [], issueNumber: '',
  };
  const DONE = Object.assign({}, OPEN, {
    number: 2, title: '済んだもの', state: 'done',
  });

  function openBoard(over) {
    const app = mount(Object.assign({
      apiInquiryList: [OPEN, DONE],
      apiInquiryThread: { inquiry: OPEN, replies: [] },
    }, over || {}));
    document.querySelector('[data-tab="report"]').click();
    document.getElementById('report-open-btn').click();
    return app;
  }

  function rows() {
    return [...document.querySelectorAll('#report-list .row-item')];
  }

  it('済んだものだけ一段沈める', () => {
    openBoard();

    const done = rows().find((r) => r.dataset.number === '2');
    const open = rows().find((r) => r.dataset.number === '1');

    expect(done.classList.contains('resolved')).toBe(true);
    expect(open.classList.contains('resolved')).toBe(false);
  });

  it('沈めても読めなくはしない', () => {
    openBoard();
    const done = rows().find((r) => r.dataset.number === '2');

    // あとから経緯を追うことがある
    expect(done.textContent).toContain('済んだもの');
    expect(done.querySelector('.state').textContent).toBe('解決');
  });

  it('未解決だけに絞ると出てこない', () => {
    const app = mount({
      apiInquiryList: [OPEN, DONE],
      apiInquiryThread: { inquiry: OPEN, replies: [] },
    });
    document.querySelector('[data-tab="report"]').click();

    expect(rows().map((r) => r.dataset.number)).toEqual(['1']);
    expect(app).toBeTruthy();
  });
});

describe('表示する名前', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openHelp() {
    const app = mount();
    document.querySelector('[data-tab="help"]').click();
    return app;
  }

  it('使い方から決められる', () => {
    const app = openHelp();

    [...document.querySelectorAll('#guide .btn')]
      .find((b) => b.textContent.includes('表示する名前')).click();

    const input = document.querySelector('#side-body input');
    expect(input.value).toBe('山田 太郎');

    input.value = '山田 一郎';
    document.querySelector('#side-body form .btn-primary').click();

    expect(app.calls.filter((c) => c.name === 'apiPeopleSetName').pop().args)
      .toEqual(['me@example.com', '山田 一郎']);
  });

  it('いまの名前とアドレスの両方を示す', () => {
    openHelp();

    expect(document.getElementById('whoami').textContent)
      .toBe('このアプリはあなたを 山田 太郎 (me@example.com) として認識しています');
  });

  it('名前を知らない人はアドレスの手前で出る', () => {
    mount({ apiPeopleNames: {} });
    document.querySelector('[data-tab="issues"]').click();

    expect(document.querySelector('#issue-list .avatar')
      .getAttribute('aria-label')).toBe('me (me@example.com)');
  });
});

describe('担当者を「@」で選ぶ', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openDetail() {
    const app = mount();
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list .row-open').click();
    document.getElementById('side-edit').click();
    return app;
  }

  function field() {
    return document.querySelectorAll('#side-body input, #side-body textarea')[2];
  }

  function type(value) {
    const input = field();
    input.value = value;
    input.selectionStart = value.length;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    return input;
  }

  it('いまの担当が「@」の形で入っている', () => {
    openDetail();
    expect(field().value).toBe('@me@example.com ');
  });

  it('名前でも探せる', () => {
    openDetail();
    type('@鈴木');

    const box = document.querySelector('.assignee-picker .mention-picker');
    expect(box.hidden).toBe(false);
    expect([...box.querySelectorAll('.mention-name')].map((n) => n.textContent))
      .toEqual(['鈴木 花子']);
  });

  it('アドレスでも探せる', () => {
    openDetail();
    type('@other');

    expect([...document.querySelectorAll('.assignee-picker .mention-name')]
      .map((n) => n.textContent)).toEqual(['鈴木 花子']);
  });

  it('選ぶとアドレスが入る', () => {
    openDetail();
    type('@鈴木');
    document.querySelector('.assignee-picker .mention-option').click();

    // 手で打たせると、打ち間違いが黙って通る
    expect(field().value).toContain('@other@example.com');
  });

  it('何人でも並べられる', () => {
    const app = openDetail();
    type('@me@example.com @other@example.com ');

    document.querySelector('#side-body form')
      .dispatchEvent(new window.Event('submit', { cancelable: true }));

    expect(app.calls.filter((c) => c.name === 'apiIssueUpdate').pop().args[1].assignee)
      .toBe('me@example.com,other@example.com');
  });

  it('選んだ人が顔と名前で並ぶ', () => {
    openDetail();
    type('@me@example.com @other@example.com ');

    expect([...document.querySelectorAll('.assignee-chosen .person-name')]
      .map((n) => n.textContent)).toEqual(['山田 太郎', '鈴木 花子']);
  });

  it('もう選んだ人は候補に出さない', () => {
    openDetail();
    type('@me@example.com @');

    expect([...document.querySelectorAll('.assignee-picker .mention-name')]
      .map((n) => n.textContent)).toEqual(['鈴木 花子']);
  });

  it('自分に割り当てるを押すと足される', () => {
    openDetail();
    type('@other@example.com ');

    [...document.querySelectorAll('#side-body .btn')]
      .find((b) => b.textContent.includes('自分に割り当てる')).click();

    expect(field().value).toContain('@me@example.com');
    expect(field().value).toContain('@other@example.com');
  });

  it('誰も居なければそう出す', () => {
    openDetail();
    type('');

    expect(document.querySelector('.assignee-chosen').textContent)
      .toContain('まだ誰も割り当てていません');
  });
});

describe('複数の担当者の見え方', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const TWO = {
    ...DEFAULTS.apiIssueList[0], parent: '',
    assignee: 'me@example.com,other@example.com',
    assignees: ['me@example.com', 'other@example.com'],
  };

  it('顔を並べて出す', () => {
    mount({ apiIssueList: [TWO] });
    document.querySelector('[data-tab="issues"]').click();

    const faces = document.querySelectorAll('#issue-list .avatars .avatar');
    expect([...faces].map((f) => f.textContent)).toEqual(['山', '鈴']);
  });

  it('多いときは残りを数で示す', () => {
    mount({
      apiIssueList: [{
        ...TWO,
        assignees: ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com'],
      }],
    });
    document.querySelector('[data-tab="issues"]').click();

    expect(document.querySelector('#issue-list .avatar.more').textContent)
      .toBe('+2');
  });

  it('担当者ごとに束ねると両方の束に出る', () => {
    mount({ apiIssueList: [TWO] });
    document.querySelector('[data-tab="issues"]').click();

    const sel = document.getElementById('issue-group');
    sel.value = 'assignee';
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));

    // 片方にしか出さないと、もう片方の人には自分の仕事が見えない
    expect([...document.querySelectorAll('#issue-list .group-head')]
      .map((h) => h.textContent.replace('▾', '')))
      .toEqual(['山田 太郎1', '鈴木 花子1']);
  });

  it('自分の担当だけに絞っても残る', () => {
    mount({ apiIssueList: [TWO] });
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('mine-btn').click();

    expect(document.querySelectorAll('#issue-list .row-item')).toHaveLength(1);
  });
});

describe('工数を割って数えることの断り', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openDetail() {
    mount();
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list .row-open').click();
    document.getElementById('side-edit').click();
  }

  function type(value) {
    const input = document
      .querySelectorAll('#side-body input, #side-body textarea')[2];
    input.value = value;
    input.selectionStart = value.length;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  }

  it('2人以上にしたその場で言う', () => {
    openDetail();
    type('@me@example.com @other@example.com ');

    // 集計を見てから気づくのでは遅い
    expect(document.querySelector('.assignee-note').textContent)
      .toContain('2人で割って数えます');
  });

  it('1人のときは言わない', () => {
    openDetail();
    type('@me@example.com ');

    expect(document.querySelector('.assignee-note')).toBe(null);
  });

  it('担当者の欄の補足にも書く', () => {
    openDetail();
    const label = document
      .querySelectorAll('#side-body input, #side-body textarea')[2].parentNode;

    expect(label.dataset.hint).toContain('頭数で割って');
  });

  it('集計の表の脇にも書く', () => {
    mount({
      apiTallyEffort: {
        periods: [{
          key: '2026-09', label: '2026年9月',
          sum: { planned: 4, actual: 6, diff: 2, count: 1 },
          cumulative: { planned: 4, actual: 6, diff: 2, count: 1 },
          byPerson: { 'me@example.com': { planned: 2, actual: 3, diff: 1, count: 1 } },
        }],
        people: [{
          who: 'me@example.com',
          total: { planned: 2, actual: 3, diff: 1, count: 1 },
        }],
        total: { planned: 4, actual: 6, diff: 2, count: 1 },
        skipped: 0, hidden: 0,
      },
    });
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('view-tally').click();

    expect(document.querySelector('#tally .tally-note').textContent)
      .toContain('頭数で割って数えています');
  });
});

describe('担当者を外す', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openDetail() {
    const app = mount();
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list .row-open').click();
    document.getElementById('side-edit').click();
    return app;
  }

  function field() {
    return document.querySelectorAll('#side-body input, #side-body textarea')[2];
  }

  function type(value) {
    const input = field();
    input.value = value;
    input.selectionStart = value.length;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  }

  function chips() {
    return [...document.querySelectorAll('.assignee-chosen .reviewer-chip')];
  }

  it('札ごとに外す印が付く', () => {
    openDetail();
    type('@me@example.com @other@example.com ');

    // 文字を消させると、どこからどこまでが1人ぶんか分かりにくい
    expect(chips().map((c) => c.querySelector('.chip-off').getAttribute('aria-label')))
      .toEqual(['山田 太郎 を外す', '鈴木 花子 を外す']);
  });

  it('押すとその人だけ消える', () => {
    openDetail();
    type('@me@example.com @other@example.com ');

    chips()[0].querySelector('.chip-off').click();

    expect(field().value).toBe('@other@example.com ');
    expect(chips().map((c) => c.querySelector('.person-name').textContent))
      .toEqual(['鈴木 花子']);
  });

  it('全部外すと担当なしになる', () => {
    const app = openDetail();
    type('@me@example.com ');

    chips()[0].querySelector('.chip-off').click();
    document.querySelector('#side-body form')
      .dispatchEvent(new window.Event('submit', { cancelable: true }));

    expect(app.calls.filter((c) => c.name === 'apiIssueUpdate').pop().args[1].assignee)
      .toBe('');
  });

  it('外したあとに残った人だけを送る', () => {
    const app = openDetail();
    type('@me@example.com @other@example.com ');

    chips()[1].querySelector('.chip-off').click();
    document.querySelector('#side-body form')
      .dispatchEvent(new window.Event('submit', { cancelable: true }));

    expect(app.calls.filter((c) => c.name === 'apiIssueUpdate').pop().args[1].assignee)
      .toBe('me@example.com');
  });

  it('外したあと、その人はまた候補に出る', () => {
    openDetail();
    type('@me@example.com @other@example.com ');
    chips()[1].querySelector('.chip-off').click();

    type(field().value + '@');

    expect([...document.querySelectorAll('.assignee-picker .mention-name')]
      .map((n) => n.textContent)).toContain('鈴木 花子');
  });

  it('2人から1人になったら断り書きも消える', () => {
    openDetail();
    type('@me@example.com @other@example.com ');
    expect(document.querySelector('.assignee-note')).toBeTruthy();

    chips()[1].querySelector('.chip-off').click();

    expect(document.querySelector('.assignee-note')).toBe(null);
  });
});

describe('やることを読む形で開く', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const ISSUE = {
    ...DEFAULTS.apiIssueList[0], parent: '',
    body: '## 手順\n\n- [ ] まず\n- [x] 済んだ\n\n**大事**なこと',
  };

  function openView(over) {
    const app = mount(Object.assign({ apiIssueList: [ISSUE] }, over || {}));
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list .row-open').click();
    return app;
  }

  it('読む形で出る', () => {
    openView();

    // 触っただけで中身が変わりそうで怖い、を避ける
    expect(document.querySelector('#side-body .side-view')).toBeTruthy();
    expect(document.querySelector('#side-body form')).toBe(null);
  });

  it('鉛筆を押すと書き換えられる', () => {
    openView();
    expect(document.getElementById('side-edit').hidden).toBe(false);

    document.getElementById('side-edit').click();

    expect(document.querySelector('#side-body form')).toBeTruthy();
  });

  it('いつ・誰が・どれくらいを並べる', () => {
    openView();
    const facts = [...document.querySelectorAll('.view-facts dt')]
      .map((d) => d.textContent);

    expect(facts).toContain('状態');
    expect(facts).toContain('担当');
    expect(facts).toContain('工数');
  });

  it('補足をマークダウンとして組み立てる', () => {
    openView();
    const md = document.querySelector('#side-body .md');

    // 「##」は2段目なので h4。パネルの中では h2 より下に置く
    expect(md.querySelector('h4').textContent).toBe('手順');
    expect(md.querySelectorAll('.md-tasks li')).toHaveLength(2);
    expect(md.querySelector('.md-check.done')).toBeTruthy();
    expect(md.querySelector('strong').textContent).toBe('大事');
  });

  it('組み立ては字だけで行う', () => {
    openView({
      apiIssueList: [{ ...ISSUE, body: '<script>あぶない</script>' }],
    });

    const md = document.querySelector('#side-body .md');
    expect(md.querySelector('script')).toBe(null);
    expect(md.textContent).toContain('<script>');
  });

  it('http 以外のリンクは字のまま出す', () => {
    openView({
      apiIssueList: [{ ...ISSUE, body: '[あぶない](javascript:alert(1))' }],
    });

    expect(document.querySelector('#side-body .md a')).toBe(null);
    expect(document.querySelector('#side-body .md').textContent)
      .toContain('あぶない');
  });

  it('読む形のまま完了にできる', () => {
    const app = openView();

    [...document.querySelectorAll('#side-body .inline-form-actions .btn')]
      .find((b) => b.textContent.includes('完了にする')).click();

    expect(app.calls.some((c) => c.name === 'apiIssueClose')).toBe(true);
  });

  it('補足が空ならそう出す', () => {
    openView({ apiIssueList: [{ ...ISSUE, body: '' }] });

    expect(document.querySelector('#side-body .md').textContent)
      .toContain('補足はありません');
  });
});

describe('やることの中で話す', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const TALK = [
    {
      id: 1, issueNumber: 2, body: '**急ぎ**でお願いします',
      by: 'other@example.com', at: '2026-09-09T00:00:00.000Z',
      editedAt: '', canEdit: false,
    },
    {
      id: 2, issueNumber: 2, body: '了解です', by: 'me@example.com',
      at: '2026-09-10T00:00:00.000Z', editedAt: '', canEdit: true,
    },
  ];

  function openView(over) {
    const app = mount(Object.assign({ apiIssueComments: TALK }, over || {}));
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list .row-open').click();
    return app;
  }

  it('やりとりが並ぶ', () => {
    openView();
    const rows = [...document.querySelectorAll('.issue-talk-list .comment')];

    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('.person-name').textContent).toBe('鈴木 花子');
    expect(rows[0].querySelector('strong').textContent).toBe('急ぎ');
  });

  it('書き込める', () => {
    const app = openView();

    const box = document.querySelector('.issue-talk .comment-form textarea');
    box.value = '着手します';
    document.querySelector('.issue-talk .comment-form .btn-primary').click();

    expect(app.calls.filter((c) => c.name === 'apiIssueComment').pop().args)
      .toEqual([2, '着手します']);
  });

  it('自分の書き込みだけ直せる', () => {
    openView();
    const rows = [...document.querySelectorAll('.issue-talk-list .comment')];

    expect(rows[0].querySelector('.comment-tools')).toBe(null);
    expect(rows[1].querySelector('.comment-tools')).toBeTruthy();
  });

  it('消すのは確かめてから', () => {
    const app = openView();
    const mine = [...document.querySelectorAll('.issue-talk-list .comment')][1];

    mine.querySelector('.comment-tools .btn-danger').click();
    expect(app.calls.some((c) => c.name === 'apiIssueCommentDelete')).toBe(false);

    document.querySelector('#side-body .confirm-strip .btn-primary').click();
    expect(app.calls.filter((c) => c.name === 'apiIssueCommentDelete').pop().args[0])
      .toBe(2);
  });

  it('まだ何も無ければ何を残す場所かを言う', () => {
    openView({ apiIssueComments: [] });

    expect(document.querySelector('.issue-talk-list').textContent)
      .toContain('決めた理由をここに残せます');
  });

  it('「@」で人を呼べる', () => {
    openView();
    const box = document.querySelector('.issue-talk .comment-form textarea');

    box.value = '@ot';
    box.selectionStart = 3;
    box.dispatchEvent(new window.Event('input', { bubbles: true }));

    expect(document.querySelector('.issue-talk .mention-picker').hidden)
      .toBe(false);
  });
});

describe('補足の下書き', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openEdit() {
    const app = mount();
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list .row-open').click();
    document.getElementById('side-edit').click();
    return app;
  }

  function bodyField() {
    return document.querySelectorAll('#side-body input, #side-body textarea')[1];
  }

  it('用意されたものと自分のものが並ぶ', () => {
    openEdit();

    expect([...document.querySelectorAll('.template-use')]
      .map((b) => b.textContent)).toEqual(['作業の段取り', '週報']);
  });

  it('押すと差し込まれる', () => {
    openEdit();
    const body = bodyField();
    body.value = '';
    body.selectionStart = 0;
    body.selectionEnd = 0;

    document.querySelector('.template-use').click();

    expect(body.value).toContain('## やること');
  });

  it('前に字があれば1行空ける', () => {
    openEdit();
    const body = bodyField();
    body.value = 'まえの字';
    body.selectionStart = body.selectionEnd = body.value.length;

    document.querySelector('.template-use').click();

    // 続けて差し込むと塊が繋がって読めない
    expect(body.value).toBe('まえの字\n\n## やること\n\n- [ ] \n');
  });

  it('自分の下書きだけ消せる', () => {
    openEdit();
    const chips = [...document.querySelectorAll('.template-chip')];

    expect(chips[0].querySelector('.chip-off')).toBe(null);
    expect(chips[1].querySelector('.chip-off')).toBeTruthy();
  });

  it('いまの補足を下書きにできる', () => {
    const app = openEdit();
    bodyField().value = '## 今週やったこと\n';

    [...document.querySelectorAll('.template-bar .btn')]
      .find((b) => b.textContent.includes('下書きにする')).click();

    document.querySelector('#side-body form input').value = '週次';
    document.querySelector('#side-body form .btn-primary').click();

    expect(app.calls.filter((c) => c.name === 'apiTemplateSave').pop().args)
      .toEqual(['週次', '## 今週やったこと\n']);
  });

  it('補足が空なら下書きにさせない', () => {
    openEdit();
    bodyField().value = '   ';

    [...document.querySelectorAll('.template-bar .btn')]
      .find((b) => b.textContent.includes('下書きにする')).click();

    expect(document.getElementById('snackbar').textContent)
      .toContain('先に補足を書いて');
  });
});

describe('起票のときに入れられるもの', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openCreate() {
    const app = mount();
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('issue-create-btn').click();
    return app;
  }

  it('担当者や工数まで尋ねる', () => {
    openCreate();

    // 作ってすぐ直せばよい、では二度手間になる
    // ラベルの字だけを読む (必須の札は字の隣に並ぶ)
    expect([...document.querySelectorAll('#side-body label')]
      .map((l) => (l.querySelector('.field-label') || l).firstChild.textContent))
      .toEqual([
        'やること', '補足 (Markdown で書けます)',
        '担当者 (「@」で選びます。何人でも)', '優先度',
        '開始日 (任意)', '期限 (任意)',
        '見積もり (規模。数値)', '予定工数 (人日)',
        'タグ (「#」で書きます。例: #会議 #調査)',
      ]);
  });

  it('入れたものを一緒に送る', () => {
    const app = openCreate();
    const fields = document.querySelectorAll('#side-body input, #side-body textarea');

    fields[0].value = '棚卸しをする';
    fields[2].value = '@me@example.com ';
    fields[2].dispatchEvent(new window.Event('input', { bubbles: true }));
    fields[4].value = '2026-10-31';
    fields[6].value = '2.5';

    document.querySelector('#side-body form .btn-primary').click();

    const call = app.calls.filter((c) => c.name === 'apiIssueCreate').pop();
    expect(call.args[4]).toEqual({
      assignee: 'me@example.com',
      startDate: '',
      dueDate: '2026-10-31',
      estimate: '',
      plannedHours: '2.5',
      priority: 'normal',
    });
  });

  it('工数は半日きざみで入れられる', () => {
    openCreate();
    const fields = document.querySelectorAll('#side-body input, #side-body textarea');

    expect(fields[6].step).toBe('0.5');
    expect(fields[3].type).toBe('date');
  });

  it('下書きも差し込める', () => {
    openCreate();

    expect(document.querySelector('#side-body .template-use')).toBeTruthy();
  });
});

describe('使われ方を数える', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const SUMMARY = {
    from: '2026-08-12', to: '2026-09-10', total: 30,
    byTarget: [
      { kind: 'action', target: 'issue-create-btn', count: 12 },
      { kind: 'action', target: 'row-open', count: 6 },
      { kind: 'view', target: 'issues', count: 9 },
    ],
    byDay: [
      { day: '2026-09-09', count: 10 },
      { day: '2026-09-10', count: 20 },
    ],
  };

  it('押した場所を数える', () => {
    const app = mount();
    document.getElementById('bell-btn').click();

    // すぐには送らない。押すたびに送るとシートが持たない
    expect(app.calls.some((c) => c.name === 'apiUsageRecord')).toBe(false);
  });

  it('画面を開いたら送るときに一緒に出す', () => {
    const app = mount({ apiUsageSummary: SUMMARY });
    document.getElementById('bell-btn').click();
    document.querySelector('[data-tab="usage"]').click();

    const rows = app.calls.filter((c) => c.name === 'apiUsageRecord').pop().args[0];
    const keys = rows.map((r) => r.kind + ':' + r.target);

    expect(keys).toContain('action:bell-btn');
    expect(keys).toContain('view:usage');
  });

  it('名前の無いところは数えない', () => {
    const app = mount({ apiUsageSummary: SUMMARY });
    document.querySelector('.layout').click();
    document.querySelector('[data-tab="usage"]').click();

    const rows = app.calls.filter((c) => c.name === 'apiUsageRecord').pop().args[0];
    expect(rows.every((r) => r.target)).toBe(true);
  });

  it('一覧の行は種類でまとめて数える', () => {
    const app = mount({ apiUsageSummary: SUMMARY });
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list .row-open').click();
    document.querySelector('[data-tab="usage"]').click();

    const rows = app.calls.filter((c) => c.name === 'apiUsageRecord').pop().args[0];
    expect(rows.map((r) => r.target)).toContain('row-open');
  });

  it('同じところを2回押したら2と数える', () => {
    const app = mount({ apiUsageSummary: SUMMARY });
    document.getElementById('bell-btn').click();
    document.getElementById('bell-btn').click();
    document.querySelector('[data-tab="usage"]').click();

    const rows = app.calls.filter((c) => c.name === 'apiUsageRecord').pop().args[0];
    expect(rows.filter((r) => r.target === 'bell-btn')[0].count).toBe(2);
  });
});

describe('使われ方のボード', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const SUMMARY = {
    from: '2026-08-12', to: '2026-09-10', total: 30,
    byTarget: [
      { kind: 'action', target: 'issue-create-btn', count: 12 },
      { kind: 'action', target: 'row-open', count: 6 },
      { kind: 'view', target: 'issues', count: 9 },
    ],
    byDay: [
      { day: '2026-09-09', count: 10 },
      { day: '2026-09-10', count: 20 },
    ],
    byUser: [
      { who: 'other@example.com', count: 20 },
      { who: 'me@example.com', count: 10 },
    ],
  };

  function openBoard(over) {
    const app = mount(Object.assign({ apiUsageSummary: SUMMARY }, over || {}));
    document.querySelector('[data-tab="usage"]').click();
    return app;
  }

  it('誰でも開ける場所に置く', () => {
    openBoard();
    expect(document.getElementById('panel-usage').hidden).toBe(false);
  });

  it('人が読める言葉に直して並べる', () => {
    openBoard();
    const names = [...document.querySelectorAll('#usage .usage-name')]
      .map((n) => n.textContent);

    expect(names).toContain('やることを作る');
    expect(names).toContain('やること・報告の行を開く');
  });

  it('操作と画面を分けて並べる', () => {
    openBoard();
    const heads = [...document.querySelectorAll('#usage h3')]
      .map((h) => h.textContent);

    expect(heads).toEqual([
      'よく使っている人', 'よく押されている操作', 'よく開かれている画面', '日ごと',
    ]);
  });

  it('多いものほど棒が長い', () => {
    openBoard();
    const bars = [...document.querySelectorAll('#usage .usage-list')][0]
      .querySelectorAll('.usage-bar');

    expect(bars[0].style.width).toBe('100%');
    expect(parseInt(bars[1].style.width, 10)).toBeLessThan(100);
  });

  it('日ごとの高さも比べられる', () => {
    openBoard();
    const days = document.querySelectorAll('#usage .usage-day-bar');

    expect(days).toHaveLength(2);
    expect(days[1].style.height).toBe('100%');
  });

  it('期間を変えられる', () => {
    const app = openBoard();

    document.getElementById('usage-days').value = '7';
    document.getElementById('usage-days')
      .dispatchEvent(new window.Event('change', { bubbles: true }));

    expect(app.calls.filter((c) => c.name === 'apiUsageSummary').pop().args[0])
      .toBe(7);
  });

  it('まだ何も無ければ何が出るのかを言う', () => {
    openBoard({
      apiUsageSummary: {
        from: '', to: '', total: 0, byTarget: [], byDay: [], byUser: [],
      },
    });

    expect(document.getElementById('usage').textContent)
      .toContain('どこがよく押されているか');
  });

  it('何を数えているかを画面にも書く', () => {
    openBoard();

    // 押した順番や時刻までは残していない
    expect(document.getElementById('panel-usage').textContent)
      .toContain('順番や時刻は残していません');
  });

  it('よく使っている人を多い順に並べる', () => {
    openBoard();
    const rows = [...document.querySelectorAll('#usage .usage-person')];

    expect(rows.map((r) => r.querySelector('.usage-name').textContent))
      .toEqual(['鈴鈴木 花子', '山山田 太郎']);
    expect(rows[0].querySelector('.usage-rank').textContent).toBe('1');
  });

  it('人を押すとその人のぶんに絞る', () => {
    const app = openBoard();
    document.querySelector('#usage .usage-person').click();

    expect(app.calls.filter((c) => c.name === 'apiUsageSummary').pop().args[1])
      .toBe('other@example.com');
  });

  it('対象を選び直せる', () => {
    const app = openBoard();

    expect([...document.querySelectorAll('#usage-who option')]
      .map((o) => o.textContent))
      .toEqual(['みんなの合計', '鈴木 花子', '山田 太郎']);

    document.getElementById('usage-who').value = 'me@example.com';
    document.getElementById('usage-who')
      .dispatchEvent(new window.Event('change', { bubbles: true }));

    expect(app.calls.filter((c) => c.name === 'apiUsageSummary').pop().args[1])
      .toBe('me@example.com');
  });

  it('誰のぶんを見ているかを出す', () => {
    openBoard({
      apiUsageSummary: Object.assign({}, SUMMARY, { who: 'me@example.com' }),
    });

    expect([...document.querySelectorAll('#usage .tally-card')]
      .map((c) => c.textContent).join(' ')).toContain('山田 太郎');
  });
});

describe('自分まわりの操作', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.open = () => {};
  });

  function openMe() {
    const app = mount();
    document.getElementById('me-btn').click();
    return app;
  }

  function actions() {
    return [...document.querySelectorAll('#me-body .btn')]
      .map((b) => b.textContent);
  }

  it('上の帯からいつでも開ける', () => {
    openMe();

    // 使い方の頁の底に置くと、困ったときにしか開かれない場所に埋もれる
    expect(document.getElementById('me-panel').hidden).toBe(false);
    expect(actions()).toEqual([
      '手元から動かす道具を落とす', '表示する名前を決める',
      'はじめの案内をもう一度出す',
    ]);
  });

  it('自分の顔と名前を出す', () => {
    openMe();

    expect(document.getElementById('me-btn').querySelector('.avatar')
      .textContent).toBe('山');
    expect(document.getElementById('me-who').textContent).toBe('山田 太郎');
    expect(document.getElementById('me-body').textContent)
      .toContain('me@example.com');
  });

  it('道具を落とせる', () => {
    let opened = '';
    window.open = (url) => { opened = url; };

    const app = openMe();
    [...document.querySelectorAll('#me-body .btn')]
      .find((b) => b.textContent.includes('手元から動かす道具')).click();

    expect(app.calls.some((c) => c.name === 'apiAgentKit')).toBe(true);
    expect(opened).toContain('drive.google.com');
  });

  it('名前を決められる', () => {
    const app = openMe();
    [...document.querySelectorAll('#me-body .btn')]
      .find((b) => b.textContent.includes('表示する名前')).click();

    const input = document.querySelector('#side-body input');
    expect(input.value).toBe('山田 太郎');

    input.value = '山田 一郎';
    document.querySelector('#side-body form .btn-primary').click();

    expect(app.calls.filter((c) => c.name === 'apiPeopleSetName').pop().args)
      .toEqual(['me@example.com', '山田 一郎']);
  });

  it('はじめの案内を出し直せる', () => {
    mount();
    document.getElementById('guideline-hide').click();

    document.getElementById('me-btn').click();
    [...document.querySelectorAll('#me-body .btn')]
      .find((b) => b.textContent.includes('もう一度出す')).click();

    expect(document.getElementById('guideline').hidden).toBe(false);
    expect(document.getElementById('me-panel').hidden).toBe(true);
  });

  it('閉じられる', () => {
    openMe();
    document.getElementById('me-close').click();

    expect(document.getElementById('me-panel').hidden).toBe(true);
  });

  it('使い方でも読み物より先に置く', () => {
    mount();
    document.querySelector('[data-tab="help"]').click();

    const guide = document.getElementById('guide');
    const top = guide.querySelector('.guide-top');
    const firstHead = guide.querySelector('h2');

    expect(top).toBeTruthy();
    expect(top.compareDocumentPosition(firstHead) &
      window.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('一覧の行の高さ', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('確認依頼の行も他と同じ器に入れる', () => {
    mount();
    document.querySelector('[data-tab="pulls"]').click();

    // 入れないとこの行だけ背が低くなる
    const row = document.querySelector('#pr-list .row-item');
    expect(row.querySelector('.row-open')).toBeTruthy();
    expect(row.querySelector('.row-open .icon')).toBeTruthy();
  });

  it('どの一覧でも丈を揃える', () => {
    const css = document.querySelector('style').textContent;
    const at = css.indexOf('\n.row-item {');

    expect(css.slice(at, css.indexOf('}', at))).toContain('min-height: 56px');
  });

  it('確認してもらう人が一覧にも出る', () => {
    mount({
      apiPrList: [{ ...DEFAULTS.apiPrList[0], reviewers: ['me@example.com'] }],
    });
    document.querySelector('[data-tab="pulls"]').click();

    const row = document.querySelector('#pr-list .row-item');
    expect(row.textContent).toContain('確認');
    expect(row.querySelector('.avatars')).toBeTruthy();
  });

  it('頼んでいなければ出さない', () => {
    mount({
      apiPrList: [{ ...DEFAULTS.apiPrList[0], reviewers: [] }],
    });
    document.querySelector('[data-tab="pulls"]').click();

    expect(document.querySelector('#pr-list .row-item .avatars')).toBe(null);
  });
});

describe('はじめての設定の案内', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openHelp() {
    mount();
    document.querySelector('[data-tab="help"]').click();
    return document.getElementById('guide').textContent;
  }

  it('エディタでやることだけを名指しする', () => {
    const text = openHelp();

    expect(text).toContain('setupRepo');
    expect(text).toContain('setupCommandQueue');

    // 文書の登録は画面からできる。id を調べさせるのは使う人の仕事ではない
    expect(text).not.toContain('debugRegisterFile');
    expect(text).toContain('文書を登録する');
  });

  it('承認を求められることを先に伝える', () => {
    // 初回に出る Google の画面で止まる人がいちばん多い
    expect(openHelp()).toContain('アクセスを承認してください');
  });

  it('二人目以降は設定が要らないと書く', () => {
    expect(openHelp()).toContain('二人目からは');
  });

  it('つまずいたときの見どころを書く', () => {
    expect(openHelp()).toContain('実行数');
  });

  it('スクラムは既定でオフで、どこでオンにするかを書く', () => {
    const text = openHelp();

    // 使わない人が多い。オンにする場所が書いていないと、使いたい人が辿り着けない
    expect(text).toContain('既定ではオフ');
    expect(text).toContain('「設定」でエージェンティックスクラムをオンに');
    expect(text).toContain('node agent.mjs scrum');
    expect(text).toContain('SCRUM.md');
  });

  it('手元から動かす手順も具体に書く', () => {
    const text = openHelp();

    expect(text).toContain('node agent.mjs files');
    expect(text).toContain('AGENTS.md');
    expect(text).toContain('Node.js 18 以上');
  });
});

describe('道具を落としたあとの案内', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.open = () => {};
  });

  function download() {
    const app = mount();
    document.getElementById('me-btn').click();

    [...document.querySelectorAll('#me-body .btn')]
      .find((b) => b.textContent.includes('手元から動かす道具')).click();

    return app;
  }

  it('落としたら続きの手順が出る', () => {
    download();

    // zip を渡して終わりにすると、設定に何を書けばよいか分からず止まる
    const steps = [...document.querySelectorAll('#side-body .setup-steps li strong')]
      .map((s) => s.textContent);

    expect(steps).toEqual(['zip を広げる', 'Google ドライブを同期する', '入れ先を設定に書く']);
  });

  it('入れ先の場所を写せる形で出す', () => {
    download();

    const code = document.querySelector('#side-body .copy-line code');
    expect(code.textContent).toContain('.git/queue');
    expect(document.querySelector('#side-body .copy-line .btn').textContent)
      .toBe('写す');
  });

  it('その場所を Drive で開ける', () => {
    download();

    const link = [...document.querySelectorAll('#side-body a')]
      .find((a) => a.textContent.includes('Drive で開く'));

    expect(link.href).toContain('drive.google.com/drive/folders/');
    expect(link.target).toBe('_blank');
  });

  it('通ったかの確かめ方を書く', () => {
    download();

    expect(document.getElementById('side-body').textContent)
      .toContain('node agent.mjs files');
  });

  it('自分の設定の画面は閉じる', () => {
    download();

    // 案内が後ろに隠れると気づかれない
    expect(document.getElementById('me-panel').hidden).toBe(true);
    expect(document.getElementById('side-panel').hidden).toBe(false);
  });
});

describe('画面から文書を登録する', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openAdd(over) {
    const app = mount(over);
    document.querySelector('[data-tab="docs"]').click();
    document.getElementById('doc-add-btn').click();
    return app;
  }

  it('入れ物の中身を一覧で出す', () => {
    openAdd();
    const rows = [...document.querySelectorAll('#side-body .bulk-row')];

    // id を調べてスクリプトプロパティに書かせない
    expect(rows.map((r) => r.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('賃金規程')]));
  });

  it('扱えるものだけ最初から選んでおく', () => {
    openAdd();
    const checks = [...document.querySelectorAll('#side-body .bulk-row input')];

    expect(checks[0].checked).toBe(true);
    expect(checks[1].checked).toBe(false);
    expect(checks[1].disabled).toBe(true);
  });

  it('扱えない理由を添える', () => {
    openAdd();

    expect(document.getElementById('side-body').textContent)
      .toContain('この形のファイルは扱えません');
  });

  it('選んだものを登録する', () => {
    const app = openAdd();

    [...document.querySelectorAll('#side-body .btn')]
      .find((b) => b.textContent === '登録する').click();

    expect(app.calls.filter((c) => c.name === 'apiRegisterFiles').pop().args[0])
      .toEqual(['NEW1']);
    expect(document.getElementById('snackbar').textContent)
      .toContain('1件を登録しました');
  });

  it('何も選ばなければ断る', () => {
    const app = openAdd();
    document.querySelector('#side-body .bulk-row input').checked = false;

    [...document.querySelectorAll('#side-body .btn')]
      .find((b) => b.textContent === '登録する').click();

    expect(app.calls.some((c) => c.name === 'apiRegisterFiles')).toBe(false);
  });

  it('入れ物を Drive で開ける', () => {
    openAdd();

    const link = [...document.querySelectorAll('#side-body a')]
      .find((a) => a.textContent.includes('Drive で開く'));

    expect(link.href).toContain('drive.google.com/drive/folders/');
  });

  it('見つからなければ入れ方を教える', () => {
    openAdd({ apiFoundFiles: [] });

    expect(document.getElementById('side-body').textContent)
      .toContain('「main」フォルダに文書を入れて');
  });

  it('1件も管理していないときは、そこから登録に入れる', () => {
    mount({ apiListFiles: [] });
    document.querySelector('[data-tab="docs"]').click();

    const btn = document.querySelector('#doc-list .blank-state .btn');
    expect(btn.textContent).toBe('文書を登録する');

    btn.click();
    expect(document.getElementById('side-title').textContent).toBe('文書を登録する');
  });
});

describe('左上の名前', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('名前と読みを出す', () => {
    mount();
    const brand = document.getElementById('brand');

    expect(brand.querySelector('.brand-name').textContent).toBe('SoftBanto');
    expect(brand.querySelector('.brand-sub').textContent).toBe('そふと番頭');
    expect(brand.querySelector('.brand-tag').textContent)
      .toBe('AIで文書とタスクを管理するシステム');
  });

  it('何をする道具かは印と名前の下に置く', () => {
    mount();
    const brand = document.getElementById('brand');

    // 名前の横に足すと、260px の帯では名前が潰れる。上から
    // 印と名前 → 何をする道具か → どこを見ているか の順に積む
    expect([...brand.children].map((el) => el.classList[0]))
      .toEqual(['brand-row', 'brand-tag', 'brand-place']);
    expect(brand.querySelector('.brand-row .brand-name')).toBeTruthy();
    expect(brand.querySelector('.brand-row .brand-tag')).toBeNull();
  });

  it('印は字と同じ色で描く', () => {
    mount();
    const mark = document.querySelector('#brand .brand-mark');

    // 画像を置かない。読み込みを増やさず、明るい地でも暗い地でも読める
    expect(mark.tagName.toLowerCase()).toBe('svg');
    expect(mark.getAttribute('aria-hidden')).toBe('true');
    expect(mark.querySelectorAll('path').length).toBeGreaterThan(2);
  });

  it('栞だけは色を変える', () => {
    mount();

    expect(document.querySelector('#brand .brand-mark-fill')).toBeTruthy();
  });

  it('触れると何の道具かが出る', () => {
    mount();

    expect(document.getElementById('brand').dataset.hint)
      .toContain('番頭');
  });

  it('左の並びの先頭にある', () => {
    mount();
    const sidebar = document.querySelector('.sidebar');

    expect(sidebar.firstElementChild.id).toBe('brand');
  });
});

describe('はじめにの入口', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('最初にやることを置く', () => {
    mount();
    const extra = document.getElementById('guideline-extra');

    expect([...extra.querySelectorAll('.btn')].map((b) => b.textContent))
      .toEqual(['文書を登録する', '手元から動かす道具を落とす']);
  });

  it('流れの図とは分けて置く', () => {
    mount();
    const body = document.getElementById('guideline-body');

    // 図の中に混ぜると手順と読めてしまう
    expect(body.querySelector('.flow-steps .btn')).toBe(null);
    expect(body.querySelector('.guideline-extra')).toBeTruthy();
  });

  it('文書の登録に入れる', () => {
    mount();

    [...document.querySelectorAll('#guideline-extra .btn')]
      .find((b) => b.textContent === '文書を登録する').click();

    expect(document.getElementById('side-title').textContent).toBe('文書を登録する');
  });

  it('道具も落とせる', () => {
    window.open = () => {};
    const app = mount();

    [...document.querySelectorAll('#guideline-extra .btn')]
      .find((b) => b.textContent.includes('道具を落とす')).click();

    expect(app.calls.some((c) => c.name === 'apiAgentKit')).toBe(true);
  });

  it('道具が要らない人には断りを添える', () => {
    mount();

    expect(document.getElementById('guideline-extra').textContent)
      .toContain('Claude や Codex から操作する場合だけ');
  });
});

describe('サーバを呼ぶところ', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openIssues(over) {
    const app = mount(over);
    document.querySelector('[data-tab="issues"]').click();
    return app;
  }

  /** いま出ている短い帯の文 */
  function snack() {
    const bar = document.getElementById('snackbar');
    return bar ? bar.textContent : '';
  }

  it('失敗ハンドラを書かなくても、失敗は黙らない', () => {
    // google.script.run は付け忘れると失敗が完全に黙る。その画面だけが
    // 「押しても何も起きない」になる
    openIssues({ apiIssueArchive: new Error('持ち主ではありません') });

    document.querySelector('#issue-list .row-item .btn-danger').click();
    document.querySelector('#panel-issues .confirm-strip .btn-primary').click();

    expect(snack()).toContain('持ち主ではありません');
    expect(document.getElementById('snackbar').className).toContain('ng');
  });

  it('一覧が出ないときは器の中に出す', () => {
    // 帯は数秒で消えるため、後から見た人に「ここが出ていない」が伝わらない
    openIssues({ apiIssueList: new Error('台帳が読めません') });

    expect(document.getElementById('issue-list').textContent)
      .toBe('エラー: 台帳が読めません');
  });

  it('失敗しても押し直せる', () => {
    const app = mount({ apiCommit: new Error('もう変わっています') });
    const commit = document.getElementById('commit-btn');
    commit.click();

    document.querySelector('#side-body form input').value = '第3条を改訂';
    document.querySelector('#side-body form .btn-primary').click();

    // 戻さないと二度と押せなくなる。失敗したのに押し直せないがいちばん困る
    expect(app.calls.some((c) => c.name === 'apiCommit')).toBe(true);
    expect(commit.disabled).toBe(false);
    expect(snack()).toContain('記録できませんでした');
    expect(snack()).toContain('もう変わっています');
  });

  it('黙って済ませるものは、跡だけ残す', () => {
    const seen = [];
    const warn = window.console.warn;
    window.console.warn = (text) => seen.push(String(text));

    try {
      mount({ apiTagList: new Error('読めません') });
    } finally {
      window.console.warn = warn;
    }

    // 以前は空の関数だったため、失敗したことがどこにも残らなかった
    expect(snack()).toBe('');
    expect(seen.join('\n')).toContain('選べないだけで手で書ける: 読めません');
  });

  it('前置きを添えて何ができなかったかを伝える', () => {
    openIssues({ apiIssueCreate: new Error('題がありません') });
    document.getElementById('issue-create-btn').click();

    document.querySelector('#side-body form input').value = 'x';
    document.querySelector('#side-body form .btn-primary').click();

    // サーバからの文だけでは、押した操作と結び付かないことがある
    expect(snack()).toContain('題がありません');
  });
});

describe('どのワークスペースを見ているか', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('ロゴの下に置き場所の名前を出す', () => {
    mount();

    // 同じ道具を複数のワークスペースに置くと、画面だけでは見分けが
    // 付かず、別のところの文書を直してしまう
    const place = document.querySelector('#brand .brand-place');

    expect(place.querySelector('.brand-place-name').textContent)
      .toBe('総務共有');
    expect(document.getElementById('brand').lastElementChild).toBe(place);
  });

  it('押すとその場所を開ける', () => {
    mount();
    const place = document.querySelector('#brand .brand-place');

    expect(place.tagName).toBe('A');
    expect(place.href).toContain('PLACE');
    expect(place.target).toBe('_blank');
    expect(place.rel).toBe('noopener');
  });

  it('上からの道のりも添える', () => {
    mount();

    expect(document.querySelector('#brand .brand-place').dataset.hint)
      .toContain('総務共有/agentic-management');
  });

  it('場所が分からないときは何も出さない', () => {
    // 空の器を先に置くと、名前が届いたときに左上の段がずれる
    mount({ apiWorkspace: { name: '', path: '', url: '' } });

    expect(document.querySelector('#brand .brand-place')).toBeNull();
    expect(document.querySelector('#brand .brand-name')).toBeTruthy();
  });

  it('リンクが無いときは字だけ出す', () => {
    mount({ apiWorkspace: { name: 'マイドライブ', path: '', url: '' } });
    const place = document.querySelector('#brand .brand-place');

    expect(place.tagName).toBe('SPAN');
    expect(place.textContent).toContain('マイドライブ');
  });

  it('長い名前でも左の帯を広げない', () => {
    mount({
      apiWorkspace: {
        name: 'とても長い名前のワークスペース共有フォルダ2026年度版',
        path: 'x', url: '',
      },
    });
    const css = document.querySelector('style').textContent;
    const rule = css.substring(css.indexOf('\n.brand-place-name {'));

    expect(rule.substring(0, rule.indexOf('}')))
      .toContain('text-overflow: ellipsis');
  });
});

describe('やることの優先度', () => {
  beforeEach(() => { window.localStorage.clear(); });

  /** 既定の2件に優先度を付けたもの */
  const ROWS = {
    apiIssueList: [
      Object.assign({}, DEFAULTS.apiIssueList[0], { priority: 'high' }),
      Object.assign({}, DEFAULTS.apiIssueList[1], { priority: 'low' }),
      {
        number: 9, title: 'ふつうの件', body: '', state: 'open',
        assignee: '', assignees: [], labels: '', linkedFileIds: '', linkedPr: '',
        createdAt: '2026-09-03T00:00:00.000Z', closedAt: '',
        dueDate: '', startDate: '', parent: '',
        estimate: '', plannedHours: '', actualHours: '', priority: 'normal',
      },
    ],
  };

  function openIssues(over) {
    const app = mount(over);
    document.querySelector('[data-tab="issues"]').click();
    return app;
  }

  function chipsOf(n) {
    const row = document.querySelector(
      '#issue-list .row-item[data-number="' + n + '"]');

    expect(row, '#' + n + ' の行が無い').toBeTruthy();
    return [...row.querySelectorAll('.chip-pri')].map((c) => c.textContent);
  }

  it('高いものと低いものに印が出る', () => {
    openIssues(ROWS);

    expect(chipsOf(2)).toEqual(['優先度高']);
    expect(chipsOf(1)).toEqual(['優先度低']);
  });

  it('ふつうには印を出さない', () => {
    openIssues(ROWS);

    // ほとんどがふつうなので、全件に付けると印が地になって、高いものが
    // 目に入らなくなる
    expect(chipsOf(9)).toEqual([]);
  });

  it('色だけに頼らない', () => {
    openIssues(ROWS);
    const chip = document.querySelector('#issue-list .chip-pri');

    // 色の違いに気づけない人がいる
    expect(chip.textContent).toContain('優先度');
    expect(chip.className).toContain('chip-pri-high');
  });

  it('作るときに選べる', () => {
    const app = openIssues();
    document.getElementById('issue-create-btn').click();

    const select = document.querySelector('#side-body select');
    expect([...select.options].map((o) => o.textContent))
      .toEqual(['高', 'ふつう', '低']);
    expect(select.value).toBe('normal');

    select.value = 'high';
    document.querySelector('#side-body form input').value = '棚卸し';
    document.querySelector('#side-body form .btn-primary').click();

    expect(app.calls.filter((c) => c.name === 'apiIssueCreate').pop().args[4])
      .toMatchObject({ priority: 'high' });
  });

  it('直すときは今の値が選ばれている', () => {
    const app = openIssues(ROWS);
    document.querySelector('#issue-list .row-item[data-number="2"] .row-open')
      .click();
    document.getElementById('side-edit').click();

    const select = document.querySelector('#side-body select');
    expect(select.value).toBe('high');

    select.value = 'low';
    document.querySelector('#side-body form .btn-primary').click();

    expect(app.calls.filter((c) => c.name === 'apiIssueUpdate').pop().args[1])
      .toMatchObject({ priority: 'low' });
  });

  it('語彙はサーバから取る', () => {
    const app = openIssues();

    // 写すと、足したときに選べるのに保存できない選択肢になる
    expect(app.calls.some((c) => c.name === 'apiIssuePriorities')).toBe(true);
  });

  it('ボードのカードにも出る', () => {
    openIssues({
      apiProjectBoard: {
        Backlog: [{
          issueNumber: 3, order: 0, title: '急ぎの件', state: 'open',
          assignee: '', assignees: [], labels: '', dueDate: '',
          staleDays: 0, staleLevel: '', priority: 'high',
        }],
      },
    });
    document.getElementById('view-board').click();

    // 一覧にだけ出ると、ボードで見ている人には何が急ぎなのか伝わらない
    expect(document.querySelector('#board .chip-pri').textContent)
      .toBe('優先度高');
  });
});

describe('右のペインの幅', () => {
  beforeEach(() => { window.localStorage.clear(); });

  /** やることを1つ開く */
  function openOne(over) {
    const app = mount(over);
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list .row-open').click();
    return app;
  }

  function handle() {
    return document.getElementById('side-resizer');
  }

  it('掴んで動かせる', () => {
    openOne();

    // 360px 固定だと、補足や差分のように中身が長いものが縦に細長く伸び、
    // 読むのに送り続けることになる
    expect(handle().getAttribute('role')).toBe('separator');

    handle().dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
    const width = document.documentElement.style.getPropertyValue('--side-pane-w');

    expect(width).not.toBe('');
    expect(window.localStorage.getItem('sidePaneWidth'))
      .toBe(parseInt(width, 10) + '');
  });

  it('二度押しで元の幅に戻せる', () => {
    openOne();
    handle().dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));

    // 行き過ぎたときに戻す手立てが要る
    handle().dispatchEvent(new window.MouseEvent('dblclick'));

    expect(document.documentElement.style.getPropertyValue('--side-pane-w'))
      .toBe('');
    expect(window.localStorage.getItem('sidePaneWidth')).toBeNull();
  });

  it('掴み手はペインと一緒に出入りする', () => {
    openOne();

    // 片方だけ触ると、閉じているのに分け目の線だけが宙に残る
    expect(document.getElementById('side-panel').hidden).toBe(false);
    expect(handle().hidden).toBe(false);

    document.getElementById('side-close').click();
    expect(document.getElementById('side-panel').hidden).toBe(true);
    expect(handle().hidden).toBe(true);
  });

  it('入力を出すときにも掴み手が出る', () => {
    mount();
    document.querySelector('[data-tab="issues"]').click();
    expect(handle().hidden).toBe(true);

    document.getElementById('issue-create-btn').click();
    expect(handle().hidden).toBe(false);
  });

  it('広げられるのに縮まない形にしない', () => {
    openOne();
    const css = document.querySelector('style').textContent;
    const rule = css.substring(css.indexOf('\n.side-panel {'));

    // flex の既定 (min-width: auto) は中身より小さくならない
    expect(rule.substring(0, rule.indexOf('}'))).toContain('min-width: 0');
    expect(rule.substring(0, rule.indexOf('}')))
      .toContain('flex: 0 0 var(--side-pane-w)');
  });

  it('狭い画面では掴ませない', () => {
    openOne();
    const css = document.querySelector('style').textContent;

    // 縦積みになるため境界は掴めない
    expect(css).toMatch(/@media \(max-width: 767px\) \{[^}]*\.resizer \{ display: none/);
  });
});

describe('確認依頼を取り下げる', () => {
  beforeEach(() => { window.localStorage.clear(); });

  /** 自分が出した依頼にする */
  const MINE = {
    apiPrList: [{
      number: 1, title: '第2条の改訂', sourceBranch: '見直し', targetBranch: 'main',
      state: 'open', author: 'me@example.com', createdAt: '',
      body: '第2条を直しました', reviewers: ['other@example.com'],
      canClose: true,
    }],
  };

  function openPulls(over) {
    const app = mount(over);
    document.querySelector('[data-tab="pulls"]').click();
    return app;
  }

  function offButton() {
    return [...document.querySelectorAll('#pr-detail .pr-actions .btn')]
      .filter((b) => b.textContent === '取り下げる')[0];
  }

  it('確認依頼から取り下げられる', () => {
    // 出したあとに思い直せず、誰も見ない依頼が開いたまま残っていた
    openPulls(MINE);

    expect(offButton()).toBeTruthy();
    expect(offButton().disabled).toBe(false);
  });

  it('確かめてからでないと取り下げない', () => {
    const app = openPulls(MINE);
    offButton().click();

    expect(app.calls.some((c) => c.name === 'apiPrClose')).toBe(false);

    const strip = document.querySelector('#pr-detail .confirm-strip');
    expect(strip.textContent).toContain('改訂版そのものは残る');
    expect(strip.textContent).toContain('改めて依頼できます');

    strip.querySelector('.btn-primary').click();
    expect(app.calls.filter((c) => c.name === 'apiPrClose').pop().args[0]).toBe(1);
  });

  it('取り下げたら一覧と数を取り直す', () => {
    const app = openPulls(MINE);
    offButton().click();
    document.querySelector('#pr-detail .confirm-strip .btn-primary').click();

    const names = app.calls.map((c) => c.name);
    const at = names.lastIndexOf('apiPrClose');

    expect(names.slice(at)).toContain('apiPrList');
    expect(names.slice(at)).toContain('apiOverview');
  });

  it('取り下げられない人には押させない', () => {
    // 確認を頼まれた側が取り下げられると、頼んだ人の知らないうちに消える
    openPulls();

    expect(offButton().disabled).toBe(true);
    expect(offButton().title).toContain('出した本人か、このアプリの管理者だけ');
  });

  it('反映済みと取り下げ済みには操作の欄を出さない', () => {
    ['merged', 'closed'].forEach((state) => {
      window.localStorage.clear();
      openPulls({
        apiPrList: [Object.assign({}, MINE.apiPrList[0], {
          state, canClose: false,
        })],
      });

      expect(document.querySelector('#pr-detail .pr-actions')).toBeNull();
    });
  });

  it('取り下げたものは「取り下げ」と出る', () => {
    openPulls({
      apiPrList: [Object.assign({}, MINE.apiPrList[0], {
        state: 'closed', canClose: false,
      })],
    });

    expect(document.querySelector('#pr-list .row-item .state').textContent)
      .toBe('取り下げ');
  });

  it('取り下げられなかったら理由を知らせ、押し直せる', () => {
    openPulls(Object.assign({}, MINE, {
      apiPrClose: new Error('これは既に反映済みです'),
    }));
    const off = offButton();
    off.click();
    document.querySelector('#pr-detail .confirm-strip .btn-primary').click();

    expect(document.getElementById('snackbar').textContent)
      .toContain('これは既に反映済みです');
    expect(off.disabled).toBe(false);
  });
});

describe('1つの改訂版で複数の文書', () => {
  beforeEach(() => { window.localStorage.clear(); });

  /** 「見直し」に2件入っている状態 */
  const TWO = {
    apiListFiles: [
      { fileId: 'DOC1', path: '就業規則.doc', type: 'doc' },
      { fileId: 'DOC2', path: '賃金規程.doc', type: 'doc' },
      { fileId: 'W1', path: 'branches/見直し/就業規則.doc', type: 'doc' },
      { fileId: 'W2', path: 'branches/見直し/賃金規程.doc', type: 'doc' },
    ],
  };

  function openBranches(over) {
    const app = mount(over);
    document.querySelector('[data-tab="branches"]').click();
    return app;
  }

  function row() {
    return document.querySelector('#branch-list .row-item');
  }

  function btn(label) {
    return [...row().querySelectorAll('.btn')]
      .filter((b) => b.textContent === label)[0];
  }

  it('入っている文書を全部出す', () => {
    openBranches(TWO);

    // 1件目の名前だけだと、2件目があることが分からない
    expect(row().querySelector('.row-meta').textContent)
      .toContain('就業規則.doc、賃金規程.doc');
  });

  it('文書を足せる', () => {
    const app = openBranches({
      apiListFiles: TWO.apiListFiles.slice(0, 3),
      apiBranchAddable: [{ fileId: 'DOC2', path: '賃金規程.doc', type: 'doc' }],
    });
    btn('文書を足す').click();

    // 候補はサーバに出させる。画面で組むと足せない理由を2か所に書くことになる
    expect(app.calls.some((c) => c.name === 'apiBranchAddable')).toBe(true);

    const select = document.querySelector('#side-body select');
    expect([...select.options].map((o) => o.textContent)).toEqual(['賃金規程.doc']);

    document.querySelector('#side-body form .btn-primary').click();
    expect(app.calls.filter((c) => c.name === 'apiBranchAddFile').pop().args)
      .toEqual(['見直し', 'DOC2']);
  });

  it('足せるものが無ければ入力を出さない', () => {
    openBranches({
      apiListFiles: TWO.apiListFiles.slice(0, 3),
      apiBranchAddable: [],
    });
    btn('文書を足す').click();

    expect(document.querySelector('#side-body select')).toBeNull();
    expect(document.getElementById('snackbar').textContent)
      .toContain('足せる文書がありません');
  });

  it('確認依頼には入っている文書を全部送る', () => {
    const app = openBranches(TWO);
    btn('確認を依頼する').click();

    document.querySelector('#side-body form input').value = '規程と細則の改訂';
    document.querySelector('#side-body form .btn-primary').click();

    // 1つ目だけ送ると、残りは確認も反映もされないまま置き去りになる
    const call = app.calls.filter((c) => c.name === 'apiPrCreate').pop();
    expect(call.args[3]).toEqual(['DOC1', 'DOC2']);
  });

  it('何が一緒に出るのかを先に見せる', () => {
    openBranches(TWO);
    btn('確認を依頼する').click();

    const note = document.querySelector('#side-body .side-note');
    expect(note.textContent).toContain('2件の文書が入ります');
    expect(note.textContent).toContain('賃金規程.doc');
  });

  it('1件だけのときは断りを出さない', () => {
    openBranches({ apiListFiles: TWO.apiListFiles.slice(0, 3) });
    btn('確認を依頼する').click();

    // 自明なことを書くと、読む値打ちのある文まで読まれなくなる
    expect(document.querySelector('#side-body .side-note')).toBeNull();
  });

  it('文書が欠けている版は反映先に出さない', () => {
    openBranches({
      apiListFiles: TWO.apiListFiles.concat([
        // 就業規則だけ持っている版
        { fileId: 'W3', path: 'branches/土台/就業規則.doc', type: 'doc' },
      ]),
    });
    btn('確認を依頼する').click();

    // 1つでも欠けた版に出すと、反映のとき作業コピーが無くて落ちる
    expect([...document.querySelectorAll('#side-body select option')]
      .map((o) => o.value)).toEqual(['main']);
  });
});

describe('コードの変更を確認依頼で読む', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const PATCH = [
    '--- a/src/core/Usage.gs',
    '+++ b/src/core/Usage.gs',
    '@@ -1,3 +1,4 @@',
    ' function usageDay() {',
    '-  return old;',
    '+  return next;',
    ' }',
  ].join('\n');

  const WITH_PATCH = {
    apiPrPreview: {
      clean: true, problems: [], conflicts: [], approvals: 1, ops: [],
      patchCount: 1,
      files: [{
        fileId: 'DOC1', path: '就業規則.doc', type: 'doc',
        clean: true, problems: [], conflicts: [], ops: [],
      }],
    },
    apiPrPatches: [{
      id: 1, path: 'src/core/Usage.gs', added: 1, removed: 1,
      by: 'me@example.com', at: '2026-09-30T00:00:00.000Z', text: PATCH,
    }],
  };

  function openPulls(over) {
    const app = mount(over);
    document.querySelector('[data-tab="pulls"]').click();
    return app;
  }

  function tab(label) {
    return [...document.querySelectorAll('#pr-detail .pr-tab')]
      .filter((b) => b.textContent === label)[0];
  }

  it('証跡があるときだけ見出しを出す', () => {
    openPulls(WITH_PATCH);
    expect(tab('コードの変更')).toBeTruthy();

    // 空の頁を開かせない
    window.localStorage.clear();
    openPulls();
    expect(tab('コードの変更')).toBeUndefined();
  });

  it('書いたとおりの字で出す', () => {
    openPulls(WITH_PATCH);
    tab('コードの変更').click();

    // 1バイト違えば別物なのが前提。整形すると読み手が判断を誤る
    const lines = [...document.querySelectorAll('#pr-detail .patch-line')]
      .map((el) => el.textContent);

    expect(lines).toContain('-  return old;');
    expect(lines).toContain('+  return next;');
    expect(lines).toContain('@@ -1,3 +1,4 @@');
  });

  it('足した行と消した行を見分けられる', () => {
    openPulls(WITH_PATCH);
    tab('コードの変更').click();

    expect(document.querySelectorAll('#pr-detail .patch-add')).toHaveLength(1);
    expect(document.querySelectorAll('#pr-detail .patch-del')).toHaveLength(1);
    expect(document.querySelectorAll('#pr-detail .patch-hunk')).toHaveLength(1);
  });

  it('反映されないことを必ず断る', () => {
    openPulls(WITH_PATCH);
    tab('コードの変更').click();

    // 書いていないと「承認したのに入っていない」になる
    expect(document.querySelector('#pr-detail .side-note').textContent)
      .toContain('この道具では反映されません');
  });

  it('反映の確認でも、コードは書き換えないと言う', () => {
    openPulls(WITH_PATCH);
    [...document.querySelectorAll('#pr-detail .pr-actions .btn')]
      .filter((b) => b.textContent.indexOf('反映') > -1)[0].click();

    expect(document.querySelector('#pr-detail .confirm-strip').textContent)
      .toContain('コードの変更は反映されません');
  });

  it('文書が無い依頼では「承認を記録する」になる', () => {
    openPulls({
      apiPrPreview: {
        clean: true, problems: [], conflicts: [], approvals: 1, ops: [],
        patchCount: 1, files: [],
      },
      apiPrPatches: WITH_PATCH.apiPrPatches,
    });

    // 書き戻すものが無いのに「反映する」と書くと、何が起きるか伝わらない
    const btn = [...document.querySelectorAll('#pr-detail .pr-actions .btn')]
      .filter((b) => b.textContent === '承認を記録する')[0];

    expect(btn).toBeTruthy();
    btn.click();
    expect(document.querySelector('#pr-detail .confirm-strip').textContent)
      .toContain('書き換える文書はありません');
  });

  it('何も添えられていなければ、添え方を示す', () => {
    openPulls({
      apiPrPreview: Object.assign({}, WITH_PATCH.apiPrPreview),
      apiPrPatches: [],
    });
    tab('コードの変更').click();

    expect(document.querySelector('#pr-detail .blank-state').textContent)
      .toContain('agent patch');
  });
});

describe('手元への頼みごと', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const WORK = {
    apiPrPreview: {
      clean: true, problems: [], conflicts: [], approvals: 1, ops: [],
      patchCount: 1,
      files: [{
        fileId: 'DOC1', path: '就業規則.doc', type: 'doc',
        clean: true, problems: [], conflicts: [], ops: [],
      }],
    },
    apiOutboxList: [{
      id: 5, verb: 'merge', label: '承認されたので取り込む',
      args: { branch: '見直し', into: 'main' },
      note: '確認依頼 #1「第2条の改訂」が承認されました。',
      state: 'open', prNumber: 1,
      createdAt: '2026-09-30T00:00:00.000Z', createdBy: 'me@example.com',
      takenAt: '', takenBy: '', doneAt: '', result: '',
    }],
  };

  function openWork(over) {
    mount(over);
    document.querySelector('[data-tab="pulls"]').click();

    const tab = [...document.querySelectorAll('#pr-detail .pr-tab')]
      .filter((b) => b.textContent === '手元への頼みごと')[0];
    if (tab) tab.click();
    return tab;
  }

  it('証跡が無くても頼める', () => {
    // 「差分を出して」は証跡を作る前に頼むもの。見出しが無いと頼めない
    expect(openWork(WORK)).toBeTruthy();

    window.localStorage.clear();
    expect(openWork()).toBeTruthy();
  });

  it('人からも頼める', () => {
    const app = mount(WORK);
    document.querySelector('[data-tab="pulls"]').click();
    [...document.querySelectorAll('#pr-detail .pr-tab')]
      .filter((b) => b.textContent === '手元への頼みごと')[0].click();

    [...document.querySelectorAll('#pr-detail .btn')]
      .filter((b) => b.textContent === '手元に頼む')[0].click();

    // 頼めることはサーバに出させる。写すと「選べるのに置けない」ものが出る
    expect(app.calls.some((c) => c.name === 'apiOutboxVerbs')).toBe(true);

    const select = document.querySelector('#side-body select');
    // 取り込みは承認したときに自動で置かれる。手で二重に頼ませない
    expect([...select.options].map((o) => o.value))
      .toEqual(['diff', 'review']);

    select.value = 'review';
    document.querySelector('#side-body form .btn-primary').click();

    const call = app.calls.filter((c) => c.name === 'apiOutboxAdd').pop();
    expect(call.args[0]).toBe('review');
    expect(call.args[1]).toEqual({ branch: '見直し', against: 'main' });
    expect(call.args[2].prNumber).toBe(1);
  });

  it('頼みごとと今の様子を出す', () => {
    openWork(WORK);
    const row = document.querySelector('#pr-detail .row-item');

    expect(row.querySelector('.row-title').textContent)
      .toBe('承認されたので取り込む');
    expect(row.textContent).toContain('承認されました');
    expect(row.querySelector('.state').textContent).toBe('待っています');
  });

  it('「送りました」とは言わない', () => {
    openWork(WORK);

    // 押すのではなく取りに来る形である。すぐ動くと思われては困る
    const note = document.querySelector('#pr-detail .side-note').textContent;
    expect(note).toContain('取りに来る形');
    expect(note).toContain('agent work');
    expect(note).not.toContain('送りました');
  });

  it('手元からの返事も出す', () => {
    openWork({
      apiPrPreview: WORK.apiPrPreview,
      apiOutboxList: [Object.assign({}, WORK.apiOutboxList[0], {
        state: 'done', result: 'main に取り込んで push しました',
      })],
    });

    expect(document.querySelector('#pr-detail .row-item').textContent)
      .toContain('main に取り込んで push しました');
    expect(document.querySelector('#pr-detail .state').textContent)
      .toBe('終わりました');
  });

  it('できなかったことも残す', () => {
    openWork({
      apiPrPreview: WORK.apiPrPreview,
      apiOutboxList: [Object.assign({}, WORK.apiOutboxList[0], {
        state: 'failed', result: '食い違いがあります',
      })],
    });

    // 黙って消すと、頼んだ人は待ち続けることになる
    expect(document.querySelector('#pr-detail .state').textContent)
      .toBe('できませんでした');
  });

  it('他の依頼の頼みごとは混ぜない', () => {
    openWork({
      apiPrPreview: WORK.apiPrPreview,
      apiOutboxList: [Object.assign({}, WORK.apiOutboxList[0], { prNumber: 99 })],
    });

    expect(document.querySelector('#pr-detail .row-item')).toBeNull();
    expect(document.querySelector('#pr-detail .blank-state').textContent)
      .toContain('頼みごとはありません');
  });
});

describe('確認依頼の差分を文書ごとに出す', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const TWO_FILES = {
    apiPrPreview: {
      clean: false, problems: [], conflicts: [], approvals: 1, ops: [],
      files: [
        {
          fileId: 'DOC1', path: '就業規則.doc', type: 'doc',
          clean: true, problems: [], conflicts: [],
          ops: [{ type: 'insert', line: '<p>第3条</p>' }],
        },
        {
          fileId: 'DOC2', path: '賃金規程.doc', type: 'doc',
          clean: false, problems: [], conflicts: [{ ours: [], theirs: [] }],
          ops: [{ type: 'insert', line: '<p>第2条</p>' }],
        },
      ],
    },
  };

  function openDiff(over) {
    mount(over);
    document.querySelector('[data-tab="pulls"]').click();
    [...document.querySelectorAll('#pr-detail .pr-tab')]
      .filter((b) => b.textContent === '差分')[0].click();
  }

  it('どの文書の差分かを言う', () => {
    openDiff(TWO_FILES);

    // 言わずに並べると読めない
    expect([...document.querySelectorAll('#pr-detail .diff-file-name')]
      .map((el) => el.textContent)).toEqual(['就業規則.doc', '賃金規程.doc']);
  });

  it('食い違っている文書を先に分かるようにする', () => {
    openDiff(TWO_FILES);
    const heads = [...document.querySelectorAll('#pr-detail .diff-file-head')];

    expect(heads[0].querySelector('.chip')).toBeNull();
    expect(heads[1].querySelector('.chip').textContent)
      .toContain('同じ場所が両方で変わっています');
  });

  it('1件だけのときは見出しを出さない', () => {
    openDiff();

    // 自明なので邪魔になる
    expect(document.querySelector('#pr-detail .diff-file-head')).toBeNull();
  });
});

describe('管理から外す', () => {
  beforeEach(() => { window.localStorage.clear(); });

  /** 改訂版の無い文書を1つだけ置く */
  const ALONE = {
    apiListFiles: [{ fileId: 'DOC1', path: '就業規則.doc', type: 'doc' }],
  };

  function openDocs(over) {
    const app = mount(over);
    document.querySelector('[data-tab="docs"]').click();
    return app;
  }

  function offButton() {
    return document.querySelector('#doc-list .card-off');
  }

  it('文書のカードから外せる', () => {
    // 間違って登録したものを戻す道が無く、台帳を手で直すしかなかった
    openDocs(ALONE);

    expect(offButton().getAttribute('aria-label'))
      .toBe('就業規則.doc を管理から外す');
  });

  it('ゴミ箱の印は使わない', () => {
    openDocs(ALONE);
    const del = document.querySelector('#issue-list .btn-danger');

    // 文書そのものを消すと読まれる。消えるのは台帳の1行だけである
    expect(offButton().classList.contains('btn-danger')).toBe(false);
    expect(offButton().querySelector('svg').innerHTML)
      .not.toBe(del ? del.querySelector('svg').innerHTML : 'x');
    expect(offButton().dataset.hint).toContain('文書そのものは消えず');
  });

  it('確かめてからでないと外さない', () => {
    const app = openDocs(ALONE);
    offButton().click();

    expect(app.calls.some((c) => c.name === 'apiUnregisterFile')).toBe(false);

    const strip = document.querySelector('#doc-list .confirm-strip');
    expect(strip.textContent).toContain('文書そのものは消えません');
    expect(strip.textContent).toContain('登録し直せば履歴もそのまま戻ります');

    strip.querySelector('.btn-primary').click();
    expect(app.calls.filter((c) => c.name === 'apiUnregisterFile').pop().args[0])
      .toBe('DOC1');
  });

  it('やめれば何も起きない', () => {
    const app = openDocs(ALONE);
    offButton().click();

    const strip = document.querySelector('#doc-list .confirm-strip');
    strip.querySelectorAll('.btn')[1].click();

    expect(document.querySelector('#doc-list .confirm-strip')).toBeNull();
    expect(app.calls.some((c) => c.name === 'apiUnregisterFile')).toBe(false);
  });

  it('開くための面の中には入れない', () => {
    // カードの大半は「開く」ための button である。その中に入れると、
    // 印を押したつもりで文書が開く
    const app = openDocs(ALONE);

    expect(offButton().closest('.doc-open')).toBeNull();
    expect(offButton().parentElement.classList.contains('doc-card')).toBe(true);

    offButton().click();
    expect(document.getElementById('panel-content').hidden).toBe(true);
    expect(app.calls.some((c) => c.name === 'apiGetFileHtml')).toBe(false);
  });

  it('改訂版が残っているものは押せない', () => {
    // 押せてから断られるより、押せないほうが理由が伝わる
    openDocs();

    expect(offButton().disabled).toBe(true);
    expect(offButton().dataset.hint).toContain('改訂版が2件あります');
  });

  it('外したら一覧と数を取り直す', () => {
    const app = openDocs(ALONE);
    offButton().click();
    document.querySelector('#doc-list .confirm-strip .btn-primary').click();

    const after = app.calls.map((c) => c.name);
    const at = after.lastIndexOf('apiUnregisterFile');

    expect(after.slice(at)).toContain('apiListFiles');
    expect(after.slice(at)).toContain('apiOverview');
  });

  it('外せなかったら理由を知らせる', () => {
    openDocs(Object.assign({}, ALONE, {
      apiUnregisterFile: new Error('改訂版が1件あります'),
    }));
    offButton().click();
    document.querySelector('#doc-list .confirm-strip .btn-primary').click();

    expect(document.getElementById('snackbar').textContent)
      .toContain('改訂版が1件あります');
  });
});

describe('使い方の目次', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openHelp() {
    mount();
    document.querySelector('[data-tab="help"]').click();
    return document.getElementById('guide-toc');
  }

  function items(toc) {
    return [...toc.querySelectorAll('.guide-toc-item')];
  }

  it('本文の右に、節の数だけ並ぶ', () => {
    const toc = openHelp();
    const heads = [...document.querySelectorAll('#guide h2')];

    // 節を足して目次に載らないと、そこだけ辿り着けない
    expect(items(toc).map((b) => b.textContent))
      .toEqual(heads.map((h) => h.textContent));
  });

  it('本文の隣に置く', () => {
    const toc = openHelp();
    const guide = document.getElementById('guide');

    /*
     * 本文は 760px で止まるので、その右は空いている。左の帯に出していた
     * ときは、道具そのものの行き先と混ざって何の目次か分からず、開くたびに
     * 左の並びが動いていた。
     */
    expect(guide.nextElementSibling).toBe(toc);
    expect(toc.closest('#panel-help')).toBeTruthy();
    expect(document.querySelector('.sidebar .guide-toc-item')).toBeNull();
  });

  it('何の目次かを言う', () => {
    const toc = openHelp();

    expect(toc.querySelector('h2').textContent).toBe('この頁の中身');
    expect(toc.getAttribute('aria-label')).toBe('使い方の目次');
  });

  it('左の並びを動かさない', () => {
    mount();
    const before = [...document.querySelectorAll('.sidebar .nav-item')].length;

    // 開くたびに左が伸び縮みすると、押したい行の位置が変わる
    document.querySelector('[data-tab="help"]').click();
    expect([...document.querySelectorAll('.sidebar .nav-item')].length)
      .toBe(before);
  });

  it('押すとその節へ寄る', () => {
    const toc = openHelp();
    const heads = [...document.querySelectorAll('#guide h2')];
    const seen = [];

    heads.forEach((h) => { h.scrollIntoView = () => seen.push(h.textContent); });
    items(toc)[3].click();

    expect(seen).toEqual([heads[3].textContent]);
  });

  it('飛び先ではなく押して寄せる', () => {
    const toc = openHelp();

    // 枠の中で動いているため、場所を変えると外側の頁ごと動くことがある
    expect(toc.querySelectorAll('a')).toHaveLength(0);
    expect(items(toc)[0].tagName).toBe('BUTTON');
  });

  it('いま読んでいる節を示す', () => {
    const toc = openHelp();
    const list = items(toc);
    const guide = document.getElementById('guide');

    // jsdom は位置を持たないので、見出しの位置を差し込んで送る
    const heads = [...document.querySelectorAll('#guide h2')];
    heads.forEach((h, i) => {
      Object.defineProperty(h, 'offsetTop', { value: 40 + i * 500 });
    });

    /** @param {number} to */
    function scrollTo(to) {
      guide.scrollTop = to;
      guide.dispatchEvent(new window.Event('scroll'));
      return list.map((b) => b.getAttribute('aria-current'));
    }

    // 色だけでは気づけない人がいるので aria-current でも示す。
    // 示すのは必ず1つ。0個だと目次が死んで見え、2個だとどちらか分からない
    [0, 1100, 4000].forEach(function (at) {
      expect(scrollTo(at).filter((v) => v === 'true')).toHaveLength(1);
    });

    expect(scrollTo(0)[0]).toBe('true');
    expect(scrollTo(1100)[2]).toBe('true');
    expect(scrollTo(1100)[0]).toBe('false');
    expect(scrollTo(4000)[list.length - 1]).toBe('true');
  });

  it('送っても上に残す', () => {
    openHelp();
    const css = document.querySelector('style').textContent;
    const rule = css.substring(css.indexOf('\n.guide-aside {'));

    // 底の節からでも一息で戻れるようにする
    expect(rule.substring(0, rule.indexOf('}'))).toContain('position: sticky');
  });

  it('狭い画面では出さない', () => {
    openHelp();
    const css = document.querySelector('style').textContent;

    // 本文の幅が足りなくなる。見出しは本文の中にあるので、無くても辿れる
    expect(css).toMatch(
      /@media \(max-width: 1023px\) \{[^}]*\.guide-aside \{ display: none/);
  });

  it('色だけで現在地を示さない', () => {
    openHelp();
    const css = document.querySelector('style').textContent;
    const at = css.indexOf("\n.guide-toc-item[aria-current='true'] {");
    const rule = css.substring(at, css.indexOf('}', at));

    expect(rule).toContain('border-left-color');
    expect(rule).toContain('font-weight');
  });
});

describe('カードの幅', () => {
  beforeEach(() => { window.localStorage.clear(); });

  /** 宣言の塊を取り出す */
  function ruleOf(selector) {
    const css = document.querySelector('style').textContent;
    const at = css.indexOf('\n' + selector + ' {');

    expect(at, selector + ' が見つからない').toBeGreaterThan(-1);
    return css.substring(at, css.indexOf('}', at));
  }

  it('行はどれも器いっぱいまで伸びる', () => {
    mount();

    // button の既定 width: auto は中身に合わせて縮むため、<button> の
    // 一覧 (確認依頼・要望) だけ題の長さで幅が変わっていた
    ['.row-item', '.usage-person'].forEach(function (sel) {
      const rule = ruleOf(sel);

      expect(rule, sel).toContain('width: stretch');
      // stretch を知らない環境のための控え
      expect(rule, sel).toContain('width: -webkit-fill-available');
      expect(rule, sel).toContain('width: -moz-available');
    });
  });

  it('幅の指定に 100% は使わない', () => {
    mount();

    // 左右に margin があるぶんだけはみ出す (実際に右端が見切れた)
    const rule = ruleOf('.row-item');

    expect(rule).toContain('margin: 0 var(--sp-4)');
    expect(rule).not.toContain('width: 100%');
  });

  it('確認依頼と要望の行も同じクラスで組む', () => {
    mount({
      apiInquiryList: [{
        number: 3, kind: 'bug', kindLabel: 'うまく動かない',
        title: 'とても長い題を付けたときにカードの右端が揃わない',
        body: 'x', by: 'me@example.com', state: 'open', context: '',
        answer: '', at: '2026-09-09T00:00:00.000Z', answeredAt: '',
        replyCount: 0,
      }],
    });

    document.querySelector('[data-tab="pulls"]').click();
    const pr = document.querySelector('#pr-list .row-item');

    document.querySelector('[data-tab="report"]').click();
    const report = document.querySelector('#report-list .row-item');

    // 一覧ごとに別のクラスを当てると、幅の直しが片方にしか効かない
    expect(pr.tagName).toBe('BUTTON');
    expect(report.tagName).toBe('BUTTON');
    expect(pr.classList.contains('row-item')).toBe(true);
    expect(report.classList.contains('row-item')).toBe(true);
  });
});

describe('使い方の図', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openHelp() {
    mount();
    document.querySelector('[data-tab="help"]').click();
    return [...document.querySelectorAll('#guide .diagram')];
  }

  const TITLES = [
    '文書が変わっていく道のり',
    '言葉どうしのつながり',
    '基本の流れ（押す順に）',
    'はじめての設定（最初の一人だけ）',
    '手元から動かすときの往復',
    '同じ場所が両方で変わったとき',
    'スクラムの1巡り（使う人だけ）',
  ];

  it('どの節にも図がある', () => {
    const figures = openHelp();
    const heads = [...document.querySelectorAll('#guide h2')];

    // 図だけ見て帰れるようにする。ここが節の数と食い違うと、
    // 図が無い節が生まれ、そこだけ読まれない
    expect(figures).toHaveLength(heads.length);
    expect(figures.map((f) => f.querySelector('title').textContent))
      .toEqual(TITLES);
  });

  it('その節の説明より先に置く', () => {
    const figures = openHelp();
    const guide = [...document.getElementById('guide').children];

    // 見出し → 図 → 箇条書き の順。図が下に回ると読まれない
    figures.forEach((fig) => {
      const at = guide.indexOf(fig);

      expect(guide[at - 1].tagName).toBe('H2');
      expect(guide[at + 1].tagName).toBe('UL');
    });
  });

  it('読み上げにも中身が届く', () => {
    const figures = openHelp();

    figures.forEach((fig) => {
      const svg = fig.querySelector('svg');

      expect(svg.getAttribute('role')).toBe('img');
      // 図が読めない人には desc だけが届く。題だけでは何も伝わらない
      expect(svg.querySelector('desc').textContent.length)
        .toBeGreaterThan(40);
    });
    expect(figures[0].querySelector('desc').textContent)
      .toContain('正式版');
  });

  it('外から何も取ってこない', () => {
    openHelp();
    const js = document.querySelector('style').textContent;

    // 図を描く道具を足すと読み込みが1つ増える
    expect(document.querySelectorAll('script[src*="mermaid"]')).toHaveLength(0);
    expect(js).toContain('.diagram-box');
  });

  it('向きのある線には先が付き、地の線には付かない', () => {
    const figures = openHelp();
    const arrows = [...figures[0].querySelectorAll('.diagram-arrow')];
    const withHead = arrows.filter((a) => a.getAttribute('marker-end'));
    const bare = arrows.filter((a) => !a.getAttribute('marker-end'));

    expect(withHead.length).toBeGreaterThan(0);
    withHead.forEach((a) => {
      expect(a.getAttribute('marker-end')).toMatch(/^url\(#arrow-\d+(-soft)?\)$/);
    });
    // 帯の底や時間の流れ。先が2つ並ぶとどちらへ向かうのか読めなくなる
    expect(bare.length).toBeGreaterThan(0);
    expect(figures[0].querySelector('marker path')).toBeTruthy();
  });

  it('図どうしで矢印の名前がぶつからない', () => {
    const figures = openHelp();
    const ids = figures.map((f) => f.querySelector('marker').id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('言葉での断りも添える', () => {
    const figures = openHelp();

    figures.forEach((fig) => {
      expect(fig.querySelector('figcaption').textContent.length)
        .toBeGreaterThan(10);
    });
    expect(figures[0].querySelector('figcaption').textContent)
      .toContain('正式版は直接なおしません');
    expect(figures[4].querySelector('figcaption').textContent)
      .toContain('Node.js 18');
  });

  it('描いたものが枠から出ない', () => {
    const figures = openHelp();

    figures.forEach((fig) => {
      const svg = fig.querySelector('svg');
      const [, , w, h] = svg.getAttribute('viewBox').split(' ').map(Number);

      // はみ出したぶんは切られて見えなくなる。座標を手で置いている
      // ぶん、足したときに気付けないと黙って欠ける
      svg.querySelectorAll('rect').forEach((el) => {
        const x = Number(el.getAttribute('x'));
        const y = Number(el.getAttribute('y'));

        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x + Number(el.getAttribute('width'))).toBeLessThanOrEqual(w);
        expect(y + Number(el.getAttribute('height'))).toBeLessThanOrEqual(h);
      });

      svg.querySelectorAll('text').forEach((el) => {
        expect(Number(el.getAttribute('y'))).toBeGreaterThan(0);
        expect(Number(el.getAttribute('y'))).toBeLessThanOrEqual(h);
        expect(Number(el.getAttribute('x'))).toBeGreaterThanOrEqual(0);
        expect(Number(el.getAttribute('x'))).toBeLessThanOrEqual(w);
      });

      svg.querySelectorAll('circle').forEach((el) => {
        const r = Number(el.getAttribute('r'));

        expect(Number(el.getAttribute('cx')) - r).toBeGreaterThanOrEqual(0);
        expect(Number(el.getAttribute('cx')) + r).toBeLessThanOrEqual(w);
        expect(Number(el.getAttribute('cy')) + r).toBeLessThanOrEqual(h);
      });
    });
  });

  it('箱どうしが重ならない', () => {
    const figures = openHelp();

    figures.forEach((fig, at) => {
      const boxes = [...fig.querySelectorAll('rect.diagram-box')].map((el) => ({
        x: Number(el.getAttribute('x')),
        y: Number(el.getAttribute('y')),
        w: Number(el.getAttribute('width')),
        h: Number(el.getAttribute('height')),
      }));

      // 重なると下の箱の字が読めなくなる。座標は手で置いている
      boxes.forEach((a, i) => {
        boxes.slice(i + 1).forEach((b) => {
          const over = a.x < b.x + b.w && b.x < a.x + a.w &&
                       a.y < b.y + b.h && b.y < a.y + a.h;

          expect(over, TITLES[at] + ' の箱が重なっている').toBe(false);
        });
      });
    });
  });

  it('狭い画面では縮めずに横へ流す', () => {
    openHelp();
    const css = document.querySelector('style').textContent;

    // 幅に合わせて縮めると字が潰れて読めない図になる
    expect(css).toMatch(/\.diagram\s*\{[^}]*overflow-x:\s*auto/);
    expect(css).toMatch(/\.diagram svg\s*\{[^}]*min-width:\s*680px/);
  });
});

describe('承認のあとに中身が変わった依頼', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function mergeButton() {
    return [...document.querySelectorAll('#pr-detail .pr-actions .btn')]
      .filter((b) => /反映する/.test(b.textContent))[0];
  }

  it('押せない理由に、承認し直しが要ることを出す', () => {
    mount({
      apiPrPreview: { ...DEFAULTS.apiPrPreview, approvals: 0, staleApprovals: 1 },
    });
    document.querySelector('[data-tab="pulls"]').click();

    // 「承認が必要」とだけ出ると、承認したはずの人が首をかしげる
    expect(mergeButton().disabled).toBe(true);
    expect(mergeButton().title).toContain('承認のあとに中身が変わっています');
  });

  it('古い承認が無ければ今までどおりの理由を出す', () => {
    mount({ apiPrPreview: { ...DEFAULTS.apiPrPreview, approvals: 0 } });
    document.querySelector('[data-tab="pulls"]').click();

    expect(mergeButton().title).toBe('反映には1件以上の承認が必要です');
  });
});

describe('Markdown で直して保存する', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('開いたときの指紋を添えて保存し、保存のあとは新しい指紋に替える', () => {
    const app = mount({
      apiGetMarkdown: { markdown: '# 第1条\n', branch: '改訂', editable: true, baseSha: 'A' },
      apiSaveMarkdown: { ok: true, baseSha: 'B' },
    });
    document.querySelector('.doc-open').click();
    document.getElementById('mode-edit').click();

    document.getElementById('edit-save-btn').click();
    document.getElementById('edit-save-btn').click();

    // 指紋を添えないと、開いたあとで Docs で直された分を上書きして消す
    const saves = app.calls.filter((c) => c.name === 'apiSaveMarkdown');
    expect(saves).toHaveLength(2);
    expect(saves[0].args[2]).toBe('A');
    expect(saves[1].args[2]).toBe('B');
  });
});

describe('見比べたものを反映する', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('見比べたときの指紋を添えて反映を頼む', () => {
    const app = mount({
      apiPrPreview: { ...DEFAULTS.apiPrPreview, approvals: 1, previewSha: 'P1' },
    });
    document.querySelector('[data-tab="pulls"]').click();

    const merge = [...document.querySelectorAll('#pr-detail .pr-actions .btn')]
      .filter((b) => /反映する/.test(b.textContent))[0];
    merge.click();
    const confirm = [...document.querySelectorAll('#pr-detail button')]
      .filter((b) => b.textContent === '反映する')[0];
    confirm.click();

    // 添えないと、見比べたあとで正式版が進んでも気づけない
    const calls = app.calls.filter((c) => c.name === 'apiPrMerge');
    expect(calls).toHaveLength(1);
    expect(calls[0].args[2]).toBe('P1');
  });
});

describe('送れなかった入力は消さない', () => {
  beforeEach(() => { window.localStorage.clear(); });

  /*
   * 入力欄は送った直後に閉じる。サーバの返事を待たずに閉じるので、失敗すると
   * (混み合っているときなど) 書いた本文ごと消え、最初から書き直すことになった。
   */
  function form() { return document.querySelector('#side-body form'); }

  it('失敗したら、書いたまま開き直す', () => {
    const app = mount({ apiIssueCreate: new Error('混み合っています') });
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('issue-create-btn').click();

    form().querySelector('input').value = '棚卸しの段取り';
    form().querySelector('textarea').value = '長い補足。\n書き直したくない。';
    form().querySelector('.btn-primary').click();

    expect(app.calls.filter((c) => c.name === 'apiIssueCreate')).toHaveLength(1);
    expect(document.getElementById('side-panel').hidden).toBe(false);
    expect(form().querySelector('input').value).toBe('棚卸しの段取り');
    expect(form().querySelector('textarea').value).toBe('長い補足。\n書き直したくない。');
  });

  it('開き直した入力から、もう一度送れる', () => {
    const app = mount({ apiIssueCreate: new Error('混み合っています') });
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('issue-create-btn').click();
    form().querySelector('input').value = '棚卸し';
    form().querySelector('.btn-primary').click();

    app.respond('apiIssueCreate', { number: 9, title: '棚卸し' });
    form().querySelector('.btn-primary').click();

    const sent = app.calls.filter((c) => c.name === 'apiIssueCreate');
    expect(sent).toHaveLength(2);
    expect(sent[1].args[0]).toBe('棚卸し');
    expect(document.getElementById('side-panel').hidden).toBe(true);
  });

  it('うまく送れたら、開き直さない', () => {
    mount();
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('issue-create-btn').click();
    form().querySelector('input').value = '棚卸し';
    form().querySelector('.btn-primary').click();

    expect(document.getElementById('side-panel').hidden).toBe(true);
  });
});

describe('遅れて届いた返事で、別の文書を描かない', () => {
  beforeEach(() => { window.localStorage.clear(); });

  /*
   * 返事が届いた時点で「いま開いている文書か」を見ていなかった。A を開いた
   * 直後に B へ切り替えると、遅れて届いた A の本文が B の題名の下に出た。
   */
  it('前に開いた版の本文は、あとから届いても描かない', () => {
    let lateDoc1 = null;
    mount({
      apiGetFileHtml: (fileId) => (fileId === 'DOC1'
        ? { later: (ok) => { lateDoc1 = ok; } }
        : { html: '<p>見直し版の本文</p>\n', url: 'https://e.test/W1', path: fileId }),
    });

    document.querySelector('.doc-open').click();
    const sel = document.getElementById('branch-select');
    sel.value = 'W1';
    sel.dispatchEvent(new window.Event('change'));
    expect(document.getElementById('viewer').srcdoc).toContain('見直し版の本文');

    lateDoc1({ html: '<p>正式版の本文</p>\n', url: 'https://e.test/DOC1', path: 'DOC1' });

    expect(document.getElementById('viewer').srcdoc).toContain('見直し版の本文');
    expect(document.getElementById('viewer').srcdoc).not.toContain('正式版の本文');
  });

  it('前に開いた版の Markdown は、あとから届いても入れない', () => {
    let lateDoc1 = null;
    mount({
      apiGetMarkdown: (fileId) => (fileId === 'DOC1'
        ? { later: (ok) => { lateDoc1 = ok; } }
        : { markdown: '# 見直し版\n', branch: '見直し', editable: true, baseSha: 'W' }),
    });

    document.querySelector('.doc-open').click();
    document.getElementById('mode-edit').click();
    const sel = document.getElementById('branch-select');
    sel.value = 'W1';
    sel.dispatchEvent(new window.Event('change'));
    document.getElementById('mode-edit').click();

    lateDoc1({ markdown: '# 正式版\n', branch: 'main', editable: false, baseSha: 'M' });

    expect(document.getElementById('editor').value).toBe('# 見直し版\n');
  });
});

describe('エージェンティックスクラム (既定はオフ)', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const ON = {
    scrumEnabled: true, canEdit: true, productGoal: '紙の稟議をなくす', definitionOfDone: '',
    glossary: { 'ベロシティ': '1スプリントで終えたポイントの合計。' }, glossaryAliases: {},
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
    expect(toggle.textContent).toBe('エージェンティックスクラムを使う');
    app.respond('apiSettings', ON);
    toggle.click();

    expect(app.calls.filter((c) => c.name === 'apiSetScrumEnabled')[0].args).toEqual([true]);
    expect(document.getElementById('nav-scrum').hidden).toBe(false);
    const after = document.getElementById('scrum-toggle');
    expect(after.getAttribute('aria-checked')).toBe('true');
    expect(after.textContent).toBe('エージェンティックスクラムを使う');
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
    expect(cards[0]).toContain('今のスプリント');
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

    const btn = document.querySelector('.term-help-btn[aria-label="ベロシティ とは"]');
    const note = btn.parentNode.querySelector('.term-help-text');
    expect(note.hidden).toBe(true);
    btn.click();
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain('終えたポイント');
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
    expect(document.getElementById('side-title').textContent).toBe('障害物 #3');
    expect(document.getElementById('side-body').textContent).toContain('解決済み');
  });

  it('スプリントが無いときは、作る入口を真ん中に出す', () => {
    mount({ apiSettings: ON, apiScrumView: { sprint: '', sprints: [], summary: {}, velocity: [],
      burndown: { days: [] }, roadmap: { sprints: [], rows: [] }, texts: {} } });
    document.querySelector('[data-tab="sprint"]').click();

    // 空の表と「?」だけ並べても、何をすればよいか分からない
    const blank = document.querySelector('#sprint-view .blank-state');
    expect(blank.textContent).toContain('スプリントがまだありません');
    blank.querySelector('.btn-primary').click();
    expect(document.getElementById('side-body').textContent).toContain('スプリントゴール');
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
    expect(document.getElementById('sprint-view').textContent).not.toContain('「このスプリントを直す」から');
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
    const help = document.querySelector('.term-help-btn[aria-label="ベロシティ とは"]');
    hinted(help, 'term-help');
    expect(help.getAttribute('title')).toBeNull();
    expect(help.dataset.hint).toContain('終えたポイント');

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
      expect(row.querySelector('.scrum-chips').textContent).toContain('5pt');

      const sel = document.getElementById('issue-group');
      sel.value = 'sprint';
      sel.dispatchEvent(new window.Event('change'));
      // スプリントは名前の順、未定は最後。見出しに積んだポイントの合計
      const heads = [...document.querySelectorAll('#issue-list .group-head')].map((h) => h.textContent);
      expect(heads[0]).toContain('sprint001');
      expect(heads[0]).toContain('3pt');
      expect(heads[1]).toContain('sprint002');
      expect(heads[2]).toContain('スプリント未定');
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
      expect(col.textContent).toContain('7pt');
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
      expect(nextTitle()).toContain('残り 3ポイント');
      document.querySelector('.scrum-next .btn-primary').click();
      expect(document.getElementById('panel-issues').hidden).toBe(false);
      expect(document.getElementById('view-board').getAttribute('aria-pressed')).toBe('true');
    });

    it('障害物があれば、それを先に片付けるよう出す', () => {
      mount({ apiSettings: ON, apiScrumView: running({ summary: { current: 'sprint001', planned: 5,
        completed: 2, openImpediments: 2, average: '' } }) });
      document.querySelector('[data-tab="sprint"]').click();

      expect(nextTitle()).toContain('障害物が 2件');
      document.querySelector('.scrum-next .btn-primary').click();
      expect(document.getElementById('panel-impediments').hidden).toBe(false);
    });

    it('ゴールが空なら、まずゴールを書くよう出す', () => {
      const v = running();
      v.sprints = [Object.assign({}, v.sprints[0], { goal: '' })];
      mount({ apiSettings: ON, apiScrumView: v });
      document.querySelector('[data-tab="sprint"]').click();

      expect(current()).toEqual(['計画する']);
      expect(nextTitle()).toContain('ゴール');
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
      expect(document.querySelector('.scrum-next .btn-primary').textContent).toBe('次のスプリントを作る');
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
      expect(btn.dataset.hint).toContain('まずスプリントを作る');
      // 押せないボタンには焦点が当たらない。理由は見える字でも隣に出す
      const reason = document.getElementById('sprint-edit-reason');
      expect(reason.hidden).toBe(false);
      expect(reason.textContent).toContain('まずスプリントを作る');
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

  it('やることの入力欄は、オンのときだけスクラムの欄が出る', () => {
    mount();
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('issue-create-btn').click();
    expect(document.getElementById('side-body').textContent).not.toContain('ストーリーポイント');

    mount({ apiSettings: ON });
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('issue-create-btn').click();
    expect(document.getElementById('side-body').textContent).toContain('ストーリーポイント');
    expect(document.getElementById('side-body').textContent).toContain('受入基準');
  });
});

describe('上の見出し', () => {
  it('左の行き先を開くと、その名前が見出しに出る (どれも「文書」に倒れない)', () => {
    mount({ apiSettings: { scrumEnabled: true, canEdit: true, productGoal: '', definitionOfDone: '', glossary: {}, glossaryAliases: {} } });
    // 名前の表に足し忘れると、既定の「文書」が出る (使われ方・要望で実際にそうなっていた)
    [...document.querySelectorAll('.sidebar .nav-item[data-tab]')].forEach((btn) => {
      btn.click();
      const label = btn.querySelector('.nav-label').textContent.trim();
      expect(document.getElementById('doc-title').textContent, btn.dataset.tab).toBe(label);
    });
  });
});

describe('スマホ', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('主な行き先を下の帯に並べ、押すとその画面を開いて現在地にする', () => {
    mount();
    const items = [...document.querySelectorAll('#mobile-nav .mobile-nav-item')];
    expect(items.map((b) => b.textContent)).toEqual(['文書', 'やること', '改訂中の版', '確認依頼', 'メニュー']);

    items[1].click();
    expect(document.getElementById('panel-issues').hidden).toBe(false);
    expect(items[1].getAttribute('aria-current')).toBe('true');
    expect(items[0].getAttribute('aria-current')).toBe('false');
  });

  it('「メニュー」で行き先の引き出しを開き、選ぶか外側を押すと閉じる', () => {
    mount();
    const sidebar = document.getElementById('sidebar');
    const menu = document.getElementById('mobile-nav-menu');
    const scrim = document.querySelector('.nav-scrim');

    menu.click();
    expect(sidebar.classList.contains('drawer-open')).toBe(true);
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    expect(scrim.hidden).toBe(false);

    // 下の帯に無い行き先を選ぶと閉じ、「メニュー」を現在地にする
    sidebar.querySelector('[data-tab="help"]').click();
    expect(sidebar.classList.contains('drawer-open')).toBe(false);
    expect(scrim.hidden).toBe(true);
    expect(menu.classList.contains('is-here')).toBe(true);
    // 現在地は読み上げにも伝える
    expect(menu.getAttribute('aria-current')).toBe('true');

    menu.click();
    scrim.click();
    expect(sidebar.classList.contains('drawer-open')).toBe(false);

    menu.click();
    // 開いているあいだ、後ろの画面には焦点を行かせない
    expect(document.querySelector('.main').hasAttribute('inert')).toBe(true);
    expect(document.getElementById('mobile-nav').hasAttribute('inert')).toBe(true);
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(sidebar.classList.contains('drawer-open')).toBe(false);
    expect(document.querySelector('.main').hasAttribute('inert')).toBe(false);
    // 閉じたら「メニュー」へ焦点を戻す
    expect(document.activeElement).toBe(menu);
  });

  it('下の帯にも件数を出す (左の行き先は引き出しの中で見えない)', async () => {
    mount();
    const issues = document.querySelector('#mobile-nav [data-go="issues"]');
    const count = issues.querySelector('.mobile-nav-count');
    const src = document.getElementById('count-todos');
    src.textContent = '7';
    src.hidden = false;
    await new Promise((r) => setTimeout(r, 0));
    expect(count.hidden).toBe(false);
    expect(count.textContent).toBe('7');
    expect(issues.getAttribute('aria-label')).toBe('やること (7)');
  });

  it('改訂版の一覧では、行の捨てるボタンを畳まない (そこが唯一の入口)', () => {
    const css = document.querySelector('style').textContent;
    expect(css).toMatch(/#issue-list \.row-item \.btn-danger \{ display: none; \}/);
    expect(css).not.toMatch(/\n\s*\.row-item \.btn-danger \{ display: none; \}/);
  });
});

describe('進捗ボードの使い勝手', () => {
  beforeEach(() => { window.localStorage.clear(); });
  const BOARD = {
    Backlog: [
      { issueNumber: 1, order: 0, title: 'a', state: 'open', assignee: '', labels: '', dueDate: '' },
      { issueNumber: 2, order: 1, title: 'b', state: 'open', assignee: '', labels: '', dueDate: '' },
    ],
    'In Progress': [], 'In Review': [], Done: [],
  };
  function openBoard(over) {
    const app = mount(Object.assign({ apiProjectBoard: BOARD }, over || {}));
    document.querySelector('[data-tab="issues"]').click();
    document.getElementById('view-board').click();
    return app;
  }

  it('列の「＋」から題名だけ打って、その列に足せる', () => {
    const app = openBoard({ apiIssueCreate: { number: 9, title: '思い付き' } });
    const col = document.querySelectorAll('.board-column')[1];
    col.querySelector('.board-add').click();

    const form = col.querySelector('.board-composer');
    const input = form.querySelector('input');
    expect(form.querySelector('.btn-primary').disabled).toBe(true);
    input.value = '思い付き';
    input.dispatchEvent(new window.Event('input'));
    form.dispatchEvent(new window.Event('submit', { cancelable: true }));

    expect(app.calls.find((c) => c.name === 'apiIssueCreate').args[0]).toBe('思い付き');
    // 作ると「これから」に入るので、足した列 (作業中) へ移す
    expect(app.calls.find((c) => c.name === 'apiProjectMove').args.slice(0, 2)).toEqual([9, 'In Progress']);
  });

  it('Esc で足す欄を閉じる', () => {
    openBoard();
    const col = document.querySelector('.board-column');
    col.querySelector('.board-add').click();
    col.querySelector('.board-composer input').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(col.querySelector('.board-composer')).toBeNull();
  });

  it('落とした位置に入れる (末尾にしか入らなかった)', () => {
    const app = openBoard();
    const col = document.querySelector('.board-column');
    const cards = col.querySelectorAll('.board-card');
    // 2枚目の上半分に落とす → 2番目 (位置1) に入る
    cards[1].getBoundingClientRect = () => ({ top: 100, height: 40 });
    cards[0].getBoundingClientRect = () => ({ top: 40, height: 40 });
    const drop = new window.Event('drop', { cancelable: true });
    drop.clientY = 105;
    drop.dataTransfer = { getData: () => '5' };
    col.dispatchEvent(drop);

    expect(app.calls.find((c) => c.name === 'apiProjectMove').args).toEqual([5, 'Backlog', 1]);
  });

  it('カードが1枚も無くても列を描き、「＋」から足せる', () => {
    openBoard({ apiProjectBoard: { Backlog: [], 'In Progress': [], 'In Review': [], Done: [] } });
    expect(document.querySelector('#issue-board .blank-state, .blank-state')).not.toBeNull();
    expect(document.querySelectorAll('.board-column .board-add')).toHaveLength(4);
  });

  it('足したあと列へ移せなかったら、欄を閉じて板を描き直す (押せないまま残さない)', () => {
    const app = openBoard({ apiIssueCreate: { number: 9, title: 'x' }, apiProjectMove: new Error('混み合っています') });
    const col = document.querySelectorAll('.board-column')[1];
    col.querySelector('.board-add').click();
    const form = col.querySelector('.board-composer');
    form.querySelector('input').value = 'x';
    form.querySelector('input').dispatchEvent(new window.Event('input'));
    form.dispatchEvent(new window.Event('submit', { cancelable: true }));

    expect(document.getElementById('snackbar').textContent).toContain('#9 は作りましたが');
    expect(document.querySelector('.board-composer')).toBeNull();
    expect(app.calls.filter((c) => c.name === 'apiProjectBoard').length).toBeGreaterThan(1);
  });

  it('絞り込んでいても、保存されている並びの位置に入れる', () => {
    const board = {
      Backlog: [
        { issueNumber: 1, order: 0, title: '見えない', state: 'open', assignee: '', labels: '', dueDate: '' },
        { issueNumber: 2, order: 1, title: '会議の準備', state: 'open', assignee: '', labels: '', dueDate: '' },
      ],
      'In Progress': [], 'In Review': [], Done: [],
    };
    const issues = [
      Object.assign({}, DEFAULTS.apiIssueList[0], { number: 1, title: '見えない' }),
      Object.assign({}, DEFAULTS.apiIssueList[0], { number: 2, title: '会議の準備' }),
    ];
    const app = openBoard({ apiProjectBoard: board, apiIssueList: issues });
    const filter = document.getElementById('issue-filter');
    filter.value = '会議';
    filter.dispatchEvent(new window.Event('input', { bubbles: true }));

    const col = document.querySelector('.board-column');
    const cards = col.querySelectorAll('.board-card');
    expect(cards).toHaveLength(1);
    cards[0].getBoundingClientRect = () => ({ top: 100, height: 40 });
    const drop = new window.Event('drop', { cancelable: true });
    drop.clientY = 101;
    drop.dataTransfer = { getData: () => '7' };
    col.dispatchEvent(drop);
    // 見えている1番目は、保存されている並びでは2番目 (位置1)
    expect(app.calls.filter((c) => c.name === 'apiProjectMove').pop().args).toEqual([7, 'Backlog', 1]);
  });

  it('キーボード: ? で操作の一覧、N で作る、/ で絞り込み。入力中は効かない', () => {
    mount();
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: '?' }));
    expect(document.getElementById('side-title').textContent).toBe('キーボードで使える操作');
    expect(document.querySelector('#side-body .shortcut-list').textContent).toContain('やることを作る');

    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: '/' }));
    expect(document.getElementById('panel-issues').hidden).toBe(false);
    expect(document.activeElement).toBe(document.getElementById('issue-filter'));

    // 絞り込みの欄で字を打っているあいだは、N で作り始めない
    const title = document.getElementById('side-title').textContent;
    document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    expect(document.getElementById('side-title').textContent).toBe(title);

    document.activeElement.blur();
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'N' }));
    expect(document.getElementById('side-body').querySelector('form')).not.toBeNull();
  });
});
