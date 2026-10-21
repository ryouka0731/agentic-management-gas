import { describe, it, expect } from 'vitest';
import { makeEnv, expectScreenSafe, expectRefused, snapshotDb, asUser, OWNER, ADMIN, OTHER } from './setup.js';

/*
 * 画面の API: 目標 (src/api/Goals.gs / src/core/Goal.gs)。
 *
 * 既定はオフ。見られるのは本人・承認する人 (直属の上長。いなければ持ち主)・上長の連なり。
 * 管理者だというだけでは見られない (docs/dev/permissions.md の「目標」)。
 */

const MEMBER = 'member@example.com';
const BOSS = 'boss@example.com';
const TOP = 'top@example.com';
const TABLES = ['goals', 'goal_items', 'goal_links'];

/** オンにして、上下関係を入れる: MEMBER → BOSS → TOP */
function on() {
  const env = makeEnv({ file: false });
  const { ctx, fake } = env;
  fake._setUser(OWNER);
  ctx.apiPrefSet('goals.enabled', true);
  ctx.memberSet(MEMBER, BOSS, '山田');
  ctx.memberSet(BOSS, TOP, '佐藤');
  return env;
}

/** MEMBER の OKR を1つ立てる (主な結果は2つ。つなぐ項目と数の項目) */
function okr(env, extra) {
  return asUser(env.fake, MEMBER, () => env.ctx.apiGoalSave(Object.assign({
    kind: 'okr', title: '手続きを速くする',
    items: [
      { title: '規程の見直しを済ませる', measure: 'issues' },
      { title: '問い合わせを減らす', measure: 'number', target: 100, unit: '件' },
    ],
  }, extra || {})));
}

/** 保存し直すときの項目 (今のまま) */
function keepItems(g) {
  return g.items.map((i) => ({ id: i.id, title: i.title, measure: i.measure, target: i.target, unit: i.unit,
    weight: i.weight, filter: i.filter }));
}

/** MEMBER の担当のやることを作る */
function issueFor(env, title, who) {
  return asUser(env.fake, OWNER, () => {
    const n = env.ctx.apiIssueCreate(title, '', []).number;
    env.ctx.apiIssueUpdate(n, { assignee: who || MEMBER });
    return n;
  });
}

describe('オフのあいだ', () => {
  const CALLS = [
    ['apiGoalMine', (c) => c.apiGoalMine('')],
    ['apiGoalSave', (c) => c.apiGoalSave({ kind: 'okr', title: 'x', items: [] })],
    ['apiGoalDelete', (c) => c.apiGoalDelete(1)],
    ['apiGoalSubmit', (c) => c.apiGoalSubmit(1)],
    ['apiGoalDecide', (c) => c.apiGoalDecide(1, 'approve', '')],
    ['apiGoalLink', (c) => c.apiGoalLink(1, 1)],
    ['apiGoalUnlink', (c) => c.apiGoalUnlink(1, 1)],
    ['apiGoalProgressInput', (c) => c.apiGoalProgressInput(1, { actual: 1 })],
    ['apiGoalReview', (c) => c.apiGoalReview(1, 'x')],
    ['apiGoalGrade', (c) => c.apiGoalGrade(1, 'A', 'x')],
    ['apiGoalTeam', (c) => c.apiGoalTeam('')],
    ['apiGoalReport', (c) => c.apiGoalReport(1)],
    ['apiGoalIssueLinks', (c) => c.apiGoalIssueLinks(1)],
  ];

  it.each(CALLS)('%s は断り、台帳に何も書かない', (_name, call) => {
    const { ctx } = makeEnv({ file: false });
    const before = snapshotDb(ctx, TABLES);
    expectRefused(() => call(ctx), /オフです/);
    expect(snapshotDb(ctx, TABLES)).toEqual(before);
  });

  it('状態はオフでも見られ、既定は半期・4月始まり', () => {
    const { ctx } = makeEnv({ file: false });
    const s = expectScreenSafe(ctx.apiGoalState());
    expect(s.enabled).toBe(false);
    expect(s.unit).toBe('half');
    expect(s.fyStart).toBe(4);
    expect(s.period).toMatch(/^\d{4}H[12]$/);
    expect(s.periods.map((p) => p.key)).toContain(s.period);
    expect(s.grades.map((x) => x.grade)).toEqual(['S', 'A', 'B', 'C', 'D']);
  });

  it('オンにできるのは管理者だけ', () => {
    const { ctx, fake } = makeEnv({ file: false });
    asUser(fake, OTHER, () => expectRefused(() => ctx.apiPrefSet('goals.enabled', true), /管理者/));
    asUser(fake, ADMIN, () => ctx.apiPrefSet('goals.enabled', true));
    expect(ctx.apiGoalState().enabled).toBe(true);
  });

  it('四半期にすると、いまの期が四半期の形になる', () => {
    const { ctx } = on();
    ctx.apiPrefSet('goals.period', 'quarter');
    expect(ctx.apiGoalState().period).toMatch(/^\d{4}Q[1-4]$/);
  });
});

describe('立てる・直す・消す', () => {
  it('立てると下書きになり、自分の目標に出る', () => {
    const env = on();
    const goal = expectScreenSafe(okr(env));
    expect(goal.status).toBe('draft');
    expect(goal.who).toBe(MEMBER);
    expect(goal.items.map((i) => i.title)).toEqual(['規程の見直しを済ませる', '問い合わせを減らす']);
    // OKR の重みが空なら等しく分ける
    expect(goal.items.map((i) => i.share)).toEqual([50, 50]);
    const mine = asUser(env.fake, MEMBER, () => expectScreenSafe(env.ctx.apiGoalMine('')));
    expect(mine.goals.map((g) => g.id)).toEqual([goal.id]);
    expect(goal.canEdit && goal.canSubmit && goal.canDelete).toBe(true);
  });

  it('項目を直す・足す・外す。外した項目のつないだやることも外れる', () => {
    const env = on();
    const goal = okr(env);
    const n = issueFor(env, '第3条の見直し');
    asUser(env.fake, MEMBER, () => env.ctx.apiGoalLink(goal.items[0].id, n));
    expect(env.ctx.dbReadAll('goal_links')).toHaveLength(1);
    const next = asUser(env.fake, MEMBER, () => env.ctx.apiGoalSave({
      id: goal.id, kind: 'okr', title: '手続きを速くする (改)',
      items: [
        { id: goal.items[1].id, title: '問い合わせを減らす', measure: 'number', target: 80, unit: '件' },
        { title: '手引きを書く', measure: 'check' },
      ],
    }));
    expect(next.title).toBe('手続きを速くする (改)');
    expect(next.items.map((i) => i.title)).toEqual(['問い合わせを減らす', '手引きを書く']);
    expect(next.items[0].id).toBe(goal.items[1].id);
    expect(next.items[0].target).toBe(80);
    expect(env.ctx.dbReadAll('goal_links')).toHaveLength(0);
  });

  it('入れた数は、測り方を変えない限り直しても残る', () => {
    const env = on();
    const goal = okr(env);
    const item = goal.items[1];
    asUser(env.fake, MEMBER, () => env.ctx.apiGoalProgressInput(item.id, { actual: 40 }));
    const kept = asUser(env.fake, MEMBER, () => env.ctx.apiGoalSave({
      id: goal.id, kind: 'okr', title: goal.title,
      items: [{ id: item.id, title: '問い合わせを減らす', measure: 'number', target: 100 }],
    }));
    expect(kept.items[0].actual).toBe(40);
  });

  it('入れた内容が足りなければ断る', () => {
    const env = on();
    asUser(env.fake, MEMBER, () => {
      expectRefused(() => env.ctx.apiGoalSave({ kind: 'okr', title: '', items: [] }), /名前を書いてください/);
      expectRefused(() => env.ctx.apiGoalSave({ kind: 'xyz', title: 'a', items: [] }), /知らない種類/);
      expectRefused(() => env.ctx.apiGoalSave({ kind: 'kpi', title: 'a', items: [{ title: 'b', measure: 'number' }] }),
        /目標の値を入れてください/);
      expectRefused(() => env.ctx.apiGoalSave({ kind: 'kpi', title: 'a', items: [{ title: 'b', measure: 'label', target: 3 }] }),
        /タグを書いてください/);
      expectRefused(() => env.ctx.apiGoalSave({ kind: 'mbo', title: 'a', items: [{ title: 'b', measure: 'check', weight: 120 }] }),
        /100までです/);
      expectRefused(() => env.ctx.apiGoalSave({ kind: 'okr', title: 'a', period: '2026年', items: [] }), /期の形/);
    });
    expect(env.ctx.dbReadAll('goals')).toHaveLength(0);
  });

  it('消せるのは本人の下書き・差し戻しだけ。項目と結び付きも消え、やることは残る', () => {
    const env = on();
    const goal = okr(env);
    const n = issueFor(env, '第3条の見直し');
    asUser(env.fake, MEMBER, () => env.ctx.apiGoalLink(goal.items[0].id, n));
    asUser(env.fake, OTHER, () => expectRefused(() => env.ctx.apiGoalDelete(goal.id), /本人だけ/));
    asUser(env.fake, MEMBER, () => env.ctx.apiGoalDelete(goal.id));
    TABLES.forEach((t) => expect(env.ctx.dbReadAll(t)).toHaveLength(0));
    expect(env.ctx.issueGet(n).title).toBe('第3条の見直し');
  });
});

describe('承認の流れ', () => {
  function submitted(env) {
    const goal = okr(env);
    asUser(env.fake, MEMBER, () => env.ctx.apiGoalSubmit(goal.id));
    return goal;
  }

  it('頼むと直属の上長に知らせが届き、上長の「承認を待つもの」に出る', () => {
    const env = on();
    const goal = submitted(env);
    expect(env.ctx.goalGet_(goal.id).status).toBe('submitted');
    const mails = env.fake._sentMails().filter((m) => m.to === BOSS);
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toBe('[SoftBanto] 目標 #' + goal.id + ' の承認を頼まれました');
    expect(env.ctx.noticeList(BOSS).map((n) => n.kind)).toEqual(['goal']);
    const team = asUser(env.fake, BOSS, () => expectScreenSafe(env.ctx.apiGoalTeam('')));
    expect(team.pending.map((g) => g.id)).toEqual([goal.id]);
    expect(team.pending[0].canDecide).toBe(true);
    expect(team.pending[0].whoName).toBe('山田');
    // 上の上 (TOP) は見られるが、承認はしない
    const top = asUser(env.fake, TOP, () => env.ctx.apiGoalTeam(''));
    expect(top.goals.map((g) => g.id)).toEqual([goal.id]);
    expect(top.pending).toEqual([]);
  });

  it('承認すると本人に知らせ、承認済みになる', () => {
    const env = on();
    const goal = submitted(env);
    const out = asUser(env.fake, BOSS, () => expectScreenSafe(env.ctx.apiGoalDecide(goal.id, 'approve', 'よいと思います')));
    expect(out.status).toBe('approved');
    expect(out.approver).toBe(BOSS);
    expect(out.managerNote).toBe('よいと思います');
    expect(env.fake._sentMails().filter((m) => m.to === MEMBER).map((m) => m.subject))
      .toEqual(['[SoftBanto] 目標 #' + goal.id + ' が承認されました']);
  });

  it('差し戻すにはひとことが要り、差し戻すと直して頼み直せる', () => {
    const env = on();
    const goal = submitted(env);
    asUser(env.fake, BOSS, () => {
      expectRefused(() => env.ctx.apiGoalDecide(goal.id, 'return', ''), /直してほしいこと/);
      env.ctx.apiGoalDecide(goal.id, 'return', '数をもう少し上げてください');
    });
    const back = env.ctx.goalGet_(goal.id);
    expect(back.status).toBe('returned');
    expect(env.fake._sentMails().some((m) => m.to === MEMBER && /差し戻されました/.test(m.subject))).toBe(true);
    asUser(env.fake, MEMBER, () => {
      env.ctx.apiGoalSave({ id: goal.id, kind: 'okr', title: goal.title,
        items: [{ title: '問い合わせを減らす', measure: 'number', target: 150 }] });
      expect(env.ctx.goalGet_(goal.id).status).toBe('returned');
      env.ctx.apiGoalSubmit(goal.id);
    });
    expect(env.ctx.goalGet_(goal.id).status).toBe('submitted');
  });

  it('承認済みを直すと、もう一度承認を待つ (直した印付き)。数を入れるだけなら承認し直しは要らない', () => {
    const env = on();
    const goal = submitted(env);
    asUser(env.fake, BOSS, () => env.ctx.apiGoalDecide(goal.id, 'approve', ''));
    const input = asUser(env.fake, MEMBER, () => env.ctx.apiGoalProgressInput(goal.items[1].id, { actual: 30 }));
    expect(input.status).toBe('approved');
    expect(input.items[1].percent).toBe(30);
    const before = env.fake._sentMails().filter((m) => m.to === BOSS).length;
    const edited = asUser(env.fake, MEMBER, () => env.ctx.apiGoalSave({ id: goal.id, kind: 'okr', title: '手続きをもっと速くする',
      items: keepItems(goal) }));
    expect(edited.status).toBe('submitted');
    expect(edited.changedAfterApproval).toBe(true);
    const mails = env.fake._sentMails().filter((m) => m.to === BOSS);
    expect(mails).toHaveLength(before + 1);
    expect(mails[mails.length - 1].subject).toMatch(/直したところの承認を頼まれました/);
    // 頼んでいるあいだは直せない
    asUser(env.fake, MEMBER, () => expectRefused(() => env.ctx.apiGoalSave({ id: goal.id, kind: 'okr', title: 'x', items: [] }),
      /承認を待っているあいだは直せません/));
  });

  it('移れない状態からは断る', () => {
    const env = on();
    const goal = okr(env);
    asUser(env.fake, BOSS, () => expectRefused(() => env.ctx.apiGoalDecide(goal.id, 'approve', ''), /承認を待っている目標ではありません/));
    asUser(env.fake, BOSS, () => expectRefused(() => env.ctx.apiGoalGrade(goal.id, 'A', 'よい'), /承認された目標だけ/));
    asUser(env.fake, MEMBER, () => expectRefused(() => env.ctx.apiGoalReview(goal.id, 'x'), /承認された目標に/));
    asUser(env.fake, MEMBER, () => env.ctx.apiGoalSubmit(goal.id));
    asUser(env.fake, MEMBER, () => expectRefused(() => env.ctx.apiGoalSubmit(goal.id), /下書きか差し戻された目標だけ/));
    asUser(env.fake, BOSS, () => expectRefused(() => env.ctx.apiGoalDecide(goal.id, 'maybe', ''), /選んでください/));
  });

  it('項目が無い・MBO の重みが100にならないなら頼めない', () => {
    const env = on();
    asUser(env.fake, MEMBER, () => {
      const empty = env.ctx.apiGoalSave({ kind: 'okr', title: '空', items: [] });
      expectRefused(() => env.ctx.apiGoalSubmit(empty.id), /1つ以上/);
      const mbo = env.ctx.apiGoalSave({ kind: 'mbo', title: 'MBO', items: [
        { title: 'a', measure: 'check', weight: 60 }, { title: 'b', measure: 'check', weight: 30 }] });
      expectRefused(() => env.ctx.apiGoalSubmit(mbo.id), /合わせて100.*いまは 90/);
    });
  });

  it('上長がいない人は持ち主に頼む。持ち主自身に上長がいなければ頼めない', () => {
    const env = on();
    const goal = asUser(env.fake, OTHER, () => env.ctx.apiGoalSave({ kind: 'kpi', title: 'K', items: [{ title: 'a', measure: 'check' }] }));
    asUser(env.fake, OTHER, () => env.ctx.apiGoalSubmit(goal.id));
    expect(env.fake._sentMails().some((m) => m.to === OWNER && /承認を頼まれました/.test(m.subject))).toBe(true);
    const own = asUser(env.fake, OWNER, () => env.ctx.apiGoalSave({ kind: 'kpi', title: 'K', items: [{ title: 'a', measure: 'check' }] }));
    asUser(env.fake, OWNER, () => expectRefused(() => env.ctx.apiGoalSubmit(own.id), /上長を登録してください/));
  });

  it('知らせのメールを止めた上長には送らない (画面の中の知らせは届く)。知らせが落ちても承認は済む', () => {
    const env = on();
    asUser(env.fake, BOSS, () => env.ctx.apiPrefSet('notify.goal', false));
    const goal = submitted(env);
    expect(env.fake._sentMails().filter((m) => m.to === BOSS)).toHaveLength(0);
    expect(env.ctx.noticeList(BOSS)).toHaveLength(1);
    env.ctx.GmailApp.sendEmail = () => { throw new Error('送れない'); };
    const out = asUser(env.fake, BOSS, () => env.ctx.apiGoalDecide(goal.id, 'approve', ''));
    expect(out.status).toBe('approved');
  });
});

describe('誰が何をできるか', () => {
  /**
   * 承認済みの目標 (振り返りまで書いたもの。評価は期の終わりか振り返りのあと) と、
   * 承認を待っている目標 (pendingId)・下書き (draftId)・つないだ本人のやること (issue)・まだつないでいないもの (issue2)
   */
  function approved() {
    const env = on();
    const goal = okr(env);
    goal.issue = issueFor(env, '本人のやること');
    goal.issue2 = issueFor(env, '本人のやること2');
    asUser(env.fake, MEMBER, () => {
      env.ctx.apiGoalLink(goal.items[0].id, goal.issue);
      env.ctx.apiGoalSubmit(goal.id);
    });
    asUser(env.fake, BOSS, () => env.ctx.apiGoalDecide(goal.id, 'approve', ''));
    asUser(env.fake, MEMBER, () => {
      env.ctx.apiGoalReview(goal.id, '振り返り');
      goal.pendingId = env.ctx.apiGoalSubmit(okr(env).id).id;
      goal.draftId = okr(env).id;
    });
    return { env, goal };
  }

  const ACTS = {
    view: (c, g) => c.apiGoalReport(g.id),
    edit: (c, g) => c.apiGoalSave({ id: g.id, kind: 'okr', title: 'x', items: keepItems(g) }),
    input: (c, g) => c.apiGoalProgressInput(g.items[1].id, { actual: 1 }),
    review: (c, g) => c.apiGoalReview(g.id, '振り返り'),
    grade: (c, g) => c.apiGoalGrade(g.id, 'A', 'よかった'),
    link: (c, g) => c.apiGoalLink(g.items[0].id, g.issue2),
    unlink: (c, g) => c.apiGoalUnlink(g.items[0].id, g.issue),
    decide: (c, g) => c.apiGoalDecide(g.pendingId, 'approve', ''),
    'delete': (c, g) => c.apiGoalDelete(g.draftId),
    withdraw: (c, g) => c.apiGoalWithdraw(g.pendingId),
  };
  // 本人 / 直属の上長 / 上の上 / ほかの人 / 管理者 (連なりの外) / 持ち主 (上長がいるので承認はしない)
  const NONE = { view: false, edit: false, input: false, review: false, grade: false, link: false, unlink: false,
    decide: false, 'delete': false, withdraw: false };
  const MATRIX = [
    [MEMBER, { view: true, edit: true, input: true, review: true, grade: false, link: true, unlink: true,
      decide: false, 'delete': true, withdraw: true }],
    [BOSS, Object.assign({}, NONE, { view: true, grade: true, decide: true })],
    [TOP, Object.assign({}, NONE, { view: true })],
    [OTHER, NONE],
    [ADMIN, NONE],
    [OWNER, NONE],
  ];

  MATRIX.forEach(([who, can]) => {
    Object.keys(ACTS).forEach((act) => {
      it(who + ' は ' + act + (can[act] ? ' できる' : ' できない'), () => {
        const { env, goal } = approved();
        const call = () => asUser(env.fake, who, () => ACTS[act](env.ctx, goal));
        if (can[act]) expect(call).not.toThrow();
        else expectRefused(call);
      });
    });
  });

  it('チームの一覧に出るのは連なりの下の人だけ。管理者・ほかの人には出ない', () => {
    const { env, goal } = approved();
    [OTHER, ADMIN, OWNER].forEach((who) => {
      const out = asUser(env.fake, who, () => env.ctx.apiGoalTeam(''));
      expect(out.goals).toEqual([]);
      expect(out.pending).toEqual([]);
    });
    expect(asUser(env.fake, BOSS, () => env.ctx.apiGoalTeam('')).goals.map((g) => g.id)).toContain(goal.id);
  });

  it('ほかの人のやることのつなぎ先には、自分の項目しか出ない', () => {
    const { env, goal } = approved();
    const n = issueFor(env, '第3条の見直し');
    asUser(env.fake, MEMBER, () => env.ctx.apiGoalLink(goal.items[0].id, n));
    const mine = asUser(env.fake, MEMBER, () => expectScreenSafe(env.ctx.apiGoalIssueLinks(n)));
    expect(mine.linked.map((l) => l.itemId)).toEqual([goal.items[0].id]);
    expect(mine.linked[0].mine).toBe(true);
    const other = asUser(env.fake, OTHER, () => env.ctx.apiGoalIssueLinks(n));
    expect(other).toEqual({ linked: [], choices: [] });
    const boss = asUser(env.fake, BOSS, () => env.ctx.apiGoalIssueLinks(n));
    expect(boss.linked).toHaveLength(1);
    expect(boss.linked[0].mine).toBe(false);
  });
});

describe('進み具合とつなぐこと', () => {
  it('つないだやることを済ませると進み、自動の見立てが変わる。同じものを2回つないでも1つ', () => {
    const env = on();
    const goal = okr(env);
    const a = issueFor(env, 'A');
    const b = issueFor(env, 'B');
    asUser(env.fake, MEMBER, () => {
      env.ctx.apiGoalLink(goal.items[0].id, a);
      env.ctx.apiGoalLink(goal.items[0].id, a);
      env.ctx.apiGoalLink(goal.items[0].id, b);
    });
    expect(env.ctx.dbReadAll('goal_links')).toHaveLength(2);
    asUser(env.fake, OWNER, () => env.ctx.apiIssueClose(a));
    let g = asUser(env.fake, MEMBER, () => env.ctx.apiGoalMine('')).goals[0];
    expect(g.items[0].percent).toBe(50);
    expect(g.items[0].remainingText).toBe('あと1件');
    expect(g.percent).toBe(25);
    expect(g.auto.text).toBe('0.3');
    asUser(env.fake, MEMBER, () => env.ctx.apiGoalProgressInput(goal.items[1].id, { actual: 100 }));
    asUser(env.fake, OWNER, () => env.ctx.apiIssueClose(b));
    g = asUser(env.fake, MEMBER, () => env.ctx.apiGoalMine('')).goals[0];
    expect(g.percent).toBe(100);
    expect(g.auto.text).toBe('1.0');
    expect(g.auto.note).toMatch(/低め/);
  });

  it('タグで数える項目は、期の中に本人が完了したタグ付きのやることを数える', () => {
    const env = on();
    const goal = asUser(env.fake, MEMBER, () => env.ctx.apiGoalSave({ kind: 'kpi', title: '改善',
      items: [{ title: '改善を4件', measure: 'label', target: 4, filter: '#改善' }] }));
    const mk = (title, labels, who) => {
      const n = issueFor(env, title, who);
      asUser(env.fake, OWNER, () => { env.ctx.apiIssueUpdate(n, { labels }); env.ctx.apiIssueClose(n); });
      return n;
    };
    mk('当たる', '改善');
    mk('当たる2', '改善,規程');
    mk('タグが違う', '規程');
    mk('ほかの人', '改善', OTHER);
    const old = mk('期の前', '改善');
    env.ctx.dbUpdate('issues', 'number', old, { closedAt: new Date(2000, 0, 1) });
    const g = asUser(env.fake, MEMBER, () => env.ctx.apiGoalMine('')).goals[0];
    expect(g.items[0].done).toBe(2);
    expect(g.items[0].percent).toBe(50);
    expect(g.items[0].remainingText).toBe('あと2件');
    expect(g.auto.grade).toBe('D');
    expect(goal.id).toBe(g.id);
  });

  it('つなげるのは「つないだやることの完了」の項目だけ。捨てたやることはつなげない', () => {
    const env = on();
    const goal = okr(env);
    const n = issueFor(env, 'A');
    asUser(env.fake, MEMBER, () => {
      expectRefused(() => env.ctx.apiGoalLink(goal.items[1].id, n), /項目だけです/);
      expectRefused(() => env.ctx.apiGoalLink(goal.items[0].id, 999), /見つかりません/);
      expectRefused(() => env.ctx.apiGoalProgressInput(goal.items[0].id, { actual: 3 }), /自動で数えます/);
      expectRefused(() => env.ctx.apiGoalProgressInput(goal.items[1].id, { actual: 'たくさん' }), /数を入れてください/);
    });
    asUser(env.fake, OWNER, () => env.ctx.apiIssueArchive(n));
    asUser(env.fake, MEMBER, () => expectRefused(() => env.ctx.apiGoalLink(goal.items[0].id, n), /捨てたもの/));
  });

  it('やることを完全に消すと、結び付きも消える', () => {
    const env = on();
    const goal = okr(env);
    const n = issueFor(env, 'A');
    asUser(env.fake, MEMBER, () => env.ctx.apiGoalLink(goal.items[0].id, n));
    asUser(env.fake, OWNER, () => { env.ctx.apiIssueArchive(n); env.ctx.apiIssuePurge(n); });
    expect(env.ctx.dbReadAll('goal_links')).toHaveLength(0);
  });

  it('外すと結び付きが消え、やることは残る', () => {
    const env = on();
    const goal = okr(env);
    const n = issueFor(env, 'A');
    asUser(env.fake, MEMBER, () => {
      env.ctx.apiGoalLink(goal.items[0].id, n);
      const out = expectScreenSafe(env.ctx.apiGoalUnlink(goal.items[0].id, n));
      expect(out.items[0].links).toEqual([]);
    });
    expect(env.ctx.issueGet(n).title).toBe('A');
  });
});

describe('期末', () => {
  it('振り返り → 評価 → 評価済み。評価のあとは誰も直せず、まとめに全部載る', () => {
    const env = on();
    const goal = okr(env);
    asUser(env.fake, MEMBER, () => env.ctx.apiGoalSubmit(goal.id));
    asUser(env.fake, BOSS, () => env.ctx.apiGoalDecide(goal.id, 'approve', ''));
    // 期の途中で振り返りが無ければ、まだ評価できない (画面と同じ決まり)
    asUser(env.fake, BOSS, () => expectRefused(() => env.ctx.apiGoalGrade(goal.id, 'A', 'よい'), /期が終わったか/));
    asUser(env.fake, MEMBER, () => env.ctx.apiGoalReview(goal.id, '問い合わせは半分になった'));
    asUser(env.fake, BOSS, () => {
      expectRefused(() => env.ctx.apiGoalGrade(goal.id, 'Z', 'x'), /から選んでください/);
      expectRefused(() => env.ctx.apiGoalGrade(goal.id, 'A', ''), /ひとこと/);
    });
    const graded = asUser(env.fake, BOSS, () => expectScreenSafe(env.ctx.apiGoalGrade(goal.id, 'A', 'よく進めました')));
    expect(graded.status).toBe('closed');
    expect(graded.finalGrade).toBe('A');
    expect(graded.gradedBy).toBe(BOSS);
    expect(graded.autoScoreAtGrade).toBe('0.0');
    expect(env.fake._sentMails().some((m) => m.to === MEMBER && /評価が付きました/.test(m.subject))).toBe(true);
    asUser(env.fake, MEMBER, () => {
      expectRefused(() => env.ctx.apiGoalProgressInput(goal.items[1].id, { actual: 1 }), /評価の済んだ目標/);
      expectRefused(() => env.ctx.apiGoalSave({ id: goal.id, kind: 'okr', title: 'x', items: [] }), /評価の済んだ目標/);
    });
    const report = asUser(env.fake, MEMBER, () => expectScreenSafe(env.ctx.apiGoalReport(goal.id)));
    expect(report.text).toContain('# 目標のまとめ: 手続きを速くする');
    expect(report.text).toContain('問い合わせは半分になった');
    expect(report.text).toContain('- 評価: A');
    expect(report.text).toContain('評価を決めるのは上長です');
  });
});

describe('画面に渡せる形か (台帳から Date で返る欄)', () => {
  it('どの API も Date を含まない', () => {
    const env = on();
    const goal = okr(env);
    const n = issueFor(env, 'A');
    asUser(env.fake, MEMBER, () => {
      env.ctx.apiGoalLink(goal.items[0].id, n);
      env.ctx.apiGoalSubmit(goal.id);
    });
    asUser(env.fake, BOSS, () => {
      expectScreenSafe(env.ctx.apiGoalDecide(goal.id, 'approve', 'よい'));
      expectScreenSafe(env.ctx.apiGoalTeam(''));
    });
    asUser(env.fake, MEMBER, () => {
      expectScreenSafe(env.ctx.apiGoalState());
      const mine = expectScreenSafe(env.ctx.apiGoalMine(''));
      expect(mine.goals[0].approvedAt).toMatch(/^\d{4}-/);
      expect(mine.linkable.map((i) => i.number)).toContain(n);
      expectScreenSafe(env.ctx.apiGoalReview(goal.id, 'x'));
      expectScreenSafe(env.ctx.apiGoalDelete(env.ctx.apiGoalSave({ kind: 'okr', title: 'y', items: [] }).id));
    });
  });
});


describe('確認の指摘 (c614b18 のあと)', () => {
  /** 承認済みの OKR (やることを1つつないだもの) */
  function approvedOkr(env) {
    const goal = okr(env);
    asUser(env.fake, MEMBER, () => env.ctx.apiGoalSubmit(goal.id));
    asUser(env.fake, BOSS, () => env.ctx.apiGoalDecide(goal.id, 'approve', ''));
    return goal;
  }

  it('承認済みを直して頼み直すときも、頼むときと同じ検査を通す (項目なし・MBO の重み)', () => {
    const env = on();
    const goal = approvedOkr(env);
    asUser(env.fake, MEMBER, () => expectRefused(() => env.ctx.apiGoalSave({ id: goal.id, kind: 'okr', title: 'x', items: [] }),
      /1つ以上/));
    expect(env.ctx.goalGet_(goal.id).status).toBe('approved');
    const mbo = asUser(env.fake, MEMBER, () => env.ctx.apiGoalSave({ kind: 'mbo', title: 'M', items: [
      { title: 'a', measure: 'check', weight: 60 }, { title: 'b', measure: 'check', weight: 40 }] }));
    asUser(env.fake, MEMBER, () => env.ctx.apiGoalSubmit(mbo.id));
    asUser(env.fake, BOSS, () => env.ctx.apiGoalDecide(mbo.id, 'approve', ''));
    asUser(env.fake, MEMBER, () => expectRefused(() => env.ctx.apiGoalSave({ id: mbo.id, kind: 'mbo', title: 'M', items: [
      { id: mbo.items[0].id, title: 'a', measure: 'check', weight: 60 },
      { id: mbo.items[1].id, title: 'b', measure: 'check', weight: 30 }] }), /合わせて100.*いまは 90/));
    expect(env.ctx.goalGet_(mbo.id).status).toBe('approved');
  });

  it('承認済みを何も変えずに保存しても、承認し直しにならず知らせも出ない', () => {
    const env = on();
    const goal = approvedOkr(env);
    const before = env.fake._sentMails().length;
    const out = asUser(env.fake, MEMBER, () => env.ctx.apiGoalSave({ id: goal.id, kind: 'okr', title: goal.title,
      items: keepItems(goal) }));
    expect(out.status).toBe('approved');
    expect(env.fake._sentMails()).toHaveLength(before);
  });

  it('つなげるのは本人が担当のやること (担当なしなら本人が作ったもの) だけ', () => {
    const env = on();
    const goal = okr(env);
    const others = issueFor(env, 'ほかの人の', OTHER);
    const ownerMade = asUser(env.fake, OWNER, () => env.ctx.apiIssueCreate('持ち主が作った担当なし', '', []).number);
    const selfMade = asUser(env.fake, MEMBER, () => env.ctx.apiIssueCreate('本人が作った担当なし', '', []).number);
    asUser(env.fake, MEMBER, () => {
      expectRefused(() => env.ctx.apiGoalLink(goal.items[0].id, others), /担当/);
      expectRefused(() => env.ctx.apiGoalLink(goal.items[0].id, ownerMade), /担当/);
      env.ctx.apiGoalLink(goal.items[0].id, selfMade);
      const mine = env.ctx.apiGoalMine('');
      expect(mine.linkable.map((i) => i.number)).toContain(selfMade);
      expect(mine.linkable.map((i) => i.number)).not.toContain(others);
    });
    // やることの詳細の「目標につなぐ」も、本人のやることでなければ選べない
    expect(asUser(env.fake, MEMBER, () => env.ctx.apiGoalIssueLinks(others)).choices).toEqual([]);
    expect(asUser(env.fake, MEMBER, () => env.ctx.apiGoalIssueLinks(selfMade)).linked).toHaveLength(1);
  });

  it('期より前に済ませたやることはつなげず、数えもしない', () => {
    const env = on();
    const goal = okr(env);
    const old = issueFor(env, '前の期に済んだ');
    asUser(env.fake, OWNER, () => env.ctx.apiIssueClose(old));
    env.ctx.dbUpdate('issues', 'number', old, { closedAt: new Date(2000, 0, 1) });
    asUser(env.fake, MEMBER, () => {
      expectRefused(() => env.ctx.apiGoalLink(goal.items[0].id, old), /期より前に完了/);
      expect(env.ctx.apiGoalMine('').linkable.map((i) => i.number)).not.toContain(old);
    });
    // 手で台帳に書いた結び付きでも数えない
    env.ctx.dbAppendNumbered('goal_links', 'id', { itemId: goal.items[0].id, issueNumber: old });
    const g = asUser(env.fake, MEMBER, () => env.ctx.apiGoalMine('')).goals[0];
    expect(g.items[0].done).toBe(0);
  });

  it('承認済みから済んだやることを外すと承認し直し、まだのものを外すのは自由', () => {
    const env = on();
    const goal = okr(env);
    const done = issueFor(env, '済んだ');
    const open = issueFor(env, 'まだ');
    asUser(env.fake, MEMBER, () => {
      env.ctx.apiGoalLink(goal.items[0].id, done);
      env.ctx.apiGoalLink(goal.items[0].id, open);
      env.ctx.apiGoalSubmit(goal.id);
    });
    asUser(env.fake, BOSS, () => env.ctx.apiGoalDecide(goal.id, 'approve', ''));
    asUser(env.fake, OWNER, () => env.ctx.apiIssueClose(done));
    const a = asUser(env.fake, MEMBER, () => env.ctx.apiGoalUnlink(goal.items[0].id, open));
    expect(a.status).toBe('approved');
    const mails = env.fake._sentMails().filter((m) => m.to === BOSS).length;
    const b = asUser(env.fake, MEMBER, () => env.ctx.apiGoalUnlink(goal.items[0].id, done));
    expect(b.status).toBe('submitted');
    expect(b.changedAfterApproval).toBe(true);
    expect(env.fake._sentMails().filter((m) => m.to === BOSS)).toHaveLength(mails + 1);
  });

  it('承認を待っている目標を本人が取り下げると下書きに戻り、上長に知らせる', () => {
    const env = on();
    const goal = okr(env);
    asUser(env.fake, MEMBER, () => env.ctx.apiGoalSubmit(goal.id));
    asUser(env.fake, BOSS, () => expectRefused(() => env.ctx.apiGoalWithdraw(goal.id), /本人だけ/));
    const out = asUser(env.fake, MEMBER, () => expectScreenSafe(env.ctx.apiGoalWithdraw(goal.id)));
    expect(out.status).toBe('draft');
    expect(env.fake._sentMails().some((m) => m.to === BOSS && /取り下げ/.test(m.subject))).toBe(true);
    asUser(env.fake, MEMBER, () => expectRefused(() => env.ctx.apiGoalWithdraw(goal.id), /承認を待っている目標だけ/));
  });

  it('上長の欄に自分 (大文字小文字違い) を入れられず、入っていても自分では承認できない', () => {
    const env = on();
    expectRefused(() => env.ctx.memberSet('self@example.com', 'SELF@example.com'), /自分を自分の上長/);
    // 台帳を手で直して自分を上長にしても、承認する人にはならない (持ち主へ倒す)
    env.ctx.dbAppend('members', { email: 'self@example.com', manager: 'Self@Example.com', note: '', updatedAt: new Date(), name: '' });
    const g = asUser(env.fake, 'self@example.com', () => env.ctx.apiGoalSave({ kind: 'kpi', title: 'K', items: [{ title: 'a', measure: 'check' }] }));
    asUser(env.fake, 'self@example.com', () => env.ctx.apiGoalSubmit(g.id));
    asUser(env.fake, 'self@example.com', () => expectRefused(() => env.ctx.apiGoalDecide(g.id, 'approve', ''), /上長だけ/));
    asUser(env.fake, OWNER, () => env.ctx.apiGoalDecide(g.id, 'approve', ''));
  });

  it('上長のいない持ち主は、自分の目標を自分で承認できない', () => {
    const env = on();
    const own = asUser(env.fake, OWNER, () => env.ctx.apiGoalSave({ kind: 'kpi', title: 'K', items: [{ title: 'a', measure: 'check' }] }));
    env.ctx.dbUpdate('goals', 'id', own.id, { status: 'submitted' });
    asUser(env.fake, OWNER, () => expectRefused(() => env.ctx.apiGoalDecide(own.id, 'approve', ''), /上長だけ/));
  });

  it('年度の始まりの月を変えても、立てた目標の期の日付は動かない', () => {
    const env = on();
    const goal = okr(env);
    expect(Number(env.ctx.goalGet_(goal.id).fyStart)).toBe(4);
    const before = env.ctx.goalRangeOf_(env.ctx.goalGet_(goal.id)).start.getTime();
    env.ctx.apiPrefSet('goals.fyStart', 1);
    expect(env.ctx.goalRangeOf_(env.ctx.goalGet_(goal.id)).start.getTime()).toBe(before);
    // 列を足す前の行 (空) は、いまの設定で読む
    env.ctx.dbUpdate('goals', 'id', goal.id, { fyStart: '' });
    const period = String(env.ctx.goalGet_(goal.id).period);
    expect(env.ctx.goalRangeOf_(env.ctx.goalGet_(goal.id)).start.getTime())
      .toBe(env.ctx.goalPeriodRange(period, 1).start.getTime());
    expect(env.ctx.goalPeriodRange(period, 1).start.getTime()).not.toBe(before);
    expect(env.ctx.prefItem_('goals.fyStart').help).toMatch(/立てた目標/);
  });

  it('一度承認された目標は、差し戻されても消せない', () => {
    const env = on();
    const goal = approvedOkr(env);
    asUser(env.fake, MEMBER, () => env.ctx.apiGoalSave({ id: goal.id, kind: 'okr', title: '直した', items: keepItems(goal) }));
    asUser(env.fake, BOSS, () => env.ctx.apiGoalDecide(goal.id, 'return', '戻して'));
    asUser(env.fake, MEMBER, () => expectRefused(() => env.ctx.apiGoalDelete(goal.id), /承認された目標は消せません/));
    expect(env.ctx.dbReadAll('goals')).toHaveLength(1);
  });

  it('知らせの関数は画面から呼べない名前 (末尾 _)', () => {
    const env = on();
    ['notifyGoalSubmitted', 'notifyGoalDecided', 'notifyGoalGraded'].forEach((n) => expect(typeof env.ctx[n]).toBe('undefined'));
    ['notifyGoalSubmitted_', 'notifyGoalDecided_', 'notifyGoalGraded_', 'notifyGoalWithdrawn_']
      .forEach((n) => expect(typeof env.ctx[n]).toBe('function'));
  });

  it('評価したときの OKR の見立ては、台帳に数で入っていても小数1桁で返す', () => {
    const env = on();
    const goal = approvedOkr(env);
    env.ctx.dbUpdate('goals', 'id', goal.id, { autoScore: 1 });
    const g = asUser(env.fake, MEMBER, () => env.ctx.apiGoalMine('')).goals[0];
    expect(g.autoScoreAtGrade).toBe('1.0');
  });

  it('上長の期の選び方には、下の人の目標の期も出る', () => {
    const env = on();
    asUser(env.fake, MEMBER, () => env.ctx.apiGoalSave({ kind: 'kpi', title: '昔', period: '2020H1', items: [] }));
    expect(asUser(env.fake, BOSS, () => env.ctx.apiGoalState()).periods.map((p) => p.key)).toContain('2020H1');
    expect(asUser(env.fake, OTHER, () => env.ctx.apiGoalState()).periods.map((p) => p.key)).not.toContain('2020H1');
  });
});
