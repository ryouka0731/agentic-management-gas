import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

/*
 * 前進を見せる (意欲づけ)。チームの前進と、本人にだけ見える最初の一歩に限る。
 * 点数・人ごとの順位は作らない (予告された報酬は内発的動機を下げ、職場の
 * ランキングは晒しと受け取られる)。
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

describe('チームの前進', () => {
  it('今週・今月に終えたやることと、今週反映した依頼をチームで数える', () => {
    const { ctx } = setup();
    // 2026-10-07 (水) を今日とする。今週は 10/05 (月) から
    const now = new Date('2026-10-07T03:00:00Z');
    const mk = (title, closedAt) => {
      const i = ctx.issueCreate(title, '', []);
      ctx.issueClose(i.number, null);
      ctx.dbUpdate('issues', 'number', i.number, { closedAt });
    };
    mk('今週', new Date('2026-10-06T01:00:00Z'));
    mk('先週だが今月', new Date('2026-10-02T01:00:00Z'));
    mk('先月', new Date('2026-09-28T01:00:00Z'));
    ctx.dbAppend('pulls', { number: 1, title: 'x', state: 'merged', author: 'a@example.com', mergedAt: new Date('2026-10-05T02:00:00Z') });

    expect(ctx.motivationProgress(now)).toMatchObject({ weekClosed: 1, monthClosed: 2, weekMerged: 1, goal: 0 });
  });

  it('目標はチームに1つ。管理者だけが決められる', () => {
    const { ctx, fake } = setup();
    expect(ctx.apiSetTeamGoal(10).goal).toBe(10);
    expect(ctx.apiProgress().canEditGoal).toBe(true);
    fake._setUser('viewer@example.com');
    expect(ctx.apiProgress().canEditGoal).toBe(false);
    expect(() => ctx.apiSetTeamGoal(5)).toThrow(/管理者/);
    fake._setUser('tester@example.com');
    expect(() => ctx.apiSetTeamGoal(-1)).toThrow(/0〜9999/);
    expect(ctx.apiSetTeamGoal(0).goal).toBe(0);
  });
});

describe('はじめの5歩 (本人にだけ見える)', () => {
  it('本人がしたことだけに印が付く', () => {
    const { ctx, fake } = setup();
    ctx.dbAppend('branches', { name: '見直し', state: 'open', createdBy: 'tester@example.com' });
    ctx.dbAppend('reviews', { prNumber: 1, reviewer: 'someone@example.com', state: 'approve', id: 1 });

    const steps = ctx.apiMyMilestones();
    expect(steps.map((s) => s.key)).toEqual(['branch', 'commit', 'pull', 'review', 'merge']);
    expect(steps.filter((s) => s.done).map((s) => s.key)).toEqual(['branch']);

    fake._setUser('someone@example.com');
    expect(ctx.apiMyMilestones().filter((s) => s.done).map((s) => s.key)).toEqual(['review']);
  });

  it('はじめの5歩を調べる関数は画面から直に呼べない (ほかの人の行いを覗けない)', () => {
    const { ctx } = setup();
    expect(ctx.motivationMilestones).toBeUndefined();
    expect(typeof ctx.motivationMilestones_).toBe('function');
  });

  it('終えたあとに捨てたものも前進に数える (目標の進み具合が後ろへ戻らない)', () => {
    const { ctx } = setup();
    const now = new Date('2026-10-07T03:00:00Z');
    const i = ctx.issueCreate('終えて捨てた', '', []);
    ctx.issueClose(i.number, null);
    ctx.dbUpdate('issues', 'number', i.number, { closedAt: new Date('2026-10-06T01:00:00Z'),
      archivedAt: new Date('2026-10-06T02:00:00Z') });
    expect(ctx.motivationProgress(now).weekClosed).toBe(1);
  });

  it('人ごとの数や順位を返す入口は無い', () => {
    const { ctx } = setup();
    const p = ctx.apiProgress();
    expect(Object.keys(p).sort()).toEqual(['canEditGoal', 'goal', 'monthClosed', 'weekClosed', 'weekMerged']);
  });
});
