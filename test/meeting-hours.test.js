import { describe, it, expect } from 'vitest';
import { loadGas } from './harness.js';
import { makeEnv, asUser, OTHER } from './api/setup.js';

/*
 * 会議の時間 (自分まわりの欄)。本人の既定のカレンダーから、相手がいて断っていない・終日でない予定を足す。
 * 期間の切り方は CalendarPlan.js (ピュア)、読むのは CalendarSync.gs の meetingHoursOf_、口は apiMeetingHours。
 * 時刻は東京。2026-10-27 は火曜。
 */

const MEMBER = 'member@example.com';

function tokyo(day, hm) {
  return new Date(day + 'T' + (hm || '00:00') + ':00+09:00');
}

describe('期間の切り方 (ピュア)', () => {
  const gas = loadGas('src/core/CalendarPlan.js');
  const at = (day, hm) => gas.meetingPeriodsOf(tokyo(day, hm).getTime());

  it('週は月曜、月は1日から (東京の0時)', () => {
    const p = at('2026-10-27', '15:00');
    expect(p.week).toBe(tokyo('2026-10-26').getTime());
    expect(p.month).toBe(tokyo('2026-10-01').getTime());
    // 日曜は前の月曜から
    expect(at('2026-11-01', '10:00').week).toBe(tokyo('2026-10-26').getTime());
    // 東京では月曜になったばかり (UTC ではまだ日曜)
    expect(at('2026-10-26', '01:00').week).toBe(tokyo('2026-10-26').getTime());
  });

  it('半期は 4〜9月 と 10〜3月。3/31→4/1、9/30→10/1 で切り替わる', () => {
    expect(at('2027-03-31', '23:59').half).toBe(tokyo('2026-10-01').getTime());
    expect(at('2027-04-01', '00:00').half).toBe(tokyo('2027-04-01').getTime());
    expect(at('2026-09-30', '23:59').half).toBe(tokyo('2026-04-01').getTime());
    expect(at('2026-10-01', '00:00').half).toBe(tokyo('2026-10-01').getTime());
    expect(at('2027-01-15', '12:00').half).toBe(tokyo('2026-10-01').getTime());
  });

  it('重なった時間は1つ分。期間の外は切る', () => {
    const list = [
      { start: tokyo('2026-10-27', '10:00').getTime(), end: tokyo('2026-10-27', '11:00').getTime() },
      { start: tokyo('2026-10-27', '10:30').getTime(), end: tokyo('2026-10-27', '11:30').getTime() },
      { start: tokyo('2026-10-27', '10:00').getTime(), end: tokyo('2026-10-27', '11:00').getTime() },
    ];
    expect(gas.meetingMinutesIn(list, 0, Infinity)).toBe(90);
    expect(gas.meetingMinutesIn(list, tokyo('2026-10-27', '11:00').getTime(), Infinity)).toBe(30);
    expect(gas.meetingHoursOfMinutes(90)).toBe(1.5);
    expect(gas.meetingHoursOfMinutes(20)).toBe(0.3);
  });
});

/** 会議の時間をオンにした人の環境。今は now */
function ready(now, on = true) {
  const env = makeEnv({ file: false });
  env.ctx.calendarNow_ = () => now;
  if (on) asUser(env.fake, MEMBER, () => env.ctx.apiPrefSet('calendar.meetings', true));
  return env;
}
const hoursAs = (env) => asUser(env.fake, MEMBER, () => env.ctx.apiMeetingHours());
const meeting = (env, day, from, to, more) => env.fake._calAddBusy(MEMBER, Object.assign({
  start: tokyo(day, from), end: tokyo(day, to), guests: [OTHER] }, more || {}));

describe('会議として数えるもの', () => {
  const NOW = tokyo('2026-10-27', '18:00');

  it('相手がいて断っていない予定だけ。ひとりの予定・断った・終日は数えない', () => {
    const env = ready(NOW);
    meeting(env, '2026-10-27', '09:00', '10:00');
    // 人から呼ばれた会議 (ゲストは自分だけで、主催者は相手)
    meeting(env, '2026-10-27', '13:00', '13:30', { guests: [MEMBER], organizer: OTHER });
    // ひとりの予定
    meeting(env, '2026-10-27', '14:00', '15:00', { guests: [] });
    // 断った
    meeting(env, '2026-10-27', '15:00', '16:00', { declined: true });
    // 取り込んだ・写した予定で、本人がゲストにも作った人にも居ない (相手だけが居る)
    meeting(env, '2026-10-27', '16:00', '17:00', { guests: ['c@example.com'], organizer: OTHER });
    // 終日
    env.fake._calAddBusy(MEMBER, { start: tokyo('2026-10-27'), end: tokyo('2026-10-28'), allDay: true, guests: [OTHER] });
    const out = hoursAs(env);
    expect(out).toEqual({ week: 1.5, month: 1.5, half: 1.5, since: '2026-10-01', until: '2026-10-27', count: 2 });
    // 数と期間だけ。題名も相手も返さない
    expect(JSON.stringify(out)).not.toContain('会議');
    expect(JSON.stringify(out)).not.toContain(OTHER);
  });

  it('重なった時間は二重に数えない', () => {
    const env = ready(NOW);
    meeting(env, '2026-10-27', '10:00', '11:00');
    meeting(env, '2026-10-27', '10:00', '11:00', { guests: ['c@example.com'] });
    meeting(env, '2026-10-27', '10:30', '12:00');
    expect(hoursAs(env).week).toBe(2);
  });

  it('今週・今月・今半期に分けて足し、まだ始まっていない会議は数えない', () => {
    const env = ready(NOW);
    meeting(env, '2026-10-27', '09:00', '10:00');
    meeting(env, '2026-10-20', '09:00', '11:00');
    meeting(env, '2026-10-02', '09:00', '09:30');
    // 前の半期
    meeting(env, '2026-09-30', '22:00', '23:00');
    // これから
    meeting(env, '2026-10-28', '09:00', '10:00');
    const out = hoursAs(env);
    expect([out.week, out.month, out.half, out.count]).toEqual([1, 3.5, 3.5, 3]);
  });

  it('週が前の半期から始まる (4/1 が木曜) ときも、週の合計は月曜から数える', () => {
    const env = ready(tokyo('2027-04-01', '12:00'));
    // 2027-03-29 (月) の会議は今週に入るが、今半期には入らない
    meeting(env, '2027-03-29', '10:00', '11:00');
    meeting(env, '2027-04-01', '09:00', '09:30');
    const out = hoursAs(env);
    expect([out.week, out.month, out.half, out.count]).toEqual([1.5, 0.5, 0.5, 1]);
  });

  it('半期の境 (3/31→4/1) をまたぐ会議は、4/1 からのぶんだけ数える', () => {
    const env = ready(tokyo('2027-04-01', '12:00'));
    meeting(env, '2027-03-31', '23:00', '23:30');
    env.fake._calAddBusy(MEMBER, { start: tokyo('2027-03-31', '23:30'), end: tokyo('2027-04-01', '01:00'), guests: [OTHER] });
    const out = hoursAs(env);
    expect(out.half).toBe(1);
    expect(out.since).toBe('2027-04-01');
  });
});

describe('覚えと、読めないとき', () => {
  const NOW = tokyo('2026-10-27', '18:00');

  it('2回目はカレンダーを読まない (同じ日のうち)。日が変われば読み直す', () => {
    const env = ready(NOW);
    meeting(env, '2026-10-27', '09:00', '10:00');
    hoursAs(env);
    const reads = env.fake._calCalls.getEvents;
    expect(hoursAs(env).week).toBe(1);
    expect(env.fake._calCalls.getEvents).toBe(reads);
    // ほかの人は自分の覚えを使わない
    asUser(env.fake, OTHER, () => env.ctx.apiPrefSet('calendar.meetings', true));
    expect(asUser(env.fake, OTHER, () => env.ctx.apiMeetingHours()).week).toBe(0);
    expect(env.fake._calCalls.getEvents).toBe(reads + 1);
    env.ctx.calendarNow_ = () => tokyo('2026-10-28', '09:00');
    hoursAs(env);
    expect(env.fake._calCalls.getEvents).toBe(reads + 2);
  });

  it('読めないときは断らず null。覚えない', () => {
    const env = ready(NOW);
    const real = env.fake.CalendarApp.getDefaultCalendar;
    env.fake.CalendarApp.getDefaultCalendar = () => { throw new Error('Action not allowed'); };
    expect(hoursAs(env)).toBe(null);
    env.fake.CalendarApp.getDefaultCalendar = real;
    expect(hoursAs(env)).not.toBe(null);
  });

  it('設定がオフ (既定) なら null で、カレンダーを開かない', () => {
    const env = ready(NOW, false);
    meeting(env, '2026-10-27', '09:00', '10:00');
    const reads = env.fake._calCalls.getEvents;
    const opens = env.fake._calCalls.getDefaultCalendar;
    expect(hoursAs(env)).toBe(null);
    expect(env.fake._calCalls.getEvents).toBe(reads);
    expect(env.fake._calCalls.getDefaultCalendar).toBe(opens);
  });

  it('覚えの鍵はアドレスを指紋にする (長いアドレスでも鍵の上限を超えない)', () => {
    const env = ready(NOW);
    const key = env.ctx.meetingCacheKey_('a'.repeat(300) + '@example.com', NOW.getTime());
    expect(key.length).toBeLessThan(250);
    expect(key).not.toContain('example.com');
    expect(key).not.toBe(env.ctx.meetingCacheKey_(MEMBER, NOW.getTime()));
  });

  it('別の実行が先に覚えていれば上書きしない', () => {
    const env = ready(NOW);
    meeting(env, '2026-10-27', '09:00', '10:00');
    const key = env.ctx.meetingCacheKey_(MEMBER, NOW.getTime());
    const cache = env.ctx.CacheService.getScriptCache();
    const realGet = cache.get;
    // 1回目の get (覚えを見る) は空、2回目 (書く前) には別の実行の覚えがある
    let n = 0;
    const newer = JSON.stringify({ week: 9, month: 9, half: 9, since: '2026-10-01', until: '2026-10-27', count: 9 });
    cache.get = (k) => (k === key ? (++n === 1 ? null : newer) : realGet.call(cache, k));
    asUser(env.fake, MEMBER, () => env.ctx.meetingHoursOf_(MEMBER));
    cache.get = realGet;
    expect(cache.get(key)).toBe(null);
  });
});
