import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';
import { APP_SOURCES } from './sources.js';

/*
 * 同じ表の何行かを1回で直す (Db.gs の dbUpdateMany)。
 * 守ること: 表を1回読んで1回で書く・直さない欄は残る・無い鍵は黙って飛ばす・同じ鍵の値は後が勝つ・
 * ほかの実行にもすぐ新しい中身 (dbInvalidate_ を通る)。
 */

function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...APP_SOURCES);
  ctx.repoInit('agentic-management');
  return { ctx, fake };
}

describe('何行かを1回で直す', () => {
  it('表を1回読んで1回で書き、直さない欄は残る', () => {
    const { ctx, fake } = setup();
    const [a, b, c] = ['A', 'B', 'C'].map((t) => ctx.issueCreate(t, '補足の' + t, []));
    const reads = fake._sheetReads('issues');
    const writes = fake._sheetWrites('issues');

    const n = ctx.dbUpdateMany('issues', 'number', [
      { value: a.number, patch: { title: 'A2' } },
      { value: c.number, patch: { title: 'C2', labels: '規程' } },
    ]);

    expect(n).toBe(2);
    // 読むのは見出し行 (dbSheet_) と中身の2回。dbUpdate 1回ぶんと同じ (行の数だけ増えない)
    expect(fake._sheetReads('issues') - reads).toBe(2);
    expect(fake._sheetWrites('issues') - writes).toBe(1);
    const rows = ctx.dbReadAll('issues');
    expect(rows.map((r) => r.title)).toEqual(['A2', 'B', 'C2']);
    expect(rows.map((r) => r.body)).toEqual(['補足のA', '補足のB', '補足のC']);
    expect(String(rows[2].labels)).toBe('規程');
    expect(rows.find((r) => r.number === b.number).state).toBe('open');
  });

  it('無い鍵は飛ばし、同じ鍵の値は後が勝つ。何も無ければ書かない', () => {
    const { ctx, fake } = setup();
    const a = ctx.issueCreate('A', '', []);
    const writes = fake._sheetWrites('issues');

    expect(ctx.dbUpdateMany('issues', 'number', [
      { value: 999, patch: { title: 'どこにも無い' } },
      { value: a.number, patch: { title: '先' } },
      { value: a.number, patch: { title: '後' } },
    ])).toBe(1);
    expect(ctx.dbReadAll('issues')[0].title).toBe('後');
    expect(fake._sheetWrites('issues') - writes).toBe(1);

    expect(ctx.dbUpdateMany('issues', 'number', [{ value: 999, patch: { title: 'x' } }])).toBe(0);
    expect(ctx.dbUpdateMany('issues', 'number', [])).toBe(0);
    expect(fake._sheetWrites('issues') - writes).toBe(1);
    expect(() => ctx.dbUpdateMany('issues', 'nope', [{ value: 1, patch: {} }])).toThrow(/未定義のカラム/);
  });

  it('ほかの実行にもすぐ新しい中身 (キャッシュの版が変わる)', () => {
    const { ctx } = setup();
    const a = ctx.issueCreate('A', '', []);
    // 先に読んでキャッシュに置く
    expect(ctx.dbReadAll('issues')[0].title).toBe('A');
    ctx.dbUpdateMany('issues', 'number', [{ value: a.number, patch: { title: 'A2' } }]);
    expect(ctx.dbReadAll('issues')[0].title).toBe('A2');
  });
});
