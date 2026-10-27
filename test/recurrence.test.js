import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';
import { makeEnv, asUser, OWNER, ADMIN, OTHER, expectScreenSafe } from './api/setup.js';

/*
 * 繰り返しのやること (やること #110)。暦の計算は RecurrenceRule.js (ピュア)、台帳と起票は Recurrence.gs、
 * 口は apiRecurrence* と命令 recurrence*。1日1回の回は recurrenceDailyOnce_ (片付けとは別の印)。
 * 日は東京の暦日。2026-10-28 は水曜。
 */

const MEMBER = 'member@example.com';

function tokyo(day, hm) {
  return new Date(day + 'T' + (hm || '09:00') + ':00+09:00');
}

describe('周期の計算 (ピュア)', () => {
  const gas = loadGas('src/core/RecurrenceRule.js');

  it('毎月31日は、30日までの月は30日、2月は28日 (閏年は29日)', () => {
    const r = { kind: 'monthly', day: 31 };
    expect(gas.recurrenceNextOn(r, '2026-01-15')).toBe('2026-01-31');
    expect(gas.recurrenceNextOn(r, '2026-02-01')).toBe('2026-02-28');
    expect(gas.recurrenceNextOn(r, '2028-02-01')).toBe('2028-02-29');
    expect(gas.recurrenceNextOn(r, '2026-04-01')).toBe('2026-04-30');
    // 当日は含む。過ぎていれば次の月
    expect(gas.recurrenceNextOn(r, '2026-01-31')).toBe('2026-01-31');
    expect(gas.recurrenceNextOn(r, '2026-02-28')).toBe('2026-02-28');
    expect(gas.recurrenceNextOn(r, '2026-03-01')).toBe('2026-03-31');
    // 年をまたぐ
    expect(gas.recurrenceNextOn({ kind: 'monthly', day: 10 }, '2026-12-11')).toBe('2027-01-10');
  });

  it('毎週は次のその曜日 (当日を含む)', () => {
    // 2026-10-28 は水曜
    expect(gas.recurrenceNextOn({ kind: 'weekly', weekday: 3 }, '2026-10-28')).toBe('2026-10-28');
    expect(gas.recurrenceNextOn({ kind: 'weekly', weekday: 1 }, '2026-10-28')).toBe('2026-11-02');
    expect(gas.recurrenceNextOn({ kind: 'weekly', weekday: 0 }, '2026-10-28')).toBe('2026-11-01');
    expect(gas.recurrenceNextOn({ kind: 'weekly', weekday: '5' }, '2026-12-30')).toBe('2027-01-01');
  });

  it('毎年は今年のその日、過ぎていれば来年。2月29日は平年は28日', () => {
    expect(gas.recurrenceNextOn({ kind: 'yearly', month: 3, day: 31 }, '2026-10-28')).toBe('2027-03-31');
    expect(gas.recurrenceNextOn({ kind: 'yearly', month: 12, day: 1 }, '2026-10-28')).toBe('2026-12-01');
    expect(gas.recurrenceNextOn({ kind: 'yearly', month: 2, day: 29 }, '2026-10-28')).toBe('2027-02-28');
    expect(gas.recurrenceNextOn({ kind: 'yearly', month: 2, day: 29 }, '2027-03-01')).toBe('2028-02-29');
  });

  it('決まりの確かめ', () => {
    expect(gas.recurrenceRuleCheck({ kind: 'weekly', weekday: 7 })).toMatch(/曜日/);
    expect(gas.recurrenceRuleCheck({ kind: 'monthly', day: 0 })).toMatch(/1〜31/);
    expect(gas.recurrenceRuleCheck({ kind: 'yearly', month: 2, day: 30 })).toMatch(/2月の日は 1〜29/);
    expect(gas.recurrenceRuleCheck({ kind: 'yearly', month: 4, day: 31 })).toMatch(/4月の日は 1〜30/);
    expect(gas.recurrenceRuleCheck({ kind: 'daily' })).toMatch(/毎週・毎月・毎年/);
    expect(gas.recurrenceRuleCheck({ kind: 'monthly', day: '31' })).toBe('');
  });

  it('何日前に入った分だけ対象日を返し、起票した対象日より後しか見ない', () => {
    const r = { kind: 'monthly', day: 31, leadDays: 3 };
    expect(gas.recurrenceDueFor(r, '2026-10-27', '')).toBe('');
    expect(gas.recurrenceDueFor(r, '2026-10-28', '')).toBe('2026-10-31');
    expect(gas.recurrenceDueFor(r, '2026-10-29', '2026-10-31')).toBe('');
    // 当日も起票し直さない
    expect(gas.recurrenceDueFor(r, '2026-10-31', '2026-10-31')).toBe('');
    expect(gas.recurrenceDueFor(r, '2026-11-27', '2026-10-31')).toBe('2026-11-30');
    // 何日前が空なら既定の3日
    expect(gas.recurrenceDueFor({ kind: 'monthly', day: 31 }, '2026-10-28', '')).toBe('2026-10-31');
    expect(gas.recurrenceDueFor({ kind: 'monthly', day: 31, leadDays: 0 }, '2026-10-28', '')).toBe('');
  });

  it('東京の今日と字', () => {
    // UTC では 10-27 の 15:30 = 東京の 10-28 00:30
    expect(gas.recurrenceTodayOf(Date.UTC(2026, 9, 27, 15, 30))).toBe('2026-10-28');
    expect(gas.recurrenceTodayOf(Date.UTC(2026, 9, 27, 14, 59))).toBe('2026-10-27');
    expect(gas.recurrenceRuleText({ kind: 'monthly', day: 31 })).toBe('毎月31日 (無い月は末日)');
    expect(gas.recurrenceRuleText({ kind: 'weekly', weekday: 1 })).toBe('毎週月曜');
    expect(gas.recurrenceRuleText({ kind: 'yearly', month: 3, day: 31 })).toBe('毎年3月31日');
    expect(gas.recurrenceDayLabel('2026-11-03')).toBe('11月3日');
  });
});

/** 片付けが済んだことにして、その日の1日1回の回を回す */
function daily(env, at) {
  const props = env.ctx.PropertiesService.getScriptProperties();
  props.setProperty('ARCHIVE_HOUSEKEPT_ON', env.ctx.recurrenceTodayOf(at.getTime()));
  return env.ctx.recurrenceDailyOnce_(at);
}

function issuesOf(env, id) {
  return env.ctx.dbReadAll('issues').filter((r) => String(r.body).indexOf('繰り返し') >= 0 &&
    (id === undefined || String(r.title).indexOf(id) === 0));
}

describe('1日1回の回で起票する', () => {
  function setup() {
    const env = makeEnv({ file: false });
    const rec = asUser(env.fake, MEMBER, () => env.ctx.apiRecurrenceCreate({
      title: '勤怠の締め', body: '勤怠の表を締める', assignee: MEMBER, kind: 'monthly', day: 31, leadDays: 3,
    }));
    return Object.assign(env, { rec });
  }

  it('対象日が「今日 + 何日前」に入ったら1つだけ作り、期限は対象日。担当が付き、ボードに置く', () => {
    const env = setup();
    expect(daily(env, tokyo('2026-10-27'))).toBe(true);
    expect(issuesOf(env)).toHaveLength(0);

    expect(daily(env, tokyo('2026-10-28'))).toBe(true);
    const made = issuesOf(env);
    expect(made).toHaveLength(1);
    expect(made[0].title).toBe('勤怠の締め (10月31日)');
    expect(env.ctx.plainDay(made[0].dueDate)).toBe('2026-10-31');
    expect(made[0].assignee).toBe(MEMBER);
    expect(String(made[0].body)).toContain('勤怠の表を締める');
    expect(env.ctx.dbFindOne('project_items', 'issueNumber', made[0].number).column).toBe('Backlog');

    const row = env.ctx.dbFindOne('recurrences', 'id', env.rec.id);
    expect(env.ctx.plainDay(row.lastIssuedFor)).toBe('2026-10-31');
    expect(Number(row.lastIssueNumber)).toBe(Number(made[0].number));
  });

  it('同じ日にもう一度回しても、翌日に回しても二度作らない', () => {
    const env = setup();
    daily(env, tokyo('2026-10-28'));
    // 同じ日の2回目は済みの印で回らない
    expect(daily(env, tokyo('2026-10-28', '10:00'))).toBe(false);
    // 済みの印を消しても、行の印 (最後に起票した対象日) で作らない
    env.ctx.PropertiesService.getScriptProperties().deleteProperty('RECURRENCE_ON');
    daily(env, tokyo('2026-10-28', '11:00'));
    daily(env, tokyo('2026-10-29'));
    daily(env, tokyo('2026-10-31'));
    expect(issuesOf(env)).toHaveLength(1);
  });

  it('次の分の本文に前の番号を添える (前の分が未完了でも作る)', () => {
    const env = setup();
    daily(env, tokyo('2026-10-28'));
    const first = issuesOf(env)[0];
    daily(env, tokyo('2026-11-27'));
    const all = issuesOf(env);
    expect(all).toHaveLength(2);
    const second = all.find((r) => r.number !== first.number);
    expect(second.title).toBe('勤怠の締め (11月30日)');
    expect(String(second.body)).toContain('前回: #' + first.number + ' (まだ完了していません)');
    expect(env.ctx.plainDay(second.dueDate)).toBe('2026-11-30');
  });

  it('期限までの日数を入れると、期限は対象日からその日数あと', () => {
    const env = setup();
    asUser(env.fake, MEMBER, () => env.ctx.apiRecurrenceUpdate(env.rec.id, { dueDays: 5 }));
    daily(env, tokyo('2026-10-28'));
    expect(env.ctx.plainDay(issuesOf(env)[0].dueDate)).toBe('2026-11-05');
  });

  it('止めたものは作らない', () => {
    const env = setup();
    asUser(env.fake, MEMBER, () => env.ctx.apiRecurrenceUpdate(env.rec.id, { active: false }));
    daily(env, tokyo('2026-10-28'));
    expect(issuesOf(env)).toHaveLength(0);
  });

  it('片付けが済んでいない日は回らない', () => {
    const env = setup();
    expect(env.ctx.recurrenceDailyOnce_(tokyo('2026-10-28'))).toBe(false);
    expect(issuesOf(env)).toHaveLength(0);
  });

  it('鍵が取れなかった分があれば済みの印を付けず、次の回に作る (作った分は二度作らない)', () => {
    const env = setup();
    const real = env.ctx.recurrenceIssueOne_;
    env.ctx.recurrenceIssueOne_ = () => false;
    daily(env, tokyo('2026-10-28'));
    const props = env.ctx.PropertiesService.getScriptProperties();
    expect(props.getProperty('RECURRENCE_ON')).toBe(null);
    expect(props.getProperty('RECURRENCE_RUNNING')).toBe(null);
    env.ctx.recurrenceIssueOne_ = real;
    daily(env, tokyo('2026-10-28', '09:01'));
    expect(issuesOf(env)).toHaveLength(1);
    expect(props.getProperty('RECURRENCE_ON')).toBe('2026-10-28');
  });

  it('命令キューの回 (processCommandQueue) に乗る', () => {
    const env = setup();
    const { ctx } = env;
    // 本物の時計で回るので、今日が対象日の何日前かの範囲に入るように作り直す
    const today = ctx.recurrenceTodayOf(Date.now());
    const day = Number(today.substring(8, 10));
    asUser(env.fake, MEMBER, () => ctx.apiRecurrenceUpdate(env.rec.id, { day: Math.min(28, day), leadDays: 0 }));
    ctx.processCommandQueue();
    const props = ctx.PropertiesService.getScriptProperties();
    expect(props.getProperty('RECURRENCE_ON')).toBe(today);
    if (day <= 28) expect(issuesOf(env)).toHaveLength(1);
    ctx.processCommandQueue();
    expect(issuesOf(env).length).toBeLessThanOrEqual(1);
  });
});

describe('作る・直す・止める・消す', () => {
  it('誰でも作れる。一覧は画面に渡せる形で、次の対象日を持つ', () => {
    const env = makeEnv({ file: false });
    const rec = asUser(env.fake, OTHER, () => env.ctx.apiRecurrenceCreate({
      title: '社会保険の算定', kind: 'yearly', month: 7, day: 10,
    }));
    expect(rec.createdBy).toBe(OTHER);
    expect(rec.active).toBe(true);
    expect(rec.leadDays).toBe(3);
    const list = expectScreenSafe(asUser(env.fake, OTHER, () => env.ctx.apiRecurrenceList()));
    expect(list).toHaveLength(1);
    expect(list[0].ruleText).toBe('毎年7月10日');
    expect(list[0].canEdit).toBe(true);
    expect(list[0].nextOn).toMatch(/^\d{4}-07-10$/);
  });

  it('直す・止める・消すのは作った人と管理者だけ', () => {
    const env = makeEnv({ file: false });
    const rec = asUser(env.fake, MEMBER, () => env.ctx.apiRecurrenceCreate({
      title: '給与の計算', kind: 'monthly', day: 25,
    }));
    expect(() => asUser(env.fake, OTHER, () => env.ctx.apiRecurrenceUpdate(rec.id, { active: false })))
      .toThrow(/作った繰り返し.*管理者/);
    expect(() => asUser(env.fake, OTHER, () => env.ctx.apiRecurrenceDelete(rec.id))).toThrow(/管理者/);
    const list = asUser(env.fake, OTHER, () => env.ctx.apiRecurrenceList());
    expect(list[0].canEdit).toBe(false);

    expect(asUser(env.fake, ADMIN, () => env.ctx.apiRecurrenceUpdate(rec.id, { active: false })).active).toBe(false);
    expect(asUser(env.fake, MEMBER, () => env.ctx.apiRecurrenceUpdate(rec.id, { active: true, title: '給与の計算と振込' })).title)
      .toBe('給与の計算と振込');
    expect(asUser(env.fake, OWNER, () => env.ctx.apiRecurrenceDelete(rec.id))).toBe(true);
    expect(env.ctx.dbReadAll('recurrences')).toHaveLength(0);
  });

  it('決まりに合わないものは作る前に断る', () => {
    const env = makeEnv({ file: false });
    const make = (f) => () => asUser(env.fake, MEMBER, () => env.ctx.apiRecurrenceCreate(f));
    expect(make({ title: '', kind: 'monthly', day: 1 })).toThrow(/題名/);
    expect(make({ title: 'x', kind: 'monthly', day: 32 })).toThrow(/1〜31/);
    expect(make({ title: 'x', kind: 'weekly' })).toThrow(/曜日/);
    expect(make({ title: 'x', kind: 'monthly', day: 1, leadDays: 400 })).toThrow(/0〜90/);
    expect(make({ title: 'x', kind: 'monthly', day: 1, assignee: 'だれか' })).toThrow(/メールアドレス/);
    expect(env.ctx.dbReadAll('recurrences')).toHaveLength(0);
  });

  it('毎月から毎週に直すと、使わない日の欄は空にする', () => {
    const env = makeEnv({ file: false });
    const rec = asUser(env.fake, MEMBER, () => env.ctx.apiRecurrenceCreate({ title: 'x', kind: 'monthly', day: 5 }));
    const after = asUser(env.fake, MEMBER, () => env.ctx.apiRecurrenceUpdate(rec.id, { kind: 'weekly', weekday: 1 }));
    expect(after.day).toBe('');
    expect(after.weekday).toBe(1);
    expect(after.ruleText).toBe('毎週月曜');
  });
});

describe('手元からの命令', () => {
  it('作った人は置いた人。直すのも置いた人で決める', () => {
    const env = makeEnv({ file: false });
    const { ctx } = env;
    const made = ctx.runCommand_({ op: 'recurrenceCreate', args: { fields: { title: '締め', kind: 'monthly', day: 31 } } }, MEMBER);
    expect(made.createdBy).toBe(MEMBER);
    expect(ctx.runCommand_({ op: 'recurrenceList', args: {} }, MEMBER)).toHaveLength(1);
    expect(() => ctx.runCommand_({ op: 'recurrenceUpdate', args: { id: made.id, patch: { active: false } } }, OTHER))
      .toThrow(/管理者/);
    expect(ctx.runCommand_({ op: 'recurrenceUpdate', args: { id: made.id, patch: { active: false } } }, MEMBER).active)
      .toBe(false);
    expect(ctx.COMMAND_PERSONAL_OPS()).toContain('recurrenceCreate');
    expect(ctx.COMMAND_PERSONAL_OPS()).toContain('recurrenceUpdate');
  });
});
