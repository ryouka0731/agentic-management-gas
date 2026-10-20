import { describe, it, expect } from 'vitest';
import { makeEnv, expectScreenSafe, expectRefused, snapshotDb, asUser, OWNER, OTHER } from './setup.js';

/*
 * 画面の API: 作業期間・困りごと・変更の履歴 (src/api/Scrum.gs)。
 *
 * 既定はオフ。オフのあいだは全部を断り、画面に出さない。やることの履歴だけは
 * オフでも見られる (CLAUDE.md「エージェンティックスクラムは既定でオフ」)。
 */

function on() {
  const env = makeEnv({ file: false });
  env.ctx.apiSetScrumEnabled(true);
  return env;
}

describe('オフのあいだ', () => {
  const CALLS = [
    ['apiSprintList', (c) => c.apiSprintList()],
    ['apiSprintCreate', (c) => c.apiSprintCreate({ name: 'S1', startDate: '2026-10-01', endDate: '2026-10-14' })],
    ['apiSprintUpdate', (c) => c.apiSprintUpdate('S1', { goal: 'x' })],
    ['apiScrumView', (c) => c.apiScrumView('')],
    ['apiImpedimentList', (c) => c.apiImpedimentList()],
    ['apiImpedimentCreate', (c) => c.apiImpedimentCreate({ title: '困った' })],
    ['apiImpedimentUpdate', (c) => c.apiImpedimentUpdate(1, { title: 'x' })],
    ['apiImpedimentResolve', (c) => c.apiImpedimentResolve(1, '直した')],
    ['apiImpedimentReopen', (c) => c.apiImpedimentReopen(1)],
    ['apiImpedimentComments', (c) => c.apiImpedimentComments(1)],
    ['apiImpedimentComment', (c) => c.apiImpedimentComment(1, 'x')],
    ['apiHistory(sprint)', (c) => c.apiHistory('sprint:S1')],
    ['apiHistory(impediment)', (c) => c.apiHistory('impediment:1')],
  ];

  it.each(CALLS)('%s は断り、台帳に何も書かない', (_name, call) => {
    const { ctx } = makeEnv({ file: false });
    const before = snapshotDb(ctx, ['sprints', 'impediments', 'impediment_comments', 'change_log']);
    expectRefused(() => call(ctx), /オフです/);
    expect(snapshotDb(ctx, ['sprints', 'impediments', 'impediment_comments', 'change_log'])).toEqual(before);
  });

  it('やることの履歴はオフでも見られる', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.apiIssueCreate('A', '', []);
    ctx.apiIssueUpdate(1, { title: 'B' });
    const out = expectScreenSafe(ctx.apiHistory('issue:1'));
    expect(out.length).toBeGreaterThan(0);
    expect(out.some((r) => r.field === 'title' && r.before === 'A' && r.after === 'B')).toBe(true);
  });

  it('履歴の対象の形が違えば断る', () => {
    const { ctx } = makeEnv({ file: false });
    expectRefused(() => ctx.apiHistory('commit:1'), /履歴の対象が正しくありません/);
    expectRefused(() => ctx.apiHistory(''), /履歴の対象が正しくありません/);
    expectRefused(() => ctx.apiHistory('issue:'), /履歴の対象が正しくありません/);
  });
});

describe('作業期間 (apiSprintList / Create / Update / apiScrumView)', () => {
  it('作ると時刻を持たない日で返し、一覧と画面の中身に出る', () => {
    const { ctx } = on();
    const made = expectScreenSafe(ctx.apiSprintCreate({ name: 'S1', goal: '紙を減らす', startDate: '2026-10-01', endDate: '2026-10-14' }));
    expect(made).toEqual({ name: 'S1', goal: '紙を減らす', startDate: '2026-10-01', endDate: '2026-10-14', notes: '' });
    expect(expectScreenSafe(ctx.apiSprintList()).map((s) => s.name)).toEqual(['S1']);

    const view = expectScreenSafe(ctx.apiScrumView(''));
    expect(view.sprint).toBe('S1');
    expect(view.sprints).toHaveLength(1);
    expect(view.burndown).toBeTruthy();
  });

  it('作業期間が無ければ、バーンダウンは空で案内を添える', () => {
    const { ctx } = on();
    const view = expectScreenSafe(ctx.apiScrumView('無い'));
    expect(view.sprint).toBe('');
    expect(view.burndown.notice).toMatch(/まだありません/);
  });

  it('直すとゴールと期間が変わり、履歴に残る', () => {
    const { ctx } = on();
    ctx.apiSprintCreate({ name: 'S1', startDate: '2026-10-01', endDate: '2026-10-14' });
    expect(expectScreenSafe(ctx.apiSprintUpdate('S1', { goal: '新しい' })).goal).toBe('新しい');
    expect(ctx.apiHistory('sprint:S1').some((r) => r.field === 'goal')).toBe(true);
  });

  it.each([
    ['名前が無い', { name: '', startDate: '2026-10-01', endDate: '2026-10-02' }, /作業期間の名前を入れてください/],
    ['名前に / ', { name: 'a/b', startDate: '2026-10-01', endDate: '2026-10-02' }, /作業期間の名前/],
    ['日付の形', { name: 'S1', startDate: '10月1日', endDate: '2026-10-02' }, /日付は YYYY-MM-DD の形/],
    ['終わりが先', { name: 'S1', startDate: '2026-10-05', endDate: '2026-10-01' }, /終わりの日が始まりの日より前/],
  ])('%s は断り、何も作らない', (_name, fields, pattern) => {
    const { ctx } = on();
    expectRefused(() => ctx.apiSprintCreate(fields), pattern);
    expect(ctx.dbReadAll('sprints')).toHaveLength(0);
  });

  it('同じ名前・無い作業期間は断る', () => {
    const { ctx } = on();
    ctx.apiSprintCreate({ name: 'S1', startDate: '2026-10-01', endDate: '2026-10-14' });
    expectRefused(() => ctx.apiSprintCreate({ name: 'S1', startDate: '2026-10-01', endDate: '2026-10-14' }), /既にあります/);
    expectRefused(() => ctx.apiSprintUpdate('S9', { goal: 'x' }), /作業期間が見つかりません/);
  });
});

describe('困りごと (apiImpediment*)', () => {
  it('記録・直す・解決・取り消しが通り、やりとりの数が一覧に付く', () => {
    const { ctx, fake } = on();
    const made = expectScreenSafe(ctx.apiImpedimentCreate({ title: '印刷機が遅い', body: '詳しく' }));
    expect(made).toMatchObject({ number: 1, title: '印刷機が遅い', reportedBy: OWNER, state: 'open', commentCount: 0 });
    expect(made.reportedAt).toMatch(/T/);

    expect(expectScreenSafe(ctx.apiImpedimentUpdate(1, { title: 'とても遅い' })).title).toBe('とても遅い');
    const c = asUser(fake, OTHER, () => expectScreenSafe(ctx.apiImpedimentComment(1, '同じく')));
    expect(c).toMatchObject({ impedimentNumber: 1, by: OTHER, canEdit: true });
    expect(expectScreenSafe(ctx.apiImpedimentComments(1)).map((x) => x.canEdit)).toEqual([false]);
    expect(expectScreenSafe(ctx.apiImpedimentList())[0].commentCount).toBe(1);

    const resolved = expectScreenSafe(ctx.apiImpedimentResolve(1, '買い替えた'));
    expect(resolved).toMatchObject({ state: 'resolved', resolution: '買い替えた' });
    expect(resolved.resolvedAt).toMatch(/T/);
    expect(expectScreenSafe(ctx.apiImpedimentReopen(1)).state).toBe('open');
    expect(ctx.apiHistory('impediment:1').length).toBeGreaterThan(0);
  });

  it('題名・解決策・やりとりの検査と、無い番号', () => {
    const { ctx } = on();
    expectRefused(() => ctx.apiImpedimentCreate({ title: '' }), /題名を入れてください/);
    expectRefused(() => ctx.apiImpedimentCreate({ title: 'あ'.repeat(201) }), /200字まで/);
    expect(ctx.dbReadAll('impediments')).toHaveLength(0);

    ctx.apiImpedimentCreate({ title: '困った' });
    expectRefused(() => ctx.apiImpedimentResolve(1, ''), /解決策を書いてください/);
    ctx.apiImpedimentResolve(1, '直した');
    expectRefused(() => ctx.apiImpedimentResolve(1, 'もう一度'), /既に解決しています/);
    expectRefused(() => ctx.apiImpedimentComment(1, ''), /内容を入力してください/);
    expectRefused(() => ctx.apiImpedimentComment(1, 'あ'.repeat(4001)), /4000文字まで/);
    expectRefused(() => ctx.apiImpedimentUpdate(9, { title: 'x' }), /困りごとが見つかりません: #9/);
    expectRefused(() => ctx.apiImpedimentComment(9, 'x'), /困りごとが見つかりません/);
  });
});

describe('履歴の行ごとの差分', () => {
  it('複数行の値は行ごとの差分を添え、1行なら添えない', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.apiIssueCreate('A', '1行目', []);
    ctx.apiIssueUpdate(1, { body: '1行目\n2行目' });
    ctx.apiIssueUpdate(1, { title: 'B' });
    const rows = ctx.apiHistory('issue:1');
    const body = rows.find((r) => r.field === 'body');
    expect([...body.lines.map((l) => l.op)]).toEqual(['same', 'add']);
    expect(rows.find((r) => r.field === 'title').lines).toBeNull();
  });
});
