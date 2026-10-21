import { describe, it, expect } from 'vitest';
import { makeEnv, expectScreenSafe, expectRefused, asUser, ADMIN, OTHER } from './setup.js';

/*
 * 画面の API: やることを予定に入れる (src/api/Calendar.gs)。
 * 作る・貼るのは管理者だけ。ほかは開いている本人のぶんだけで、アドレスを受けない。
 */

function on(env, who) {
  asUser(env.fake, who, () => env.ctx.apiPrefSet('calendar.plan', true));
}

describe('apiCalendarCreateShared / apiCalendarSetShared', () => {
  it('管理者が作ると、チームの設定に入り、共有の相手を足す頁を返す', () => {
    const { ctx, fake } = makeEnv({ file: false });
    const out = asUser(fake, ADMIN, () => expectScreenSafe(ctx.apiCalendarCreateShared()));
    expect(out).toMatchObject({ sharedSet: true, canOpen: true, canWrite: true, sharedName: '番頭の予定', isAdmin: true });
    const id = ctx.calendarSharedId_();
    expect(id).toMatch(/@group\.calendar\.google\.com$/);
    expect(out.calendarUrl).toBe('https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(id));
    // 2つ目は作らない
    asUser(fake, ADMIN, () => expectRefused(() => ctx.apiCalendarCreateShared(), /もうあります/));
  });

  it('管理者でない人は作れず、貼れない', () => {
    const { ctx, fake } = makeEnv({ file: false });
    asUser(fake, OTHER, () => {
      expectRefused(() => ctx.apiCalendarCreateShared(), /管理者/);
      expectRefused(() => ctx.apiCalendarSetShared('x@group.calendar.google.com'), /管理者/);
      expectRefused(() => ctx.apiPrefSet('calendar.shared', 'x@group.calendar.google.com'), /管理者/);
    });
    expect(ctx.calendarSharedId_()).toBe('');
  });

  it('貼る ID は、押した管理者が開けるものだけ。空なら外す', () => {
    const { ctx, fake } = makeEnv({ file: false });
    const mine = asUser(fake, OTHER, () => ctx.CalendarApp.createCalendar('別のカレンダー').getId());
    asUser(fake, ADMIN, () => {
      expectRefused(() => ctx.apiCalendarSetShared('こわれた'), /ID の形/);
      expectRefused(() => ctx.apiCalendarSetShared(mine), /開けません/);
      fake._calShare(mine, ADMIN, 'writer');
      expect(ctx.apiCalendarSetShared(' ' + mine + ' ').sharedSet).toBe(true);
    });
    expect(ctx.calendarSharedId_()).toBe(mine);
    asUser(fake, ADMIN, () => expect(ctx.apiCalendarSetShared('').sharedSet).toBe(false));
    // 外しても、カレンダーそのものは消さない
    expect(fake._calExists(mine)).toBe(true);
  });
});

describe('apiCalendarStatus', () => {
  it('決まっていなければ理由を返し、管理者でない人には頁の URL を返さない', () => {
    const { ctx, fake } = makeEnv({ file: false });
    const out = asUser(fake, OTHER, () => expectScreenSafe(ctx.apiCalendarStatus()));
    expect(out).toMatchObject({ enabled: false, sharedSet: false, canOpen: false, settingsUrl: '', isAdmin: false });
    expect(out.reason).toMatch(/まだ決まっていません/);
    ctx.apiCalendarCreateShared();
    const member = asUser(fake, OTHER, () => ctx.apiCalendarStatus());
    expect(member.settingsUrl).toBe('');
    expect(member.reason).toMatch(/予定の変更/);
  });

  it('書けたかは、最後に組んだときに書けたかで答える', () => {
    const { ctx, fake } = makeEnv({ file: false });
    ctx.apiCalendarCreateShared();
    fake._calShare(ctx.calendarSharedId_(), OTHER, 'writer');
    on({ ctx, fake }, OTHER);
    expect(asUser(fake, OTHER, () => ctx.apiCalendarStatus()).canWrite).toBe(false);
    asUser(fake, OTHER, () => ctx.apiCalendarPlan());
    const out = asUser(fake, OTHER, () => ctx.apiCalendarStatus());
    expect(out).toMatchObject({ enabled: true, canOpen: true, canWrite: true, lastOk: true });
    expect(out.lastPlanned).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('apiCalendarPlan / apiCalendarToday', () => {
  it('本人のぶんだけを組み、画面に渡せる形で返す', () => {
    const env = makeEnv({ file: false });
    const { ctx, fake } = env;
    ctx.apiCalendarCreateShared();
    fake._calShare(ctx.calendarSharedId_(), OTHER, 'writer');
    on(env, OTHER);
    const n = ctx.apiIssueCreate('規程', '', []).number;
    ctx.apiIssueUpdate(n, { assignee: OTHER, plannedHours: 0.25 });
    ctx.apiIssueUpdate(ctx.apiIssueCreate('持ち主の', '', []).number, { assignee: 'tester@example.com' });
    const out = asUser(fake, OTHER, () => expectScreenSafe(ctx.apiCalendarPlan()));
    expect(out.ok).toBe(true);
    expect(out.blocks.every((b) => b.issueNumber === n && b.title === '規程')).toBe(true);
    expect(out.calendarUrl).toMatch(/^https:\/\/calendar\.google\.com\//);
    // 入口はアドレスを受けない
    // apiCalendarPlan が受けるのは {auto} だけ。字 (アドレス) を渡しても開いている本人のぶんを組む
    const named = asUser(fake, OTHER, () => ctx.apiCalendarPlan('tester@example.com'));
    expect(named.blocks.every((b) => b.issueNumber === n)).toBe(true);
    expect(ctx.apiCalendarToday.length).toBe(0);
    expect(ctx.apiCalendarStatus.length).toBe(0);
    const today = asUser(fake, OTHER, () => expectScreenSafe(ctx.apiCalendarToday()));
    expect(today).toMatchObject({ enabled: true, ok: true, plannedToday: true });
  });

  it('オフのあいだは、今日の予定を尋ねてもカレンダーを開かない', () => {
    const { ctx, fake } = makeEnv({ file: false });
    ctx.apiCalendarCreateShared();
    const before = fake._calCalls.getEvents;
    const out = asUser(fake, OTHER, () => expectScreenSafe(ctx.apiCalendarToday()));
    expect(out).toMatchObject({ enabled: false, ok: false, blocks: [] });
    expect(fake._calCalls.getEvents).toBe(before);
  });

  it('開けないときは投げずに理由を返す (ホームを壊さない)', () => {
    const { ctx, fake } = makeEnv({ file: false });
    ctx.apiCalendarCreateShared();
    on({ ctx, fake }, OTHER);
    const out = asUser(fake, OTHER, () => expectScreenSafe(ctx.apiCalendarPlan()));
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/予定の変更/);
    const today = asUser(fake, OTHER, () => ctx.apiCalendarToday());
    expect(today.ok).toBe(false);
    expect(today.reason).toMatch(/予定の変更/);
  });
});

describe('レビューで直したもの (API)', () => {
  it('共有の相手を足す頁は web-safe な base64 で /u/0/ の形', () => {
    const { ctx, fake } = makeEnv({ file: false });
    const out = asUser(fake, ADMIN, () => ctx.apiCalendarCreateShared());
    const id = ctx.calendarSharedId_();
    expect(out.settingsUrl).toBe('https://calendar.google.com/calendar/u/0/r/settings/calendar/' +
      Buffer.from(id).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
  });

  it('apiCalendarPlan は {auto: true} を受け、その日に組んであれば組み直さない', () => {
    const { ctx, fake } = makeEnv({ file: false });
    ctx.apiCalendarCreateShared();
    ctx.apiPrefSet('calendar.plan', true);
    ctx.apiIssueUpdate(ctx.apiIssueCreate('a', '', []).number, { assignee: 'tester@example.com' });
    expect(ctx.apiCalendarPlan().ok).toBe(true);
    const made = fake._calCalls.createEvent;
    const auto = expectScreenSafe(ctx.apiCalendarPlan({ auto: true }));
    expect(auto).toMatchObject({ ok: true, skipped: true });
    expect(fake._calCalls.createEvent).toBe(made);
  });

  it('様子を尋ねるだけでは登録しに行かない (開くたびに登録を試さない)', () => {
    const { ctx, fake } = makeEnv({ file: false });
    ctx.apiCalendarCreateShared();
    let subs = 0;
    const orig = ctx.CalendarApp.subscribeToCalendar;
    ctx.CalendarApp.subscribeToCalendar = (id) => { subs++; return orig(id); };
    // 共有されていない人・共有されたがまだ登録していない人
    asUser(fake, OTHER, () => ctx.apiCalendarStatus());
    fake._calShare(ctx.calendarSharedId_(), OTHER, 'writer');
    const out = asUser(fake, OTHER, () => ctx.apiCalendarStatus());
    expect(subs).toBe(0);
    expect(out.reason).toMatch(/予定を組み直す/);
    // 組み直すときには登録する
    on({ ctx, fake }, OTHER);
    asUser(fake, OTHER, () => ctx.apiCalendarPlan());
    expect(subs).toBe(1);
    expect(asUser(fake, OTHER, () => ctx.apiCalendarStatus()).canOpen).toBe(true);
  });
});
