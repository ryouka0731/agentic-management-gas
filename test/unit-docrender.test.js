import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

/*
 * Docs を読む側 (DocRenderer) の単体テスト。
 *
 * 疑似GASは DocumentApp を持たない (fileId → HTML の表で済ませている) ので、
 * 読む側は一度も動いていなかった。ここでは読む側が使う API だけを写した
 * 最小の疑似 DocumentApp を組む。字の装飾は「1字ごとの装飾」で持ち、
 * getTextAttributeIndices は装飾が変わる位置を返す (実機と同じ)。
 */
const ET = { PARAGRAPH: 'PARAGRAPH', LIST_ITEM: 'LIST_ITEM', TABLE: 'TABLE', INLINE_IMAGE: 'INLINE_IMAGE', TEXT: 'TEXT', HORIZONTAL_RULE: 'HORIZONTAL_RULE', PAGE_BREAK: 'PAGE_BREAK' };
const H = { NORMAL: 'N', HEADING1: 'H1', HEADING2: 'H2', HEADING3: 'H3', HEADING4: 'H4', HEADING5: 'H5', HEADING6: 'H6', TITLE: 'T', SUBTITLE: 'ST' };
const G = { NUMBER: 'NUMBER', BULLET: 'BULLET', LATIN_UPPER: 'LU', LATIN_LOWER: 'LL', ROMAN_UPPER: 'RU', ROMAN_LOWER: 'RL', HOLLOW_BULLET: 'HB', SQUARE_BULLET: 'SB' };

/** runs → Text 要素。opts.noLeadingZero で、先頭の 0 を返さない実機の癖を写す */
function textOf(runs, opts) {
  const chars = [];
  for (const r of runs || []) for (const ch of r.text) chars.push({ ch, r });
  // 文字列の位置 (UTF-16) ごとの装飾
  const at = [];
  for (const c of chars) for (let k = 0; k < c.ch.length; k++) at.push(c.r);
  const s = chars.map((c) => c.ch).join('');
  const key = (r) => JSON.stringify([!!r.bold, !!r.italic, !!r.underline, !!r.strike, r.link || null]);
  const bounds = [];
  for (let i = 0; i < at.length; i++) {
    if (i === 0 || key(at[i]) !== key(at[i - 1])) bounds.push(i);
  }
  if (opts && opts.noLeadingZero && bounds[0] === 0) bounds.shift();
  return {
    getText: () => s,
    getTextAttributeIndices: () => bounds,
    isBold: (i) => !!at[i].bold,
    isItalic: (i) => !!at[i].italic,
    isUnderline: (i) => !!at[i].underline,
    isStrikethrough: (i) => !!at[i].strike,
    getLinkUrl: (i) => at[i].link || null,
  };
}

function image(opts) {
  const bytes = Buffer.from(opts.bytes || 'PNGDATA');
  const el = {
    getType: () => ET.INLINE_IMAGE,
    asInlineImage: () => ({
      getBlob: () => {
        if (opts.broken) throw new Error('Invalid argument: imageId');
        return {
          getBytes: () => Array.from(bytes).map((b) => (b > 127 ? b - 256 : b)),
          getContentType: () => opts.mime || 'image/png',
          copyBlob: () => ({ setName: (n) => ({ name: n }) }),
        };
      },
      getAltTitle: () => opts.title || '',
      getAltDescription: () => opts.desc || '',
    }),
  };
  return { el, sha: crypto.createHash('sha256').update(bytes).digest('hex') };
}

function para(runs, opts) {
  const o = opts || {};
  const tx = textOf(runs, o);
  const kids = (tx.getText() ? [{ getType: () => ET.TEXT }] : []).concat((o.images || []).map((im) => im.el));
  const p = {
    getType: () => ET.PARAGRAPH,
    asParagraph: () => p,
    editAsText: () => tx,
    getHeading: () => o.heading || H.NORMAL,
    getNumChildren: () => kids.length,
    getChild: (i) => kids[i],
  };
  return p;
}

function listItem(runs, glyph, depth) {
  const tx = textOf(runs);
  const li = {
    getType: () => ET.LIST_ITEM,
    asListItem: () => li,
    editAsText: () => tx,
    getGlyphType: () => glyph,
    getNestingLevel: () => depth || 0,
  };
  return li;
}

/** rows: セルごとに子要素 (para / listItem / そのほか) の配列 */
function table(rows) {
  const t = {
    getType: () => ET.TABLE,
    asTable: () => t,
    getNumRows: () => rows.length,
    getRow: (r) => ({
      getNumCells: () => rows[r].length,
      getCell: (c) => ({ getNumChildren: () => rows[r][c].length, getChild: (i) => rows[r][c][i] }),
    }),
  };
  return t;
}

function setup(children) {
  const fake = createFakeGas();
  fake.DocumentApp = {
    ElementType: ET, ParagraphHeading: H, GlyphType: G,
    openById: () => ({ getBody: () => ({ getNumChildren: () => children.length, getChild: (i) => children[i] }) }),
  };
  const logs = [];
  fake.Logger = { log: (m) => logs.push(m) };
  const ctx = loadGasWith(fake, 'src/core/Hash.js', 'src/core/HashGas.gs', 'src/core/Normalize.js',
    'src/render/DocRenderer.gs');
  const puts = [];
  ctx.objectPutBlob = (sha, blob, ext) => puts.push({ sha, ext });
  return { ctx, puts, logs };
}

describe('renderDocBlocks: 段落と見出し', () => {
  it('段落の装飾を run に写し、同じ装飾の続きはまとめる', () => {
    const { ctx } = setup([para([
      { text: 'Hello ' }, { text: 'wor', bold: true }, { text: 'ld', bold: true },
      { text: ' and ' }, { text: 'link', link: 'https://e.test/', italic: true },
      { text: 'U', underline: true }, { text: 'S', strike: true },
    ])]);
    expect(ctx.renderDocBlocks('D')).toEqual([{
      type: 'paragraph',
      runs: [
        { text: 'Hello ' }, { text: 'world', bold: true }, { text: ' and ' },
        { text: 'link', italic: true, link: 'https://e.test/' },
        { text: 'U', underline: true }, { text: 'S', strike: true },
      ],
    }]);
  });

  it('装飾の位置に 0 が無くても先頭の字を落とさない', () => {
    const { ctx } = setup([para([{ text: 'ab' }, { text: 'cd', bold: true }], { noLeadingZero: true })]);
    expect(ctx.renderDocBlocks('D')[0].runs).toEqual([{ text: 'ab' }, { text: 'cd', bold: true }]);
  });

  it('見出しの種類を level に写す (TITLE は1、SUBTITLE は2)', () => {
    const levels = [
      [H.HEADING1, 1], [H.TITLE, 1], [H.HEADING2, 2], [H.SUBTITLE, 2], [H.HEADING3, 3],
      [H.HEADING4, 4], [H.HEADING5, 5], [H.HEADING6, 6],
    ];
    const { ctx } = setup(levels.map(([h]) => para([{ text: 'x' }], { heading: h })));
    expect(ctx.renderDocBlocks('D').map((b) => [b.type, b.level])).toEqual(levels.map(([, l]) => ['heading', l]));
  });

  it('空の段落も段落として残す (空行の位置が変わらないように)', () => {
    const { ctx } = setup([para([]), para([{ text: 'a' }])]);
    expect(ctx.renderDocBlocks('D')).toEqual([
      { type: 'paragraph', runs: [] },
      { type: 'paragraph', runs: [{ text: 'a' }] },
    ]);
  });

  it('区切り線や改ページは版管理の対象外として飛ばす', () => {
    const { ctx } = setup([{ getType: () => ET.HORIZONTAL_RULE }, para([{ text: 'a' }]), { getType: () => ET.PAGE_BREAK }]);
    expect(ctx.renderDocBlocks('D')).toEqual([{ type: 'paragraph', runs: [{ text: 'a' }] }]);
  });
});

describe('renderDocBlocks: リスト', () => {
  it('番号・英字・ローマ数字は番号付き、点は番号なしとして読む', () => {
    const ordered = [G.NUMBER, G.LATIN_UPPER, G.LATIN_LOWER, G.ROMAN_UPPER, G.ROMAN_LOWER];
    const unordered = [G.BULLET, G.HOLLOW_BULLET, G.SQUARE_BULLET];
    const { ctx } = setup(ordered.concat(unordered).map((g) => listItem([{ text: g }], g)));
    expect(ctx.renderDocBlocks('D').map((b) => b.ordered))
      .toEqual(ordered.map(() => true).concat(unordered.map(() => false)));
  });

  it('入れ子の深さと装飾を持つ', () => {
    const { ctx } = setup([listItem([{ text: '子', bold: true }], G.BULLET, 2)]);
    expect(ctx.renderDocBlocks('D')).toEqual([
      { type: 'listItem', ordered: false, depth: 2, runs: [{ text: '子', bold: true }] },
    ]);
  });
});

describe('renderDocBlocks: 表', () => {
  it('セルの中の段落とリストをつないで1つの run 列にする', () => {
    const { ctx } = setup([table([
      [
        [para([{ text: '項目' }])],
        [para([{ text: '金額', bold: true }]), para([{ text: '(円)' }])],
      ],
      [
        [listItem([{ text: '一' }], G.BULLET)],
        [{ getType: () => ET.TEXT }],
      ],
    ])]);
    // 2行目2列目は段落でもリストでもない子だけなので空になる
    const out = ctx.renderDocBlocks('D');
    expect(out).toEqual([{
      type: 'table',
      rows: [
        [[{ text: '項目' }], [{ text: '金額', bold: true }, { text: '(円)' }]],
        [[{ text: '一' }], []],
      ],
    }]);
  });

  it('隣り合う段落が同じ装飾ならセルの中でもまとめる', () => {
    const { ctx } = setup([table([[[para([{ text: 'a' }]), para([{ text: 'b' }])]]])]);
    expect(ctx.renderDocBlocks('D')[0].rows[0][0]).toEqual([{ text: 'ab' }]);
  });
});

describe('renderDocBlocks: 画像', () => {
  it('画像は中身の SHA-256 で置き、種類ごとの拡張子で保存する', () => {
    const cases = [['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/gif', 'gif'],
      ['image/webp', 'webp'], ['image/bmp', 'bmp'], ['image/tiff', 'bin']];
    const imgs = cases.map(([mime], i) => image({ mime, bytes: 'IMG' + i, title: 't' + i }));
    const { ctx, puts } = setup([para([], { images: imgs })]);
    const out = ctx.renderDocBlocks('D');

    // 字の無い段落に画像だけがあるとき、空の段落は出さない
    expect(out).toEqual(imgs.map((im, i) => ({ type: 'image', sha: im.sha, alt: 't' + i })));
    expect(puts).toEqual(imgs.map((im, i) => ({ sha: im.sha, ext: cases[i][1] })));
  });

  it('字と画像が並ぶ段落は、段落のあとに画像を置く', () => {
    const im = image({ desc: '説明' });
    const { ctx } = setup([para([{ text: '図1' }], { images: [im] })]);
    expect(ctx.renderDocBlocks('D')).toEqual([
      { type: 'paragraph', runs: [{ text: '図1' }] },
      { type: 'image', sha: im.sha, alt: '説明' },
    ]);
  });

  it('代替の題を説明より先に使う', () => {
    const im = image({ title: '題', desc: '説明' });
    const { ctx } = setup([para([], { images: [im] })]);
    expect(ctx.renderDocBlocks('D')[0].alt).toBe('題');
  });

  it('実体を取れない画像は unavailable として残し、文書全体は読める', () => {
    const { ctx, puts, logs } = setup([para([{ text: '前' }], { images: [image({ broken: true, desc: '消えた図' })] })]);
    expect(ctx.renderDocBlocks('D')).toEqual([
      { type: 'paragraph', runs: [{ text: '前' }] },
      { type: 'image', sha: 'unavailable', alt: '消えた図' },
    ]);
    expect(puts).toEqual([]);
    expect(logs.join('\n')).toMatch(/消えた図/);
  });
});

describe('renderDoc', () => {
  it('Block 列を正規化 HTML にして返す', () => {
    const { ctx } = setup([
      para([{ text: '規程' }], { heading: H.HEADING1 }),
      para([{ text: 'Hello ' }, { text: 'world', bold: true }]),
      listItem([{ text: '一' }], G.NUMBER),
    ]);
    const html = ctx.renderDoc('D');
    expect(html).toBe(ctx.serializeBlocks(ctx.renderDocBlocks('D')));
    // 読み直すと同じ Block 列に戻る (書き戻しの前提)
    expect(ctx.serializeBlocks(ctx.parseBlocks(html))).toBe(html);
    expect(html).toContain('<strong>world</strong>');
  });
});
