import { describe, it, expect } from 'vitest';
import { makeEnv, asUser, OTHER } from './api/setup.js';

/*
 * やることを予定に入れる: カレンダーの読み書き (src/core/CalendarSync.gs)。
 * 触るのは番頭がその人のために入れた印付きの予定だけ。時刻は東京。2026-10-19 は月曜。
 */

const MEMBER = 'member@example.com';

function tokyo(day, hm) {
  return new Date(day + 'T' + (hm || '00:00') + ':00+09:00');
}
const MON8 = tokyo('2026-10-19', '08:00');

/** 管理者が共有カレンダーを作り、人に「予定の変更」で共有し、その人が予定に入れるをオンにする */
function ready(opts = {}) {
  const env = makeEnv({ file: false });
  const { ctx, fake } = env;
  const status = ctx.apiCalendarCreateShared();
  env.calId = ctx.calendarSharedId_();
  expect(status.sharedSet).toBe(true);
  for (const who of opts.writers || [MEMBER]) fake._calShare(env.calId, who, 'writer');
  for (const who of opts.readers || []) fake._calShare(env.calId, who, 'reader');
  for (const who of opts.on || [MEMBER]) asUser(fake, who, () => ctx.apiPrefSet('calendar.plan', true));
  return env;
}

function task(ctx, who, title, fields) {
  const n = ctx.apiIssueCreate(title, '', []).number;
  ctx.apiIssueUpdate(n, Object.assign({ assignee: who }, fields || {}));
  return n;
}

function planAs(env, who, now) {
  return asUser(env.fake, who, () => env.ctx.calendarPlanFor_(who, now || MON8));
}

const mineOf = (env, who) => env.fake._calEvents(env.calId)
  .filter((e) => e.tags.banto === 'block' && e.tags.bantoWho === who);

describe('組む', () => {
  it('担当のやることを、印を付けて共有カレンダーに入れる', () => {
    const env = ready();
    const n = task(env.ctx, MEMBER, '規程の改定', { plannedHours: 0.25, dueDate: '2026-10-20' });
    task(env.ctx, OTHER, 'ほかの人の', { plannedHours: 1 });
    const out = planAs(env, MEMBER);
    expect(out.ok).toBe(true);
    expect(out.blocks.map((b) => b.issueNumber)).toEqual([n, n, n]);
    const evs = mineOf(env, MEMBER);
    expect(evs).toHaveLength(3);
    expect(evs[0].title).toBe('#' + n + ' 規程の改定');
    expect(evs[0].tags.bantoIssue).toBe(String(n));
    expect(evs[0].description).toMatch(/番頭が組んだ予定です。組み直すと変わります/);
    // 本人の既定のカレンダーには書かない
    expect(env.fake._calEvents(MEMBER)).toEqual([]);
    // 台帳には書かない。組んだ日だけ覚える
    const planned = JSON.parse(env.ctx.PropertiesService.getScriptProperties().getProperty('CAL_PLANNED:' + MEMBER));
    expect(planned).toMatchObject({ day: '2026-10-19', ok: true });
  });

  it('予定の名前を「集中」にできる', () => {
    const env = ready();
    task(env.ctx, MEMBER, '人事の秘密', {});
    asUser(env.fake, MEMBER, () => env.ctx.apiPrefSet('calendar.title', 'generic'));
    planAs(env, MEMBER);
    expect(mineOf(env, MEMBER).map((e) => e.title)).toEqual(['集中 (番頭)']);
    expect(JSON.stringify(env.fake._calEvents(env.calId))).not.toContain('人事の秘密');
  });

  it('担当が大文字で書かれていても本人のものとして読む', () => {
    const env = ready();
    task(env.ctx, 'Member@Example.com', '大文字', {});
    expect(planAs(env, MEMBER).blocks).toHaveLength(1);
  });

  it('閉じたもの・捨てたものは入れない', () => {
    const env = ready();
    const a = task(env.ctx, MEMBER, '閉じた', {});
    const b = task(env.ctx, MEMBER, '捨てた', {});
    env.ctx.issueClose(a, null);
    env.ctx.apiIssueArchive(b);
    expect(planAs(env, MEMBER).blocks).toEqual([]);
  });
});

describe('ほかの予定と重ねない', () => {
  it('本人の既定のカレンダーの会議を避ける。終日と断った予定は避けない', () => {
    const env = ready();
    task(env.ctx, MEMBER, '長い仕事', { plannedHours: 0.5 });
    env.fake._calAddBusy(MEMBER, { start: tokyo('2026-10-19', '09:00'), end: tokyo('2026-10-19', '11:00') });
    env.fake._calAddBusy(MEMBER, { start: tokyo('2026-10-19', '00:00'), end: tokyo('2026-10-20', '00:00'), allDay: true });
    env.fake._calAddBusy(MEMBER, { start: tokyo('2026-10-19', '11:00'), end: tokyo('2026-10-19', '12:00'), declined: true });
    const out = planAs(env, MEMBER);
    expect(out.blocks[0].start).toBe(tokyo('2026-10-19', '11:00').toISOString());
    for (const b of out.blocks) {
      expect(Date.parse(b.start) >= tokyo('2026-10-19', '11:00').getTime()).toBe(true);
    }
  });
});

describe('組み直す', () => {
  it('これから始まる予定を入れ替え、増やさない', () => {
    const env = ready();
    task(env.ctx, MEMBER, 'a', { plannedHours: 0.25 });
    planAs(env, MEMBER);
    const first = mineOf(env, MEMBER).map((e) => e.id);
    planAs(env, MEMBER);
    const second = mineOf(env, MEMBER).map((e) => e.id);
    expect(second).toHaveLength(first.length);
    expect(second.some((id) => first.includes(id))).toBe(false);
  });

  it('いま続いている予定は残し、それと重ねない', () => {
    const env = ready();
    task(env.ctx, MEMBER, 'a', { plannedHours: 0.25 });
    planAs(env, MEMBER);
    const running = mineOf(env, MEMBER)[0];
    expect(running.start).toBe(tokyo('2026-10-19', '09:00').getTime());
    planAs(env, MEMBER, tokyo('2026-10-19', '09:10'));
    const after = mineOf(env, MEMBER);
    expect(after.map((e) => e.id)).toContain(running.id);
    for (const e of after) {
      if (e.id === running.id) continue;
      expect(e.start >= running.end).toBe(true);
    }
  });

  it('印の無い予定・ほかの人の番頭の予定は消さない', () => {
    const env = ready({ writers: [MEMBER, OTHER], on: [MEMBER, OTHER] });
    task(env.ctx, MEMBER, 'mine', {});
    task(env.ctx, OTHER, 'theirs', {});
    planAs(env, OTHER);
    const theirs = mineOf(env, OTHER).map((e) => e.id);
    // 人が手で入れた予定 (印なし)
    const cal = env.ctx.CalendarApp.getCalendarById(env.calId);
    const hand = cal.createEvent('打ち合わせ', tokyo('2026-10-20', '10:00'), tokyo('2026-10-20', '11:00'));
    // 印は似ているが別の人の
    const spoof = cal.createEvent('似せた', tokyo('2026-10-21', '10:00'), tokyo('2026-10-21', '11:00'));
    spoof.setTag('banto', 'block');
    planAs(env, MEMBER);
    planAs(env, MEMBER);
    const ids = env.fake._calEvents(env.calId).map((e) => e.id);
    for (const id of theirs) expect(ids).toContain(id);
    expect(ids).toContain(hand.getId());
    expect(ids).toContain(spoof.getId());
  });
});

describe('入れられないとき', () => {
  it('共有カレンダーが決まっていなければ、何をすればよいかを返す', () => {
    const env = makeEnv({ file: false });
    asUser(env.fake, MEMBER, () => env.ctx.apiPrefSet('calendar.plan', true));
    const out = planAs(env, MEMBER);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/まだ決まっていません.*管理者/);
  });

  it('共有されていなければ「予定の変更」で共有してもらうよう返す', () => {
    const env = ready({ writers: [] });
    task(env.ctx, MEMBER, 'a', {});
    const out = planAs(env, MEMBER);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/開けません.*予定の変更/);
  });

  it('見るだけの共有なら、何も変えずに理由を返す', () => {
    const env = ready({ writers: [MEMBER] });
    task(env.ctx, MEMBER, 'a', { plannedHours: 0.25 });
    planAs(env, MEMBER);
    const before = mineOf(env, MEMBER).map((e) => e.id);
    env.fake._calShare(env.calId, MEMBER, 'reader');
    const out = planAs(env, MEMBER);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/見るだけ.*予定の変更/);
    expect(mineOf(env, MEMBER).map((e) => e.id)).toEqual(before);
  });

  it('オフなら組まない', () => {
    const env = ready({ on: [] });
    task(env.ctx, MEMBER, 'a', {});
    const out = planAs(env, MEMBER);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/オフです/);
    expect(env.fake._calCalls.createEvent).toBe(0);
  });
});

describe('やめる', () => {
  it('オフにすると、これから先の番頭の予定を消す。ほかの人のぶんは残す', () => {
    const env = ready({ writers: [MEMBER, OTHER], on: [MEMBER, OTHER] });
    task(env.ctx, MEMBER, 'mine', { plannedHours: 0.25 });
    task(env.ctx, OTHER, 'theirs', {});
    // 今 (実際の時計) から組む。オフにするのも今
    asUser(env.fake, MEMBER, () => env.ctx.calendarPlanFor_(MEMBER));
    asUser(env.fake, OTHER, () => env.ctx.calendarPlanFor_(OTHER));
    expect(mineOf(env, MEMBER).length).toBeGreaterThan(0);
    asUser(env.fake, MEMBER, () => env.ctx.apiPrefSet('calendar.plan', false));
    expect(mineOf(env, MEMBER)).toEqual([]);
    expect(mineOf(env, OTHER).length).toBeGreaterThan(0);
    expect(env.ctx.PropertiesService.getScriptProperties().getProperty('CAL_PLANNED:' + MEMBER)).toBe(null);
  });

  it('消せなくても設定はオフになる', () => {
    const env = ready();
    task(env.ctx, MEMBER, 'mine', {});
    asUser(env.fake, MEMBER, () => env.ctx.calendarPlanFor_(MEMBER));
    env.fake._calShare(env.calId, MEMBER, 'reader');
    const res = asUser(env.fake, MEMBER, () => env.ctx.apiPrefSet('calendar.plan', false));
    expect(res.effective.calendar.plan).toBe(false);
  });
});

describe('今日の予定', () => {
  it('今日の自分の番頭の予定だけを、やることの名前を添えて返す', () => {
    const env = ready({ writers: [MEMBER, OTHER], on: [MEMBER, OTHER] });
    const n = task(env.ctx, MEMBER, '今日やる', { plannedHours: 0.25 });
    task(env.ctx, OTHER, 'ほか', {});
    planAs(env, MEMBER);
    planAs(env, OTHER);
    const out = asUser(env.fake, MEMBER, () => env.ctx.calendarTodayFor_(MEMBER, MON8));
    expect(out.ok).toBe(true);
    expect(out.blocks.map((b) => [b.issueNumber, b.title])).toEqual([[n, '今日やる'], [n, '今日やる'], [n, '今日やる']]);
    expect(asUser(env.fake, MEMBER, () => env.ctx.calendarTodayFor_(MEMBER, tokyo('2026-10-20', '08:00'))).blocks)
      .toEqual([]);
  });
});

