// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { prefsFixture } from '../dom.js';
import { mount } from './mount.js';

/*
 * 会議の時間 (自分まわりの欄。js-calendar の makeMeetingHoursBox を js-me が置く)。
 * 自分の設定 calendar.meetings をオンにした人が、自分まわりの欄を開いたときだけ apiMeetingHours を呼ぶ。
 * 開いた直後には呼ばない。null (読めない) なら欄を出さない。
 */

const q = (s) => document.querySelector(s);
const callsOf = (app, name) => app.calls.filter((c) => c.name === name);

const HOURS = { week: 3.5, month: 12, half: 40.5, since: '2026-10-01', until: '2026-10-27', count: 31 };

function mountMeetings(on, reply) {
  return mount({
    apiPrefs: prefsFixture({ values: on ? { 'calendar.meetings': true } : {} }),
    apiMeetingHours: reply === undefined ? HOURS : reply,
  });
}

describe('会議の時間', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('オフ (既定) なら自分まわりを開いても呼ばず、欄も出さない', () => {
    const app = mountMeetings(false);
    q('#me-btn').click();
    expect(callsOf(app, 'apiMeetingHours')).toEqual([]);
    expect(q('.me-meetings')).toBe(null);
  });

  it('オンでも開いた直後には呼ばない。自分まわりを開いたときに取り、3つの数と期間を出す', () => {
    const app = mountMeetings(true);
    expect(callsOf(app, 'apiMeetingHours')).toEqual([]);
    q('#me-btn').click();
    expect(callsOf(app, 'apiMeetingHours')).toHaveLength(1);
    const box = q('#me-panel .me-meetings') || q('.me-meetings');
    expect(box.hidden).toBe(false);
    expect([...box.querySelectorAll('.me-meetings-cell')].map((c) => c.textContent))
      .toEqual(['今週3.5時間', '今月12時間', '今半期40.5時間']);
    expect(box.textContent).toContain('2026/10/1〜2026/10/27');
    expect(box.textContent).toContain('31件');
  });

  it('設定が届く前に欄を開いても、届いたら会議の欄だけを出す (欄の全体は描き直さない)', () => {
    let deliver = null;
    const app = mount({
      apiPrefs: () => ({ later: (ok) => { deliver = () => ok(prefsFixture({ values: { 'calendar.meetings': true } })); } }),
      apiMeetingHours: HOURS,
    });
    q('#me-btn').click();
    expect(callsOf(app, 'apiMeetingHours')).toEqual([]);
    const games = callsOf(app, 'apiGameState').length;
    deliver();
    expect(callsOf(app, 'apiMeetingHours')).toHaveLength(1);
    expect(document.querySelectorAll('.me-meetings')).toHaveLength(1);
    expect(q('.me-meetings').hidden).toBe(false);
    expect(q('.me-meetings').textContent).toContain('今半期40.5時間');
    expect(callsOf(app, 'apiGameState')).toHaveLength(games);
  });

  it('読めない (null) なら欄を出さない', () => {
    const app = mountMeetings(true, null);
    q('#me-btn').click();
    expect(callsOf(app, 'apiMeetingHours')).toHaveLength(1);
    const box = q('.me-meetings');
    expect(!box || box.hidden).toBe(true);
  });
});
