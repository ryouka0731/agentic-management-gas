// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULTS } from '../dom.js';
import { mount } from './mount.js';

/*
 * 反映の理由と、文書の改訂履歴の表 (やること #111)。
 */

const $ = (s) => document.querySelector(s);
const snack = () => (document.getElementById('snackbar') || { textContent: '' }).textContent;

describe('反映の理由の欄', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const mergeBtn = () => [...document.querySelectorAll('#pr-detail .pr-actions .btn')]
    .find((b) => /に反映する/.test(b.textContent));
  const confirm = () => [...document.querySelectorAll('#pr-detail .confirm-strip .btn')]
    .find((b) => b.textContent === '反映する').click();

  it('反映のボタンの前に置き、既定値 (本文の1行目) を入れておく', () => {
    mount({ apiPrPreview: Object.assign({}, DEFAULTS.apiPrPreview, { approvals: 1, defaultReason: '始業を30分遅らせる' }) });
    $('[data-tab="pulls"]').click();
    const input = $('#pr-detail .pr-actions .pr-reason input');
    expect(input.value).toBe('始業を30分遅らせる');
    expect(input.maxLength).toBe(200);
    expect(input.closest('.pr-reason').textContent).toContain('反映の理由');
    // 押す前に目に入るよう、ボタンより前
    expect(input.compareDocumentPosition(mergeBtn()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('書き直した理由を添えて反映を頼む', () => {
    const app = mount({
      apiPrPreview: Object.assign({}, DEFAULTS.apiPrPreview, { approvals: 1, previewSha: 'P1', defaultReason: '既定' }),
      apiPrMerge: { sha: 'S', message: 'm' },
    });
    $('[data-tab="pulls"]').click();
    $('#pr-detail .pr-reason input').value = '  法改正に合わせる  ';
    mergeBtn().click();
    confirm();
    expect(app.calls.filter((c) => c.name === 'apiPrMerge').pop().args).toEqual([1, [], 'P1', '法改正に合わせる']);
  });

  it('空にして押せば空で送る (サーバが本文の1行目で残す)', () => {
    const app = mount({
      apiPrPreview: Object.assign({}, DEFAULTS.apiPrPreview, { approvals: 1, defaultReason: '既定' }),
      apiPrMerge: { sha: 'S', message: 'm' },
    });
    $('[data-tab="pulls"]').click();
    $('#pr-detail .pr-reason input').value = '';
    mergeBtn().click();
    confirm();
    expect(app.calls.filter((c) => c.name === 'apiPrMerge').pop().args[3]).toBe('');
  });
});

describe('改訂履歴の表', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const ITEMS = [
    { number: 2, title: '第3条の改訂', mergedAt: '2026-10-02T01:00:00.000Z', mergedBy: 'me@example.com', mergedByName: '山田 太郎', reason: '法改正' },
    { number: 1, title: '<b>第2条</b>', mergedAt: '2026-10-01T01:00:00.000Z', mergedBy: 'other@example.com', mergedByName: '鈴木 花子', reason: '' },
  ];

  function openRevisions(over) {
    const app = mount(over);
    $('.nav-item[data-tab="docs"]').click();
    $('.doc-open').click();
    $('.tab[data-tab="revisions"]').click();
    return app;
  }

  it('文書のタブから開くと、反映ごとに題名・日付・反映した人・理由を返事の順に並べる', () => {
    const app = openRevisions({
      apiRevisionHistory: Object.assign({}, DEFAULTS.apiRevisionHistory, { items: ITEMS }),
    });
    expect($('#panel-revisions').hidden).toBe(false);
    expect(app.calls.filter((c) => c.name === 'apiRevisionHistory').pop().args).toEqual(['DOC1']);
    const rows = [...document.querySelectorAll('#revision-list .revision-row')];
    expect(rows.map((r) => r.querySelector('.row-title').textContent)).toEqual(['#2 第3条の改訂', '#1 <b>第2条</b>']);
    expect(rows[0].querySelector('.row-meta').textContent).toContain('山田 太郎');
    expect(rows[0].querySelector('.revision-reason').textContent).toBe('理由: 法改正');
    expect(rows[1].querySelector('.revision-reason').textContent).toBe('理由: (書かれていません)');
    // 題名は字のまま (タグとして読まない)
    expect($('#revision-list b')).toBeNull();
  });

  it('反映が無ければ、どうすれば並ぶかを言う。取れなければ理由を出す', () => {
    const app = openRevisions();
    expect($('#revision-list').textContent).toContain('まだ反映された確認依頼がありません');

    app.respond('apiRevisionHistory', new Error('読めません'));
    $('.tab[data-tab="content"]').click();
    $('.tab[data-tab="revisions"]').click();
    expect($('#revision-list .fail-text').textContent).toBe('エラー: 読めません');
  });

  it('書き出せないとき (管理者でない・Slides) は、理由を添えて押せなくする', () => {
    openRevisions({
      apiRevisionHistory: Object.assign({}, DEFAULTS.apiRevisionHistory, {
        canExport: false, exportBlocked: 'Slides には改訂履歴の表を書き出せません',
      }),
    });
    const btn = $('#revision-export-btn');
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe('Slides には改訂履歴の表を書き出せません');
    expect($('#revision-export-note').textContent).toContain('Slides');
  });

  it('書き出しは帯で確かめてから頼み、済んだら一覧を取り直す', () => {
    const app = openRevisions({ apiRevisionExport: { fileId: 'DOC1', type: 'doc', rows: 2, sha: 'S', changed: true } });
    $('#revision-export-btn').click();
    expect(app.calls.filter((c) => c.name === 'apiRevisionExport')).toHaveLength(0);
    const before = app.calls.filter((c) => c.name === 'apiRevisionHistory').length;
    [...document.querySelectorAll('#panel-revisions .confirm-strip .btn')].find((b) => b.textContent === '書く').click();
    expect(app.calls.filter((c) => c.name === 'apiRevisionExport').pop().args).toEqual(['DOC1']);
    expect(snack()).toContain('改訂履歴の表を書きました (2件)');
    expect(app.calls.filter((c) => c.name === 'apiRevisionHistory').length).toBe(before + 1);
  });

  it('書き出しに失敗したら理由を出し、押し直せるようにする', () => {
    openRevisions({ apiRevisionExport: new Error('記録していない変更があります') });
    $('#revision-export-btn').click();
    [...document.querySelectorAll('#panel-revisions .confirm-strip .btn')].find((b) => b.textContent === '書く').click();
    expect(snack()).toContain('書けませんでした: 記録していない変更があります');
    expect($('#revision-export-btn').disabled).toBe(false);
  });
});
