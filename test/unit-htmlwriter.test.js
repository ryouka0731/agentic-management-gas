import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

/*
 * 書き戻し (HtmlWriter) の枝ごとの単体テスト。表とリンクは
 * test/htmlwriter.test.js にある。ここは見出し・リスト・画像・検証・種別の分岐。
 *
 * 疑似 DocumentApp は実機と同じく空の字を入れる操作を断り、書いたものの見出し・
 * 入れ子・記号を覚える。
 */
function fakeDocs() {
  function text() {
    const t = {
      s: '', styles: [],
      getText: () => t.s,
      appendText: (v) => { if (v === '') throw new Error('Cannot insert an empty text element.'); t.s += v; return t; },
    };
    ['Bold', 'Italic', 'Underline', 'Strikethrough', 'LinkUrl'].forEach((k) => {
      t['set' + k] = (a, b, v) => {
        if (a < 0 || b >= t.s.length || b < a) throw new Error('範囲が不正です: ' + a + '-' + b);
        t.styles.push({ k, a, b, v });
        return t;
      };
    });
    return t;
  }
  function para(kind) {
    const tx = text();
    const p = {
      kind, text: tx, heading: null, depth: null, glyph: null, images: [],
      getType: () => 'PARAGRAPH', asParagraph: () => p, editAsText: () => tx,
      getText: () => tx.s, getNumChildren: () => (tx.s ? 1 : 0) + p.images.length,
      setHeading: (h) => { p.heading = h; return p; },
      setNestingLevel: (d) => { if (p.glyph) p.glyph = 'RESET'; p.depth = d; return p; },
      setGlyphType: (g) => { p.glyph = g; return p; },
      appendInlineImage: (blob) => {
        const img = { blob, alt: null, setAltDescription: (a) => { img.alt = a; } };
        p.images.push(img);
        return img;
      },
    };
    return p;
  }
  const body = {
    children: [], saved: 0, cleared: 0,
    clear: () => { body.cleared++; body.children = [para('PARAGRAPH')]; return body; },
    appendParagraph: (v) => { if (v !== '') throw new Error('想定外'); const p = para('PARAGRAPH'); body.children.push(p); return p; },
    appendListItem: () => { const p = para('LIST_ITEM'); body.children.push(p); return p; },
    getNumChildren: () => body.children.length,
    getChild: (i) => body.children[i],
    removeChild: (el) => { body.children = body.children.filter((x) => x !== el); },
  };
  const DocumentApp = {
    openById: () => ({ getBody: () => body, saveAndClose: () => { body.saved++; } }),
    ParagraphHeading: { NORMAL: 'N', HEADING1: 'H1', HEADING2: 'H2', HEADING3: 'H3', HEADING4: 'H4', HEADING5: 'H5', HEADING6: 'H6' },
    GlyphType: { NUMBER: 'NUMBER', BULLET: 'BULLET' },
    ElementType: { PARAGRAPH: 'PARAGRAPH', TABLE: 'TABLE', LIST_ITEM: 'LIST_ITEM' },
  };
  return { DocumentApp, body };
}

const SHA = 'f'.repeat(64);

function setup() {
  const fake = createFakeGas();
  const docs = fakeDocs();
  fake.DocumentApp = docs.DocumentApp;
  const ctx = loadGasWith(fake, 'src/core/Normalize.js', 'src/render/HtmlWriter.gs');
  const blobs = { [SHA]: { name: 'img' } };
  ctx.objectFindBlob = (s) => blobs[s] || null;
  return { ctx, body: docs.body };
}

describe('htmlWriterValidate', () => {
  it('書き戻せる内容には問題を返さない', () => {
    const { ctx } = setup();
    expect(ctx.htmlWriterValidate([
      { type: 'heading', level: 1, runs: [] }, { type: 'paragraph', runs: [] },
      { type: 'listItem', runs: [] }, { type: 'table', rows: [[[]]] },
      { type: 'image', sha: SHA, alt: '' },
    ])).toEqual([]);
  });

  it('未対応の種別・取れない画像・実体の無い画像・空の表を行番号付きで挙げる', () => {
    const { ctx } = setup();
    const problems = ctx.htmlWriterValidate([
      { type: 'sheet', name: 'x', rows: [] },
      { type: 'image', sha: 'unavailable', alt: '図1' },
      { type: 'image', sha: 'unavailable' },
      { type: 'image', sha: '0123456789'.padEnd(64, '0') },
      { type: 'table', rows: [] },
      { type: 'table' },
      { type: 'table', rows: [[]] },
    ]);
    expect(problems).toHaveLength(7);
    expect(problems[0]).toMatch(/^1行目: 未対応のブロック種別です \(sheet\)/);
    expect(problems[1]).toMatch(/^2行目: 実体を取得できない画像.*alt=図1/);
    expect(problems[2]).toMatch(/^3行目: .*alt=\)/);
    expect(problems[3]).toMatch(/^4行目: 画像の実体がobjectsに見つかりません \(sha=0123456\)/);
    expect(problems[4]).toMatch(/^5行目: 空のテーブル/);
    expect(problems[5]).toMatch(/^6行目: 空のテーブル/);
    expect(problems[6]).toMatch(/^7行目: 列が0のテーブル/);
  });
});

describe('writeBlocksToDoc', () => {
  it('検証に通らなければ消さずに断る', () => {
    const { ctx, body } = setup();
    expect(() => ctx.writeBlocksToDoc('D', [{ type: 'image', sha: 'unavailable' }])).toThrow(/書き戻せません/);
    expect(body.cleared).toBe(0);
  });

  it('空の内容では文書を消さずに断る', () => {
    const { ctx, body } = setup();
    expect(() => ctx.writeBlocksToDoc('D', [])).toThrow(/書き戻す内容が空です/);
    expect(body.cleared).toBe(0);
  });

  it('見出しの段を1〜6に戻す (6より深いものは6)', () => {
    const { ctx, body } = setup();
    const blocks = [1, 2, 3, 4, 5, 6, 7].map((l) => ({ type: 'heading', level: l, runs: [{ text: 'h' + l }] }));
    ctx.writeBlocksToDoc('D', blocks);
    expect(body.children.map((c) => c.heading)).toEqual(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H6']);
    expect(body.children.map((c) => c.text.s)).toEqual(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7']);
    expect(body.saved).toBe(1);
  });

  it('リストは入れ子を先に決めてから記号を付ける (逆だと記号が既定に戻る)', () => {
    const { ctx, body } = setup();
    ctx.writeBlocksToDoc('D', [
      { type: 'listItem', ordered: true, depth: 2, runs: [{ text: '一' }] },
      { type: 'listItem', ordered: false, runs: [{ text: '点' }] },
    ]);
    expect(body.children.map((c) => [c.kind, c.depth, c.glyph, c.text.s])).toEqual([
      ['LIST_ITEM', 2, 'NUMBER', '一'],
      ['LIST_ITEM', 0, 'BULLET', '点'],
    ]);
  });

  it('装飾をすべて字の範囲に当て、空の run は飛ばす', () => {
    const { ctx, body } = setup();
    ctx.writeBlocksToDoc('D', [{ type: 'paragraph', runs: [
      { text: '' }, { text: 'ab', italic: true, underline: true }, { text: 'c', strike: true },
    ] }]);
    const p = body.children[0];
    expect(p.heading).toBe('N');
    expect(p.text.s).toBe('abc');
    expect(p.text.styles).toEqual([
      { k: 'Italic', a: 0, b: 1, v: true }, { k: 'Underline', a: 0, b: 1, v: true },
      { k: 'Strikethrough', a: 2, b: 2, v: true },
    ]);
  });

  it('画像は実体を差し込み、代替の字があるときだけ付ける', () => {
    const { ctx, body } = setup();
    ctx.writeBlocksToDoc('D', [
      { type: 'image', sha: SHA, alt: '組織図' },
      { type: 'image', sha: SHA, alt: '' },
    ]);
    expect(body.children.map((c) => c.images.map((i) => [i.blob.name, i.alt]))).toEqual([
      [['img', '組織図']], [['img', null]],
    ]);
  });

  it('clear が残した先頭の空段落を消す', () => {
    const { ctx, body } = setup();
    ctx.writeBlocksToDoc('D', [{ type: 'paragraph', runs: [{ text: 'a' }] }, { type: 'paragraph', runs: [{ text: 'b' }] }]);
    expect(body.children.map((c) => c.text.s)).toEqual(['a', 'b']);
  });

  it('中身が空段落1つだけなら、それを消して文書を空にはしない', () => {
    const { ctx, body } = setup();
    ctx.writeBlocksToDoc('D', [{ type: 'paragraph', runs: [] }]);
    // 先頭の空段落と書いた空段落の2つになり、先頭を消すので1つ残る
    expect(body.children).toHaveLength(1);
  });

  it('先頭が画像の段落なら消さない (字は空でも子がある)', () => {
    const { ctx, body } = setup();
    // clear が残す空段落の代わりに、画像を持つ段落が先頭に来るようにする
    const realClear = body.clear;
    body.clear = () => { realClear(); body.children[0].images.push({}); return body; };
    ctx.writeBlocksToDoc('D', [{ type: 'paragraph', runs: [{ text: 'a' }] }]);
    expect(body.children).toHaveLength(2);
  });
});

describe('writeHtmlToFile', () => {
  it('doc は Docs に書き、sheet は Sheets に回し、slide と未知は断る', () => {
    const { ctx, body } = setup();
    ctx.writeHtmlToFile('D', '<h2>章</h2>\n<p>本文</p>\n', 'doc');
    expect(body.children.map((c) => [c.heading, c.text.s])).toEqual([['H2', '章'], ['N', '本文']]);

    const sheets = [];
    ctx.writeHtmlToSheet = (id, html) => sheets.push([id, html]);
    ctx.writeHtmlToFile('S', '<x>', 'sheet');
    expect(sheets).toEqual([['S', '<x>']]);

    expect(() => ctx.writeHtmlToFile('P', '', 'slide')).toThrow(/Slidesには書き戻せません/);
    expect(() => ctx.writeHtmlToFile('P', '', 'pdf')).toThrow(/対応していないファイル種別です: pdf/);
  });
});
