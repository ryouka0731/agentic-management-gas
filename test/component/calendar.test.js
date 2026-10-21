// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { prefsFixture } from '../dom.js';
import { mount } from './mount.js';

/*
 * やることを予定に入れる (js-calendar)。自分の設定の calendar.plan をオンにした人の画面にだけ出す。
 * オフのあいだは何も呼ばない。ホームは1日1回だけ黙って組み直す。
 */

const $ = (s) => document.querySelector(s);
const callsOf = (app, name) => app.calls.filter((c) => c.name === name);

/** 今日の、東京の時刻の ISO */
function todayAt(hm) {
  const day = new Date(Date.now() + 9 * 3600000).toISOString().substring(0, 10);
  return new Date(day + 'T' + hm + ':00+09:00').toISOString();
}

const BLOCKS = [
  { issueNumber: 2, title: '通勤手当の見直し', start: todayAt('09:00'), end: todayAt('09:45') },
  { issueNumber: 3, title: '慶弔規程', start: todayAt('09:55'), end: todayAt('10:40') },
];

function today(over) {
  return Object.assign({ enabled: true, ok: true, reason: '', plannedToday: true, blocks: BLOCKS,
    calendarUrl: 'https://calendar.google.com/calendar/r?cid=x' }, over || {});
}

function status(over) {
  return Object.assign({ enabled: true, sharedSet: true, sharedName: '番頭の予定', canOpen: true, canWrite: true,
    reason: '', lastPlanned: '', lastOk: false, calendarUrl: 'https://calendar.google.com/calendar/r?cid=x',
    settingsUrl: 'https://calendar.google.com/calendar/r/settings/calendar/eA', isAdmin: true }, over || {});
}

function mountOn(over, values) {
  return mount(Object.assign({
    apiPrefs: prefsFixture({ values: Object.assign({ 'calendar.plan': true }, values || {}) }),
    apiCalendarToday: today(),
    apiCalendarStatus: status(),
    apiCalendarPlan: { ok: true, reason: '', blocks: BLOCKS, late: [], unplaced: [], calendarUrl: '', lastPlanned: '' },
  }, over || {}));
}

describe('ホームの今日の予定', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('オフなら何も呼ばず、カードも出さない', () => {
    const app = mount();
    expect(callsOf(app, 'apiCalendarToday')).toEqual([]);
    expect(callsOf(app, 'apiCalendarPlan')).toEqual([]);
    expect(callsOf(app, 'apiCalendarStatus')).toEqual([]);
    expect($('#home-calendar').textContent).toBe('');
  });

  it('オンなら今日の予定を時刻つきで並べ、押すとそのやることを開く', () => {
    const app = mountOn();
    const rows = [...document.querySelectorAll('#home-calendar .home-calendar-row')];
    expect(rows.map((r) => r.textContent)).toEqual(['#2 通勤手当の見直し9:00〜9:45', '#3 慶弔規程9:55〜10:40']);
    expect($('#home-calendar .home-section-head').textContent).toBe('今日の予定 (番頭が組んだもの)');
    expect($('#home-calendar a.calendar-link').href).toContain('calendar.google.com');
    // 今日はもう組んであるので、組み直さない
    expect(callsOf(app, 'apiCalendarPlan')).toEqual([]);
    rows[0].click();
    expect(callsOf(app, 'apiIssueList').length).toBeGreaterThan(0);
  });

  it('その日にまだ組んでいなければ、1回だけ黙って組む', () => {
    const app = mountOn({ apiCalendarToday: today({ plannedToday: false }) });
    expect(callsOf(app, 'apiCalendarPlan')).toHaveLength(1);
    expect(document.querySelectorAll('#home-calendar .home-calendar-row')).toHaveLength(2);
    // ホームを開き直しても、同じ日には二度頼まない
    $('.nav-item[data-tab="issues"]').click();
    $('.nav-item[data-tab="home"]').click();
    expect(callsOf(app, 'apiCalendarToday').length).toBeGreaterThan(1);
    expect(callsOf(app, 'apiCalendarPlan')).toHaveLength(1);
  });

  it('組めないときは理由をカードに出し、組みに行かない。失敗してもホームは出る', () => {
    const app = mountOn({ apiCalendarToday: today({ ok: false, plannedToday: false, blocks: [],
      reason: '共有カレンダー「番頭の予定」を開けません。管理者に、あなたのアドレスを「予定の変更」の権限で共有してもらってください' }) });
    expect($('#home-calendar').textContent).toContain('予定の変更');
    expect(callsOf(app, 'apiCalendarPlan')).toEqual([]);

    const broken = mountOn({ apiCalendarToday: new Error('混み合っています') });
    expect($('#home-calendar').textContent).toBe('');
    expect($('#home-turn').textContent).not.toBe('');
    void broken;
  });

  it('前に頼んだぶんの返事では描き直さない', () => {
    const later = [];
    const app = mountOn({ apiCalendarToday: () => ({ later: (ok) => later.push(ok) }) });
    $('.nav-item[data-tab="issues"]').click();
    $('.nav-item[data-tab="home"]').click();
    expect(later).toHaveLength(2);
    later[1](today({ blocks: [BLOCKS[1]] }));
    later[0](today());
    expect(document.querySelectorAll('#home-calendar .home-calendar-row')).toHaveLength(1);
    void app;
  });
});

describe('設定の予定に入れる', () => {
  beforeEach(() => { window.localStorage.clear(); });

  function openSettings() {
    $('.nav-item[data-tab="settings"]').click();
  }

  it('オンなら様子・組み直す・カレンダーで開くを出し、押すと組み直す', () => {
    const app = mountOn({ apiCalendarStatus: status({ lastPlanned: '2026-10-21T00:00:00.000Z', lastOk: true }),
      apiCalendarPlan: { ok: true, reason: '', blocks: BLOCKS, unplaced: [], calendarUrl: '', lastPlanned: '',
        late: [{ number: 3, title: '慶弔規程', due: '2026-10-20' }] } });
    openSettings();
    const panel = $('#calendar-mine');
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toContain('番頭の予定');
    expect(panel.querySelector('.calendar-last').textContent).toContain('最後に組んだのは');
    expect(panel.querySelector('a.calendar-link')).not.toBeNull();
    panel.querySelector('.calendar-replan').click();
    expect(callsOf(app, 'apiCalendarPlan')).toHaveLength(1);
    expect($('#calendar-mine .calendar-late').textContent).toContain('#3 慶弔規程');
  });

  it('組めなかった理由を帯で出し、ボタンを戻す', () => {
    mountOn({ apiCalendarPlan: { ok: false, reason: '「やることを予定に入れる」がオフです', blocks: [], late: [], unplaced: [] } });
    openSettings();
    const btn = $('#calendar-mine .calendar-replan');
    btn.click();
    expect(btn.disabled).toBe(false);
    expect(document.getElementById('snackbar').textContent).toContain('オフです');
  });

  it('オフなら欄を隠す。管理者でなければ様子も尋ねない', () => {
    const app = mount({ apiPrefs: prefsFixture({ canEditTeam: false }) });
    openSettings();
    expect($('#calendar-mine').hidden).toBe(true);
    expect(callsOf(app, 'apiCalendarStatus')).toEqual([]);
    // チームの設定は今の値だけ
    expect($('#calendar-team').textContent).toContain('まだ決まっていません');
    expect($('#calendar-team button')).toBeNull();
  });

  it('管理者は共有カレンダーを作れ、作ったら共有の相手を足す頁を出す', () => {
    let made = false;
    const app = mount({
      apiPrefs: () => prefsFixture({ values: made ? { 'calendar.shared': 'cal1@group.calendar.google.com' } : {} }),
      apiCalendarStatus: () => status({ sharedSet: made }),
      apiCalendarCreateShared: () => { made = true; return status(); },
    });
    openSettings();
    const create = [...document.querySelectorAll('#calendar-team button')].find((b) => b.textContent === '共有カレンダーを作る');
    create.click();
    expect(callsOf(app, 'apiCalendarCreateShared')).toHaveLength(1);
    const team = $('#calendar-team');
    expect(team.textContent).toContain('予定の変更');
    expect(team.querySelector('a.calendar-link').href).toContain('/settings/calendar/');
    expect([...team.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['この ID にする', '外す']);
  });

  it('ID を貼ると、その ID で決める', () => {
    const app = mount({ apiCalendarStatus: status({ sharedSet: false }), apiCalendarSetShared: status() });
    openSettings();
    $('#calendar-team .calendar-id').value = ' x@group.calendar.google.com ';
    [...document.querySelectorAll('#calendar-team button')].find((b) => b.textContent === 'この ID にする').click();
    expect(callsOf(app, 'apiCalendarSetShared').map((c) => c.args)).toEqual([['x@group.calendar.google.com']]);
  });
});

describe('レビューで直したもの (画面)', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('自動の組み直しは {auto: true} で頼み、済んだら今日の予定を取り直して描く', () => {
    let n = 0;
    const app = mountOn({
      apiCalendarToday: () => (++n === 1 ? today({ plannedToday: false, blocks: [] }) : today({ blocks: [BLOCKS[0]] })),
    });
    expect(callsOf(app, 'apiCalendarPlan').map((c) => c.args)).toEqual([[{ auto: true }]]);
    expect(callsOf(app, 'apiCalendarToday')).toHaveLength(2);
    expect(document.querySelectorAll('#home-calendar .home-calendar-row')).toHaveLength(1);
  });

  it('続けて押して断られたら、残りの秒のあいだボタンを押せないままにする', () => {
    mountOn({ apiCalendarPlan: { ok: false, reason: 'さっき組み直したところです。あと45秒待ってください', waitSeconds: 45,
      blocks: [], late: [], unplaced: [] } });
    $('.nav-item[data-tab="settings"]').click();
    const btn = $('#calendar-mine .calendar-replan');
    btn.click();
    expect(btn.disabled).toBe(true);
    expect(document.getElementById('snackbar').textContent).toContain('45秒');
  });

  it('やめたときに消せなかった予定の数を、設定の欄に残す', () => {
    const off = prefsFixture({ values: {} });
    off.calendarLeft = 2;
    mountOn({ apiPrefSet: off });
    $('.nav-item[data-tab="settings"]').click();
    $('[data-pref="calendar.plan"] button[role="switch"]').click();
    const panel = $('#calendar-mine');
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toContain('消せなかった予定が 2 件あります (カレンダーで消してください)');
  });

  it('上限で止まったときは「入りきらない」ではなく、上限で止めたと添える', () => {
    mountOn({ apiCalendarPlan: { ok: true, reason: '', blocks: BLOCKS, late: [], unplaced: [], capped: true } });
    $('.nav-item[data-tab="settings"]').click();
    $('#calendar-mine .calendar-replan').click();
    expect($('#calendar-mine').textContent).toContain('1回に入れられる数');
  });
});
