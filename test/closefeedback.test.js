import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

/*
 * 完了にした瞬間に「何が起きたか」を1つだけ返す。くじではなく、本当に
 * 起きたことで驚かせる (docs/superpowers/specs/2026-10-14-task-flow-motivation-design.md)。
 */
const SOURCES = (() => {
  const src = fs.readFileSync(new URL('./scrum-api.test.js', import.meta.url), 'utf8');
  return eval(src.match(/const SOURCES = (\[[\s\S]*?\]);/)[1]).concat(['src/core/Motivation.gs']);
})();

function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...SOURCES);
  ctx.repoInit('agentic-management');
  return { ctx, fake };
}

const NOW = new Date('2026-10-14T03:00:00Z');

/** やることを作って閉じる。日付は台帳を直に書き換える */
function closed(ctx, title, patch) {
  const i = ctx.issueCreate(title, '', []);
  ctx.issueClose(i.number, null);
  ctx.dbUpdate('issues', 'number', i.number, Object.assign({
    createdAt: new Date('2026-10-13T01:00:00Z'), closedAt: new Date('2026-10-14T02:00:00Z'),
  }, patch || {}));
  return i.number;
}

describe('完了したときに返す知らせ', () => {
  it('どれにも当たらなければチームの数を返す', () => {
    const { ctx } = setup();
    const n = closed(ctx, 'ふつう');
    expect(ctx.closeFeedback_(n, NOW)).toMatchObject({ kind: 'team', number: n, title: 'ふつう', weekClosed: 1 });
  });

  it('重いもの (ポイント5以上・予定4時間以上) は heavy。字の数でも読む', () => {
    const { ctx } = setup();
    const a = closed(ctx, 'ポイント', { points: 5 });
    const b = closed(ctx, '時間', { plannedHours: '4' });
    const c = closed(ctx, '軽い', { points: '', plannedHours: 3 });
    expect(ctx.closeFeedback_(a, NOW).kind).toBe('heavy');
    expect(ctx.closeFeedback_(b, NOW).kind).toBe('heavy');
    expect(ctx.closeFeedback_(c, NOW).kind).toBe('team');
  });

  it('作ってから14日以上たったものは longAwaited。重いより先', () => {
    const { ctx } = setup();
    const a = closed(ctx, '長い', { createdAt: new Date('2026-09-30T01:00:00Z'), points: 8 });
    const b = closed(ctx, '13日', { createdAt: new Date('2026-10-01T01:00:00Z') });
    expect(ctx.closeFeedback_(a, NOW)).toMatchObject({ kind: 'longAwaited', days: 14 });
    expect(ctx.closeFeedback_(b, NOW).kind).toBe('team');
  });

  it('読めない日付は longAwaited にしない', () => {
    const { ctx } = setup();
    const a = closed(ctx, '壊れた日付', { createdAt: 'いつか' });
    expect(ctx.closeFeedback_(a, NOW).kind).toBe('team');
  });

  it('小分けの途中は parentStep、最後の1つは parentDone。捨てた子は数えない', () => {
    const { ctx } = setup();
    const parent = ctx.issueCreate('規程の改定', '', []).number;
    // 作る順を期待の逆にする (偶然一致しないように)
    const thrown = ctx.issueCreate('捨てた子', '', []).number;
    ctx.dbUpdate('issues', 'number', thrown, { parent, archivedAt: new Date('2026-10-13T00:00:00Z') });
    const second = ctx.issueCreate('子2', '', []).number;
    ctx.dbUpdate('issues', 'number', second, { parent });
    const first = closed(ctx, '子1', { parent, points: 8 });

    expect(ctx.closeFeedback_(first, NOW)).toMatchObject({
      kind: 'parentStep', parent: { number: parent, title: '規程の改定', done: 1, total: 2 },
    });
    ctx.issueClose(second, null);
    expect(ctx.closeFeedback_(second, NOW)).toMatchObject({
      kind: 'parentDone', parent: { number: parent, done: 2, total: 2 },
    });
  });

  it('親が既に閉じていれば親の知らせにしない', () => {
    const { ctx } = setup();
    const parent = ctx.issueCreate('親', '', []).number;
    ctx.issueClose(parent, null);
    const kid = closed(ctx, '子', { parent, points: 5 });
    expect(ctx.closeFeedback_(kid, NOW).kind).toBe('heavy');
  });

  it('子が全部捨てられた親を「全部終わった」と読まない', () => {
    const { ctx } = setup();
    const parent = ctx.issueCreate('親', '', []).number;
    const kid = closed(ctx, '捨てた子', { parent, archivedAt: new Date('2026-10-14T02:30:00Z') });
    expect(ctx.closeFeedback_(kid, NOW).kind).toBe('team');
  });

  it('画面からは apiCloseFeedback で呼ぶ', () => {
    const { ctx } = setup();
    const n = closed(ctx, 'ふつう');
    expect(ctx.apiCloseFeedback(n)).toMatchObject({ kind: 'team', number: n });
  });
});
