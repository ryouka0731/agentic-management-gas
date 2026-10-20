import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';
import { APP_SOURCES } from './sources.js';

/*
 * 完了にした瞬間に「何が起きたか」を1つだけ返す。くじではなく、本当に
 * 起きたことで驚かせる (docs/superpowers/specs/2026-10-14-task-flow-motivation-design.md)。
 */
const SOURCES = APP_SOURCES.concat(['src/core/Motivation.gs']);

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

  it('重いもの (ポイント5以上・予定1人日以上) は heavy。字の数でも読む', () => {
    const { ctx } = setup();
    // plannedHours は列の名前に反して人日で持っている (画面は「予定 N人日」)
    const a = closed(ctx, 'ポイント', { points: 5 });
    const b = closed(ctx, '1人日', { plannedHours: '1' });
    const c = closed(ctx, '半日', { points: '', plannedHours: 0.5 });
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

  it('閉じていないやることには、起きていないことを知らせない', () => {
    const { ctx } = setup();
    const parent = ctx.issueCreate('親', '', []).number;
    const kid = ctx.issueCreate('開いたままの子', '', []).number;
    ctx.dbUpdate('issues', 'number', kid, { parent, points: 8 });
    expect(ctx.closeFeedback_(kid, NOW)).toMatchObject({ kind: 'team', closed: false });
    expect(ctx.closeFeedback_(kid, NOW)).not.toHaveProperty('parent');
  });

  it('画面からは apiCloseFeedback で呼ぶ', () => {
    const { ctx } = setup();
    const n = closed(ctx, 'ふつう');
    expect(ctx.apiCloseFeedback(n)).toMatchObject({ kind: 'team', number: n });
  });
});

describe('今日片づけたもの (本人にだけ)', () => {
  it('担当に自分が入っている・担当が空で自分が閉じた・自分の依頼の反映を載せる', () => {
    const { ctx, fake } = setup();
    const today = new Date('2026-10-14T02:00:00Z');
    const yesterday = new Date('2026-10-13T02:00:00Z');

    // 作る順を期待の逆にする
    ctx.dbAppend('pulls', { number: 7, title: '細則の見直し', state: 'merged', author: 'tester@example.com', mergedAt: today });
    ctx.dbAppend('pulls', { number: 8, title: '人の依頼', state: 'merged', author: 'b@example.com', mergedAt: today });

    const empty = ctx.issueCreate('担当なし', '', []).number;
    ctx.issueClose(empty, null); // tester が閉じた記録が残る
    ctx.dbUpdate('issues', 'number', empty, { closedAt: today });

    const mine = ctx.issueCreate('規程の改定', '', []).number;
    ctx.issueClose(mine, null);
    ctx.dbUpdate('issues', 'number', mine, { assignee: 'b@example.com, tester@example.com', closedAt: today });

    const others = ctx.issueCreate('人の', '', []).number;
    ctx.issueClose(others, null);
    ctx.dbUpdate('issues', 'number', others, { assignee: 'b@example.com', closedAt: today });

    const old = ctx.issueCreate('昨日の', '', []).number;
    ctx.issueClose(old, null);
    ctx.dbUpdate('issues', 'number', old, { assignee: 'tester@example.com', closedAt: yesterday });

    fake._setUser('b@example.com');
    const byB = ctx.issueCreate('B が閉じた担当なし', '', []).number;
    ctx.issueClose(byB, null);
    ctx.dbUpdate('issues', 'number', byB, { closedAt: today });
    fake._setUser('tester@example.com');

    expect(ctx.myToday_('tester@example.com', NOW)).toEqual([
      { kind: 'issue', number: empty, title: '担当なし' },
      { kind: 'issue', number: mine, title: '規程の改定' },
      { kind: 'pull', number: 7, title: '細則の見直し' },
    ]);
  });

  it('完了を取り消したものは消える', () => {
    const { ctx } = setup();
    const n = ctx.issueCreate('早合点', '', []).number;
    ctx.issueClose(n, null);
    ctx.dbUpdate('issues', 'number', n, { assignee: 'tester@example.com', closedAt: new Date('2026-10-14T02:00:00Z') });
    ctx.issueReopen(n);
    expect(ctx.myToday_('tester@example.com', NOW)).toEqual([]);
  });

  it('閉じた記録の無い担当なしのものは、誰の今日にも載らない (例外にしない)', () => {
    const { ctx } = setup();
    ctx.dbAppend('issues', { number: 99, title: '古い', state: 'closed', closedAt: new Date('2026-10-14T02:00:00Z') });
    expect(ctx.myToday_('tester@example.com', NOW)).toEqual([]);
  });

  it('画面からは本人のぶんだけ (アドレスを受ける関数は直に呼べない)', () => {
    const { ctx } = setup();
    expect(ctx.myToday).toBeUndefined();
    expect(Array.isArray(ctx.apiMyToday())).toBe(true);
    expect(ctx.apiMyToday.length).toBe(0);
  });

  it('apiMyToday は開いている本人のぶんだけを返す', () => {
    const { ctx, fake } = setup();
    const now = new Date();
    const a = ctx.issueCreate('tester のもの', '', []).number;
    ctx.issueClose(a, null);
    ctx.dbUpdate('issues', 'number', a, { assignee: 'tester@example.com', closedAt: now });
    const b = ctx.issueCreate('B のもの', '', []).number;
    ctx.issueClose(b, null);
    ctx.dbUpdate('issues', 'number', b, { assignee: 'b@example.com', closedAt: now });

    fake._setUser('b@example.com');
    expect(ctx.apiMyToday()).toEqual([{ kind: 'issue', number: b, title: 'B のもの' }]);
  });
});
