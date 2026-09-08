import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

/**
 * Phase 3a (Sheets / Slides レンダラ) の統合テスト。
 */

function setup(...extra) {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, 'src/core/Normalize.js', ...extra);
  return { ctx, fake };
}

describe('renderSheet', () => {
  const SRC = ['src/render/SheetRenderer.gs'];

  it('シートごとに table を出し、数式を保持する', () => {
    const { ctx } = setup(...SRC);
    const ss = ctx.SpreadsheetApp.create('売上表');
    const s = ss.insertSheet('2026年');
    s.appendRow(['月', '金額']);
    s.appendRow(['1月', '=SUM(B1:B1)']);

    const html = ctx.renderSheet(ss.getId());

    expect(html).toContain('<table data-sheet="2026年">');
    expect(html).toContain('<tr><td>月</td><td>金額</td></tr>');
    expect(html).toContain('data-formula="=SUM(B1:B1)"');
  });

  it('同じ内容からは常に同じ HTML が出る', () => {
    const { ctx } = setup(...SRC);
    const ss = ctx.SpreadsheetApp.create('売上表');
    ss.insertSheet('S').appendRow(['a', 'b']);
    expect(ctx.renderSheet(ss.getId())).toBe(ctx.renderSheet(ss.getId()));
  });

  it('末尾の空行を落とす', () => {
    const { ctx } = setup(...SRC);
    const ss = ctx.SpreadsheetApp.create('売上表');
    const s = ss.insertSheet('S');
    s.appendRow(['a']);
    s.appendRow(['']);
    s.appendRow(['']);

    expect(ctx.renderSheet(ss.getId())).toBe(
      '<table data-sheet="S">\n<tr><td>a</td></tr>\n</table>\n'
    );
  });

  it('複数シートを順に出す', () => {
    const { ctx } = setup(...SRC);
    const ss = ctx.SpreadsheetApp.create('売上表');
    ss.insertSheet('一枚目').appendRow(['x']);
    ss.insertSheet('二枚目').appendRow(['y']);

    const html = ctx.renderSheet(ss.getId());
    expect(html.indexOf('data-sheet="一枚目"'))
      .toBeLessThan(html.indexOf('data-sheet="二枚目"'));
  });
});

describe('writeHtmlToSheet', () => {
  const SRC = ['src/render/SheetRenderer.gs', 'src/render/SheetWriter.gs'];

  it('書き戻すと同じ HTML が再現される (往復)', () => {
    const { ctx } = setup(...SRC);
    const ss = ctx.SpreadsheetApp.create('売上表');
    ss.insertSheet('S').appendRow(['月', '金額']);

    const before = ctx.renderSheet(ss.getId());
    ctx.writeHtmlToSheet(ss.getId(), before);
    expect(ctx.renderSheet(ss.getId())).toBe(before);
  });

  it('数式は数式として書き戻る', () => {
    const { ctx } = setup(...SRC);
    const ss = ctx.SpreadsheetApp.create('売上表');
    ss.insertSheet('S').appendRow(['1']);

    ctx.writeHtmlToSheet(ss.getId(),
      '<table data-sheet="S">\n<tr><td data-formula="=1+1">2</td></tr>\n</table>\n');

    expect(ctx.renderSheet(ss.getId())).toContain('data-formula="=1+1"');
  });

  it('sheet 以外のブロックが混ざったら書き戻さない', () => {
    const { ctx } = setup(...SRC);
    const problems = ctx.sheetWriterValidate([{ type: 'paragraph', runs: [] }]);
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain('Sheetsに書き戻せないブロック');
  });

  it('シート名の重複と空を検出する', () => {
    const { ctx } = setup(...SRC);
    expect(ctx.sheetWriterValidate([
      { type: 'sheet', name: 'S', rows: [] },
      { type: 'sheet', name: 'S', rows: [] },
    ]).length).toBe(1);

    expect(ctx.sheetWriterValidate([{ type: 'sheet', name: '', rows: [] }]).length).toBe(1);
  });

  it('検証に通らない内容では中身を書き換えない', () => {
    const { ctx } = setup(...SRC);
    const ss = ctx.SpreadsheetApp.create('売上表');
    ss.insertSheet('S').appendRow(['守られるべき値']);
    const before = ctx.renderSheet(ss.getId());

    expect(() => ctx.writeHtmlToSheet(ss.getId(), '<p>段落</p>\n'))
      .toThrow(/Sheetsに書き戻せません/);
    expect(ctx.renderSheet(ss.getId())).toBe(before);
  });
});

describe('renderSlides', () => {
  const SRC = ['src/render/SlidesRenderer.gs'];

  it('スライド境界・本文・スピーカーノートを出す', () => {
    const { ctx, fake } = setup(...SRC);
    const id = fake._createSlides('提案書', [
      { shapes: ['表紙', '2026年度方針'], notes: '30秒で話す' },
      { shapes: ['目次'] },
    ]);

    const html = ctx.renderSlides(id);

    expect(html).toContain('<section data-slide="1">');
    expect(html).toContain('<p>表紙</p>');
    expect(html).toContain('<p>2026年度方針</p>');
    expect(html).toContain('<p>ノート: 30秒で話す</p>');
    expect(html).toContain('<section data-slide="2">');
  });

  it('空のシェイプは出力しない', () => {
    const { ctx, fake } = setup(...SRC);
    const id = fake._createSlides('提案書', [{ shapes: ['', '本文'] }]);
    expect(ctx.renderSlides(id)).toBe('<section data-slide="1">\n<p>本文</p>\n');
  });

  it('同じ内容からは常に同じ HTML が出る', () => {
    const { ctx, fake } = setup(...SRC);
    const id = fake._createSlides('提案書', [{ shapes: ['a'], notes: 'b' }]);
    expect(ctx.renderSlides(id)).toBe(ctx.renderSlides(id));
  });
});
