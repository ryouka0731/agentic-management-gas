import { describe, it, expect } from 'vitest';
import { makeEnv, expectScreenSafe, expectRefused, snapshotDb, asUser, OWNER, ADMIN, OTHER } from './setup.js';

/*
 * 画面の API: 人・工数の集計・使われ方・Google ToDo (src/api/People.gs)。
 *
 * 人に関わる数は本人と部下のぶんだけ見せる (memberVisibleTo)。上下関係と他人の名前を
 * 変えられるのは管理者だけ。CSV (apiUsageRows) は見られない人の行を入れない。
 */

const THIRD = 'third@example.com';

/** OTHER の上長を OWNER にし、3人がそれぞれ使った記録を残す */
function team() {
  const env = makeEnv({ file: false });
  const { ctx, fake } = env;
  ctx.apiMemberSet(OTHER, OWNER, 'ほか');
  for (const who of [OWNER, OTHER, THIRD]) {
    asUser(fake, who, () => ctx.apiUsageRecord([{ kind: 'view', target: 'docs', count: 2 }]));
  }
  return env;
}

describe('上下関係と名前 (apiMemberList / apiMemberSet / apiPeopleSetName / apiPeopleNames)', () => {
  it('管理者が上下関係と名前を決め、一覧に出る', () => {
    const { ctx, fake } = makeEnv({ file: false });
    const out = asUser(fake, ADMIN, () => expectScreenSafe(ctx.apiMemberSet(OTHER, OWNER, '山田')));
    expect({ ...out }).toEqual({ email: OTHER, manager: OWNER, name: '山田' });
    expect(expectScreenSafe(ctx.apiMemberList())).toEqual([{ email: OTHER, manager: OWNER, name: '山田' }]);
    expect(expectScreenSafe(ctx.apiPeopleNames())).toMatchObject({ [OTHER]: '山田' });
  });

  it('管理者でない人は上下関係を変えられず、台帳を変えない', () => {
    const { ctx, fake } = makeEnv({ file: false });
    asUser(fake, OTHER, () => {
      expectRefused(() => ctx.apiMemberSet(OTHER, THIRD, ''), /上下関係を変えることは、このアプリの管理者/);
    });
    expect(ctx.dbReadAll('members')).toHaveLength(0);
  });

  it.each([
    ['メールでない人', ['山田', OWNER], /メールアドレスの形になっていません/],
    ['メールでない上長', [OTHER, '部長'], /メールアドレスの形になっていません/],
    ['自分が自分の上長', [OTHER, OTHER], /自分を自分の上長にはできません/],
  ])('%s は断る', (_name, args, pattern) => {
    const { ctx } = makeEnv({ file: false });
    expectRefused(() => ctx.apiMemberSet(...args), pattern);
    expect(ctx.dbReadAll('members')).toHaveLength(0);
  });

  it('上下が輪になるものは断る', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.apiMemberSet(OTHER, OWNER, '');
    const before = snapshotDb(ctx, ['members']);
    expectRefused(() => ctx.apiMemberSet(OWNER, OTHER, ''), /上下が輪になります/);
    expect(snapshotDb(ctx, ['members'])).toEqual(before);
  });

  it('自分の名前は誰でも決められ、他人の名前は管理者だけ', () => {
    const { ctx, fake } = makeEnv({ file: false });
    asUser(fake, OTHER, () => {
      expect(expectScreenSafe(ctx.apiPeopleSetName(OTHER, '自分の名'))).toEqual({ email: OTHER, name: '自分の名' });
      expectRefused(() => ctx.apiPeopleSetName(THIRD, '勝手な名'), /他人の名前を変えられるのは、このアプリの管理者だけ/);
    });
    expect(ctx.dbFindOne('members', 'email', THIRD)).toBeNull();
    expect(asUser(fake, ADMIN, () => ctx.apiPeopleSetName(THIRD, '三郎')).name).toBe('三郎');
  });

  it('名前を変えても上下関係は残す', () => {
    const { ctx, fake } = makeEnv({ file: false });
    ctx.apiMemberSet(OTHER, OWNER, '');
    asUser(fake, OTHER, () => ctx.apiPeopleSetName(OTHER, '改名'));
    expect(ctx.apiMemberList()[0]).toEqual({ email: OTHER, manager: OWNER, name: '改名' });
  });
});

describe('apiKnownPeople', () => {
  it('記録・確認・担当・名簿・やりとり・報告に出てきた人を重なりなく並べる', () => {
    const { ctx, fake } = makeEnv();
    ctx.apiIssueCreate('A', '', [], '', { assignee: 'assignee@example.com' });
    asUser(fake, 'talker@example.com', () => ctx.apiIssueComment(1, '一言'));
    ctx.apiMemberSet('member@example.com', '', '');
    asUser(fake, 'reporter@example.com', () => ctx.apiInquiryCreate('bug', '報告', ''));
    asUser(fake, 'replier@example.com', () => ctx.apiInquiryReply(1, '返信'));

    const out = expectScreenSafe(ctx.apiKnownPeople());
    expect([...out]).toEqual([...out].sort());
    expect(new Set(out).size).toBe(out.length);
    for (const who of [OWNER, 'assignee@example.com', 'talker@example.com', 'member@example.com',
      'reporter@example.com', 'replier@example.com']) {
      expect(out).toContain(who);
    }
  });

  it('開いている本人が分からなければ入れない', () => {
    const { ctx, fake } = makeEnv({ file: false });
    fake._setUser('');
    expect(ctx.apiKnownPeople()).not.toContain('');
  });
});

describe('工数の集計 (apiTallyScope / apiTallyEffort)', () => {
  function effort() {
    const env = makeEnv({ file: false });
    const { ctx } = env;
    ctx.apiMemberSet(OTHER, OWNER, '');
    ctx.apiIssueCreate('2人で', '', [], '', { assignee: OWNER + ',' + OTHER, plannedHours: 4, actualHours: 2, dueDate: '2026-10-20' });
    ctx.apiIssueCreate('ほかの部署', '', [], '', { assignee: THIRD, plannedHours: 6, dueDate: '2026-10-20' });
    ctx.apiIssueCreate('担当なし', '', [], '', { plannedHours: 1, dueDate: '2026-10-20' });
    return env;
  }

  it('見てよい人と、上長か・管理者かを返す', () => {
    const env = effort();
    const { ctx, fake } = env;
    expect(expectScreenSafe(ctx.apiTallyScope())).toEqual({ me: OWNER, canSee: [OWNER, OTHER], isManager: true, canEdit: true });
    expect(asUser(fake, OTHER, () => ctx.apiTallyScope())).toEqual({ me: OTHER, canSee: [OTHER], isManager: false, canEdit: false });
  });

  it('人ごとの内訳は本人と部下だけ。2人で持つ仕事は頭数で割る', () => {
    const env = effort();
    const { ctx } = env;
    const out = expectScreenSafe(ctx.apiTallyEffort('week', 'due', ''));
    const who = out.people.map((p) => p.who).sort();
    expect(who).toEqual(['(担当なし)', OTHER, OWNER].sort());
    expect(out.people.find((p) => p.who === OWNER).total.planned).toBe(2);
    expect(out.people.find((p) => p.who === OTHER).total.planned).toBe(2);
    // 全体は誰でも見られる。見えないぶんの数が添えられる
    expect(out.total.planned).toBe(11);
    expect(out.hidden).toBe(1);
    for (const p of out.periods) expect(Object.keys(p.byPerson)).not.toContain(THIRD);
  });

  it('部下でない人の集計は断り、自分と部下は1人に絞れる', () => {
    const env = effort();
    const { ctx, fake } = env;
    expectRefused(() => ctx.apiTallyEffort('week', 'due', THIRD), /その人の集計は見られません/);
    const only = ctx.apiTallyEffort('month', 'due', OTHER);
    expect(only.people.map((p) => p.who)).toEqual([OTHER]);
    asUser(fake, OTHER, () => {
      expectRefused(() => ctx.apiTallyEffort('week', 'due', OWNER), /その人の集計は見られません/);
      expect(ctx.apiTallyEffort('week', 'due', '').people.map((p) => p.who).sort())
        .toEqual(['(担当なし)', OTHER].sort());
    });
  });
});

describe('使われ方 (apiUsageRecord / apiUsageSummary / apiUsageRows)', () => {
  it('記録すると数を返す。押した人は画面から受け取らない', () => {
    const { ctx, fake } = makeEnv({ file: false });
    const n = asUser(fake, OTHER, () => ctx.apiUsageRecord([{ kind: 'view', target: 'docs', count: 3, user: 'liar@example.com' }]));
    expect(n).toBeGreaterThan(0);
    const users = ctx.dbReadAll('usage').map((r) => String(r.user));
    expect(users).toEqual([OTHER]);
    expect(ctx.apiUsageRecord()).toBe(0);
  });

  it('場所ごとの合計は全員ぶん、人ごとの数は本人と部下だけ', () => {
    const { ctx, fake } = team();
    const out = expectScreenSafe(ctx.apiUsageSummary(30, ''));
    expect(out.total).toBe(6);
    expect(out.byUser.map((u) => u.who).sort()).toEqual([OTHER, OWNER].sort());

    const theirs = asUser(fake, OTHER, () => ctx.apiUsageSummary(30, ''));
    expect(theirs.total).toBe(6);
    expect(theirs.byUser.map((u) => u.who)).toEqual([OTHER]);
  });

  it('CSV の行は見られる人のぶんだけ (名前を空にして残さない)', () => {
    const { ctx, fake } = team();
    const out = expectScreenSafe(ctx.apiUsageRows(30, ''));
    expect(out.rows.map((r) => r.user).sort()).toEqual([OTHER, OWNER].sort());
    expect(out.rows.every((r) => r.user)).toBe(true);
    expect(out.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const theirs = asUser(fake, OTHER, () => ctx.apiUsageRows(30, ''));
    expect(theirs.rows.map((r) => r.user)).toEqual([OTHER]);
    expect(ctx.apiUsageRows(30, OTHER).rows.map((r) => r.user)).toEqual([OTHER]);
  });

  it('見られない人を名指しすると断る', () => {
    const { ctx, fake } = team();
    expectRefused(() => ctx.apiUsageSummary(30, THIRD), /その人の使われ方は見られません/);
    expectRefused(() => ctx.apiUsageRows(30, THIRD), /その人の使われ方は見られません/);
    asUser(fake, OTHER, () => {
      expectRefused(() => ctx.apiUsageRows(30, OWNER), /見られません/);
    });
  });
});

describe('Google ToDo (apiTasksState / apiTasksChooseList / apiTasksSync)', () => {
  it('拡張サービスが無ければ使えないと返し、入口を出させない', () => {
    const { ctx } = makeEnv({ file: false });
    expect(expectScreenSafe(ctx.apiTasksState())).toEqual({ available: false, listId: '', lists: [] });
    expect(() => ctx.apiTasksSync()).toThrow(/使えません/);
  });

  it('リストを選んでから、自分の担当ぶんを同期する', () => {
    const { ctx } = makeEnv({ file: false, tasks: true });
    const state = expectScreenSafe(ctx.apiTasksState());
    expect(state.available).toBe(true);
    expect(state.lists.map((l) => l.id)).toEqual(['L1']);

    expectRefused(() => ctx.apiTasksSync(), /先に入れ先の ToDo リストを選んでください/);
    expectRefused(() => ctx.apiTasksChooseList('L9'), /そのリストは見つかりません/);
    expect(ctx.apiTasksChooseList('L1')).toBe('L1');
    expect(ctx.apiTasksState().listId).toBe('L1');

    ctx.apiIssueCreate('自分の', '', [], '', { assignee: OWNER, dueDate: '2026-11-01' });
    const out = expectScreenSafe(ctx.apiTasksSync());
    expect(out.pushed).toBe(1);
  });

  it('リストが読めないときは使えないものとして返す', () => {
    const { ctx, fake } = makeEnv({ file: false, tasks: true });
    fake.Tasks.Tasklists.list = () => { throw new Error('boom'); };
    expect(ctx.apiTasksState()).toEqual({ available: false, listId: '', lists: [] });
  });
});
