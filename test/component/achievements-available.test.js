// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prefsFixture } from '../dom.js';
import { mount } from './mount.js';
import { loadGasWith } from '../harness.js';
import { createFakeGas } from '../fakegas.js';
import { APP_SOURCES } from '../sources.js';

/*
 * 実績の頁の「この環境では取れません」と、残りが少ないときの手がかり。返事は本物のサーバ (疑似GAS) から作る。
 * 疑似GASの入れ物は持ち主1人なので、いっしょに の実績は取れない。
 */

const ME = 'tester@example.com';
const wire = (v) => JSON.parse(JSON.stringify(v));

function server() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...APP_SOURCES);
  ctx.repoInit('agentic-management');
  return ctx;
}
function gotAll(ctx, keys) {
  const got = {};
  keys.forEach((k) => { got[k] = '2026-10-20'; });
  ctx.PropertiesService.getScriptProperties().setProperty('ACH:' + ME, JSON.stringify({ days: { n: 1, last: '2026-10-20' }, got }));
}
function mountAch(ctx) {
  const res = wire(ctx.apiAchievements());
  return mount({
    apiPrefs: prefsFixture({ values: {} }),
    apiAchievementsCheck: res, apiAchievements: res, apiOshiGet: wire(ctx.apiOshiGet()),
  });
}
function openPage() {
  document.getElementById('me-btn').click();
  [...document.querySelectorAll('#me-body button')].find((b) => b.textContent === '実績').click();
  return document.querySelector('.ach-page');
}

describe('この環境では取れない実績', () => {
  beforeEach(() => { window.localStorage.clear(); vi.spyOn(Math, 'random').mockReturnValue(0.5); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('取れないものは札「この環境では取れません」と理由。まとまりの数とクリアまでの数に入れない', () => {
    const ctx = server();
    mountAch(ctx);
    const page = openPage();
    const b = page.querySelector('.ach-badge[data-ach="reviews-1"]');
    expect(b.classList.contains('is-off')).toBe(true);
    expect(b.textContent).toContain('この環境では取れません');
    expect(b.textContent).toContain('ほかの人がいると取れます');
    const goal = page.querySelector('.ach-badge[data-ach="first-goal"]');
    expect(goal.textContent).toContain('「目標 (OKR・MBO・KPI) を使う」をオンにすると取れます');
    const heads = [...page.querySelectorAll('.ach-head')].map((h) => h.textContent);
    expect(heads).toContain('いっしょに 0 / 0');
    const res = ctx.apiAchievements();
    expect(page.textContent).toContain('クリアまで あと ' + (res.total - res.got) + ' 個');
  });

  it('取れる実績の残りが3つ以下なら、名前と説明を見せる', () => {
    const ctx = server();
    const off = Object.keys(ctx.achUnavailable_(ME));
    const can = ctx.ACHIEVEMENTS().map((a) => a.key).filter((k) => off.indexOf(k) < 0);
    gotAll(ctx, can.slice(0, can.length - 2));
    mountAch(ctx);
    const page = openPage();
    for (const k of can.slice(can.length - 2)) {
      const b = page.querySelector('.ach-badge[data-ach="' + k + '"]');
      expect(b.querySelector('.ach-name').textContent, k).toBe(ctx.achOf(k).title);
      expect(b.classList.contains('is-near'), k).toBe(true);
    }
  });

  it('手元の道具の実績は、まだでも取り方の手がかりを出す', () => {
    const ctx = server();
    mountAch(ctx);
    const b = openPage().querySelector('.ach-badge[data-ach="first-kit"]');
    expect(b.querySelector('.ach-name').textContent).toBe('???');
    expect(b.querySelector('.ach-sub').textContent).toContain('手元の道具');
  });

  it('取れる実績を全部取ったら「全部取りました」(取れない実績が残っていても)', () => {
    const ctx = server();
    const off = Object.keys(ctx.achUnavailable_(ME));
    const can = ctx.ACHIEVEMENTS().map((a) => a.key).filter((k) => off.indexOf(k) < 0 && k !== 'days-1');
    gotAll(ctx, can);
    ctx.PropertiesService.getScriptProperties().setProperty('ACH:' + ME, JSON.stringify({
      days: { n: 0, last: '' }, got: Object.fromEntries(can.map((k) => [k, '2026-10-20'])) }));
    const oshi = wire(ctx.apiOshiGet());
    const check = wire(ctx.apiAchievementsCheck());
    expect(check.newly.map((a) => a.key)).toEqual(['days-1']);
    mount({
      apiPrefs: prefsFixture({ values: {} }),
      apiAchievementsCheck: check, apiAchievements: check, apiOshiGet: oshi,
    });
    expect(document.getElementById('ach-toast').textContent).toContain('全部取りました');
    expect(document.getElementById('oshi-bubble').dataset.event).toBe('clear');
  });
});
