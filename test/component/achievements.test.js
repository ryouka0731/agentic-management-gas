// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prefsFixture } from '../dom.js';
import { mount } from './mount.js';
import { loadGasWith } from '../harness.js';
import { createFakeGas } from '../fakegas.js';
import { APP_SOURCES } from '../sources.js';

/*
 * 実績 (js-ach)。返事の形は仕込みで写さず、本物のサーバ (疑似GAS) の apiAchievements から作る。
 * 守ること: 本人だけ・まだのものは ???・取ったら隅に小さく知らせ、推しがお祝い・ach.cheer を止めたら何も出さない。
 */

const ME = 'tester@example.com';

/** 本物のサーバ。開いた1日目と、やることを1つ済ませた人 */
function server() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...APP_SOURCES);
  ctx.repoInit('agentic-management');
  return { ctx, fake };
}
const wire = (v) => JSON.parse(JSON.stringify(v));

/** 開いたとき「はじめの一日」を取った返事 (newly あり) と、そのあと何も無い返事 */
function firstDay() {
  const { ctx } = server();
  const check = wire(ctx.apiAchievementsCheck());
  const after = wire(ctx.apiAchievements());
  const oshi = wire(ctx.apiOshiGet());
  return { check, after, oshi, ctx };
}

/** 段が上がる返事 (Lv4 → Lv5) */
function crossing() {
  const { ctx } = server();
  ctx.apiAchievementsCheck();
  ctx.dbAppend('branches', { name: '見直し', createdBy: ME });
  ctx.dbAppend('inquiries', { number: 1, kind: 'bug', body: 'x', by: ME, at: new Date(), state: 'open' });
  const before = wire(ctx.apiAchievements());
  const n = ctx.issueCreate('しごと', '', []).number;
  ctx.dbUpdate('issues', 'number', n, { assignee: ME });
  ctx.issueClose(n, null);
  return { before, cross: wire(ctx.apiAchievements()), oshi: wire(ctx.apiOshiGet()) };
}

function mountAch(values, over) {
  const v = values || {};
  return mount(Object.assign({
    apiPrefs: prefsFixture({ values: v }),
    apiPrefSet: (key, value) => prefsFixture({ values: Object.assign({}, v, { [key]: value }) }),
  }, over || {}));
}

const toast = () => document.getElementById('ach-toast');
const bubble = () => document.getElementById('oshi-bubble');
const names = (app) => app.calls.map((c) => c.name);

function openPage() {
  document.getElementById('me-btn').click();
  const btn = [...document.querySelectorAll('#me-body button')].find((b) => b.textContent === '実績');
  expect(btn, '自分のところに「実績」がある').toBeTruthy();
  btn.click();
  return document.querySelector('.ach-page');
}

describe('実績', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('開いたときに1回だけ数え直し、取った実績を隅に小さく知らせる。推しが「実績を取った」と言う', () => {
    const d = firstDay();
    const app = mountAch({}, { apiAchievementsCheck: d.check, apiAchievements: d.after, apiOshiGet: d.oshi });
    expect(names(app).filter((n) => n === 'apiAchievementsCheck').length).toBe(1);
    const t = toast();
    expect(t.classList.contains('is-shown')).toBe(true);
    expect(t.getAttribute('role')).toBe('status');
    expect(t.textContent).toContain('実績「はじめの一日」を取りました');
    expect(t.textContent).toContain('Lv 2');
    // 知らせは焦点を奪わない
    expect(t.contains(document.activeElement)).toBe(false);
    expect(bubble().dataset.event).toBe('badge');
    expect(d.ctx.OSHI_LINES().buddy.badge).toContain(bubble().querySelector('.oshi-line').textContent);
    // 楽しい演出のお祝いがオフなら大きな字は出ない
    expect(document.querySelector('.fun-banner')).toBe(null);
  });

  it('「実績を取ったら知らせる」を止めた人には、知らせも推しのお祝いも出さない', () => {
    const d = firstDay();
    mountAch({ 'ach.cheer': false }, { apiAchievementsCheck: d.check, apiOshiGet: d.oshi });
    expect(toast().classList.contains('is-shown')).toBe(false);
    expect(toast().textContent).toBe('');
    expect(bubble() === null || bubble().dataset.event !== 'badge').toBe(true);
  });

  it('楽しい演出の「済ませたらお祝い」もオンなら、大きな字も出す', () => {
    const d = firstDay();
    mountAch({ 'fun.cheer': true }, { apiAchievementsCheck: d.check, apiOshiGet: d.oshi });
    const banner = document.querySelector('.fun-banner');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('BADGE GET!');
    expect(banner.textContent).toContain('はじめの一日');
  });

  it('止めた人 (実績を集める オフ) には、数え直しも頁もカードも出さない', () => {
    const d = firstDay();
    const app = mountAch({ 'ach.on': false }, { apiAchievementsCheck: d.check });
    expect(names(app)).not.toContain('apiAchievementsCheck');
    expect(toast() === null || !toast().classList.contains('is-shown')).toBe(true);
    document.getElementById('me-btn').click();
    expect([...document.querySelectorAll('#me-body button')].some((b) => b.textContent === '実績')).toBe(false);
    expect(document.querySelector('.ach-card')).toBe(null);
  });

  it('頁: 取ったものは絵・名前・取った日、まだのものは ???。まとまりごとの数と推しの Lv', () => {
    const d = firstDay();
    mountAch({}, { apiAchievementsCheck: d.after, apiAchievements: d.after, apiOshiGet: d.oshi });
    const page = openPage();
    expect(page).toBeTruthy();
    const got = page.querySelector('.ach-badge[data-ach="days-1"]');
    expect(got.classList.contains('is-done')).toBe(true);
    expect(got.querySelector('.ach-medal').textContent).toBe('🌱');
    expect(got.querySelector('.ach-name').textContent).toBe('はじめの一日');
    expect(got.querySelector('.ach-sub').textContent.endsWith('(' + d.after.items.find((a) => a.key === 'days-1').at + ')')).toBe(true);
    expect(d.after.items.find((a) => a.key === 'days-1').at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const locked = page.querySelector('.ach-badge[data-ach="days-3"]');
    expect(locked.querySelector('.ach-name').textContent).toBe('???');
    expect(locked.querySelector('.ach-sub').textContent).toBe('あと 2 日で…');
    // 「はじめて」は手がかりを出さず、まとまりの名前だけ
    const first = page.querySelector('.ach-badge[data-ach="first-kit"]');
    expect(first.querySelector('.ach-name').textContent).toBe('???');
    expect(first.querySelector('.ach-sub').textContent).toBe('はじめて');
    expect(page.textContent).not.toContain('手元の道具を使った');
    const heads = [...page.querySelectorAll('.ach-head')].map((h) => h.textContent);
    expect(heads).toContain('通算の日 1 / 8');
    expect(page.querySelector('.ach-level-head').textContent).toContain('推しの Lv 2');
    expect(page.textContent).toContain('あなたにだけ見えます');
    expect(page.textContent).not.toMatch(/連続|\d+ *位/);
  });

  it('ホームの「最近の実績」に Lv と最近取ったものを出す。止めると出さない', () => {
    const d = firstDay();
    mountAch({}, { apiAchievementsCheck: d.check, apiAchievements: d.after, apiOshiGet: d.oshi });
    const card = document.querySelector('#home-cards .ach-card');
    expect(card).toBeTruthy();
    expect(card.textContent).toContain('はじめの一日');
    expect(card.textContent).toContain('推しの Lv 2');
    mountAch({ 'home.cards.ach': false }, { apiAchievementsCheck: d.check, apiOshiGet: d.oshi });
    expect(document.querySelector('.ach-card')).toBe(null);
  });

  it('やることを済ませたら数え直す。済ませたほめ言葉を上書きせず、消えてから「実績を取った」', () => {
    const d = firstDay();
    // 開いたときには何も無く、済ませたあとの数え直しで取れる
    const app = mountAch({}, { apiAchievementsCheck: (opts) => (opts ? d.check : d.after), apiOshiGet: d.oshi });
    // 知らせの器は最初から空で置いてある (1回目の知らせも読み上げられるように)
    expect(toast().getAttribute('role')).toBe('status');
    expect(toast().textContent).toBe('');
    document.querySelector('[data-tab="issues"]').click();
    document.querySelector('#issue-list [aria-label$="を完了にする"]').click();
    // 済ませたあとの数え直しは、変わりうるものだけを名指して頼む (開いた日は数えない)
    const re = app.calls.filter((c) => c.name === 'apiAchievementsCheck');
    expect(re.length).toBe(2);
    expect(re[1].args[0].metrics).toEqual(['done']);
    expect(bubble().dataset.event).toBe('done');
    expect(toast().classList.contains('is-shown')).toBe(true);
    bubble().querySelector('.oshi-close').click();
    expect(bubble().hidden).toBe(false);
    expect(bubble().dataset.event).toBe('badge');
  });

  it('2つ以上取ったら「実績を N 個取りました」', () => {
    const { ctx } = server();
    ctx.dbAppend('branches', { name: '見直し', createdBy: ME });
    const res = wire(ctx.apiAchievementsCheck());
    expect(res.newly.length).toBe(2);
    mountAch({}, { apiAchievementsCheck: res, apiOshiGet: wire(ctx.apiOshiGet()) });
    expect(toast().textContent).toContain('実績を 2 個取りました');
  });

  it('知らせは上の帯の下に出し、自分まわり・知らせの欄より手前に重ねる (鈴と顔を覆わない)', async () => {
    const fs = await import('node:fs');
    const css = fs.readFileSync('src/ui/app.css.html', 'utf8');
    const rule = css.match(/\.ach-toast \{[^}]*\}/)[0];
    expect(rule).toContain('top: calc(56px + var(--sp-2))');
    expect(Number(rule.match(/z-index: (\d+)/)[1])).toBeGreaterThan(160);
  });

  it('段が上がったら「育ちの段が上がった」を、上がった段の表情で言う。推しの育ちも Lv に揃える', () => {
    const c = crossing();
    expect(c.cross).toMatchObject({ crossed: true, level: 5, stage: { key: 'grow2' } });
    // 推しの返事は1つ前の Lv (取る前に取った返事)
    const stale = Object.assign({}, c.oshi, { growth: Object.assign({}, c.oshi.growth, { level: 4, key: 'grow1', label: '見習い' }) });
    mountAch({}, { apiAchievementsCheck: c.cross, apiOshiGet: stale });
    expect(bubble().dataset.event).toBe('levelup');
    expect(bubble().dataset.state).toBe('grow2');
    expect(toast().textContent).toContain('一人前になりました');
    const stage = document.querySelector('#home-cards .oshi-card .oshi-stage');
    expect(stage.textContent).toContain('Lv 5');
    expect(stage.dataset.stage).toBe('grow2');
  });
});
