import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

/*
 * 書き戻し (HtmlWriter) を動かすための、最小限の疑似 DocumentApp。
 *
 * 実機で分かった振る舞いだけを写す。いちばん大事なのは **空の字を入れる操作を
 * 断る** こと (`Cannot insert an empty text element.`)。疑似GASに DocumentApp が
 * 無かったため、表のセルを setText('') で空にしてから書く作りが、実機の
 * debugWriteRoundTrip で初めて落ちた。
 */
function fakeDocs() {
  // 書き込みの呼び出しを順に控える (書く順序を確かめるため)
  const log = [];
  function text(initial) {
    const t = {
      s: initial || '', styles: [],
      getText: () => t.s,
      appendText: (v) => { if (v === '') throw new Error('Cannot insert an empty text element.'); t.s += v; return t; },
      setText: (v) => { if (v === '') throw new Error('Cannot insert an empty text element.'); t.s = v; return t; },
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
  function para(initial) {
    const tx = text(initial);
    const p = {
      kind: 'PARAGRAPH', text: tx,
      getType: () => 'PARAGRAPH', asParagraph: () => p, editAsText: () => tx,
      getText: () => tx.s, getNumChildren: () => (tx.s ? 1 : 0),
      setText: (v) => { tx.setText(v); return p; },
      setHeading: (h) => { log.push(['heading', h]); return p; },
      setNestingLevel: (n) => { log.push(['nesting', n]); return p; },
      setGlyphType: (g) => { log.push(['glyph', g]); return p; },
      appendInlineImage: (blob) => {
        log.push(['image', blob]);
        return { setAltDescription: (a) => { log.push(['alt', a]); } };
      },
    };
    return p;
  }
  const body = {
    children: [],
    clear: () => { log.push(['clear']); body.children = [para('')]; return body; },
    appendParagraph: (v) => { log.push(['p', v]); const p = para(v); body.children.push(p); return p; },
    appendListItem: (v) => { log.push(['li', v]); const p = para(v); p.kind = 'LIST_ITEM'; body.children.push(p); return p; },
    appendTable: (rows) => {
      log.push(['table', rows]);
      const cells = rows.map((r) => r.map((v) => para(v)));
      const table = {
        kind: 'TABLE', cells,
        getType: () => 'TABLE',
        getRow: (r) => ({ getCell: (c) => ({ getChild: () => cells[r][c] }) }),
      };
      body.children.push(table);
      return table;
    },
    getNumChildren: () => body.children.length,
    getChild: (i) => body.children[i],
    removeChild: (el) => { body.children = body.children.filter((x) => x !== el); },
  };
  const DocumentApp = {
    openById: () => ({ getBody: () => body, saveAndClose: () => { log.push(['save']); } }),
    ParagraphHeading: { NORMAL: 'N', HEADING1: 'H1', HEADING2: 'H2', HEADING3: 'H3', HEADING4: 'H4', HEADING5: 'H5', HEADING6: 'H6' },
    GlyphType: { NUMBER: 'NUMBER', BULLET: 'BULLET' },
    ElementType: { PARAGRAPH: 'PARAGRAPH', TABLE: 'TABLE', LIST_ITEM: 'LIST_ITEM' },
  };
  return { DocumentApp, body, log };
}

function setup() {
  const fake = createFakeGas();
  const docs = fakeDocs();
  fake.DocumentApp = docs.DocumentApp;
  const ctx = loadGasWith(fake, 'src/core/Normalize.js', 'src/render/HtmlWriter.gs');
  ctx.objectFindBlob = (sha) => ({ sha });
  return { ctx, body: docs.body, log: docs.log };
}

describe('表のセルに書き戻す', () => {
  it('装飾の付いたセルがあっても落ちない', () => {
    const { ctx, body } = setup();
    ctx.writeHtmlToDoc('D1',
      '<table>\n<tr><td>項目</td><td><strong>金額</strong> (円)</td></tr>\n</table>\n');

    const table = body.children.find((c) => c.kind === 'TABLE');
    const cell = table.cells[0][1].text;
    expect(cell.s).toBe('金額 (円)');
    // 太字は「金額」の2字だけに当たる
    expect(cell.styles).toEqual([{ k: 'Bold', a: 0, b: 1, v: true }]);
  });

  it('リンクも、その字の範囲に当たる', () => {
    const { ctx, body } = setup();
    ctx.writeHtmlToDoc('D1',
      '<table>\n<tr><td>詳しくは <a href="https://e.test/">こちら</a></td></tr>\n</table>\n');

    const cell = body.children.find((c) => c.kind === 'TABLE').cells[0][0].text;
    expect(cell.s).toBe('詳しくは こちら');
    expect(cell.styles).toEqual([{ k: 'LinkUrl', a: 5, b: 7, v: 'https://e.test/' }]);
  });

  it('空のセルと飾りの無いセルはそのまま', () => {
    const { ctx, body } = setup();
    ctx.writeHtmlToDoc('D1', '<table>\n<tr><td></td><td>ふつう</td></tr>\n</table>\n');

    const table = body.children.find((c) => c.kind === 'TABLE');
    expect(table.cells[0][1].text.s).toBe('ふつう');
    expect(table.cells[0][1].text.styles).toEqual([]);
  });
});

describe('段落とリストに書き戻す', () => {
  it('装飾の境目の空白も字のまま書く', () => {
    const { ctx, body } = setup();
    ctx.writeHtmlToDoc('D1', '<p>Hello <strong>world</strong> and more</p>\n');

    const p = body.children.find((c) => c.kind === 'PARAGRAPH' && c.text.s);
    expect(p.text.s).toBe('Hello world and more');
    expect(p.text.styles).toEqual([{ k: 'Bold', a: 6, b: 10, v: true }]);
  });
});

describe('ブロックの種類ごとの書き方', () => {
  it('見出し・段落・リスト・表・画像を順に書き、clear() が残した空段落を消す', () => {
    const { ctx, body, log } = setup();
    ctx.writeHtmlToDoc('D1', [
      '<h2>見出し</h2>',
      '<p>本文</p>',
      '<li data-list="ul" data-depth="1">箇条</li>',
      '<li data-list="ol" data-depth="0">番号</li>',
      '<table>',
      '<tr><td></td><td>b</td></tr>',
      '</table>',
      '<img data-sha="s1" alt="図">',
      '<img data-sha="s2" alt="">',
    ].join('\n') + '\n');

    expect(JSON.parse(JSON.stringify(log))).toEqual([
      ['clear'],
      ['p', ''], ['heading', 'H2'],
      ['p', ''], ['heading', 'N'],
      ['li', ''], ['nesting', 1], ['glyph', 'BULLET'],
      ['li', ''], ['nesting', 0], ['glyph', 'NUMBER'],
      ['table', [[' ', 'b']]],
      ['p', ''], ['image', { sha: 's1' }], ['alt', '図'],
      ['p', ''], ['image', { sha: 's2' }],
      ['save'],
    ]);
    expect(body.children.map((c) => c.kind))
      .toEqual(['PARAGRAPH', 'PARAGRAPH', 'LIST_ITEM', 'LIST_ITEM', 'TABLE', 'PARAGRAPH', 'PARAGRAPH']);
    expect(body.children[0].text.s).toBe('見出し');
  });

  it('書き戻せない中身と空の中身は、消す前に断る', () => {
    const { ctx, log } = setup();
    expect(() => ctx.writeBlocksToDoc('D1', [{ type: 'image', sha: 'unavailable', alt: '' }]))
      .toThrow('書き戻せません');
    expect(() => ctx.writeBlocksToDoc('D1', [])).toThrow('書き戻す内容が空です');
    expect(log).toEqual([]);
  });

  it('表だけでも、clear() が残した空段落を消す', () => {
    const { ctx, body } = setup();
    ctx.writeHtmlToDoc('D1', '<table>\n<tr><td>a</td></tr>\n</table>\n');
    // 子が2つ (空段落 + 表) なので消す。表だけが残る
    expect(body.children.map((c) => c.kind)).toEqual(['TABLE']);
  });
});
