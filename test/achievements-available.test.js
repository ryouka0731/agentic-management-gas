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

  it('予定は共有カレンダーが決まっていない・自分の「やることを予定に入れる」がオフなら取れない', () => {
    const { ctx } = setup();
    expect(off(ctx)['first-calendar']).toContain('共有カレンダー');
    ctx.apiPrefSet('calendar.shared', 'cal@group.calendar.google.com');
    expect(off(ctx)['first-calendar']).toContain('「やることを予定に入れる」');
    props(ctx).setProperty('MYPREF:' + ME, JSON.stringify({ 'calendar.plan': true }));
    expect(off(ctx)['first-calendar']).toBeUndefined();
  });

  it('使われ方で数える実績 (Markdown・日報・探す) は、使われ方の記録が止まっていれば取れない。どの切り替えかを言う', () => {
    const { ctx } = setup();
    for (const k of ['first-markdown', 'first-reportCopy', 'first-search']) expect(off(ctx)[k], k).toBeUndefined();
    ctx.apiPrefSet('usage.self', false);
    for (const k of ['first-markdown', 'first-reportCopy', 'first-search']) expect(off(ctx)[k], k).toContain('「自分の使われ方を記録する」');
    ctx.apiPrefSet('usage.self', null);
    ctx.apiPrefSet('usage.enabled', false);
    expect(off(ctx)['first-search']).toContain('チームの設定「使われ方を記録する」');
  });

  it('集中と推しは、その設定がオフなら取れない。手元の道具はいつも取れる', () => {
    const { ctx } = setup();
    expect(off(ctx)['first-focus']).toContain('「今から始める」');
    expect(off(ctx)['first-oshi']).toBeUndefined();
    expect(off(ctx)['first-kit']).toBeUndefined();
    props(ctx).setProperty('MYPREF:' + ME, JSON.stringify({ 'focus.start': true, 'oshi.on': false }));
    expect(off(ctx)['first-focus']).toBeUndefined();
    expect(off(ctx)['first-oshi']).toContain('「推しに応援してもらう」');
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
