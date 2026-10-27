import { describe, it, expect } from 'vitest';
import { makeEnv, expectScreenSafe, expectRefused, asUser, snapshotDb, ADMIN, OTHER, OWNER } from './setup.js';

/*
 * 画面の API: お知らせ・1問アンケート・案内 (src/api/Announcement.gs / src/core/Announcement.gs)。
 *
 * 管理者が置き、ホームの上に1つずつ出す。読んだ・答えた・閉じたら次からは出ない。答えは1人1回。
 * 管理者の一覧は選択肢ごとの数だけで、誰が何と答えたかは返さない。
 */

const POLL = { kind: 'poll', title: '忘年会の日', body: 'どちらがよいですか\n(1つ選んでください)',
  options: '12/20|12/27', startAt: '', endAt: '' };
const NOTICE = { kind: 'notice', title: '健康診断のお知らせ', body: '11月に行います', options: '', startAt: '', endAt: '' };

/** 東京の今日から n 日ずらした 'yyyy-MM-dd' */
function day(ctx, n) {
  return ctx.usageDay(new Date(Date.now() + n * 86400000));
}

describe('お知らせを置く', () => {
  it('管理者は置ける。置いたものは本人に出る (本文は平文のまま、置いた人のアドレスは出さない)', () => {
    const { ctx, fake } = makeEnv({ file: false });
    const list = asUser(fake, ADMIN, () => expectScreenSafe(ctx.apiAnnouncementCreate(POLL)));
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ kind: 'poll', title: '忘年会の日', options: ['12/20', '12/27'] });
    const next = asUser(fake, OTHER, () => expectScreenSafe(ctx.apiAnnouncementNext()));
    expect(next).toMatchObject({ kind: 'poll', title: '忘年会の日', body: 'どちらがよいですか\n(1つ選んでください)',
      options: ['12/20', '12/27'] });
    expect(JSON.stringify(next)).not.toMatch(/@/);
  });

  it('管理者でない人は置けない・終えられない・答えの数を見られない', () => {
    const { ctx, fake } = makeEnv({ file: false });
    asUser(fake, ADMIN, () => ctx.apiAnnouncementCreate(NOTICE));
    const before = snapshotDb(ctx, ['announcements']);
    asUser(fake, OTHER, () => {
      expectRefused(() => ctx.apiAnnouncementCreate(NOTICE), /管理者/);
      expectRefused(() => ctx.apiAnnouncementArchive(1), /管理者/);
      expectRefused(() => ctx.apiAnnouncementList(), /管理者/);
    });
    expect(snapshotDb(ctx, ['announcements'])).toEqual(before);
  });

  it('中身の確かめ (種類・題名・選択肢・期間)', () => {
    const { ctx } = makeEnv({ file: false });
    expectRefused(() => ctx.apiAnnouncementCreate(Object.assign({}, NOTICE, { kind: 'x' })), /種類/);
    expectRefused(() => ctx.apiAnnouncementCreate(Object.assign({}, NOTICE, { title: '  ' })), /題名/);
    expectRefused(() => ctx.apiAnnouncementCreate(Object.assign({}, POLL, { options: 'ひとつだけ' })), /選択肢/);
    expectRefused(() => ctx.apiAnnouncementCreate(Object.assign({}, POLL, { options: 'a|a' })), /同じ選択肢/);
    expectRefused(() => ctx.apiAnnouncementCreate(Object.assign({}, NOTICE, { startAt: '11/1' })), /期間/);
    expectRefused(() => ctx.apiAnnouncementCreate(Object.assign({}, NOTICE,
      { startAt: '2026-11-10', endAt: '2026-11-01' })), /終わりの日/);
    expect(ctx.dbReadAll('announcements')).toHaveLength(0);
  });
});

describe('本人に1つずつ出す', () => {
  it('期間の外は出さない (始まる前・終わったあと)。期間の中は出す', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.apiAnnouncementCreate(Object.assign({}, NOTICE, { title: 'まだ', startAt: day(ctx, 2) }));
    ctx.apiAnnouncementCreate(Object.assign({}, NOTICE, { title: 'もう終わった', endAt: day(ctx, -1) }));
    expect(ctx.apiAnnouncementNext()).toBeNull();
    ctx.apiAnnouncementCreate(Object.assign({}, NOTICE, { title: 'いま', startAt: day(ctx, 0), endAt: day(ctx, 0) }));
    expect(ctx.apiAnnouncementNext().title).toBe('いま');
  });

  it('閉じたら出ない。ほかの人にはまだ出る', () => {
    const { ctx, fake } = makeEnv({ file: false });
    ctx.apiAnnouncementCreate(NOTICE);
    const id = ctx.apiAnnouncementNext().id;
    expectScreenSafe(ctx.apiAnnouncementReply(id, 'closed'));
    expect(ctx.apiAnnouncementNext()).toBeNull();
    expect(asUser(fake, OTHER, () => ctx.apiAnnouncementNext()).id).toBe(id);
  });

  it('2つあれば古い順に1つずつ。片づけると次が出る', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.apiAnnouncementCreate(Object.assign({}, NOTICE, { title: '1つ目' }));
    ctx.apiAnnouncementCreate(Object.assign({}, POLL, { title: '2つ目' }));
    const first = ctx.apiAnnouncementNext();
    expect(first.title).toBe('1つ目');
    ctx.apiAnnouncementReply(first.id, '');
    const second = ctx.apiAnnouncementNext();
    expect(second.title).toBe('2つ目');
    ctx.apiAnnouncementReply(second.id, '12/27');
    expect(ctx.apiAnnouncementNext()).toBeNull();
  });

  it('終えたものは出さず、答えも受けない', () => {
    const { ctx, fake } = makeEnv({ file: false });
    ctx.apiAnnouncementCreate(POLL);
    ctx.apiAnnouncementArchive(1);
    asUser(fake, OTHER, () => {
      expect(ctx.apiAnnouncementNext()).toBeNull();
      expectRefused(() => ctx.apiAnnouncementReply(1, '12/20'), /終わっています/);
    });
  });
});

describe('答えは1人1回', () => {
  it('2回答えても1つしか残らず、2回目は前の答えを返す', () => {
    const { ctx, fake } = makeEnv({ file: false });
    ctx.apiAnnouncementCreate(POLL);
    asUser(fake, OTHER, () => {
      expect(ctx.apiAnnouncementReply(1, '12/20')).toMatchObject({ answer: '12/20', already: false });
      expect(ctx.apiAnnouncementReply(1, '12/27')).toMatchObject({ answer: '12/20', already: true });
      expect(ctx.apiAnnouncementReply(1, 'closed')).toMatchObject({ answer: '12/20', already: true });
    });
    const mine = ctx.dbReadAll('announcement_replies').filter((r) => r.who === OTHER);
    expect(mine).toHaveLength(1);
    expect(mine[0].answer).toBe('12/20');
  });

  it('アドレスの大文字小文字が違っても同じ人として数える', () => {
    const { ctx, fake } = makeEnv({ file: false });
    ctx.apiAnnouncementCreate(POLL);
    asUser(fake, 'Other@Example.com', () => ctx.apiAnnouncementReply(1, '12/20'));
    asUser(fake, OTHER, () => {
      expect(ctx.apiAnnouncementNext()).toBeNull();
      expect(ctx.apiAnnouncementReply(1, '12/27').already).toBe(true);
    });
  });

  it('答えがあるか見てから書くまでを、1つの鍵の中で行う', () => {
    const { ctx, fake } = makeEnv({ file: false });
    ctx.apiAnnouncementCreate(POLL);
    // 答えを読むのも書くのも、鍵を持っているあいだ (分けると、ほぼ同時の2回が「まだ無い」と読んで両方書く)
    let held = false;
    const seen = [];
    const realLock = fake.LockService.getScriptLock;
    fake.LockService.getScriptLock = () => ({
      tryLock: () => { held = true; return true; },
      releaseLock: () => { held = false; },
    });
    const realRead = ctx.dbReadAll;
    const realAppend = ctx.dbAppend;
    ctx.dbReadAll = (t) => { if (t === 'announcement_replies') seen.push(['read', held]); return realRead(t); };
    ctx.dbAppend = (t, row) => { if (t === 'announcement_replies') seen.push(['write', held]); return realAppend(t, row); };
    asUser(fake, OTHER, () => ctx.apiAnnouncementReply(1, '12/20'));
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen.filter(([k]) => k === 'write')).toHaveLength(1);
    seen.forEach(([k, h]) => expect(h, k + ' が鍵の外').toBe(true));

    // 鍵が取れなければ、何も書かずに断る
    ctx.dbReadAll = realRead;
    ctx.dbAppend = realAppend;
    fake.LockService.getScriptLock = () => ({ tryLock: () => false, releaseLock: () => {} });
    try {
      asUser(fake, 'c@example.com', () => expectRefused(() => ctx.apiAnnouncementReply(1, '12/20'), /混み合って/));
    } finally {
      fake.LockService.getScriptLock = realLock;
    }
    expect(ctx.dbReadAll('announcement_replies')).toHaveLength(1);
  });

  it('選択肢にない答え・お知らせへの答えの字は断る', () => {
    const { ctx } = makeEnv({ file: false });
    ctx.apiAnnouncementCreate(POLL);
    ctx.apiAnnouncementCreate(NOTICE);
    expectRefused(() => ctx.apiAnnouncementReply(1, '1/1'), /選択肢にない/);
    expectRefused(() => ctx.apiAnnouncementReply(2, 'はい'), /答えられません/);
    expectRefused(() => ctx.apiAnnouncementReply(99, ''), /見つかりません/);
    expect(ctx.dbReadAll('announcement_replies')).toHaveLength(0);
  });
});

describe('答えの数 (管理者)', () => {
  it('選択肢ごとの数・読んだ数・閉じた数だけを返し、誰が答えたかは入れない', () => {
    const { ctx, fake } = makeEnv({ file: false });
    ctx.apiAnnouncementCreate(POLL);
    ctx.apiAnnouncementCreate(NOTICE);
    asUser(fake, OTHER, () => { ctx.apiAnnouncementReply(1, '12/20'); ctx.apiAnnouncementReply(2, ''); });
    asUser(fake, ADMIN, () => { ctx.apiAnnouncementReply(1, '12/20'); ctx.apiAnnouncementReply(2, 'closed'); });
    asUser(fake, 'c@example.com', () => ctx.apiAnnouncementReply(1, '12/27'));
    const out = asUser(fake, ADMIN, () => expectScreenSafe(ctx.apiAnnouncementList()));
    // 新しい順
    expect(out.items.map((i) => i.id)).toEqual([2, 1]);
    const poll = out.items[1];
    expect(poll.counts).toEqual([{ option: '12/20', count: 2 }, { option: '12/27', count: 1 }]);
    expect(poll).toMatchObject({ total: 3, closed: 0, active: true, archived: false });
    expect(out.items[0]).toMatchObject({ read: 1, closed: 1, total: 2 });
    const text = JSON.stringify(out);
    expect(text).not.toMatch(/@/);
    [OWNER, ADMIN, OTHER, 'c@example.com'].forEach((who) => expect(text).not.toContain(who.split('@')[0] + '@'));
    expect(text).not.toMatch(/"who"|createdBy/);
  });

  it('終えても答えの数は残る', () => {
    const { ctx, fake } = makeEnv({ file: false });
    ctx.apiAnnouncementCreate(POLL);
    asUser(fake, OTHER, () => ctx.apiAnnouncementReply(1, '12/27'));
    const out = ctx.apiAnnouncementArchive(1);
    expect(out.items[0]).toMatchObject({ archived: true, active: false, total: 1 });
    // 2回終えても変わらない
    expect(ctx.apiAnnouncementArchive(1).items[0].archived).toBe(true);
    expectRefused(() => ctx.apiAnnouncementArchive(42), /見つかりません/);
  });
});
