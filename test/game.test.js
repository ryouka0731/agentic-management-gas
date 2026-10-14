import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

/*
 * ポイント・レベル・週の上位。利用者の判断で入れた。守り (重さで付ける・
 * 上位3人だけ・週ごと・既定オフ・参加は本人が選ぶ) を固定する。
 */
const SOURCES = (() => {
  const src = fs.readFileSync(new URL('./scrum-api.test.js', import.meta.url), 'utf8');
  return eval(src.match(/const SOURCES = (\[[\s\S]*?\]);/)[1])
    .concat(['src/core/Motivation.gs', 'src/core/Game.gs']);
})();

function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...SOURCES);
  ctx.repoInit('agentic-management');
  return { ctx, fake };
}

const NOW = new Date('2026-10-14T03:00:00Z'); // 水曜。今週は 10/12 (月) から
const TODAY = new Date('2026-10-14T02:00:00Z');

function closed(ctx, title, patch) {
  const i = ctx.issueCreate(title, '', []);
  ctx.issueClose(i.number, null);
  ctx.dbUpdate('issues', 'number', i.number, Object.assign({
    createdAt: new Date('2026-10-13T01:00:00Z'), closedAt: TODAY,
  }, patch || {}));
  return i.number;
}

describe('ポイント', () => {
  it('完了1・重い+2・長く止まっていた+2。担当が複数なら頭数で割る', () => {
    const { ctx } = setup();
    closed(ctx, 'ふつう', { assignee: 'a@example.com' });
    closed(ctx, '重い', { assignee: 'a@example.com', points: 5 });
    closed(ctx, '長い', { assignee: 'a@example.com, b@example.com', createdAt: new Date('2026-09-20T01:00:00Z') });
    expect(ctx.gamePointsByPerson_('', '')).toEqual({ 'a@example.com': 1 + 3 + 1.5, 'b@example.com': 1.5 });
  });

  it('小分けの最後の1つに +1 (いまの子の状態で見る)', () => {
    const { ctx } = setup();
    const parent = ctx.issueCreate('親', '', []).number;
    closed(ctx, '子2', { parent, assignee: 'a@example.com', closedAt: new Date('2026-10-14T02:30:00Z') });
    closed(ctx, '子1', { parent, assignee: 'b@example.com' });
    expect(ctx.gamePointsByPerson_('', '')).toEqual({ 'a@example.com': 2, 'b@example.com': 1 });
  });

  it('担当が空なら閉じた人に付く。閉じた記録も無ければ誰にも付かない', () => {
    const { ctx } = setup();
    closed(ctx, '担当なし');
    ctx.dbAppend('issues', { number: 99, title: '古い', state: 'closed', closedAt: TODAY });
    expect(ctx.gamePointsByPerson_('', '')).toEqual({ 'tester@example.com': 1 });
  });

  it('完了を取り消すと消える', () => {
    const { ctx } = setup();
    const n = closed(ctx, '早合点', { assignee: 'a@example.com' });
    ctx.issueReopen(n);
    expect(ctx.gamePointsByPerson_('', '')).toEqual({});
  });

  it('ほかの人の依頼への確認は1 (同じ依頼には1回・自分の依頼とコメントは数えない)。反映は出した人に2', () => {
    const { ctx } = setup();
    ctx.dbAppend('pulls', { number: 1, title: 'x', state: 'merged', author: 'a@example.com', mergedAt: TODAY });
    ctx.dbAppend('reviews', { prNumber: 1, reviewer: 'b@example.com', state: 'request_changes', at: TODAY, id: 1 });
    ctx.dbAppend('reviews', { prNumber: 1, reviewer: 'b@example.com', state: 'approve', at: TODAY, id: 2 });
    ctx.dbAppend('reviews', { prNumber: 1, reviewer: 'a@example.com', state: 'approve', at: TODAY, id: 3 });
    ctx.dbAppend('reviews', { prNumber: 1, reviewer: 'c@example.com', state: 'comment', at: TODAY, id: 4 });
    expect(ctx.gamePointsByPerson_('', '')).toEqual({ 'a@example.com': 2, 'b@example.com': 1 });
  });

  it('期間で絞る', () => {
    const { ctx } = setup();
    closed(ctx, '今週', { assignee: 'a@example.com' });
    closed(ctx, '先週', { assignee: 'a@example.com', closedAt: new Date('2026-10-09T02:00:00Z') });
    expect(ctx.gamePointsByPerson_('2026-10-12', '2026-10-14')).toEqual({ 'a@example.com': 1 });
  });
});

describe('レベル', () => {
  it('レベル n に必要な合計は 5n(n+1)/2', () => {
    const { ctx } = setup();
    expect([0, 4, 5, 14, 15, 30].map((t) => ctx.gameLevel(t))).toEqual([0, 0, 1, 1, 2, 3]);
    expect(ctx.gameLevelAt(3)).toBe(30);
  });

  it('取り消しで合計が減っても、見せたレベルは下がらない', () => {
    const { ctx } = setup();
    const nos = [];
    for (let k = 0; k < 5; k++) nos.push(closed(ctx, 'x' + k, { assignee: 'tester@example.com' }));
    ctx.gameLevelSeenSet_('tester@example.com', 1);
    // 合計 5 → 4 に減らす
    ctx.issueReopen(nos[0]);
    expect(ctx.gameMine_('tester@example.com', NOW).level).toBe(1);
  });
});

describe('週の上位', () => {
  function three(ctx) {
    // 作る順を期待の逆にする
    closed(ctx, 'd1', { assignee: 'd@example.com' });
    closed(ctx, 'c1', { assignee: 'c@example.com', points: 5 });
    closed(ctx, 'b1', { assignee: 'b@example.com', points: 5 });
    closed(ctx, 'a1', { assignee: 'a@example.com', points: 5 });
    closed(ctx, 'a2', { assignee: 'a@example.com', points: 5 });
  }

  it('参加した人の上位3位まで。同点は同じ順位', () => {
    const { ctx } = setup();
    three(ctx);
    ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com'].forEach((e) => ctx.gameSetPlaying_(e, true));
    expect(ctx.gameTop_(NOW).map((r) => [r.rank, r.email, r.points])).toEqual([
      [1, 'a@example.com', 6], [2, 'b@example.com', 3], [2, 'c@example.com', 3],
    ]);
  });

  it('不参加と0点は載らない。先週のぶんは入らない', () => {
    const { ctx } = setup();
    three(ctx);
    closed(ctx, '先週', { assignee: 'e@example.com', points: 8, closedAt: new Date('2026-10-09T02:00:00Z') });
    ['b@example.com', 'd@example.com', 'e@example.com'].forEach((e) => ctx.gameSetPlaying_(e, true));
    expect(ctx.gameTop_(NOW).map((r) => r.email)).toEqual(['b@example.com', 'd@example.com']);
  });

  it('4位以下の人に自分の順位は返らない (週の点だけ)', () => {
    const { ctx } = setup();
    three(ctx);
    ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com'].forEach((e) => ctx.gameSetPlaying_(e, true));
    const mine = ctx.gameMine_('d@example.com', NOW);
    expect(mine.week).toBe(1);
    expect(mine).not.toHaveProperty('rank');
  });
});

describe('オン・オフと参加', () => {
  it('既定はオフ・不参加', () => {
    const { ctx } = setup();
    expect(ctx.gameEnabled()).toBe(false);
    expect(ctx.gamePlayers()).toEqual([]);
    expect(ctx.gameSetEnabled_(true)).toBe(true);
  });

  it('参加の一覧が壊れていても空として読む', () => {
    const { ctx, fake } = setup();
    fake.PropertiesService.getScriptProperties().setProperty('GAME_PLAYERS', '{壊れた');
    expect(ctx.gamePlayers()).toEqual([]);
    expect(ctx.gameSetPlaying_('a@example.com', true)).toBe(true);
    expect(ctx.gamePlayers()).toEqual(['a@example.com']);
  });

  it('参加の出し入れは鍵の中で行う', () => {
    const { ctx, fake } = setup();
    const order = [];
    fake.LockService.getScriptLock = () => ({
      tryLock: () => { order.push('lock'); return true; },
      releaseLock: () => { order.push('release'); },
    });
    const props = fake.PropertiesService.getScriptProperties();
    const realSet = props.setProperty.bind(props);
    props.setProperty = (k, v) => { order.push('set'); return realSet(k, v); };
    fake.PropertiesService.getScriptProperties = () => props;

    ctx.gameSetPlaying_('a@example.com', true);
    expect(order).toEqual(['lock', 'set', 'release']);
  });
});
