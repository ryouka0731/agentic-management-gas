// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { mountApp, DEFAULTS } from '../dom.js';

/*
 * 文書のリンク (?doc=…&full=1) で開かれたとき。番頭の画面 (ホーム・左の行き先・上の操作) を出さず、文書だけを出す。
 * doGet が body に doc-link / doc-full と文書の id を付ける (test/api/main.test.js)。ここは画面側。
 */

const names = (app) => app.calls.map((c) => c.name);
const HOME_CALLS = ['apiHomeSummary', 'apiMyToday', 'apiHomeActivity', 'apiOverview'];

function mountLink(doc, over) {
  return mountApp(Object.assign({}, DEFAULTS, over || {}), { link: { doc } });
}

describe('文書のリンクで開かれたとき', () => {
  it('ホームを出さずに文書を開き、周りを隠したまま本文だけを出す', () => {
    const app = mountLink('DOC1');
    expect(document.body.classList.contains('doc-link')).toBe(true);
    expect(document.body.classList.contains('doc-full')).toBe(true);
    // ホームは取りに行かない (開かれた瞬間にホームが一瞬出ない)
    HOME_CALLS.forEach((n) => expect(names(app), n).not.toContain(n));
    // 文書は開く
    expect(app.calls.filter((c) => c.name === 'apiGetFileHtml').map((c) => c.args)).toEqual([['DOC1']]);
    expect(document.getElementById('panel-content').hidden).toBe(false);
    expect(document.getElementById('panel-home').hidden).toBe(true);
    expect(document.querySelector('.link-loading')).toBe(null);
    expect(document.querySelector('.crumbs h1').textContent).toBe('就業規則.doc');
  });

  it('改訂版の作業コピーの id でも開く (題名は正式版の名前)', () => {
    const app = mountLink('W1');
    expect(app.calls.filter((c) => c.name === 'apiGetFileHtml').map((c) => c.args)).toEqual([['W1']]);
    expect(document.body.classList.contains('doc-link')).toBe(true);
  });

  it('見られない文書なら、ふつうの画面 (ホーム) に戻して知らせる', () => {
    const app = mountLink('NOPE123456');
    expect(document.body.classList.contains('doc-link')).toBe(false);
    expect(document.getElementById('panel-home').hidden).toBe(false);
    expect(document.querySelector('.link-loading')).toBe(null);
    expect(names(app)).not.toContain('apiGetFileHtml');
    expect(document.getElementById('snackbar').textContent).toContain('見られないか、登録されていません');
  });

  it('文書の一覧が取れなくても、ふつうの画面に戻す', () => {
    mountLink('DOC1', { apiListFiles: new Error('取れません') });
    expect(document.body.classList.contains('doc-link')).toBe(false);
    expect(document.getElementById('panel-home').hidden).toBe(false);
  });

  it('ふつうに開いたときは今までどおりホームを出し、印は付かない', () => {
    const app = mountApp(Object.assign({}, DEFAULTS));
    expect(document.body.classList.contains('doc-link')).toBe(false);
    expect(document.body.dataset.linkDoc).toBe('');
    expect(document.getElementById('panel-home').hidden).toBe(false);
    expect(names(app)).not.toContain('apiGetFileHtml');
  });
});
