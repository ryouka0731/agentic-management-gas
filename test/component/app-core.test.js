// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from './mount.js';
import { takeUncaught } from '../dom.js';

/*
 * 画面の土台 (app.js) の道具: 画面側のエラーの帯、差分の読み替え、掴み手のキー操作、
 * 入力欄の必須、文書へのリンク。
 */

const $ = (s) => document.querySelector(s);
const snack = () => (document.getElementById('snackbar') || { textContent: '' }).textContent;

describe('画面側のエラーを帯で見せる', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('拾えなかった例外と失敗を、上の帯に出す (黙って止まらない)', () => {
    mount();
    window.dispatchEvent(Object.assign(new window.Event('error'),
      { message: 'x is not defined', filename: 'app.js', lineno: 12 }));
    expect($('#fatal-error').textContent).toBe('画面側のエラー: x is not defined (app.js:12)');

    window.dispatchEvent(Object.assign(new window.Event('error'), { message: '' }));
    expect($('#fatal-error').textContent).toBe('画面側のエラー: 不明');

    window.dispatchEvent(Object.assign(new window.Event('unhandledrejection'), { reason: new Error('届かない') }));
    expect($('#fatal-error').textContent).toBe('画面側のエラー: 処理されなかった失敗: 届かない');
    window.dispatchEvent(Object.assign(new window.Event('unhandledrejection'), { reason: '字だけ' }));
    expect($('#fatal-error').textContent).toContain('字だけ');
    expect(document.querySelectorAll('#fatal-error')).toHaveLength(1);
    // わざと起こした例外なので、受け止めなかった例外としては数えない
    takeUncaught();
  });
});

describe('差分の行を、人の読める種別に直す', () => {
  beforeEach(() => { window.localStorage.clear(); });

  const GRAPH = {
    rows: [{
      sha: 'c'.repeat(64), parentSha: '', diffFrom: '', branch: 'main', message: '最初の記録',
      author: 'me@example.com', timestamp: '2026-09-09T07:53:00.000Z',
      lane: 0, activeLanes: [0], fork: false, forkLane: -1, merge: false,
    }],
    laneCount: 1, branches: ['main'],
  };

  it.each([
    ['<p>A &amp; B &lt;C&gt; &quot;D&quot; &#39;E&#39;</p>', '段落', 'A & B <C> "D" \'E\''],
    ['<li data-list="ol" data-depth="1">二段目</li>', '番号書き', '  二段目'],
    ['<li data-list="ul" data-depth="0">箇条</li>', '箇条書き', '箇条'],
    ['<img data-sha="abc" alt="">', '画像', '(説明なし)'],
    ['<img data-sha="abc" alt="組織図">', '画像', '組織図'],
    ['<table data-sheet="名簿">', 'シート', '名簿'],
    ['<section data-slide="3">', 'スライド', '3枚目'],
    ['<table>', '表', '開始'],
    ['</table>', '表', '終わり'],
    ['<tr><td>氏名</td><td data-formula="=A1">山田</td></tr>', '行', '氏名 | 山田'],
    ['<hr>', '', ''],
  ])('%s は「%s」', (line, kind, text) => {
    mount({ apiCommitGraph: GRAPH, apiCommitDiff: [{ type: 'insert', line }] });
    $('.nav-item[data-tab="docs"]').click();
    $('.doc-open').click();
    $('[data-tab="history"]').click();
    const cell = $('#diff-view .diff-cell');
    const k = cell.querySelector('.diff-kind');
    expect(k ? k.textContent : '').toBe(kind);
    expect(cell.querySelector('.diff-text').textContent).toBe(text);
  });
});

describe('本文の箇条書き', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('続いた項目を1つの並びに包み、種類が変わったら包み直す', () => {
    mount({
      apiGetFileHtml: {
        html: '<li data-list="ul" data-depth="0">一</li>\n<li data-list="ul" data-depth="0">二</li>\n' +
          '<li data-list="ol" data-depth="0">三</li>\n<p>段落</p>\n<li data-list="ol" data-depth="0">四</li>\n',
        name: '就業規則', url: 'https://example.invalid/d/DOC1', path: '就業規則.doc',
      },
    });
    $('.nav-item[data-tab="docs"]').click();
    $('.doc-open').click();
    const frame = $('#panel-content iframe');
    const html = frame.getAttribute('srcdoc') || '';
    expect(html).toMatch(/<ul>\n<li data-list="ul" data-depth="0">一<\/li>\n<li data-list="ul" data-depth="0">二<\/li>\n<\/ul>\n<ol>/);
    expect(html).toMatch(/<\/ol>\n<p>段落<\/p>\n<ol>\n<li data-list="ol" data-depth="0">四<\/li>\n<\/ol>/);
  });
});

describe('掴み手をキーで動かす', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function key(el, k) {
    el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  }

  it('左右の矢印で 16px ずつ動き、Home と二度押しで元に戻す。ほかのキーでは動かない', () => {
    mount();
    const handle = $('#resizer');
    const width = () => document.documentElement.style.getPropertyValue('--sidebar-w');

    key(handle, 'ArrowRight');
    const first = parseInt(width(), 10);
    expect(first).toBeGreaterThan(0);
    key(handle, 'ArrowRight');
    expect(parseInt(width(), 10)).toBe(first + 16);
    key(handle, 'ArrowLeft');
    expect(parseInt(width(), 10)).toBe(first);
    expect(window.localStorage.getItem('sidebarWidth')).toBe(String(first));

    key(handle, 'a');
    expect(parseInt(width(), 10)).toBe(first);

    key(handle, 'Home');
    expect(width()).toBe('');
    expect(window.localStorage.getItem('sidebarWidth')).toBe(null);

    key(handle, 'ArrowRight');
    handle.dispatchEvent(new window.Event('dblclick'));
    expect(width()).toBe('');
    expect(snack()).toContain('幅を元に戻しました');
  });

  it('覚えていた幅で開く', () => {
    window.localStorage.setItem('sidebarWidth', '300');
    mount();
    expect(document.documentElement.style.getPropertyValue('--sidebar-w')).toBe('300px');
  });
});

describe('入力欄の必須', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('必須が空のまま送ると止めて知らせる (サーバには頼まない)', () => {
    const app = mount();
    $('.nav-item[data-tab="issues"]').click();
    $('#issue-create-btn').click();
    $('#side-body form').dispatchEvent(new window.Event('submit', { cancelable: true }));
    expect(snack()).toContain('必須の項目が空です');
    expect(app.calls.some((c) => c.name === 'apiIssueCreate')).toBe(false);
    expect($('#side-panel').hidden).toBe(false);
  });
});

describe('文書を Drive の元の形で開くリンク', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('表・スライド・知らない形でそれぞれの開き先を指す', () => {
    mount({
      apiListFiles: [
        { fileId: 'S1', path: '名簿.sheet', type: 'sheet' },
        { fileId: 'P1', path: '説明.slide', type: 'slide' },
        { fileId: 'X1', path: '別の形', type: 'pdf' },
      ],
    });
    $('.nav-item[data-tab="docs"]').click();
    const hrefs = [...document.querySelectorAll('#doc-list a')].map((a) => a.href);
    expect(hrefs).toContain('https://docs.google.com/spreadsheets/d/S1/edit');
    expect(hrefs).toContain('https://docs.google.com/presentation/d/P1/edit');
    expect(hrefs).toContain('https://drive.google.com/file/d/X1/view');
  });
});

describe('テーマを替えたら、開いている本文も描き直す', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('本文を見ているときだけ取り直す', () => {
    const app = mount();
    const count = () => app.calls.filter((c) => c.name === 'apiGetFileHtml').length;
    $('#theme-btn').click();
    expect(count()).toBe(0);

    $('.nav-item[data-tab="docs"]').click();
    $('.doc-open').click();
    const before = count();
    $('#theme-btn').click();
    expect(count()).toBe(before + 1);
  });
});
