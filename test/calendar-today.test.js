import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';
import { APP_SOURCES } from './sources.js';

/*
 * 命令 calendarToday (やること #99)。手元の VS Code の拡張が、会議の始まる前に知らせて会議の URL を開くために読む。
 * キューは仕掛けた人 (RUNNER) の権限で回る。置いた人が仕掛けた人なら既定のカレンダー、ほかの人なら仕掛けた人に
 * 共有されて登録されているその人のカレンダーだけを読む。時刻は東京。2026-10-28 は水曜。
 */

const RUNNER = 'tester@example.com';
const MEMBER = 'member@example.com';

function tokyo(day, hm) {
  return new Date(day + 'T' + (hm || '00:00') + ':00+09:00');
}

function setup(now) {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...APP_SOURCES);
  ctx.repoInit('agentic-management');
  // トリガーは仕掛けた人として走る (開いている人もその人)
  fake._setUser(RUNNER);
  fake._setEffectiveUser(RUNNER);
  ctx.calendarNow_ = () => now;
  return { ctx, fake };
}

const today = (ctx, by) => ctx.runCommand_({ op: 'calendarToday', args: {} }, by);

describe('今日の予定 (calendarToday)', () => {
  const NOW = tokyo('2026-10-28', '08:30');

  it('今日に始まる予定だけを、始まりの順に返す。終日と断った予定は除く', () => {
    const { ctx, fake } = setup(NOW);
    fake._calAddBusy(RUNNER, { start: tokyo('2026-10-28', '13:00'), end: tokyo('2026-10-28', '14:00'), title: '午後の打ち合わせ' });
    fake._calAddBusy(RUNNER, { start: tokyo('2026-10-28', '09:00'), end: tokyo('2026-10-28', '09:30'), title: '朝会' });
    // 昨日・明日
    fake._calAddBusy(RUNNER, { start: tokyo('2026-10-27', '09:00'), end: tokyo('2026-10-27', '10:00'), title: '昨日' });
    fake._calAddBusy(RUNNER, { start: tokyo('2026-10-29', '00:00'), end: tokyo('2026-10-29', '01:00'), title: '明日' });
    // 昨日から続いている (今日に始まっていない)
    fake._calAddBusy(RUNNER, { start: tokyo('2026-10-27', '23:00'), end: tokyo('2026-10-28', '01:00'), title: '夜通し' });
    // 終日・断った
    fake._calAddBusy(RUNNER, { start: tokyo('2026-10-28'), end: tokyo('2026-10-29'), allDay: true, title: '終日' });
    fake._calAddBusy(RUNNER, { start: tokyo('2026-10-28', '15:00'), end: tokyo('2026-10-28', '16:00'), title: '断った', declined: true });
    const r = today(ctx, RUNNER);
    expect(r.day).toBe('2026-10-28');
    expect(r.events.map((e) => e.title)).toEqual(['朝会', '午後の打ち合わせ']);
    expect(r.events[0].start).toBe(tokyo('2026-10-28', '09:00').toISOString());
    expect(r.events[0].end).toBe(tokyo('2026-10-28', '09:30').toISOString());
    // キューは JSON で運ぶ
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it('会議の URL は場所を先に、無ければ説明から拾う。無ければ null', () => {
    const { ctx, fake } = setup(NOW);
    fake._calAddBusy(RUNNER, { start: tokyo('2026-10-28', '10:00'), end: tokyo('2026-10-28', '10:30'), title: '場所',
      location: 'https://meet.google.com/abc-defg-hij', description: 'https://meet.google.com/zzz-zzzz-zzz' });
    fake._calAddBusy(RUNNER, { start: tokyo('2026-10-28', '11:00'), end: tokyo('2026-10-28', '11:30'), title: '説明',
      description: '参加: <a href="https://meet.google.com/xyz-abcd-efg">こちら</a>。' });
    fake._calAddBusy(RUNNER, { start: tokyo('2026-10-28', '12:00'), end: tokyo('2026-10-28', '12:30'), title: '無し',
      location: '3階の会議室', description: 'https://meet.example.com/abc-defg-hij と http://meet.google.com/plain' });
    const got = today(ctx, RUNNER).events.map((e) => [e.title, e.meetUrl]);
    expect(got).toEqual([
      ['場所', 'https://meet.google.com/abc-defg-hij'],
      ['説明', 'https://meet.google.com/xyz-abcd-efg'],
      ['無し', null],
    ]);
  });

  it('予定の URL は繰り返しでない予定だけ。繰り返しは null', () => {
    const { ctx, fake } = setup(NOW);
    fake._calAddBusy(RUNNER, { id: 'abc123@google.com', start: tokyo('2026-10-28', '10:00'), end: tokyo('2026-10-28', '10:30'), title: '一度' });
    fake._calAddBusy(RUNNER, { id: 'rep@google.com', start: tokyo('2026-10-28', '11:00'), end: tokyo('2026-10-28', '11:30'), title: '毎週', recurring: true });
    const [once, weekly] = today(ctx, RUNNER).events;
    const eid = Buffer.from('abc123 ' + RUNNER).toString('base64').replace(/=+$/, '');
    expect(once.eventUrl).toBe('https://calendar.google.com/calendar/event?eid=' + eid);
    expect(weekly.eventUrl).toBe(null);
  });

  it('ほかの人のぶんは、仕掛けた人に共有されて登録されているときだけ読む。無ければ断る', () => {
    const { ctx, fake } = setup(NOW);
    fake._calAddBusy(MEMBER, { start: tokyo('2026-10-28', '10:00'), end: tokyo('2026-10-28', '10:30'), title: 'メンバーの会議' });
    expect(() => today(ctx, MEMBER)).toThrow('あなたの予定を読めません');
    // 仕掛けた人の予定を、ほかの人に返さない
    fake._calAddBusy(RUNNER, { start: tokyo('2026-10-28', '11:00'), end: tokyo('2026-10-28', '11:30'), title: '持ち主の会議' });
    expect(() => today(ctx, MEMBER)).toThrow('あなたの予定を読めません');
    fake._calShare(MEMBER, RUNNER, 'reader');
    fake.CalendarApp.subscribeToCalendar(MEMBER);
    expect(today(ctx, MEMBER).events.map((e) => e.title)).toEqual(['メンバーの会議']);
  });

  it('置いた人が分からなければ断る', () => {
    const { ctx } = setup(NOW);
    expect(() => today(ctx, '')).toThrow('命令を置いた人が分かりません');
  });

  it('置いた人から見た様子を返す命令 (COMMAND_PERSONAL_OPS) に入っている', () => {
    const { ctx } = setup(NOW);
    expect(ctx.COMMAND_PERSONAL_OPS()).toContain('calendarToday');
  });

  it('大文字のアドレスで置かれても、仕掛けた人の既定のカレンダーを読む', () => {
    const { ctx, fake } = setup(NOW);
    fake._calAddBusy(RUNNER, { start: tokyo('2026-10-28', '10:00'), end: tokyo('2026-10-28', '10:30'), title: '朝' });
    expect(today(ctx, 'Tester@Example.com').events.length).toBe(1);
  });
});
