import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

/*
 * ホーム。草は本人とチームの合計だけ。連続日数は数えない。最近の動きに名前を入れない。
 */
const SOURCES = (() => {
  const src = fs.readFileSync(new URL('./scrum-api.test.js', import.meta.url), 'utf8');
  return eval(src.match(/const SOURCES = (\[[\s\S]*?\]);/)[1]);
})();

function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...SOURCES);
  ctx.repoInit('agentic-management');
  return { ctx, fake };
}

const ME = 'tester@example.com';
const NOW = new Date('2026-10-14T03:00:00Z'); // 水曜 (東京 12:00)

function closed(ctx, title, patch) {
  const i = ctx.issueCreate(title, '', []);
  ctx.issueClose(i.number, null);
  ctx.dbUpdate('issues', 'number', i.number, Object.assign({
    createdAt: new Date('2026-10-13T01:00:00Z'), closedAt: new Date('2026-10-14T02:00:00Z'),
  }, patch || {}));
  return i.number;
}

function cell(act, day) {
  for (const w of act.weeks) for (const c of w) if (c.day === day) return c;
  return null;
}

describe('草', () => {
  it('53週 × 7日。月曜から並び、右端の週に今日がある。今日より後は数を持たない', () => {
    const { ctx } = setup();
    const act = ctx.homeActivity_(ME, NOW);
    expect(act.weeks).toHaveLength(53);
    act.weeks.forEach((w) => expect(w).toHaveLength(7));
    expect(act.weeks[52][0].day).toBe('2026-10-12'); // 今週の月曜
    expect(act.weeks[52][2]).toMatchObject({ day: '2026-10-14', future: false });
    expect(act.weeks[52][3]).toMatchObject({ day: '2026-10-15', future: true, me: 0, team: 0 });
    expect(act.weeks[0][0].day).toBe('2025-10-13');
  });

  it('今日が日曜でも右端が今週 (月曜はじまり)', () => {
    const { ctx } = setup();
    const act = ctx.homeActivity_(ME, new Date('2026-10-18T03:00:00Z'));
    expect(act.weeks[52][6]).toMatchObject({ day: '2026-10-18', future: false });
  });

  it('5つの行いを東京の日付で数える。自分の草は自分のぶんだけ', () => {
    const { ctx } = setup();
    // 記録 (東京では 10/14 の 0:30)
    ctx.dbAppend('commits', { sha: 'a1', author: ME, timestamp: new Date('2026-10-13T15:30:00Z') });
    ctx.dbAppend('commits', { sha: 'a2', author: 'b@example.com', timestamp: new Date('2026-10-14T01:00:00Z') });
    closed(ctx, '自分の', { assignee: ME });
    ctx.dbAppend('pulls', { number: 1, author: ME, state: 'merged',
      createdAt: new Date('2026-10-13T01:00:00Z'), mergedAt: new Date('2026-10-14T01:00:00Z') });
    ctx.dbAppend('reviews', { prNumber: 1, reviewer: 'b@example.com', state: 'approve', at: new Date('2026-10-14T01:00:00Z'), id: 1 });
    ctx.dbAppend('reviews', { prNumber: 1, reviewer: 'b@example.com', state: 'comment', at: new Date('2026-10-14T01:00:00Z'), id: 2 });

    const act = ctx.homeActivity_(ME, NOW);
    // 10/14: 記録2 + 完了1 + 反映1 + 承認1 (コメントは数えない)
    expect(cell(act, '2026-10-14')).toMatchObject({ me: 3, team: 5 });
    // 10/13: 依頼を出した
    expect(cell(act, '2026-10-13')).toMatchObject({ me: 1, team: 1 });
    expect(act.meTotal).toBe(4);
  });

  it('チームでは担当2人の完了を1と数える。自分の依頼への自分の承認は数えない', () => {
    const { ctx } = setup();
    closed(ctx, '2人', { assignee: ME + ', b@example.com' });
    ctx.dbAppend('pulls', { number: 1, author: ME, state: 'open', createdAt: new Date('2026-10-01T01:00:00Z') });
    ctx.dbAppend('reviews', { prNumber: 1, reviewer: ME, state: 'approve', at: new Date('2026-10-14T01:00:00Z'), id: 1 });
    const act = ctx.homeActivity_(ME, NOW);
    expect(cell(act, '2026-10-14')).toMatchObject({ me: 1, team: 1 });
  });

  it('取り消した完了・1年より前・読めない日付は数えず、落ちない', () => {
    const { ctx } = setup();
    const n = closed(ctx, '取り消し', { assignee: ME });
    ctx.issueReopen(n);
    closed(ctx, '古い', { assignee: ME, closedAt: new Date('2025-01-01T01:00:00Z') });
    ctx.dbAppend('commits', { sha: 'x', author: ME, timestamp: 'きのう' });
    const act = ctx.homeActivity_(ME, NOW);
    expect(act.meTotal).toBe(0);
  });

  it('アドレスを受ける関数は画面から直に呼べない。API は本人のぶんだけ返す', () => {
    const { ctx } = setup();
    expect(typeof ctx.homeActivity_).toBe('function');
    expect(ctx.homeActivity).toBeUndefined();
    closed(ctx, 'ほかの人', { assignee: 'b@example.com', closedAt: new Date() });
    const act = ctx.apiHomeActivity();
    const today = act.weeks[52].filter((c) => !c.future).pop();
    expect(today.me).toBe(0);
    expect(today.team).toBe(1);
    expect(Object.keys(act).sort()).toEqual(['meTotal', 'weeks']);
  });
});
