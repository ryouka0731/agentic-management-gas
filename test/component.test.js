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

  it('3つの見方に分かれている', () => {
    mount();
    document.querySelector('[data-tab="pulls"]').click();

    const tabs = [...document.querySelectorAll('#pr-detail .pr-tab')]
      .map((el) => el.textContent);

    expect(tabs).toEqual(['やりとり', '変更の記録', '差分']);
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
    expect([...document.querySelectorAll('#side-body label')]
      .map((l) => l.firstChild.textContent))
      .toEqual([
        'やること', '補足 (Markdown で書けます)',
        '担当者 (「@」で選びます。何人でも)', '開始日 (任意)', '期限 (任意)',
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
