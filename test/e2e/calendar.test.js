// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { mountFullstack, createServer, go, click, byText, OWNER } from './fullstack.js';

/*
 * やることを予定に入れるを通しで: 管理者が共有カレンダーを作る → 人を「予定の変更」で共有する → その人が設定でオンにする →
 * 組み直す → ホームに今日の予定が出る。返事は本物のサーバが返す。
 * 入る予定は時刻で変わるので、サーバの今を「今日の 8:00 (東京)」に固定し、土日にも入れる。
 */

const $ = (s) => document.querySelector(s);
const MEMBER = 'member@example.com';

function todayEight() {
  const day = new Date(Date.now() + 9 * 3600000).toISOString().substring(0, 10);
  return new Date(day + 'T08:00:00+09:00');
}

describe('共有カレンダーを作って、今日の予定が出るまで', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('作る → 共有 → オン → 組み直す → ホームに出る → オフで消える', async () => {
    const server = createServer();
    const at = todayEight();
    server.ctx.calendarNow_ = () => new Date(at.getTime());
    server.fake._setUser(OWNER);
    const n = server.ctx.apiIssueCreate('通勤手当の見直し', '', []).number;
    server.ctx.apiIssueUpdate(n, { assignee: MEMBER, plannedHours: 0.25 });

    // 1. 管理者 (持ち主) が設定の画面で共有カレンダーを作る
    const admin = mountFullstack({ server });
    await admin.settle();
    go('settings'); await admin.settle();
    click(byText('#calendar-team button', '共有カレンダーを作る')); await admin.settle();
    const id = server.ctx.calendarSharedId_();
    expect(id).toMatch(/@group\.calendar\.google\.com$/);
    expect($('#calendar-team').textContent).toContain('予定の変更');
    expect($('#calendar-team a.calendar-link').href).toContain('/settings/calendar/');

    // 2. 管理者が Google カレンダーで、その人を「予定の変更」で足す (番頭の外の操作)
    server.fake._calShare(id, MEMBER, 'writer');

    // 3. その人が開く。オフのうちは何も呼ばない
    const me = admin.as(MEMBER);
    await me.settle();
    expect(me.calls.filter((c) => c.name === 'apiCalendarToday')).toEqual([]);
    go('settings'); await me.settle();
    expect($('#calendar-mine').hidden).toBe(true);
    click($('[data-pref="calendar.weekend"] button[role="switch"]')); await me.settle();
    click($('[data-pref="calendar.plan"] button[role="switch"]')); await me.settle();
    expect($('#calendar-mine').hidden).toBe(false);
    expect($('#calendar-mine').textContent).toContain('番頭の予定');

    // 4. 組み直す。共有カレンダーにその人の印付きの予定が入る
    click($('#calendar-mine .calendar-replan')); await me.settle();
    const evs = server.fake._calEvents(id).filter((e) => e.tags.bantoWho === MEMBER);
    expect(evs.map((e) => e.title)).toEqual(['#' + n + ' 通勤手当の見直し', '#' + n + ' 通勤手当の見直し',
      '#' + n + ' 通勤手当の見直し']);

    // 5. ホームに今日の予定が出る
    go('home'); await me.settle();
    const rows = [...document.querySelectorAll('#home-calendar .home-calendar-row')];
    expect(rows.map((r) => r.querySelector('.home-row-when').textContent)).toEqual(['9:00〜9:45', '9:55〜10:40', '10:50〜11:20']);

    // 6. オフにすると、これから先の予定が消え、カードも消える
    go('settings'); await me.settle();
    click($('[data-pref="calendar.plan"] button[role="switch"]')); await me.settle();
    expect(server.fake._calEvents(id).filter((e) => e.tags.bantoWho === MEMBER)).toEqual([]);
    go('home'); await me.settle();
    expect($('#home-calendar').textContent).toBe('');
  }, 60000);
});
