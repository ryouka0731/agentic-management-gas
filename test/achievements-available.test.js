import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';
import { APP_SOURCES } from './sources.js';

/*
 * この環境では取れない実績 (achUnavailable_)。クリアと「クリアで分かる」の Lv は、取れる実績 (と取った実績) だけで数える。
 * 守ること: 取った実績は取れなくなっても数える (取り上げない)・一度クリアしたら、取れる実績が増えてもクリアのまま・
 * 理由はどの設定をオンにすれば取れるかを言う。
 */

const ME = 'tester@example.com';
const OTHER = 'other@example.com';
const TEAM = ['merged-1', 'merged-10', 'merged-50', 'reviews-1', 'reviews-10', 'reviews-50', 'first-merge', 'first-approve'];

function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...APP_SOURCES);
  ctx.repoInit('agentic-management');
  return { ctx, fake };
}
const props = (ctx) => ctx.PropertiesService.getScriptProperties();
const off = (ctx) => ctx.achUnavailable_(ME);
/** 入れ物のフォルダに編集する人を足す (いっしょに使う人がいる環境) */
function addEditor(ctx, fake, email) {
  // 疑似GASに CacheService は無いので、覚えは使われない (毎回数え直す)
  fake.DriveApp.getFolderById(ctx.repoConfig().rootId)._addEditor(email);
}
/** 疑似の CacheService (期限は覚えて返すだけ) */
function withCache(ctx) {
  const store = new Map();
  ctx.CacheService = { getScriptCache: () => ({
    get: (k) => (store.has(k) ? store.get(k).v : null),
    put: (k, v, ttl) => { store.set(k, { v: String(v), ttl }); },
    remove: (k) => { store.delete(k); },
  }) };
  return store;
}
function gotAll(ctx, keys) {
  const got = {};
  keys.forEach((k) => { got[k] = '2026-10-20'; });
  props(ctx).setProperty('ACH:' + ME, JSON.stringify({ days: { n: 1, last: '2026-10-20' }, got }));
}

describe('この環境では取れない実績', () => {
  it('使う人が1人なら、いっしょに (6つ) と はじめての 承認した・反映した は取れない。ほかの人がいれば取れる', () => {
    const { ctx, fake } = setup();
    const o = off(ctx);
    for (const k of TEAM) expect(o[k], k).toContain('ほかの人');
    addEditor(ctx, fake, OTHER);
    const o2 = off(ctx);
    for (const k of TEAM) expect(o2[k], k).toBeUndefined();
  });

  it('Drive では1人に見えても、台帳にほかの人 (確認・返事・使われ方・担当・やりとり) がいれば1人ではない', () => {
    const rows = [
      ['reviews', { prNumber: 1, reviewer: OTHER, state: 'approve', at: new Date() }],
      ['pulls', { number: 1, title: 'x', state: 'open', author: 'Other@Example.com' }],
      ['usage', { day: '2026-10-20', kind: 'action', target: 'search-open', count: 1, user: OTHER }],
      ['issues', { number: 1, title: 'x', state: 'open', assignee: ME + ',' + OTHER }],
      ['issue_comments', { id: 1, issueNumber: 1, body: 'x', by: OTHER, at: new Date() }],
    ];
    for (const [table, row] of rows) {
      const { ctx } = setup();
      expect(off(ctx)['reviews-1'], table).toBeTruthy();
      ctx.dbAppend(table, row);
      expect(off(ctx)['reviews-1'], table).toBeUndefined();
    }
    // 自分の行だけなら1人のまま (大文字小文字は見ない)
    const { ctx } = setup();
    ctx.dbAppend('pulls', { number: 1, title: 'x', state: 'open', author: 'Tester@Example.com' });
    expect(off(ctx)['reviews-1']).toBeTruthy();
  });

  it('読めないときは1人と言わない (編集する人が読めない・持ち主が分からない・共有ドライブの役割が空)', () => {
    let { ctx, fake } = setup();
    fake.DriveApp.getFolderById(ctx.repoConfig().rootId).getEditors = () => { throw new Error('読めません'); };
    expect(off(ctx)['reviews-1']).toBeUndefined();
    ({ ctx, fake } = setup());
    fake.DriveApp.getFolderById(ctx.repoConfig().rootId)._setOwner('');
    expect(off(ctx)['reviews-1']).toBeUndefined();
    ({ ctx } = setup());
    ctx.repoDriveIdSafe_ = () => 'drive-1';
    ctx.driveMembers_ = () => ({ owners: [], admins: [] });
    expect(off(ctx)['reviews-1']).toBeUndefined();
    // 共有ドライブの役割が自分だけなら1人
    ctx.driveMembers_ = () => ({ owners: [ME], admins: [ME] });
    expect(off(ctx)['reviews-1']).toBeTruthy();
  });

  it('1人か・ほかの人がいるかは10分覚え、読めなかったことは短く覚える', () => {
    const { ctx, fake } = setup();
    const store = withCache(ctx);
    expect(off(ctx)['reviews-1']).toBeTruthy();
    expect(store.get('ACH_PEOPLE:' + ME)).toEqual({ v: 'solo', ttl: 600 });
    // 覚えているあいだは Drive に問い合わせない (人が加わっても、覚えが切れるまで1人のまま)
    fake.DriveApp.getFolderById(ctx.repoConfig().rootId)._addEditor(OTHER);
    expect(off(ctx)['reviews-1']).toBeTruthy();
    store.clear();
    expect(off(ctx)['reviews-1']).toBeUndefined();
    expect(store.get('ACH_PEOPLE:' + ME)).toEqual({ v: 'team', ttl: 600 });
    let asked = 0;
    const one = setup();
    const s2 = withCache(one.ctx);
    one.fake.DriveApp.getFolderById(one.ctx.repoConfig().rootId).getEditors = () => { asked++; throw new Error('読めません'); };
    expect(off(one.ctx)['reviews-1']).toBeUndefined();
    expect(off(one.ctx)['reviews-1']).toBeUndefined();
    expect(asked).toBe(1);
    expect(s2.get('ACH_PEOPLE:' + ME).v).toBe('unknown');
    expect(s2.get('ACH_PEOPLE:' + ME).ttl).toBeLessThanOrEqual(120);
  });

  it('グループ・ドメイン・リンクで共有していれば、名指しの人が1人でも1人と言わない', () => {
    // マイドライブ: 入れ物がリンクやドメインに開いている
    for (const access of ['ANYONE_WITH_LINK', 'DOMAIN', 'DOMAIN_WITH_LINK', 'ANYONE']) {
      const { ctx, fake } = setup();
      expect(off(ctx)['reviews-1'], access).toBeTruthy();
      fake.DriveApp.getFolderById(ctx.repoConfig().rootId)._setAccess(access);
      expect(off(ctx)['reviews-1'], access).toBeUndefined();
    }
    // 共有の広さが読めなければ1人と言わない
    let { ctx, fake } = setup();
    fake.DriveApp.getFolderById(ctx.repoConfig().rootId).getSharingAccess = () => { throw new Error('読めません'); };
    expect(off(ctx)['reviews-1']).toBeUndefined();
    // 共有ドライブ: 管理する人は自分だけでも、グループ・ドメイン・リンクに役割がある
    for (const type of ['group', 'domain', 'anyone']) {
      ({ ctx, fake } = setup());
      ctx.repoDriveIdSafe_ = () => 'drive-1';
      const perms = [{ emailAddress: ME, role: 'organizer', type: 'user' }];
      fake.Drive = fake._makeDrive({ members: { 'drive-1': perms } });
      expect(off(ctx)['reviews-1'], type).toBeTruthy();
      ctx.DRIVE_MEMBERS_MEMO_ = {};
      perms.push(type === 'group' ? { emailAddress: 'team@example.com', role: 'writer', type } : { role: 'reader', type, domain: 'example.com' });
      expect(off(ctx)['reviews-1'], type).toBeUndefined();
    }
  });

  it('確認を頼まれた人 (reviewers) にほかの人がいれば、1人ではない', () => {
    const { ctx } = setup();
    ctx.dbAppend('pulls', { number: 1, title: 'x', state: 'open', author: ME, reviewers: ME + ',' + OTHER });
    expect(off(ctx)['reviews-1']).toBeUndefined();
    const solo = setup();
    solo.ctx.dbAppend('pulls', { number: 1, title: 'x', state: 'open', author: ME, reviewers: ME });
    expect(off(solo.ctx)['reviews-1']).toBeTruthy();
  });

  it('上下関係の名簿にほかの人がいれば、1人ではない', () => {
    const { ctx } = setup();
    ctx.memberSet(OTHER, ME);
    expect(off(ctx)['reviews-1']).toBeUndefined();
  });

  it('目標はチームの設定「目標」がオフなら取れない', () => {
    const { ctx } = setup();
    expect(off(ctx)['first-goal']).toContain('「目標 (OKR・MBO・KPI) を使う」');
    ctx.apiPrefSet('goals.enabled', true);
    expect(off(ctx)['first-goal']).toBeUndefined();
  });

  it('予定は共有カレンダーが決まっていなければ取れない', () => {
    const { ctx } = setup();
    expect(off(ctx)['first-calendar']).toContain('共有カレンダー');
    ctx.apiPrefSet('calendar.shared', 'cal@group.calendar.google.com');
    // 自分の「やることを予定に入れる」は自分の設定なので、取れないことにはしない
    expect(off(ctx)['first-calendar']).toBeUndefined();
  });

  it('使われ方で数える実績 (Markdown・日報・探す) は、チームの「使われ方を記録する」がオフなら取れない', () => {
    const { ctx } = setup();
    for (const k of ['first-markdown', 'first-reportCopy', 'first-search']) expect(off(ctx)[k], k).toBeUndefined();
    ctx.apiPrefSet('usage.enabled', false);
    for (const k of ['first-markdown', 'first-reportCopy', 'first-search']) expect(off(ctx)[k], k).toContain('チームの設定「使われ方を記録する」');
  });

  it('自分の設定で止めているものは、取れないことにしない (自分で切ってクリアできてしまう)。取り方の手がかりだけ出す', () => {
    const { ctx } = setup();
    ctx.apiPrefSet('goals.enabled', true);
    ctx.apiPrefSet('calendar.shared', 'cal@group.calendar.google.com');
    props(ctx).setProperty('MYPREF:' + ME, JSON.stringify({ 'usage.self': false, 'oshi.on': false, 'focus.start': false, 'calendar.plan': false }));
    const o = off(ctx);
    for (const k of ['first-markdown', 'first-reportCopy', 'first-search', 'first-oshi', 'first-focus', 'first-calendar']) {
      expect(o[k], k).toBeUndefined();
    }
    const tips = ctx.achPersonalTips_(ME);
    expect(tips['first-markdown']).toContain('自分の設定「自分の使われ方を記録する」をオンにすると取れます');
    expect(tips['first-oshi']).toContain('「推しに応援してもらう」');
    expect(tips['first-focus']).toContain('「今から始める」');
    expect(tips['first-calendar']).toContain('「やることを予定に入れる」');
    const res = ctx.apiAchievements();
    expect(res.items.find((i) => i.key === 'first-focus')).toMatchObject({ off: false });
    expect(res.items.find((i) => i.key === 'first-focus').hint).toContain('「今から始める」');
    // 自分の設定を切っても、クリアは近づかない
    const offKeys = Object.keys(o);
    gotAll(ctx, ctx.ACHIEVEMENTS().map((a) => a.key).filter((k) => offKeys.indexOf(k) < 0 && k !== 'first-focus'));
    expect(ctx.apiOshiGet().cleared).toBe(false);
  });

  it('手元の道具はいつも取れる', () => {
    const { ctx } = setup();
    expect(off(ctx)['first-kit']).toBeUndefined();
  });

  it('取った実績は、取れなくなっても取れないとは言わない (数に入れる)', () => {
    const { ctx } = setup();
    gotAll(ctx, ['reviews-1']);
    expect(off(ctx)['reviews-1']).toBeUndefined();
    expect(off(ctx)['reviews-10']).toBeTruthy();
  });
});

describe('実績の頁の返事とクリア', () => {
  it('取れないものは off と理由。まとまりの数とクリアまでの数には入れない', () => {
    const { ctx } = setup();
    const res = ctx.apiAchievements();
    const team = res.items.filter((i) => i.group === 'team');
    expect(team.every((i) => i.off && /ほかの人/.test(i.reason))).toBe(true);
    expect(res.groups.find((g) => g.key === 'team')).toMatchObject({ total: 0, got: 0 });
    const offN = res.items.filter((i) => i.off).length;
    expect(res.total).toBe(ctx.ACHIEVEMENTS().length - offN);
    expect(res.got).toBe(res.unlocked.length);
  });

  it('取れる実績のうち、まだのものが3つ以下なら名前と説明を見せる', () => {
    const { ctx } = setup();
    const offKeys = Object.keys(off(ctx));
    const can = ctx.ACHIEVEMENTS().map((a) => a.key).filter((k) => offKeys.indexOf(k) < 0);
    gotAll(ctx, can.slice(0, can.length - 3));
    const res = ctx.apiAchievements();
    const left = res.items.filter((i) => !i.done && !i.off);
    expect(left.length).toBe(3);
    for (const i of left) {
      expect(i.near, i.key).toBe(true);
      expect(i.title, i.key).toBe(ctx.achOf(i.key).title);
    }
    gotAll(ctx, can.slice(0, can.length - 4));
    expect(ctx.apiAchievements().items.filter((i) => !i.done && !i.off).every((i) => !i.near && !i.title)).toBe(true);
  });

  it('手元の道具の実績は、まだでも取り方の手がかりを出す', () => {
    const { ctx } = setup();
    expect(ctx.apiAchievements().items.find((i) => i.key === 'first-kit').hint).toContain('手元の道具');
  });

  it('1人の環境では、取れる実績を全部取ればクリア。「クリアで分かる」の Lv も取れる数で決まる', () => {
    const { ctx } = setup();
    const offKeys = Object.keys(off(ctx));
    expect(offKeys.length).toBeGreaterThan(0);
    const can = ctx.ACHIEVEMENTS().map((a) => a.key).filter((k) => offKeys.indexOf(k) < 0);
    gotAll(ctx, can);
    const o = ctx.apiOshiGet();
    expect(o.cleared).toBe(true);
    expect(o.reveal.maxLevel).toBe(1 + can.length);
  });

  it('一度クリアしたら、あとからほかの人が来て取れる実績が増えても、クリアのまま', () => {
    const { ctx, fake } = setup();
    const offKeys = Object.keys(off(ctx));
    gotAll(ctx, ctx.ACHIEVEMENTS().map((a) => a.key).filter((k) => offKeys.indexOf(k) < 0));
    expect(ctx.apiOshiGet().cleared).toBe(true);
    addEditor(ctx, fake, OTHER);
    expect(off(ctx)['reviews-1']).toBeUndefined();
    expect(ctx.apiOshiGet().cleared).toBe(true);
    // 実績の頁もクリアのまま (いま届いたわけではない)
    expect(ctx.apiAchievements()).toMatchObject({ cleared: true, clearedNow: false });
  });

  it('クリアに届いたその返事だけ clearedNow', () => {
    const { ctx } = setup();
    const offKeys = Object.keys(off(ctx));
    const can = ctx.ACHIEVEMENTS().map((a) => a.key).filter((k) => offKeys.indexOf(k) < 0 && k !== 'days-1');
    props(ctx).setProperty('ACH:' + ME, JSON.stringify({ days: { n: 0, last: '' }, got: Object.fromEntries(can.map((k) => [k, '2026-10-20'])) }));
    expect(ctx.apiAchievements()).toMatchObject({ cleared: false, clearedNow: false });
    expect(ctx.apiAchievementsCheck()).toMatchObject({ cleared: true, clearedNow: true });
    expect(ctx.apiAchievements()).toMatchObject({ cleared: true, clearedNow: false });
  });

  it('まだクリアしていない人は、取れる実績が増えればそのぶん先に延びる', () => {
    const { ctx, fake } = setup();
    addEditor(ctx, fake, OTHER);
    const offKeys = Object.keys(off(ctx));
    const can = ctx.ACHIEVEMENTS().map((a) => a.key).filter((k) => offKeys.indexOf(k) < 0);
    gotAll(ctx, can.filter((k) => TEAM.indexOf(k) < 0));
    expect(ctx.apiOshiGet().cleared).toBe(false);
  });
});
