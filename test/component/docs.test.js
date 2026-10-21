// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mountApp, DEFAULTS } from '../dom.js';
import { mount } from './mount.js';

describe('文書', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('開くとタブが出て、正式版では直せない', () => {
    mount({ apiGetMarkdown: { markdown: '# 就業規則\n', branch: 'main', editable: false } });

    document.querySelector('.nav-item[data-tab="docs"]').click();
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
    document.querySelector('.nav-item[data-tab="docs"]').click();
    document.querySelector('.doc-open').click();
    document.querySelector('[data-tab="history"]').click();

    const nav = document.querySelector('.nav-item[data-tab="docs"]');
    expect(nav.getAttribute('aria-current')).toBe('true');
  });

  it('戻る道がある', () => {
    mount();
    document.querySelector('.nav-item[data-tab="docs"]').click();
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
    document.querySelector('.nav-item[data-tab="docs"]').click();
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

describe('Markdown で直して保存する', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('開いたときの指紋を添えて保存し、保存のあとは新しい指紋に替える', () => {
    const app = mount({
      apiGetMarkdown: { markdown: '# 第1条\n', branch: '改訂', editable: true, baseSha: 'A' },
      apiSaveMarkdown: { ok: true, baseSha: 'B' },
    });
    document.querySelector('.nav-item[data-tab="docs"]').click();
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

    document.querySelector('.nav-item[data-tab="docs"]').click();
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

    document.querySelector('.nav-item[data-tab="docs"]').click();
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

describe('文書の全画面と、全画面のリンク', () => {
  beforeEach(() => { window.localStorage.clear(); });
  // 写し先を差し替えたテストが、後のテストに残らないようにする
  afterEach(() => { delete window.navigator.clipboard; });

  const key = (el, k) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const full = () => document.body.classList.contains('doc-full');

  /** 開いた URL のパラメータを決めて組む */
  function mountAt(parameter, over) {
    return mountApp(Object.assign({}, DEFAULTS, over || {}), { location: { parameter, parameters: {}, hash: '' } });
  }

  function openFirst() {
    document.querySelector('.nav-item[data-tab="docs"]').click();
    document.querySelector('.doc-open').click();
  }

  it('読んでいるときだけボタンが出る', () => {
    mount();
    expect(document.getElementById('doc-full-btn').hidden).toBe(true);
    expect(document.getElementById('doc-link-btn').hidden).toBe(true);
    openFirst();
    expect(document.getElementById('doc-full-btn').hidden).toBe(false);
    expect(document.getElementById('doc-link-btn').hidden).toBe(false);
    // 直すモードには全画面を出さない
    document.getElementById('mode-edit').click();
    expect(document.getElementById('doc-full-btn').hidden).toBe(true);
    document.getElementById('mode-view').click();
    expect(document.getElementById('doc-full-btn').hidden).toBe(false);
    // 履歴のタブでも出さない
    document.querySelector('.tab[data-tab="history"]').click();
    expect(document.getElementById('doc-full-btn').hidden).toBe(true);
  });

  it('ボタンで全画面になり、Esc で戻る', () => {
    mount();
    openFirst();
    const btn = document.getElementById('doc-full-btn');
    btn.click();
    expect(full()).toBe(true);
    expect(btn.textContent).toBe('全画面を閉じる');
    // 字が変わるので押した状態は持たせない (読み上げが二重になる)
    expect(btn.hasAttribute('aria-pressed')).toBe(false);
    // 本文の iframe に入った Esc は届かないので、閉じるボタンに置いておく
    expect(document.activeElement).toBe(btn);
    expect(btn.title).toContain('Esc');
    key(document.body, 'Escape');
    expect(full()).toBe(false);
    expect(btn.textContent).toBe('全画面');
  });

  it('全画面では周りを隠し、題名と閉じるボタンだけを残す', () => {
    mount();
    openFirst();
    document.getElementById('doc-full-btn').click();
    const shown = (el) => window.getComputedStyle(el).display !== 'none';
    // 「直す」を含む本文の上の操作も隠す (全画面のあいだは直させない)
    for (const sel of ['.sidebar', '#resizer', '.tabs', '.doc-modes', '#doc-link-btn', '#branch-switch', '#crumb-back']) {
      expect(shown(document.querySelector(sel)), sel).toBe(false);
    }
    expect(shown(document.getElementById('doc-title'))).toBe(true);
    expect(shown(document.getElementById('doc-full-btn'))).toBe(true);
    expect(shown(document.getElementById('viewer'))).toBe(true);
  });

  it('ほかのものが受けた Esc では抜けない', () => {
    mount();
    openFirst();
    document.getElementById('doc-full-btn').click();
    const taken = (e) => e.preventDefault();
    document.body.addEventListener('keydown', taken);
    key(document.body, 'Escape');
    document.body.removeEventListener('keydown', taken);
    expect(full()).toBe(true);
    // 引き出しが開いていれば、Esc はそちらを閉じる
    document.querySelector('.sidebar').classList.add('drawer-open');
    key(document.body, 'Escape');
    expect(full()).toBe(true);
    expect(document.querySelector('.sidebar').classList.contains('drawer-open')).toBe(false);
    key(document.body, 'Escape');
    expect(full()).toBe(false);
  });

  it('Ctrl+K は全画面を抜けてから探す欄へ', () => {
    mount();
    openFirst();
    document.getElementById('doc-full-btn').click();
    document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(full()).toBe(false);
    expect(document.activeElement.id).toBe('search-input');
  });

  it('右のペインを開くなら全画面を抜ける (開いたのに見えない)', () => {
    mount();
    openFirst();
    document.getElementById('doc-full-btn').click();
    key(document.body, '?');
    expect(document.getElementById('side-panel').hidden).toBe(false);
    expect(full()).toBe(false);
  });

  it('全画面に入るとき、開いている右のペインと引き出しを閉じる (隠れたまま残さない)', () => {
    mount();
    openFirst();
    // 右のペインを開いてから全画面へ
    key(document.body, '?');
    expect(document.getElementById('side-panel').hidden).toBe(false);
    document.querySelector('.sidebar').classList.add('drawer-open');
    document.getElementById('doc-full-btn').click();
    expect(full()).toBe(true);
    expect(document.getElementById('side-panel').hidden).toBe(true);
    expect(document.querySelector('.sidebar').classList.contains('drawer-open')).toBe(false);
    // 最初の Esc で全画面を抜ける (見えないものを閉じるだけにならない)
    key(document.body, 'Escape');
    expect(full()).toBe(false);
  });

  it('閉じるボタンでも戻る', () => {
    mount();
    openFirst();
    document.getElementById('doc-full-btn').click();
    document.getElementById('doc-full-btn').click();
    expect(full()).toBe(false);
  });

  it('別のタブへ移ると抜ける', () => {
    mount();
    openFirst();
    document.getElementById('doc-full-btn').click();
    document.querySelector('.nav-item[data-tab="issues"]').click();
    expect(full()).toBe(false);
  });

  it('リンクに ?doc=…&full=1 が入る。URL は開いたときに1回だけ尋ね、押した中で同期に写す', async () => {
    const copied = [];
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true,
      value: { writeText: (t) => { copied.push(t); return Promise.resolve(); } } });
    const app = mount();
    openFirst();
    // 押す前に尋ね終えている (押してから尋ねると、ブラウザが書き込みを断る)
    expect(app.calls.filter((c) => c.name === 'apiAppUrl')).toHaveLength(1);
    document.getElementById('doc-link-btn').click();
    // 待たずに書き込まれている = 押した操作の中で呼んだ
    expect(copied).toEqual(['https://script.google.com/macros/s/APP1/exec?doc=DOC1&full=1']);
    await Promise.resolve();
    expect(document.getElementById('snackbar').textContent).toContain('コピーしました');
    // もう一度開き直して押しても、尋ね直さない
    document.querySelector('.nav-item[data-tab="docs"]').click();
    document.querySelector('.doc-open').click();
    document.getElementById('doc-link-btn').click();
    expect(copied).toHaveLength(2);
    expect(app.calls.filter((c) => c.name === 'apiAppUrl')).toHaveLength(1);
  });

  it('URL がまだ届いていなければ、尋ねてから欄に出す (返事のあとには写そうとしない)', () => {
    const copied = [];
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true,
      value: { writeText: (t) => { copied.push(t); return Promise.resolve(); } } });
    let fail = true;
    const app = mount({ apiAppUrl: () => (fail ? new Error('混み合っています') : DEFAULTS.apiAppUrl) });
    openFirst();
    fail = false;
    document.getElementById('doc-link-btn').click();
    expect(app.calls.filter((c) => c.name === 'apiAppUrl')).toHaveLength(2);
    expect(copied).toEqual([]);
    const row = document.getElementById('doc-link-row');
    expect(row.hidden).toBe(false);
    expect(row.querySelector('code').textContent).toBe('https://script.google.com/macros/s/APP1/exec?doc=DOC1&full=1');
  });

  it('先に尋ねて断られても、次に文書を開いたときに尋ね直す', () => {
    const copied = [];
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true,
      value: { writeText: (t) => { copied.push(t); return Promise.resolve(); } } });
    let fail = true;
    const app = mount({ apiAppUrl: () => (fail ? new Error('混み合っています') : DEFAULTS.apiAppUrl) });
    openFirst();
    fail = false;
    document.querySelector('.nav-item[data-tab="docs"]').click();
    document.querySelector('.doc-open').click();
    expect(app.calls.filter((c) => c.name === 'apiAppUrl')).toHaveLength(2);
    document.getElementById('doc-link-btn').click();
    expect(copied).toHaveLength(1);
  });

  it('写せないときは、選んで写せる欄にリンクを出す', async () => {
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true,
      value: { writeText: () => Promise.reject(new Error('NotAllowedError')) } });
    mount({ apiListFiles: DEFAULTS.apiListFiles.concat([{ fileId: 'DOC2', path: '賃金規程.doc', type: 'doc' }]) });
    openFirst();
    document.getElementById('doc-link-btn').click();
    await Promise.resolve();
    await Promise.resolve();
    const row = document.getElementById('doc-link-row');
    expect(row.hidden).toBe(false);
    expect(row.querySelector('code').textContent).toBe('https://script.google.com/macros/s/APP1/exec?doc=DOC1&full=1');
    // 別の文書へ移ったら前のリンクを残さない
    document.querySelector('.nav-item[data-tab="docs"]').click();
    document.querySelectorAll('.doc-open')[1].click();
    expect(document.getElementById('doc-title').textContent).toBe('賃金規程.doc');
    expect(row.hidden).toBe(true);
    expect(row.textContent).toBe('');
  });

  it('欄の「写す」は、写せたときだけ写しましたと言う', async () => {
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: undefined });
    const had = Object.prototype.hasOwnProperty.call(document, 'execCommand');
    try {
      mount();
      openFirst();
      document.getElementById('doc-link-btn').click();
      const row = document.getElementById('doc-link-row');
      const copyBtn = Array.from(row.querySelectorAll('button')).find((b) => b.textContent === '写す');
      // 断られると例外ではなく false が返る
      document.execCommand = () => false;
      copyBtn.click();
      expect(document.getElementById('snackbar').textContent).toContain('写せませんでした');
      expect(String(window.getSelection())).toBe('https://script.google.com/macros/s/APP1/exec?doc=DOC1&full=1');
      document.execCommand = () => true;
      copyBtn.click();
      expect(document.querySelector('#snackbar .snackbar-text').textContent).toBe('写しました');
    } finally {
      if (!had) delete document.execCommand;
    }
  });

  it('リンクで開くと、その文書が全画面で開く', () => {
    const app = mountAt({ doc: 'DOC1', full: '1' });
    expect(app.calls.some((c) => c.name === 'apiGetFileHtml' && c.args[0] === 'DOC1')).toBe(true);
    expect(document.getElementById('panel-content').hidden).toBe(false);
    expect(document.getElementById('doc-title').textContent).toBe('就業規則.doc');
    expect(full()).toBe(true);
  });

  it('改訂版の作業コピーのリンクは、その版を正式版の名前で開く', () => {
    mountAt({ doc: 'W1' });
    expect(document.getElementById('panel-content').hidden).toBe(false);
    expect(document.getElementById('doc-title').textContent).toBe('就業規則.doc');
    expect(document.getElementById('branch-select').value).toBe('W1');
    // full が無ければ全画面にはしない
    expect(full()).toBe(false);
  });

  it('起動のときの一覧を待つあいだに人が移ったら、リンクの文書で奪わない', () => {
    const pending = [];
    const app = mountAt({ doc: 'DOC1', full: '1' },
      { apiListFiles: () => ({ later: (ok) => pending.push(ok) }) });
    // 起動のときの1回を待つ。同じものを尋ね直さない
    expect(app.calls.filter((c) => c.name === 'apiListFiles')).toHaveLength(1);
    document.querySelector('.nav-item[data-tab="issues"]').click();
    pending.forEach((ok) => ok(DEFAULTS.apiListFiles));
    expect(document.getElementById('panel-issues').hidden).toBe(false);
    expect(app.calls.some((c) => c.name === 'apiGetFileHtml')).toBe(false);
    expect(full()).toBe(false);
  });

  it('起動のときの一覧が遅れて届いても、移っていなければ開く', () => {
    const pending = [];
    mountAt({ doc: 'DOC1', full: '1' }, { apiListFiles: () => ({ later: (ok) => pending.push(ok) }) });
    pending.forEach((ok) => ok(DEFAULTS.apiListFiles));
    expect(document.getElementById('panel-content').hidden).toBe(false);
    expect(full()).toBe(true);
  });

  it('本文の返事を待つあいだに人が移っても、リンクの文書で奪わない', () => {
    const pending = [];
    mountAt({ doc: 'DOC1', full: '1' },
      { apiGetFileHtml: () => ({ later: (ok) => pending.push(ok) }) });
    document.querySelector('.nav-item[data-tab="issues"]').click();
    pending.forEach((ok) => ok(DEFAULTS.apiGetFileHtml));
    expect(document.getElementById('panel-issues').hidden).toBe(false);
    expect(document.getElementById('panel-content').hidden).toBe(true);
    // 開きかけた文書の題名を、移った先に残さない
    expect(document.getElementById('doc-title').textContent).toBe('やること');
    expect(full()).toBe(false);
    // 描かなかった文書を、いま開いている文書として残さない (本文のタブで空の本文になる)
    document.querySelector('.tab[data-tab="content"]').click();
    expect(document.getElementById('panel-content').hidden).toBe(true);
    expect(document.getElementById('panel-docs').hidden).toBe(false);
    expect(document.getElementById('branch-select').options.length).toBe(0);
  });

  it('一覧が取れなければ、帯で知らせる (ホームでは一覧の欄が見えない)', () => {
    mountAt({ doc: 'DOC1', full: '1' }, { apiListFiles: () => new Error('混み合っています') });
    expect(document.getElementById('panel-home').hidden).toBe(false);
    expect(document.getElementById('snackbar').textContent).toContain('リンクの文書を開けませんでした');
  });

  it('本文が取れなければ、前に開いていた文書に戻す', () => {
    const app = mount();
    openFirst();
    app.respond('apiGetFileHtml', () => new Error('混み合っています'));
    const sel = document.getElementById('branch-select');
    sel.value = 'W1';
    sel.dispatchEvent(new window.Event('change'));
    expect(document.getElementById('snackbar').textContent).toContain('開けませんでした');
    expect(document.getElementById('doc-title').textContent).toBe('就業規則.doc');
    expect(sel.value).toBe('DOC1');
    // 戻した文書の履歴を引く
    document.querySelector('.tab[data-tab="history"]').click();
    expect(app.calls.filter((c) => c.name === 'apiCommitGraph').pop().args[0]).toBe('DOC1');
  });

  it('リンクの本文が取れなければ、開きかけた文書を残さない', () => {
    mountAt({ doc: 'DOC1', full: '1' }, { apiGetFileHtml: () => new Error('混み合っています') });
    expect(document.getElementById('panel-home').hidden).toBe(false);
    expect(document.getElementById('doc-title').textContent).toBe('ホーム');
    document.querySelector('.tab[data-tab="content"]').click();
    expect(document.getElementById('panel-docs').hidden).toBe(false);
  });

  it('リンクの本文を待つあいだに人が同じ文書を開き直したら、遅れた返事で戻さない', () => {
    const pending = [];
    mountAt({ doc: 'DOC1', full: '1' },
      { apiGetFileHtml: () => ({ later: (ok) => pending.push(ok) }) });
    document.querySelector('.nav-item[data-tab="docs"]').click();
    document.querySelector('.doc-open').click();
    expect(pending).toHaveLength(2);
    // リンクの返事が先に届いても、人が開いたほうを消さない
    pending[0](DEFAULTS.apiGetFileHtml);
    pending[1](DEFAULTS.apiGetFileHtml);
    expect(document.getElementById('panel-content').hidden).toBe(false);
    expect(document.getElementById('doc-title').textContent).toBe('就業規則.doc');
    // 人が開いたものなので、全画面にはしない
    expect(full()).toBe(false);
  });

  it('同じ文書を開き直したら、先の遅れた返事で本文を上書きしない', () => {
    const app = mount();
    openFirst();
    const pending = [];
    app.respond('apiGetFileHtml', () => ({ later: (ok) => pending.push(ok) }));
    const sel = document.getElementById('branch-select');
    sel.dispatchEvent(new window.Event('change'));
    sel.dispatchEvent(new window.Event('change'));
    pending[1](Object.assign({}, DEFAULTS.apiGetFileHtml, { html: '<p>新しい第1条</p>\n' }));
    pending[0](Object.assign({}, DEFAULTS.apiGetFileHtml, { html: '<p>古い第1条</p>\n' }));
    const doc = document.getElementById('viewer').srcdoc;
    expect(doc).toContain('新しい第1条');
    expect(doc).not.toContain('古い第1条');
  });

  it('リンクの本文が遅れて取れなかったとき、そのあと人が開いた文書を消さない', () => {
    const pending = [];
    mountAt({ doc: 'DOC1', full: '1' },
      { apiGetFileHtml: () => ({ later: (ok, ng) => pending.push([ok, ng]) }) });
    document.querySelector('.nav-item[data-tab="docs"]').click();
    document.querySelector('.doc-open').click();
    pending[0][1](new Error('混み合っています'));
    pending[1][0](DEFAULTS.apiGetFileHtml);
    expect(document.getElementById('panel-content').hidden).toBe(false);
    expect(document.getElementById('doc-title').textContent).toBe('就業規則.doc');
  });

  it('リンクの一覧を待つあいだに人が別の文書を開いたら、リンクの文書で上書きしない', () => {
    const lists = [];
    const html = [];
    mountAt({ doc: 'W1', full: '1' }, {
      apiListFiles: () => ({ later: (ok) => lists.push(ok) }),
      apiGetFileHtml: () => ({ later: (ok) => html.push(ok) }),
    });
    // 探す欄から文書を開く (画面はまだ切り替わらない)
    const input = document.getElementById('search-input');
    input.focus();
    input.dispatchEvent(new window.Event('focus'));
    input.value = '就業';
    input.dispatchEvent(new window.Event('input'));
    document.querySelector('#search-results [data-kind="doc"]').click();
    // 探す欄の一覧が先に届き、人の文書を開き始める
    lists[1](DEFAULTS.apiListFiles);
    // 起動のときの一覧が遅れて届く。リンクの W1 で上書きしない
    lists[0](DEFAULTS.apiListFiles);
    expect(html).toHaveLength(1);
    html[0](DEFAULTS.apiGetFileHtml);
    expect(document.getElementById('branch-select').value).toBe('DOC1');
    expect(full()).toBe(false);
  });

  it('一覧に無い id は開かず、ホームのまま知らせる', () => {
    const app = mountAt({ doc: 'NOPE', full: '1' });
    expect(app.calls.some((c) => c.name === 'apiGetFileHtml')).toBe(false);
    expect(document.getElementById('panel-home').hidden).toBe(false);
    expect(full()).toBe(false);
    expect(document.getElementById('snackbar').textContent).toContain('この文書は見られないか、登録されていません');
  });
});

describe('文書のまわりの、うまくいかないとき・空のとき', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const $ = (s) => document.querySelector(s);
  const snack = () => (document.getElementById('snackbar') || { textContent: '' }).textContent;
  const btnIn = (root, text) => [...document.querySelectorAll(root + ' .btn')]
    .find((b) => b.textContent.indexOf(text) >= 0);

  function openDoc(over) {
    const app = mount(over);
    $('.nav-item[data-tab="docs"]').click();
    $('.doc-open').click();
    return app;
  }

  it('Markdown が取れなければ、欄を空にして理由を出す', () => {
    openDoc({ apiGetMarkdown: new Error('読めませんでした') });
    $('#mode-edit').click();
    expect($('#editor').value).toBe('');
    expect($('#mode-hint').textContent).toBe('エラー: 読めませんでした');
  });

  it('保存に失敗したら、帯で知らせて押し直せるようにする', () => {
    openDoc({
      apiGetMarkdown: { markdown: '# 第1条\n', branch: '見直し', editable: true, baseSha: 'A' },
      apiSaveMarkdown: new Error('書き戻せません'),
    });
    $('#mode-edit').click();
    $('#edit-save-btn').click();
    expect(snack()).toContain('書き戻せません');
    expect($('#edit-save-btn').disabled).toBe(false);
    expect($('#mode-hint').textContent).toBe('');
  });

  it('正式版を直接直した分は、確かめてから退避する。失敗したら押し直せる', () => {
    const app = openDoc({
      apiFileStatus: { dirty: true, headSha: 'a', branch: 'main' },
      apiStashMainDrift: new Error('混み合っています'),
    });
    expect($('#stash-btn').hidden).toBe(false);
    $('#stash-btn').click();
    expect(app.calls.some((c) => c.name === 'apiStashMainDrift')).toBe(false);
    btnIn('.confirm-strip', '退避する').click();
    expect(snack()).toContain('混み合っています');
    expect($('#stash-btn').disabled).toBe(false);
  });

  it('文書に結び付いたやることを本文の上に出す。無ければ出さない', () => {
    openDoc({ apiIssuesForFile: [{ number: 4, title: '第1条を直す' }] });
    expect($('#linked-issues').hidden).toBe(false);
    expect($('#linked-issues').textContent).toBe('やること #4 第1条を直す');

    openDoc({ apiIssuesForFile: [] });
    expect($('#linked-issues').hidden).toBe(true);
  });

  it('記録がまだ無ければ、どうすれば残るかを言う。取れなければ理由を出す', () => {
    const app = openDoc({ apiCommitGraph: { rows: [], laneCount: 1, branches: [] } });
    $('.tab[data-tab="history"]').click();
    expect($('#panel-history').textContent).toContain('まだ記録がありません');

    app.respond('apiCommitGraph', new Error('読めません'));
    $('.tab[data-tab="content"]').click();
    $('.tab[data-tab="history"]').click();
    expect($('#panel-history').textContent).toContain('エラー: 読めません');
  });

  it('差分が取れなければ、差分の欄に理由を出す', () => {
    openDoc({ apiCommitDiff: new Error('差分を作れません') });
    $('.tab[data-tab="history"]').click();
    expect($('#panel-history').textContent).toContain('エラー: 差分を作れません');
  });

  it('この文書の改訂版が無ければ、そこから作れる', () => {
    openDoc({ apiListFiles: [{ fileId: 'DOC1', path: '就業規則.doc', type: 'doc' }] });
    $('.tab[data-tab="drafts"]').click();
    expect($('#draft-list').textContent).toContain('この文書の改訂版はありません');
    btnIn('#draft-list', 'この文書の改訂版を作る').click();
    expect($('#side-title').textContent).toBe('この文書の改訂版を作る');
  });

  it('改訂中の版が1つも無ければそう言う。一覧が取れなければ理由を出す', () => {
    const app = mount({ apiBranchList: [DEFAULTS.apiBranchList[0]] });
    $('.nav-item[data-tab="branches"]').click();
    expect($('#branch-list').textContent).toContain('改訂中の版はありません');

    app.respond('apiBranchList', new Error('混み合っています'));
    $('.nav-item[data-tab="home"]').click();
    $('.nav-item[data-tab="branches"]').click();
    expect($('#branch-list .fail-text').textContent).toBe('エラー: 混み合っています');
  });

  it('改訂版を捨てたら、帯で知らせて一覧を取り直す', () => {
    const app = mount({ apiBranchDelete: { ok: true } });
    $('.nav-item[data-tab="branches"]').click();
    const lists = app.calls.filter((c) => c.name === 'apiBranchList').length;
    $('#branch-list .btn-danger').click();
    btnIn('.confirm-strip', '捨てる').click();
    expect(app.calls.filter((c) => c.name === 'apiBranchDelete').pop().args).toEqual(['見直し']);
    expect(snack()).toContain('改訂版を捨てました');
    expect(app.calls.filter((c) => c.name === 'apiBranchList').length).toBeGreaterThan(lists);
  });

  it('文書を足す: 候補が取れなければ理由を、足せなければ断りを出す', () => {
    const app = mount({ apiBranchAddable: new Error('読めません') });
    $('.nav-item[data-tab="branches"]').click();
    btnIn('#branch-list', '文書を足す').click();
    expect(snack()).toContain('候補を取れませんでした: 読めません');

    app.respond('apiBranchAddable', [{ fileId: 'DOC2', path: '賃金規程.doc' }]);
    app.respond('apiBranchAddFile', new Error('その文書はこの改訂版に入っています'));
    btnIn('#branch-list', '文書を足す').click();
    $('#side-body form .btn-primary').click();
    expect(snack()).toContain('足せませんでした: その文書はこの改訂版に入っています');
  });

  it('確認依頼: 改訂版に文書が無い・正式版が見つからなければ、そう言って欄を開かない', () => {
    mount({
      apiListFiles: [
        { fileId: 'DOC1', path: '就業規則.doc', type: 'doc' },
        { fileId: 'W9', path: 'branches/見直し/消えた規程.doc', type: 'doc' },
      ],
    });
    $('.nav-item[data-tab="branches"]').click();
    const row = [...document.querySelectorAll('#branch-list .row-item')]
      .find((r) => r.textContent.indexOf('見直し') >= 0);
    [...row.querySelectorAll('.btn')].find((b) => b.textContent === '確認を依頼する').click();
    expect(snack()).toContain('正式版の文書が見つかりません');
    expect($('#side-panel').hidden).toBe(true);

    const other = [...document.querySelectorAll('#branch-list .row-item')]
      .find((r) => r.textContent.indexOf('土台') >= 0);
    [...other.querySelectorAll('.btn')].find((b) => b.textContent === '確認を依頼する').click();
    expect(snack()).toContain('対象の文書が見つかりません');
  });

  it('依頼できなければ、理由を帯で出して書いたまま開き直す', () => {
    mount({ apiPrCreate: new Error('この組み合わせには閉じていない確認依頼があります: #1') });
    $('.nav-item[data-tab="branches"]').click();
    btnIn('#branch-list', '確認を依頼する').click();
    $('#side-body input[name="title"]').value = '第2条の改訂';
    $('#side-body form .btn-primary').click();
    expect(snack()).toContain('依頼できませんでした: この組み合わせには閉じていない確認依頼があります');
    expect($('#side-body input[name="title"]').value).toBe('第2条の改訂');
  });

  it('まとめて記録: 改訂中の版が無い・変更が無いときはそう言う。一部できなければ件数と理由を出す', () => {
    const app = mount({ apiBranchList: [DEFAULTS.apiBranchList[0]] });
    $('.nav-item[data-tab="branches"]').click();
    $('#bulk-commit-btn').click();
    expect(snack()).toContain('改訂中の版がありません');

    app.respond('apiBranchList', DEFAULTS.apiBranchList);
    app.respond('apiDirtyFiles', []);
    $('#bulk-commit-btn').click();
    expect(snack()).toContain('記録していない変更はありません');

    app.respond('apiDirtyFiles', (name) => (name === '見直し'
      ? [{ fileId: 'W1', path: 'branches/見直し/就業規則.doc' }]
      : new Error('読めません')));
    app.respond('apiCommitMany', { committed: [], failed: [{ path: 'branches/見直し/就業規則.doc', error: '進んでいます' }] });
    $('#bulk-commit-btn').click();
    // 読めなかった版があっても、読めたぶんで尋ねる
    expect(document.querySelectorAll('#side-body .bulk-row')).toHaveLength(1);
    $('#side-body input[name="message"]').value = 'まとめて';
    $('#side-body form .btn-primary').click();
    expect(snack()).toContain('0件記録しました / 1件できませんでした: branches/見直し/就業規則.doc 進んでいます');
  });

  it('まとめて記録: 全部外したら送らない。版の一覧が取れなければ押し直せる', () => {
    const app = mount({ apiDirtyFiles: [{ fileId: 'W1', path: 'branches/見直し/就業規則.doc' }] });
    $('.nav-item[data-tab="branches"]').click();
    $('#bulk-commit-btn').click();
    document.querySelectorAll('#side-body .bulk-row input').forEach((b) => { b.checked = false; });
    $('#side-body input[name="message"]').value = 'まとめて';
    $('#side-body form .btn-primary').click();
    expect(snack()).toContain('対象が選ばれていません');
    expect(app.calls.some((c) => c.name === 'apiCommitMany')).toBe(false);

    app.respond('apiBranchList', new Error('混み合っています'));
    $('#bulk-commit-btn').click();
    expect($('#bulk-commit-btn').disabled).toBe(false);
  });

  it('手元に頼む: 頼めることが取れない・無ければそう言う', () => {
    const app = mount({ apiOutboxVerbs: new Error('読めません') });
    $('.nav-item[data-tab="pulls"]').click();
    [...document.querySelectorAll('#pr-detail .pr-tab')].find((b) => b.textContent === '手元への頼みごと').click();
    btnIn('#pr-detail', '手元に頼む').click();
    expect(snack()).toContain('頼めることを取れませんでした: 読めません');

    app.respond('apiOutboxVerbs', [['merge', '取り込む']]);
    btnIn('#pr-detail', '手元に頼む').click();
    expect(snack()).toContain('頼めることがありません');

    app.respond('apiOutboxVerbs', [['diff', '差分']]);
    app.respond('apiOutboxAdd', new Error('使えない字が入っています'));
    btnIn('#pr-detail', '手元に頼む').click();
    $('#side-body form .btn-primary').click();
    expect(snack()).toContain('頼めませんでした: 使えない字が入っています');
  });

  it('この画面の URL が分からなければ、リンクを作れないと言う', () => {
    openDoc({ apiAppUrl: '' });
    $('#doc-link-btn').click();
    expect(snack()).toContain('この画面の URL が分からず、リンクを作れませんでした');
  });
});
