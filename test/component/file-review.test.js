// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from './mount.js';

/*
 * 文書の見直しの期日 (js-docs の makeReviewPill / renderDocReview。やること #112)。返事の形はサーバの apiListFiles
 * (test/file-review.test.js) に合わせてある。
 */

const $ = (s) => document.querySelector(s);

const NONE = { reviewDue: '', reviewAssignee: '', reviewNoticeDays: 30, reviewIssuedFor: '', reviewDaysLeft: '' };

function files(review) {
  return [
    Object.assign({ fileId: 'DOC1', path: '就業規則.doc', type: 'doc' }, NONE, review || {}),
    Object.assign({ fileId: 'W1', path: 'branches/見直し/就業規則.doc', type: 'doc' }, NONE),
  ];
}

function openDocs(review, over) {
  const app = mount(Object.assign({ apiListFiles: files(review) }, over || {}));
  document.querySelector('.nav-item[data-tab="docs"]').click();
  return app;
}

const pillOf = () => Array.from(document.querySelectorAll('#doc-list .doc-meta .chip'))
  .find((c) => c.textContent.indexOf('見直し') === 0);

describe('文書の一覧の見直しの札', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('期日が無ければ出さない', () => {
    openDocs();
    expect(pillOf()).toBe(undefined);
  });

  it('期日と残り日数を出す。何日前より遠ければふつうの札', () => {
    openDocs({ reviewDue: '2026-11-30', reviewDaysLeft: 33 });
    expect(pillOf().textContent).toBe('見直し 11/30 (あと 33 日)');
    expect(pillOf().className).toBe('chip');
  });

  it('何日前の内に入ったら注意の色', () => {
    openDocs({ reviewDue: '2026-11-30', reviewDaysLeft: 12 });
    expect(pillOf().className).toContain('chip-review-soon');
  });

  it('過ぎていれば危ない色で「過ぎ」と書く', () => {
    openDocs({ reviewDue: '2026-10-20', reviewDaysLeft: -8 });
    expect(pillOf().textContent).toBe('見直し 10/20 (8 日過ぎ)');
    expect(pillOf().className).toContain('chip-review-late');
  });
});

describe('文書の画面の見直しの期日', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('正式版を開くと行が出て、決めると apiFileReviewSet に送る', () => {
    const app = openDocs(null, { apiFileReviewSet: { reviewDue: '2026-12-31' } });
    $('#doc-list .doc-open').click();
    const row = $('#doc-review-row');
    expect(row.hidden).toBe(false);
    expect(row.textContent).toContain('見直しの期日はまだありません');
    Array.from(row.querySelectorAll('button')).find((b) => b.textContent === '見直しの期日を決める').click();
    const form = $('#side-body form');
    form.querySelector('[name="due"]').value = '2026-12-31';
    form.querySelector('[name="noticeDays"]').value = '30';
    form.dispatchEvent(new window.Event('submit', { cancelable: true }));
    const sent = app.calls.find((c) => c.name === 'apiFileReviewSet');
    expect(sent.args).toEqual(['DOC1', '2026-12-31', '', '30']);
  });

  it('期日があれば、期日・担当・何日前を出す', () => {
    openDocs({ reviewDue: '2026-12-31', reviewDaysLeft: 64, reviewAssignee: 'me@example.com' });
    $('#doc-list .doc-open').click();
    const row = $('#doc-review-row');
    expect(row.textContent).toContain('見直しの期日 2026-12-31');
    expect(row.textContent).toContain('30日前にやることを作ります');
    expect(row.querySelector('.chip').textContent).toBe('見直し 12/31 (あと 64 日)');
  });
});
