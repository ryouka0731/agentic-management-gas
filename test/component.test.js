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
