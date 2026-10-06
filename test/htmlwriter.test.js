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
      setHeading: () => p, setNestingLevel: () => p, setGlyphType: () => p,
      appendInlineImage: () => ({ setAltDescription: () => {} }),
    };
    return p;
  }
  const body = {
    children: [],
    clear: () => { body.children = [para('')]; return body; },
    appendParagraph: (v) => { const p = para(v); body.children.push(p); return p; },
    appendListItem: (v) => { const p = para(v); p.kind = 'LIST_ITEM'; body.children.push(p); return p; },
    appendTable: (rows) => {
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
    openById: () => ({ getBody: () => body, saveAndClose: () => {} }),
    ParagraphHeading: { NORMAL: 'N', HEADING1: 'H1', HEADING2: 'H2', HEADING3: 'H3', HEADING4: 'H4', HEADING5: 'H5', HEADING6: 'H6' },
    GlyphType: { NUMBER: 'NUMBER', BULLET: 'BULLET' },
    ElementType: { PARAGRAPH: 'PARAGRAPH', TABLE: 'TABLE', LIST_ITEM: 'LIST_ITEM' },
  };
  return { DocumentApp, body };
}

function setup() {
  const fake = createFakeGas();
  const docs = fakeDocs();
  fake.DocumentApp = docs.DocumentApp;
  const ctx = loadGasWith(fake, 'src/core/Normalize.js', 'src/render/HtmlWriter.gs');
  ctx.objectFindBlob = () => ({});
  return { ctx, body: docs.body };
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
