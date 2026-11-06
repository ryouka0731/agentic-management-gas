// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { mountApp, DEFAULTS } from '../dom.js';
import { ROOT } from '../ui-source.js';

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

  /*
   * やること #116: 共有したリンクを開いた人には、ふつうの 1 枚の web ページに見える。番頭の画面への入口は
   * 右端の小さな「番頭で開く」だけ。押すと、その文書を開いたまま左の行き先・上の操作が出る (ホームには移らない)
   */
  it('「番頭で開く」だけが出ていて、押すとその文書を開いたまま番頭の画面が出る', () => {
    const app = mountLink('DOC1');
    const open = document.getElementById('doc-link-open');
    expect(open.hidden).toBe(false);
    expect(document.getElementById('doc-full-btn').hidden).toBe(false);
    // 周りに要るものはまだ取っていない
    expect(names(app)).not.toContain('apiWhoAmI');

    open.click();

    expect(document.body.classList.contains('doc-link')).toBe(false);
    expect(document.body.classList.contains('doc-full')).toBe(false);
    expect(open.hidden).toBe(true);
    expect(document.getElementById('panel-content').hidden).toBe(false);
    expect(document.getElementById('panel-home').hidden).toBe(true);
    // 左の行き先・上の段と、急がない波で飛ばしていたものを取る
    ['apiWhoAmI', 'apiWorkspace', 'apiSettings', 'apiPeopleNames', 'apiTagList'].forEach((n) => {
      expect(names(app), n).toContain(n);
    });
    // 二度押しても何も起きない
    open.click();
    expect(app.calls.filter((c) => c.name === 'apiWhoAmI')).toHaveLength(1);
  });

  it('「番頭で開く」は全画面の隠す決まり (doc-full / doc-link) の両方から外してある', () => {
    // jsdom は CSS の display を見ないので、字で確かめる。片方だけ外すと本物のブラウザでは出ない (実際に踏んだ)
    const css = fs.readFileSync(path.join(ROOT, 'src/ui/app.css.html'), 'utf8');
    expect(css).toContain('body.doc-full .toolbar > :not(.crumbs):not(#doc-full-btn):not(#doc-link-open)');
    expect(css).toContain('body.doc-link .toolbar > :not(.crumbs):not(#doc-link-open)');
  });

  it('ふつうに開いたときは「番頭で開く」は出ない', () => {
    mountApp(Object.assign({}, DEFAULTS));
    expect(document.getElementById('doc-link-open').hidden).toBe(true);
  });

  it('ふつうに開いたときは今までどおりホームを出し、印は付かない', () => {
    const app = mountApp(Object.assign({}, DEFAULTS));
    expect(document.body.classList.contains('doc-link')).toBe(false);
    expect(document.body.dataset.linkDoc).toBe('');
    expect(document.getElementById('panel-home').hidden).toBe(false);
    expect(names(app)).not.toContain('apiGetFileHtml');
  });
});
