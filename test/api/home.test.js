import { describe, it, expect } from 'vitest';
import { makeEnv, expectScreenSafe, expectRefused, asUser, OWNER, ADMIN, OTHER } from './setup.js';

/*
 * 画面の API: ホーム・前進・日報・横断検索 (src/api/Home.gs)。
 *
 * 本人のぶんとチームの合計だけを返す。最近の動き・改善のヒント・横断検索に
 * 人の名前とアドレスは入れない。
 */

function closeMine(ctx, who = OWNER, title = '今日閉じた') {
  const n = ctx.apiIssueCreate(title, '', [], '', { assignee: who }).number;
  ctx.apiIssueClose(n);
  return n;
}

describe('チームの前進 (apiProgress / apiSetTeamGoal)', () => {
  it('人ごとには数えず、管理者かどうかを添える', () => {
    const { ctx, fake } = makeEnv({ file: false });
    closeMine(ctx);
    const out = expectScreenSafe(ctx.apiProgress());
    expect(out.weekClosed).toBe(1);
    expect(out.monthClosed).toBe(1);
    expect(out.canEditGoal).toBe(true);
    expect(asUser(fake, OTHER, () => ctx.apiProgress().canEditGoal)).toBe(false);
    expect(JSON.stringify(out)).not.toMatch(/@/);
  });

  it('目標は管理者だけが決められ、0 で消える', () => {
    const { ctx, fake } = makeEnv({ file: false });
    expect(asUser(fake, ADMIN, () => expectScreenSafe(ctx.apiSetTeamGoal(12))).goal).toBe(12);
    asUser(fake, OTHER, () => {
      expectRefused(() => ctx.apiSetTeamGoal(99), /チームの目標を決めることは、このアプリの管理者/);
    });
    expect(ctx.apiProgress().goal).toBe(12);
    expect(ctx.apiSetTeamGoal(0).goal).toBe(0);
  });

  it('数でない・範囲の外は断る', () => {
    const { ctx } = makeEnv({ file: false });
    expectRefused(() => ctx.apiSetTeamGoal('たくさん'), /目標は 0〜9999 の数で/);
    expectRefused(() => ctx.apiSetTeamGoal(-1), /目標は 0〜9999/);
    expectRefused(() => ctx.apiSetTeamGoal(10000), /目標は 0〜9999/);
  });
});

describe('本人のぶん (apiMyMilestones / apiMyToday / apiHomeActivity / apiCloseFeedback)', () => {
  it('はじめの5歩は本人のぶんだけ', () => {
    const { ctx, fake } = makeEnv();
    const out = expectScreenSafe(ctx.apiMyMilestones());
    expect(out).toHaveLength(5);
    for (const m of out) expect(Object.keys(m).sort()).toEqual(['done', 'hint', 'key', 'label', 'tab']);
    const theirs = asUser(fake, OTHER, () => ctx.apiMyMilestones());
    expect(theirs.every((m) => m.done === false)).toBe(true);
  });

  it('今日片づけたものは本人の担当だけ', () => {
    const { ctx, fake } = makeEnv({ file: false });
    closeMine(ctx, OWNER, '自分の');
    closeMine(ctx, OTHER, 'ほかの人の');
    const out = expectScreenSafe(ctx.apiMyToday());
    expect(out.map((x) => x.title)).toEqual(['自分の']);
    expect(asUser(fake, OTHER, () => ctx.apiMyToday().map((x) => x.title))).toEqual(['ほかの人の']);
  });

  it('草は本人の数とチームの合計だけ', () => {
    const { ctx } = makeEnv({ file: false });
    closeMine(ctx, OWNER);
    closeMine(ctx, OTHER);
    const out = expectScreenSafe(ctx.apiHomeActivity());
    expect(out.meTotal).toBe(1);
    const cells = out.weeks.flat();
    expect(cells.reduce((n, c) => n + c.team, 0)).toBe(2);
    for (const c of cells) expect(Object.keys(c).sort()).toEqual(['day', 'future', 'me', 'team']);
  });

  it('完了の知らせは閉じたときだけポイントを添え、ポイントがオフなら添えない', () => {
    const { ctx } = makeEnv({ file: false });
    const n = closeMine(ctx);
    const off = expectScreenSafe(ctx.apiCloseFeedback(n));
    expect(off).toMatchObject({ number: n, title: '今日閉じた', weekClosed: 1 });
    expect(off).not.toHaveProperty('points');

    ctx.apiSetGameEnabled(true);
    const on = expectScreenSafe(ctx.apiCloseFeedback(n));
    expect(on.points).toBeGreaterThan(0);

    const open = ctx.apiIssueCreate('開いたまま', '', [], '', { assignee: OWNER }).number;
    expect(ctx.apiCloseFeedback(open)).not.toHaveProperty('points');
  });

  it('親のあるやることは、親の進み具合を添える', () => {
    const { ctx } = makeEnv({ file: false });
    const parent = ctx.apiIssueCreate('親', '', []).number;
    ctx.apiIssueCreate('子1', '', [], '', { parent, assignee: OWNER });
    const child = ctx.apiIssueCreate('子2', '', [], '', { parent, assignee: OWNER }).number;
    ctx.apiIssueClose(child);
    const out = expectScreenSafe(ctx.apiCloseFeedback(child));
    expect(out.parent).toEqual({ number: parent, title: '親', done: 1, total: 2 });
  });
});

describe('完了の知らせの添えもの', () => {
  it('長く待ったものは待った日数を、レベルが上がったときはそのレベルを添える', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.apiSetGameEnabled(true);
    const n = ctx.apiIssueCreate('長く待った', '', [], '', { assignee: OWNER, estimate: 8 }).number;
    ctx.dbUpdate('issues', 'number', n, { createdAt: new Date(Date.now() - 60 * 86400000) });
    ctx.apiIssueClose(n);
    const out = expectScreenSafe(ctx.apiCloseFeedback(n));
    expect(out.kind).toBe('longAwaited');
    expect(out.days).toBeGreaterThanOrEqual(59);

    // ポイントを貯めると、どこかでレベルが上がったと添える (見せたと覚えるまで添え続ける)
    let up;
    for (let k = 0; k < 40 && !up; k++) {
      const m = ctx.apiIssueCreate('積む' + k, '', [], '', { assignee: OWNER, estimate: 8 }).number;
      ctx.apiIssueClose(m);
      up = ctx.apiCloseFeedback(m).levelUp;
    }
    expect(up).toBeGreaterThan(0);
    ctx.apiGameLevelSeen(up);
    const m = ctx.apiIssueCreate('もう1つ', '', [], '', { assignee: OWNER }).number;
    ctx.apiIssueClose(m);
    const after = ctx.apiCloseFeedback(m);
    if (after.levelUp) expect(after.levelUp).toBeGreaterThan(up);
  });
});

describe('apiHomeSummary', () => {
  it('あなたの番・最近の動き・改善のヒントを返し、人の名前もアドレスも入れない', () => {
    const { ctx, fake } = makeEnv();
    asUser(fake, OTHER, () => {
      ctx.dbAppend('pulls', { number: 90, title: '頼まれた', state: 'open', author: OTHER,
        reviewers: OWNER, createdAt: new Date() });
    });
    const due = ctx.apiIssueCreate('期限', '', [], '', { assignee: OWNER }).number;
    ctx.dbUpdate('issues', 'number', due, { dueDate: new Date() });
    for (let k = 0; k < 3; k++) {
      const late = ctx.apiIssueCreate('遅れ' + k, '', [], '', { assignee: OWNER }).number;
      ctx.dbUpdate('issues', 'number', late, { dueDate: new Date('2020-01-01T00:00:00Z') });
    }

    const out = expectScreenSafe(ctx.apiHomeSummary());
    expect(out.myTurn.reviews.items.map((x) => x.number)).toContain(90);
    expect(out.myTurn.due.total).toBeGreaterThan(0);
    expect(out.recent.length).toBeGreaterThan(0);
    expect(out.advice.length).toBeGreaterThan(0);
    for (const a of out.advice) expect(Object.keys(a.action).sort()).toEqual(['arg', 'kind', 'label']);
    expect(JSON.stringify(out.recent)).not.toMatch(/@/);
    expect(JSON.stringify(out.advice)).not.toMatch(/@/);
  });

  it('改善のヒントを出さないと決めた人には数えない', () => {
    const { ctx } = makeEnv({ file: false });
    for (let k = 0; k < 3; k++) {
      const late = ctx.apiIssueCreate('遅れ' + k, '', [], '', { assignee: OWNER }).number;
      ctx.dbUpdate('issues', 'number', late, { dueDate: new Date('2020-01-01T00:00:00Z') });
    }
    ctx.apiPrefSet('home.cards.advice', false);
    expect(ctx.apiHomeSummary().advice).toEqual([]);
  });

  it('改善のヒントが落ちても、ほかの区画は返す', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.homeAdvice_ = () => { throw new Error('boom'); };
    const out = expectScreenSafe(ctx.apiHomeSummary());
    expect(out.advice).toEqual([]);
    expect(out.myTurn).toBeTruthy();
  });
});

describe('日報 (apiReportParts / apiSetReportKind / apiSetReportCustom)', () => {
  it('中身・ひな形・選んでいる形・自分の形を返す', () => {
    const { ctx } = makeEnv({ file: false });
    closeMine(ctx, OWNER, '規程を直した');
    const out = expectScreenSafe(ctx.apiReportParts());
    expect(out.parts.today.map((x) => x.title)).toEqual(['規程を直した']);
    expect(out.templates.map((t) => t.key)).toEqual(ctx.REPORT_TEMPLATES().map((t) => t.key));
    expect(out.kind).toBe('three');
    expect(out.custom).toBe('');
    expect(out.parts.date).toMatch(/\d/);
  });

  it('明日のぶん (期限か始まりが明日まで) と、自分が出した困りごとを入れる', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.apiIssueCreate('明日まで', '', [], '', { assignee: OWNER, dueDate: '2020-01-01' });
    ctx.apiIssueCreate('ずっと先', '', [], '', { assignee: OWNER, dueDate: '2099-01-01' });
    ctx.apiSetScrumEnabled(true);
    ctx.apiImpedimentCreate({ title: '印刷機が遅い' });
    const out = expectScreenSafe(ctx.apiReportParts());
    expect(out.parts.tomorrow.map((x) => x.title)).toEqual(['明日まで']);
    expect(out.parts.tomorrow[0].due).toBe('2020-01-01');
    expect(out.parts.troubles.map((x) => x.title)).toEqual(['印刷機が遅い']);
  });

  it('形を選ぶのは本人のぶんだけで、知らない形は断る', () => {
    const { ctx, fake } = makeEnv({ file: false });
    expect(expectScreenSafe(ctx.apiSetReportKind('today'))).toEqual({ kind: 'today' });
    expect(ctx.apiReportParts().kind).toBe('today');
    expect(asUser(fake, OTHER, () => ctx.apiReportParts().kind)).toBe('three');
    expectRefused(() => ctx.apiSetReportKind('weekly'), /日報の形が分かりません/);
    expect(ctx.apiReportParts().kind).toBe('today');
  });

  it('自分の形を書くとそれを選び、空にすると既定に戻る', () => {
    const { ctx } = makeEnv({ file: false });
    expect(expectScreenSafe(ctx.apiSetReportCustom('【本日】{今日}'))).toEqual({ custom: '【本日】{今日}', kind: 'custom' });
    expect(ctx.apiSetReportCustom('')).toEqual({ custom: '', kind: 'three' });
  });

  it('長すぎる形は断り、前の形を残す', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.apiSetReportCustom('前の形');
    expectRefused(() => ctx.apiSetReportCustom('あ'.repeat(ctx.REPORT_CUSTOM_MAX() + 1)), /日報の形は\d+字までです/);
    expect(ctx.apiReportParts().custom).toBe('前の形');
  });
});

describe('apiSearchIndex', () => {
  it('題名・番号・状態だけを返し、人の名前とアドレスは入れない', () => {
    const { ctx, fake } = makeEnv();
    ctx.apiIssueCreate('担当つき', '', [], '', { assignee: 'secret@example.com' });
    asUser(fake, 'reporter@example.com', () => ctx.apiInquiryCreate('bug', '報告です', ''));
    const out = expectScreenSafe(ctx.apiSearchIndex());
    expect(out.length).toBeGreaterThan(0);
    for (const x of out) expect(Object.keys(x).sort()).toEqual(['archived', 'key', 'kind', 'number', 'state', 'title']);
    expect(JSON.stringify(out)).not.toMatch(/@/);
    expect(out.some((x) => x.title === '担当つき')).toBe(true);
  });

  it('捨てたやることには印が付く', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.apiIssueCreate('捨てた', '', []);
    ctx.apiIssueArchive(1);
    const hit = ctx.apiSearchIndex().find((x) => x.title === '捨てた');
    expect(hit).toBeTruthy();
    expect(hit.archived).toBe(true);
  });
});
