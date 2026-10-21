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
    // 会議 (9:00-11:00) のあと10分空けてから。断った予定 (11:00-12:00) は避けない
    expect(out.blocks[0].start).toBe(tokyo('2026-10-19', '11:10').toISOString());
    for (const b of out.blocks) {
      expect(Date.parse(b.start) >= tokyo('2026-10-19', '11:10').getTime()).toBe(true);
    }
  });
});

describe('組み直す', () => {
  it('これから始まる予定を入れ替え、増やさない', () => {
    const env = ready();
    task(env.ctx, MEMBER, 'a', { plannedHours: 0.25 });
    planAs(env, MEMBER);
    const first = mineOf(env, MEMBER).map((e) => e.id);
    planAs(env, MEMBER, new Date(MON8.getTime() + 120000));
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
    planAs(env, MEMBER, new Date(MON8.getTime() + 120000));
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
    const out = planAs(env, MEMBER, new Date(MON8.getTime() + 120000));
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


describe('2つの画面で同時に組まない', () => {
  it('組み直しているあいだのもう1つは断り、予定を二重にしない', () => {
    const env = ready();
    task(env.ctx, MEMBER, 'a', { plannedHours: 0.25 });
    const original = env.ctx.calendarPlanBlocks;
    let second = null;
    // 1つ目が並べているあいだに、別の画面がもう1つ頼む
    env.ctx.calendarPlanBlocks = (input) => {
      if (!second) second = env.ctx.calendarPlanFor_(MEMBER, MON8);
      return original(input);
    };
    const first = planAs(env, MEMBER);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('別の画面で組み直しています。少し待ってから開き直してください');
    expect(mineOf(env, MEMBER)).toHaveLength(first.blocks.length);
    // 終わったら印を外す (次は組める)
    env.ctx.calendarPlanBlocks = original;
    expect(planAs(env, MEMBER, new Date(MON8.getTime() + 120000)).ok).toBe(true);
  });

  it('組み直しの途中で落ちても印は外す', () => {
    const env = ready();
    task(env.ctx, MEMBER, 'a', {});
    const original = env.ctx.calendarPlanBlocks;
    env.ctx.calendarPlanBlocks = () => { throw new Error('予期しない'); };
    expect(() => planAs(env, MEMBER)).toThrow(/予期しない/);
    env.ctx.calendarPlanBlocks = original;
    expect(planAs(env, MEMBER, new Date(MON8.getTime() + 120000)).ok).toBe(true);
  });

  it('自動の組み直しは、印の中でその日にもう組んだかを見直す', () => {
    const env = ready();
    task(env.ctx, MEMBER, 'a', {});
    expect(planAs(env, MEMBER).ok).toBe(true);
    const before = mineOf(env, MEMBER).map((e) => e.id);
    const auto = asUser(env.fake, MEMBER, () =>
      env.ctx.calendarPlanFor_(MEMBER, new Date(MON8.getTime() + 3600000), { auto: true }));
    expect(auto).toMatchObject({ ok: true, skipped: true });
    expect(mineOf(env, MEMBER).map((e) => e.id)).toEqual(before);
  });

  it('組めなかった日は「組んだ日」に数えない (次に開いたときにもう一度試す)', () => {
    const env = ready({ writers: [] });
    task(env.ctx, MEMBER, 'a', {});
    env.fake._calShare(env.calId, MEMBER, 'reader');
    expect(planAs(env, MEMBER).ok).toBe(false);
    env.fake._calShare(env.calId, MEMBER, 'writer');
    const auto = asUser(env.fake, MEMBER, () => env.ctx.calendarPlanFor_(MEMBER, MON8, { auto: true }));
    expect(auto.ok).toBe(true);
    expect(auto.skipped).toBeFalsy();
  });
});

describe('続けて押しても組み直さない', () => {
  it('60秒のうちに手で頼んだら、残りの秒を添えて断る', () => {
    const env = ready();
    task(env.ctx, MEMBER, 'a', {});
    planAs(env, MEMBER);
    const again = planAs(env, MEMBER, new Date(MON8.getTime() + 15000));
    expect(again.ok).toBe(false);
    expect(again.waitSeconds).toBe(45);
    expect(again.reason).toMatch(/45秒/);
    expect(planAs(env, MEMBER, new Date(MON8.getTime() + 61000)).ok).toBe(true);
  });
});

describe('書けなかったときの理由', () => {
  it('途中で書けなくなったのは「見るだけ」ではなく、混み合っていると返し、入れたぶんを消す', () => {
    const env = ready();
    task(env.ctx, MEMBER, 'a', { plannedHours: 0.25 });
    env.fake._calFailCreate(env.fake._calCalls.createEvent + 2, 'Service invoked too many times');
    const out = planAs(env, MEMBER);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('カレンダーが混み合っています。あとでもう一度組み直してください');
    expect(mineOf(env, MEMBER)).toEqual([]);
  });

  it('1件目から権限で断られたときだけ「見るだけ」と返す', () => {
    const env = ready();
    task(env.ctx, MEMBER, 'a', {});
    env.fake._calFailCreate(env.fake._calCalls.createEvent + 1, 'Something else broke');
    expect(planAs(env, MEMBER).reason).toMatch(/混み合っています/);
  });
});

describe('人が直した番頭の予定', () => {
  it('動かした・ゲストを足した予定は組み直しでも消さず、埋まっている時間として避ける', () => {
    const env = ready();
    task(env.ctx, MEMBER, 'a', { plannedHours: 0.25 });
    planAs(env, MEMBER);
    const [moved, guested] = mineOf(env, MEMBER).slice(1);
    env.fake._calEdit(moved, { moved: true });
    env.fake._calEdit(guested, { guests: ['boss@example.com'] });
    planAs(env, MEMBER, new Date(MON8.getTime() + 120000));
    const after = mineOf(env, MEMBER);
    expect(after.map((e) => e.id)).toEqual(expect.arrayContaining([moved.id, guested.id]));
    for (const e of after) {
      if (e === moved || e === guested) continue;
      for (const k of [moved, guested]) expect(e.start < k.end && k.start < e.end).toBe(false);
    }
  });
});

describe('やめるときに消せなかったもの', () => {
  it('1件ずつ消し、消せなかった数を返す。覚え書きは必ず消す', () => {
    const env = ready();
    task(env.ctx, MEMBER, 'a', { plannedHours: 0.25 });
    asUser(env.fake, MEMBER, () => env.ctx.calendarPlanFor_(MEMBER));
    const stuck = mineOf(env, MEMBER)[0];
    env.fake._calFailDelete((ev) => ev === stuck);
    const left = asUser(env.fake, MEMBER, () => env.ctx.calendarClearMine_(MEMBER));
    expect(left).toBe(1);
    expect(mineOf(env, MEMBER)).toEqual([stuck]);
    expect(env.ctx.PropertiesService.getScriptProperties().getProperty('CAL_PLANNED:' + MEMBER)).toBe(null);
    // 設定の画面には、消せなかった数を返す
    env.fake._calFailDelete(() => true);
    asUser(env.fake, MEMBER, () => env.ctx.calendarPlanFor_(MEMBER, new Date(Date.now() + 120000)));
    const res = asUser(env.fake, MEMBER, () => env.ctx.apiPrefSet('calendar.plan', false));
    expect(res.calendarLeft).toBeGreaterThan(0);
  });
});

describe('共有カレンダーの会議も避ける', () => {
  it('印の無い予定・ゲストになっている予定は避け、ほかの人の番頭の予定と空き時間の予定は避けない', () => {
    const env = ready({ writers: [MEMBER, OTHER], on: [MEMBER, OTHER] });
    task(env.ctx, MEMBER, 'a', {});
    env.fake._calAddTo(env.calId, { title: 'チームの定例', start: tokyo('2026-10-19', '09:00'), end: tokyo('2026-10-19', '10:00') });
    env.fake._calAddTo(env.calId, { title: '空き', free: true, start: tokyo('2026-10-19', '10:00'), end: tokyo('2026-10-19', '11:00') });
    env.fake._calAddBusy(MEMBER, { free: true, start: tokyo('2026-10-19', '10:00'), end: tokyo('2026-10-19', '11:00') });
    const out = planAs(env, MEMBER);
    // 定例 (9:00-10:00) のあと、10分空けてから
    expect(out.blocks[0].start).toBe(tokyo('2026-10-19', '10:10').toISOString());

    const env2 = ready({ writers: [MEMBER, OTHER], on: [MEMBER, OTHER] });
    task(env2.ctx, MEMBER, 'b', {});
    // ほかの人の番頭の予定 (MEMBER はゲストではない) は避けない。ゲストなら避ける
    env2.fake._calAddTo(env2.calId, { start: tokyo('2026-10-19', '09:00'), end: tokyo('2026-10-19', '10:00'),
      tags: { banto: 'block', bantoWho: OTHER } });
    expect(planAs(env2, MEMBER).blocks[0].start).toBe(tokyo('2026-10-19', '09:00').toISOString());
  });

  it('ゲストになっているほかの人の番頭の予定は避ける', () => {
    const env = ready({ writers: [MEMBER, OTHER], on: [MEMBER, OTHER] });
    task(env.ctx, MEMBER, 'b', {});
    env.fake._calAddTo(env.calId, { start: tokyo('2026-10-19', '09:00'), end: tokyo('2026-10-19', '10:00'),
      tags: { banto: 'block', bantoWho: OTHER }, guests: [MEMBER] });
    expect(planAs(env, MEMBER).blocks[0].start).toBe(tokyo('2026-10-19', '10:10').toISOString());
  });
});

describe('印を付ける前に止まった予定', () => {
  it('説明の最後の行にも印を書き、印 (tag) が無くても本人の予定として入れ直す', () => {
    const env = ready();
    const n = task(env.ctx, MEMBER, 'a', {});
    planAs(env, MEMBER);
    const ev = mineOf(env, MEMBER)[0];
    expect(ev.description.split('\n').pop()).toBe('番頭: ' + MEMBER + ' #' + n);
    // 時間切れで印 (tag) が付かなかった予定
    const orphan = env.fake._calAddTo(env.calId, { start: tokyo('2026-10-20', '09:00'), end: tokyo('2026-10-20', '09:45'),
      description: 'x\n番頭: ' + MEMBER + ' #' + n });
    // 似せた別の人のもの・行の途中にあるものは本人のものではない
    const other = env.fake._calAddTo(env.calId, { start: tokyo('2026-10-21', '09:00'), end: tokyo('2026-10-21', '09:45'),
      description: '番頭: ' + OTHER + ' #' + n });
    planAs(env, MEMBER, new Date(MON8.getTime() + 120000));
    const ids = env.fake._calEvents(env.calId).map((e) => e.id);
    expect(ids).not.toContain(orphan.id);
    expect(ids).toContain(other.id);
  });
});
