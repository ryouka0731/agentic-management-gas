import { describe, it, expect } from 'vitest';
import { makeEnv, expectScreenSafe, expectRefused, asUser, OWNER, ADMIN, OTHER } from './setup.js';
import { installCoworkCache } from '../cowork-cache.js';

/*
 * 画面の API: 作業雑談部屋 (src/api/Cowork.gs / src/core/Cowork.gs)。
 *
 * 既定はオフ。部屋を決めるのは管理者だけ。入る・出る・合図は開いている本人のぶんだけで、
 * 返すのは名前だけ (アドレスは返さない)。いる印はキャッシュにだけ置く (docs/dev/permissions.md)。
 */

const MEET = 'https://meet.google.com/abc-defg-hij';
const CHANNEL = 'https://example-team.slack.com/archives/C02GHIJKL';

function env(opts = {}) {
  const e = makeEnv({ file: false });
  const clock = installCoworkCache(e.fake);
  e.fake._setUser(OWNER);
  if (opts.on !== false) e.ctx.apiPrefSet('cowork.enabled', true);
  e.ctx.memberSet(OTHER, '', '小野');
  e.ctx.memberSet(ADMIN, '', '安達');
  e.ctx.apiCoworkSetRooms([{ name: '雑談', link: MEET }, { name: 'もくもく', link: CHANNEL }]);
  return Object.assign(e, { clock });
}

/** 返事の中にアドレスが無い */
function expectNoEmails(v) {
  expect(JSON.stringify(v)).not.toMatch(/@/);
}

describe('作業雑談部屋の入口', () => {
  it('オフ (既定) なら、部屋・入る・出る・合図はどれも断る', () => {
    const e = env({ on: false });
    const id = e.ctx.coworkRooms_()[0].id;
    asUser(e.fake, OTHER, () => {
      expectRefused(() => e.ctx.apiCoworkRooms(), /作業雑談部屋は使っていません/);
      expectRefused(() => e.ctx.apiCoworkEnter(id), /使っていません/);
      expectRefused(() => e.ctx.apiCoworkLeave(id), /使っていません/);
      expectRefused(() => e.ctx.apiCoworkBeat(id), /使っていません/);
    });
    expect(e.clock.store.size).toBe(0);
  });

  it('部屋を決めるのは管理者だけ。管理者はオフのあいだも用意できる', () => {
    const e = env({ on: false });
    asUser(e.fake, OTHER, () => {
      expectRefused(() => e.ctx.apiCoworkSetRooms([{ name: 'x', link: MEET }]), /管理者/);
      expectRefused(() => e.ctx.apiCoworkRoomSettings(), /管理者/);
    });
    const got = asUser(e.fake, ADMIN, () => e.ctx.apiCoworkRoomSettings());
    expectScreenSafe(got);
    expect(got.rooms.map((r) => [r.name, r.link, r.kind])).toEqual([
      ['雑談', MEET, 'Google Meet'], ['もくもく', CHANNEL, 'Slack チャンネル']]);
    expect(got.max).toBe(10);
  });

  it('貼られたリンクの字は残さず、部品から組み直す', () => {
    const e = env();
    const got = e.ctx.apiCoworkSetRooms([{ name: ' 雑談 ', link: '  HTTPS://MEET.GOOGLE.COM/abc-defg-hij/?authuser=1#x ' }]);
    expect(got.rooms[0]).toMatchObject({ name: '雑談', link: MEET });
    const stored = e.fake.PropertiesService.getScriptProperties().getProperty('COWORK_ROOMS');
    expect(stored).not.toContain('authuser');
    expect(JSON.parse(stored)).toEqual([{ name: '雑談', parts: { kind: 'meet', code: 'abc-defg-hij' } }]);
    expectRefused(() => e.ctx.apiCoworkSetRooms([{ name: 'a', link: 'https://meet.google.com.evil.com/abc-defg-hij' }]),
      /Google Meet か Slack のリンクだけ/);
    expectRefused(() => e.ctx.apiCoworkSetRooms('x'), /部屋の一覧/);
  });

  it('入る → ほかの人に名前が見える → 出ると消える。返事にアドレスは入らない', () => {
    const e = env();
    const id = e.ctx.coworkRooms_()[0].id;
    const entered = asUser(e.fake, OTHER, () => e.ctx.apiCoworkEnter(id));
    expectScreenSafe(entered);
    expectNoEmails(entered);
    expect(entered.saved).toBe(true);
    expect(entered.myRoomId).toBe(id);
    expect(entered.rooms[0].people).toEqual([expect.objectContaining({ name: '小野', mine: true, focus: false })]);

    const seen = asUser(e.fake, ADMIN, () => e.ctx.apiCoworkRooms());
    expectScreenSafe(seen);
    expectNoEmails(seen);
    expect(seen.rooms[0].people.map((p) => [p.name, p.mine])).toEqual([['小野', false]]);
    expect(seen.myRoomId).toBe('');
    expect(seen.rooms[0].parts).toEqual({ kind: 'meet', code: 'abc-defg-hij' });
    expect(seen.beatSeconds).toBe(60);
    expect(seen.expireSeconds).toBe(120);

    const left = asUser(e.fake, OTHER, () => e.ctx.apiCoworkLeave(id));
    expectScreenSafe(left);
    expect(left.rooms[0].count).toBe(0);
    expect(asUser(e.fake, ADMIN, () => e.ctx.apiCoworkRooms()).rooms[0].count).toBe(0);
  });

  it('合図が止まると2分で消える。合図が続けば残る', () => {
    const e = env();
    const id = e.ctx.coworkRooms_()[0].id;
    asUser(e.fake, OTHER, () => e.ctx.apiCoworkEnter(id));
    e.clock.advance(60 * 1000);
    expectScreenSafe(asUser(e.fake, OTHER, () => e.ctx.apiCoworkBeat(id)));
    e.clock.advance(100 * 1000);
    expect(e.ctx.apiCoworkRooms().rooms[0].count).toBe(1);
    e.clock.advance(30 * 1000);
    expect(e.ctx.apiCoworkRooms().rooms[0].count).toBe(0);
  });

  it('無い部屋には入れない。誰か分からなければ断る', () => {
    const e = env();
    asUser(e.fake, OTHER, () => {
      expectRefused(() => e.ctx.apiCoworkEnter('rnothere'), /その部屋は見つかりません/);
      expectRefused(() => e.ctx.apiCoworkBeat(''), /見つかりません/);
    });
    asUser(e.fake, '', () => expectRefused(() => e.ctx.apiCoworkRooms(), /誰か分かりません/));
  });

  it('混み合って印を付けられなくても断らず、saved: false で返す', () => {
    const e = env();
    const id = e.ctx.coworkRooms_()[0].id;
    e.fake.LockService = { getScriptLock: () => ({ tryLock: () => false, releaseLock: () => {} }) };
    const got = asUser(e.fake, OTHER, () => e.ctx.apiCoworkEnter(id));
    expect(got.saved).toBe(false);
    expect(got.rooms[0].count).toBe(0);
  });
});
