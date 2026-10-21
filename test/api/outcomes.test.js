import { describe, it, expect } from 'vitest';
import { makeEnv, expectScreenSafe, expectRefused, asUser, ADMIN, OTHER } from './setup.js';

/*
 * 画面の API: 成果の数 (src/api/Outcomes.gs)。
 *
 * 管理者だけが見る。人の名前もアドレスも返さない。記録した人が3人より少ない週は数を null にする。
 */

/** 先週・先々週 (今日から見て) の月曜 */
function mondays(ctx) {
  const today = ctx.usageDay(new Date());
  const dow = new Date(today + 'T00:00:00Z').getUTCDay();
  const thisMonday = ctx.outcomesShiftDay_(today, -((dow + 6) % 7));
  return [ctx.outcomesShiftDay_(thisMonday, -7), ctx.outcomesShiftDay_(thisMonday, -14)];
}

function place(ctx) {
  const [last, before] = mondays(ctx);
  const row = (day, o) => ctx.dbAppend('outcomes_daily', Object.assign({ day, moved: 0, closedClean: 0,
    mergedClean: 0, reopened: 0, overdue: 0, activePeople: 0, busyErrors: 0, timeoutErrors: 0, fxOff: '' }, o));
  row(last, { moved: 2, closedClean: 1, activePeople: 3, overdue: 1 });
  row(ctx.outcomesShiftDay_(last, 2), { moved: 1, mergedClean: 1, activePeople: 2, busyErrors: 2, overdue: 3, fxOff: 1 });
  row(before, { moved: 7, activePeople: 2 });
  return { last, before };
}

describe('apiOutcomes', () => {
  it('管理者には週ごとの数を返す。3人に届かない週は数を出さない', () => {
    const { ctx, fake } = makeEnv({ file: false });
    const { last, before } = place(ctx);
    const out = asUser(fake, ADMIN, () => expectScreenSafe(ctx.apiOutcomes(2)));
    expect(out.minPeople).toBe(3);
    expect(out.since).toBe(before);
    expect(out.weeks).toHaveLength(2);
    expect(out.weeks[0]).toMatchObject({ start: last, hidden: false, people: 3, moved: 3, closedClean: 1,
      mergedClean: 1, busyErrors: 2, overdue: 3, fxOff: 1, days: 2 });
    expect(out.weeks[1]).toMatchObject({ start: before, hidden: true, people: null, moved: null, overdue: null });
    expect(JSON.stringify(out)).not.toMatch(/@/);
  });

  it('管理者でない人には返さない', () => {
    const { ctx, fake } = makeEnv({ file: false });
    place(ctx);
    asUser(fake, OTHER, () => expectRefused(() => ctx.apiOutcomes(4), /管理者/));
  });

  it('週の数は 1〜26。外れたら8週', () => {
    const { ctx } = makeEnv({ file: false });
    expect(ctx.apiOutcomes(0).weeks).toHaveLength(8);
    expect(ctx.apiOutcomes('x').weeks).toHaveLength(8);
    expect(ctx.apiOutcomes(27).weeks).toHaveLength(8);
    expect(ctx.apiOutcomes(3).weeks).toHaveLength(3);
    expect(ctx.apiOutcomes(3).since).toBe('');
  });
});
