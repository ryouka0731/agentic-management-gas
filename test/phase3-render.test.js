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

  /*
   * 読むのは表示値 (getDisplayValues) なので、書き戻しで表示値を書くと、
   * 反映で触っていないセルまで丸めた値に置き換わる (3.14159 → 3.14)。
   * clear() で表示の書式も消えるため、実機では '0123' が 123 になる。
   */
  function rounded(ctx) {
    const ss = ctx.SpreadsheetApp.create('売上表');
    const sheet = ss.insertSheet('S');
    sheet.appendRow(['月', '金額']);
    sheet.appendRow(['4月', 3.14159]);
    sheet._format = (v) => (typeof v === 'number' ? v.toFixed(2) : String(v));
    return { ss, sheet };
  }

  it('変えていないセルは、生の値のまま残す', () => {
    const { ctx } = setup(...SRC);
    const { ss, sheet } = rounded(ctx);
    const html = ctx.renderSheet(ss.getId());
    expect(html).toContain('3.14<');

    // 見出しだけを直した結果を書き戻す
    ctx.writeHtmlToSheet(ss.getId(), html.replace('>金額<', '>金額 (千円)<'));

    expect(sheet._rows[0][1]).toBe('金額 (千円)');
    expect(sheet._rows[1][1]).toBe(3.14159);
  });

  it('表示の書式を消さない', () => {
    const { ctx } = setup(...SRC);
    const { ss, sheet } = rounded(ctx);

    ctx.writeHtmlToSheet(ss.getId(), ctx.renderSheet(ss.getId()));

    // 書式まで消すと、残した値も違って見える
    expect(typeof sheet._format).toBe('function');
    expect(ctx.renderSheet(ss.getId())).toContain('3.14<');
  });

  it('変えたセルは書いた値になり、消した行は残らない', () => {
    const { ctx } = setup(...SRC);
    const { ss } = rounded(ctx);
    ctx.writeHtmlToSheet(ss.getId(),
      '<table data-sheet="S">\n<tr><td>月</td><td>金額</td></tr>\n</table>\n');

    expect(ctx.renderSheet(ss.getId())).toBe(
      '<table data-sheet="S">\n<tr><td>月</td><td>金額</td></tr>\n</table>\n');
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

describe('種別ごとの分岐', () => {
  const SRC = [
    'src/render/SheetRenderer.gs',
    'src/render/SheetWriter.gs',
    'src/render/HtmlWriter.gs',
  ];

  it('slide には書き戻せない', () => {
    const { ctx } = setup(...SRC);
    expect(() => ctx.writeHtmlToFile('x', '', 'slide'))
      .toThrow(/Slidesには書き戻せません/);
  });

  it('未知の種別は明示的に拒否する', () => {
    const { ctx } = setup(...SRC);
    expect(() => ctx.writeHtmlToFile('x', '', 'pdf'))
      .toThrow(/対応していないファイル種別/);
  });

  it('sheet は writeHtmlToSheet に回る', () => {
    const { ctx } = setup(...SRC);
    const ss = ctx.SpreadsheetApp.create('売上表');
    ss.insertSheet('S').appendRow(['a']);

    ctx.writeHtmlToFile(ss.getId(),
      '<table data-sheet="S">\n<tr><td>b</td></tr>\n</table>\n', 'sheet');

    expect(ctx.renderSheet(ss.getId())).toContain('<td>b</td>');
  });
});

describe('liveHtml のキャッシュ', () => {
  /*
   * CacheService は1つの値を100KBまでしか持てない。区切りを字数で決めて
   * いると、日本語 (UTF-8 で1字3バイト) では上限を超え、置けずに投げる。
   * キャッシュは速くするためのものなので、置けなくても文書は読めなければ
   * ならない。
   */
  function withCache(fake, opts) {
    const store = new Map();
    const bytes = (s) => Buffer.byteLength(String(s), 'utf8');
    fake.CacheService = {
      getScriptCache: () => ({
        get: (k) => (store.has(k) ? store.get(k) : null),
        getAll: (keys) => Object.fromEntries(keys.filter((k) => store.has(k)).map((k) => [k, store.get(k)])),
        putAll: (obj) => {
          if (opts && opts.broken) throw new Error('Service invoked too many times');
          for (const [k, v] of Object.entries(obj)) {
            if (bytes(v) > 100 * 1024) throw new Error('Argument too large: value');
          }
          for (const [k, v] of Object.entries(obj)) store.set(k, v);
        },
        removeAll: (keys) => keys.forEach((k) => store.delete(k)),
      }),
    };
    return store;
  }

  function ready(opts) {
    const fake = createFakeGas();
    const store = withCache(fake, opts);
    const ctx = loadGasWith(fake, 'src/core/Hash.js', 'src/core/HashGas.gs',
      'src/core/Db.gs', 'src/core/Repo.gs', 'src/core/Normalize.js',
      'src/render/LiveCache.gs');
    const config = ctx.repoInit('agentic-management');
    const id = fake._createDoc('就業規則', '', config.mainId);
    ctx.repoRegisterFile(id, '就業規則.doc');

    const big = '<p>' + 'あ'.repeat(60000) + '</p>\n';
    let renders = 0;
    ctx.renderDoc = () => { renders++; return big; };
    return { ctx, id, big, store, renders: () => renders };
  }

  it('日本語の大きな文書でも読めて、2回目はキャッシュから返す', () => {
    const { ctx, id, big, renders } = ready();

    expect(ctx.liveHtml(id)).toBe(big);
    expect(ctx.liveHtml(id)).toBe(big);
    expect(renders()).toBe(1);
  });

  it('絵文字の途中で区切らない', () => {
    const { ctx, store } = ready();
    const size = ctx.CACHE_CHUNK_SIZE();
    // ちょうど区切りの位置にサロゲートペアがまたがるようにする
    const html = 'a'.repeat(size - 1) + '😀' + 'b'.repeat(10);
    ctx.liveCachePut_('k', html);

    for (const [key, v] of store) {
      if (key === 'k:meta') continue;
      const last = v.charCodeAt(v.length - 1);
      expect(last >= 0xD800 && last <= 0xDBFF).toBe(false);
    }
    expect(ctx.liveCacheGet_('k')).toBe(html);
  });

  it('キャッシュが使えなくても読める', () => {
    const { ctx, id, big } = ready({ broken: true });

    expect(ctx.liveHtml(id)).toBe(big);
  });
});
