import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { loadGas, loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';
import { APP_SOURCES } from './sources.js';
import { ui } from './ui-source.js';

/*
 * 実績 (バッジ)。定義は src/core/Achievements.js、数えて覚えるのは AchievementsStore.gs、入口は src/api/Achievements.gs。
 * 守ること: 通算で数える (連続は持たない)・一度取ったら消さない・本人にだけ・順位なし・推しの Lv = 1 + 取った数。
 */

const pure = loadGas('src/core/Achievements.js', 'src/core/Oshi.js');
const ME = 'tester@example.com';
const DAY1 = new Date('2026-10-21T03:00:00Z'); // 東京 12:00

function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...APP_SOURCES);
  ctx.repoInit('agentic-management');
  return { ctx, fake };
}
const keysOf = (res) => res.newly.slice().sort();
const props = (ctx) => ctx.PropertiesService.getScriptProperties();

describe('定義 (Achievements.js)', () => {
  const list = pure.ACHIEVEMENTS();

  it('key は重ならず、まとまりと数えるものは定義にあり、絵と名前と説明を持つ', () => {
    const keys = list.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
    const groups = pure.ACH_GROUPS().map((g) => g.key);
    expect(groups).toEqual(['days', 'done', 'team', 'first']);
    const metrics = pure.ACH_METRICS();
    for (const a of list) {
      expect(groups, a.key).toContain(a.group);
      expect(metrics[a.metric], a.key).toBeTruthy();
      expect(a.title && a.desc && a.icon, a.key).toBeTruthy();
      expect(a.threshold, a.key).toBeGreaterThanOrEqual(1);
    }
  });

  it('同じ数えるものの中で threshold は小さい順に並び、重ならない', () => {
    const by = {};
    for (const a of list) (by[a.metric] = by[a.metric] || []).push(a.threshold);
    for (const m of Object.keys(by)) {
      const t = by[m];
      for (let i = 1; i < t.length; i++) expect(t[i], m).toBeGreaterThan(t[i - 1]);
    }
    expect(by.days).toEqual([1, 3, 7, 30, 50, 100, 200, 365]);
    expect(by.done).toEqual([1, 10, 30, 50, 100, 300, 1000]);
    expect(by.merged).toEqual([1, 10, 50]);
    expect(by.reviews).toEqual([1, 10, 50]);
  });

  it('「はじめて」は15あり、どれも1回で取れる', () => {
    const first = list.filter((a) => a.group === 'first');
    expect(first.map((a) => a.metric)).toEqual(['branch', 'pull', 'merge', 'approve', 'markdown', 'comment', 'inquiry',
      'reportCopy', 'focus', 'style', 'oshi', 'goal', 'calendar', 'kit', 'search']);
    for (const a of first) {
      expect(a.threshold).toBe(1);
      expect(pure.ACH_METRICS()[a.metric].first, a.key).toBe(true);
    }
  });

  it('続けることを求めない (連続・毎日の実績は無い) / Git の言葉を見せない', () => {
    const all = JSON.stringify(list) + JSON.stringify(pure.ACH_GROUPS()) + JSON.stringify(pure.ACH_METRICS());
    for (const bad of ['連続', '毎日', '連日', 'ストリーク', '順位', 'ランキング']) expect(all.includes(bad), bad).toBe(false);
    for (const bad of ['マージ', 'コミット', 'ブランチ', 'プルリク', 'PR', 'Issue']) expect(all.includes(bad), bad).toBe(false);
  });

  it('届いたものだけ newly、取ったものは二度出さない', () => {
    expect(pure.achNewly({ days: 3, done: 0 }, {})).toEqual(['days-1', 'days-3']);
    expect(pure.achNewly({ days: 3 }, { 'days-1': 'x' })).toEqual(['days-3']);
    expect(pure.achNewly({ branch: 1 }, {})).toEqual(['first-branch']);
    expect(pure.achNewly({}, {})).toEqual([]);
  });

  it('次に近い実績は数えるものごとに1つ、「はじめて」は出さず、近い順', () => {
    const next = pure.achNext({ days: 6, done: 1, merged: 0, reviews: 0, branch: 0 },
      { 'days-1': 'x', 'days-3': 'x', 'done-1': 'x' });
    expect(next.map((n) => n.key)).toEqual(['days-7', 'done-10', 'merged-1']);
    expect(next[0]).toMatchObject({ have: 6, need: 7, left: 1, unit: '日' });
    expect(pure.achHintOf(next[0])).toBe('あと 1 日で…');
    expect(pure.achNext({}, {}, 99).some((n) => n.group === 'first')).toBe(false);
  });

  it('推しの Lv は 1 + 取った数。段は見習い Lv1〜4・一人前 Lv5〜14・名人 Lv15〜', () => {
    expect(pure.achLevelOf(0)).toBe(1);
    expect(pure.achLevelOf(4)).toBe(5);
    expect(pure.oshiStageOf(pure.achLevelOf(3)).key).toBe('grow1');
    expect(pure.oshiStageOf(pure.achLevelOf(4)).key).toBe('grow2');
    expect(pure.oshiStageOf(pure.achLevelOf(13)).key).toBe('grow2');
    expect(pure.oshiStageOf(pure.achLevelOf(14)).key).toBe('grow3');
  });

  it('推しは「実績を取った」「育ちの段が上がった」を、どの口調でも3つ以上言える', () => {
    const lines = pure.OSHI_LINES();
    const ev = pure.OSHI_EVENTS().map((e) => e.key);
    expect(ev).toContain('badge');
    expect(ev).toContain('levelup');
    expect(pure.OSHI_EVENTS().find((e) => e.key === 'badge')).toMatchObject({ label: '実績を取った', state: 'celebrate' });
    for (const t of pure.OSHI_TONES()) {
      expect(lines[t.key].badge.length, t.key).toBeGreaterThanOrEqual(3);
      expect(lines[t.key].levelup.length, t.key).toBeGreaterThanOrEqual(3);
    }
  });

  it('画面の使われ方の場所はサーバの ACH_USAGE_PLACES と同じ', () => {
    const { ctx } = setup();
    const f = ui(['ACH_USAGE_TARGETS']);
    expect(f.ACH_USAGE_TARGETS().slice().sort()).toEqual(Object.values(ctx.ACH_USAGE_PLACES()).sort());
  });
});

describe('通算で開いた日', () => {
  it('東京の暦日ごとに1回だけ数える (同じ日に何度開いても1日)', () => {
    const { ctx } = setup();
    expect(ctx.achDaysTouch_(ME, DAY1)).toMatchObject({ n: 1, counted: true, last: '2026-10-21' });
    expect(ctx.achDaysTouch_(ME, new Date('2026-10-21T14:59:00Z'))).toMatchObject({ n: 1, counted: false });
    // 東京の0時 (UTC 15:00) で次の日
    expect(ctx.achDaysTouch_(ME, new Date('2026-10-21T15:00:00Z'))).toMatchObject({ n: 2, counted: true, last: '2026-10-22' });
    // 続けなくても数える (間が空いても減らない)
    expect(ctx.achDaysTouch_(ME, new Date('2026-12-01T03:00:00Z'))).toMatchObject({ n: 3 });
    expect(ctx.achDaysRead_('TESTER@example.com').n).toBe(3);
  });

  it('2つのタブで同時に開いても2日にしない (見ることと足すことを1つの鍵の中で)', () => {
    const { ctx } = setup();
    const orig = ctx.dbWithLock_;
    let raced = false;
    // 1つ目のタブが鍵を取る直前に、2つ目のタブが同じ日を数え終えた
    ctx.dbWithLock_ = function (ms, fn, busy) {
      if (!raced) {
        raced = true;
        props(ctx).setProperty('ACH_DAYS:' + ME, JSON.stringify({ n: 1, last: '2026-10-21' }));
      }
      return orig(ms, fn, busy);
    };
    const got = ctx.achDaysTouch_(ME, DAY1);
    expect(got).toMatchObject({ n: 1, counted: false });
  });

  it('鍵が取れなければ数えない (投げない)', () => {
    const { ctx } = setup();
    ctx.dbWithLock_ = (ms, fn, busy) => busy();
    expect(ctx.achDaysTouch_(ME, DAY1)).toMatchObject({ n: 0, counted: false });
  });

  it('開いた日を数えるのは apiAchievementsCheck だけ (apiAchievements は数えない)', () => {
    const { ctx } = setup();
    ctx.apiAchievements();
    expect(ctx.achDaysRead_(ME).n).toBe(0);
    const res = ctx.apiAchievementsCheck();
    expect(ctx.achDaysRead_(ME).n).toBe(1);
    expect(res.newly.map((a) => a.key)).toEqual(['days-1']);
    expect(ctx.apiAchievementsCheck().newly).toEqual([]);
  });
});

describe('数え方 (台帳から)', () => {
  function close(ctx, who) {
    const i = ctx.issueCreate('しごと', '', []);
    ctx.dbUpdate('issues', 'number', i.number, { assignee: who });
    ctx.issueClose(i.number, null);
    return i.number;
  }

  it('済ませたやることは担当の本人のぶんだけ (大文字小文字を見ない)', () => {
    const { ctx } = setup();
    for (let i = 0; i < 10; i++) close(ctx, i % 2 ? 'Tester@Example.com' : ME);
    close(ctx, 'other@example.com');
    expect(keysOf(ctx.achCheck_(ME, DAY1, {}))).toEqual(['done-1', 'done-10']);
    expect(ctx.achCheck_('other@example.com', DAY1, {}).newly).toEqual(['done-1']);
  });

  it('確認依頼: 出した・届いた・反映した・承認した・ほかの人への返事', () => {
    const { ctx } = setup();
    ctx.dbAppend('pulls', { number: 1, title: 'a', state: 'merged', author: ME, createdAt: DAY1 });
    ctx.dbAppend('pulls', { number: 2, title: 'b', state: 'open', author: 'other@example.com', createdAt: DAY1 });
    ctx.dbAppend('reviews', { prNumber: 2, reviewer: ME, state: 'approve', body: '', at: DAY1, id: 1 });
    // 自分の依頼への返事は数えない
    ctx.dbAppend('reviews', { prNumber: 1, reviewer: ME, state: 'comment', body: 'メモ', at: DAY1, id: 2 });
    ctx.dbAppend('commits', { sha: 'x', parentSha: '', branch: 'main', fileId: 'F', blobSha: 'b', author: ME,
      message: '反映: 確認依頼 #1 a', timestamp: DAY1 });
    const res = ctx.achCheck_(ME, DAY1, {});
    expect(res.counts).toMatchObject({ merged: 1, reviews: 1, pull: 1, merge: 1, approve: 1 });
    expect(keysOf(res)).toEqual(['first-approve', 'first-merge', 'first-pull', 'merged-1', 'reviews-1'].sort());
  });

  it('反映した記録の文は、反映のときに残す文と同じ (PullRequest.gs)', () => {
    const src = fs.readFileSync(path.resolve('src/core/PullRequest.gs'), 'utf8');
    expect(src).toContain("'反映: 確認依頼 #' + number");
  });

  it('改訂版・やりとり・報告・集中・目標を台帳から', () => {
    const { ctx } = setup();
    ctx.dbAppend('branches', { name: 'main', createdBy: ME });
    expect(ctx.achCheck_(ME, DAY1, {}).counts.branch).toBe(0);
    ctx.dbAppend('branches', { name: '見直し', createdBy: ME });
    ctx.dbAppend('inquiry_replies', { id: 1, inquiryNumber: 1, body: 'はい', by: ME, at: DAY1 });
    ctx.dbAppend('inquiries', { number: 1, kind: 'bug', body: 'x', by: ME, at: DAY1, state: 'open' });
    ctx.dbAppend('focus_sessions', { id: 1, issueNumber: 1, who: ME, startedAt: DAY1 });
    ctx.dbAppend('goals', { id: 1, who: ME, period: '2026H2', title: 'g' });
    expect(keysOf(ctx.achCheck_(ME, DAY1, {}))).toEqual(
      ['first-branch', 'first-comment', 'first-focus', 'first-goal', 'first-inquiry'].sort());
  });

  it('使われ方の場所 (Markdown で保存・日報をコピー・探す・推しを選ぶ) は本人のぶんだけ', () => {
    const { ctx, fake } = setup();
    ctx.usageRecord([{ kind: 'action', target: 'md-save', count: 1 }, { kind: 'action', target: 'report-copy', count: 1 }]);
    fake._setUser('other@example.com');
    ctx.usageRecord([{ kind: 'action', target: 'search-open', count: 1 }]);
    fake._setUser(ME);
    expect(keysOf(ctx.achCheck_(ME, DAY1, {}))).toEqual(['first-markdown', 'first-reportCopy']);
  });

  it('診断・推しを選んだ・予定・手元の道具は、今あるスクリプトプロパティから', () => {
    const { ctx } = setup();
    const answers = {};
    ctx.STYLE_QUESTIONS().forEach((q) => { answers[q.id] = 4; });
    ctx.apiWorkStyleSave(answers);
    ctx.apiPrefSet('oshi.char', 'builtin:itsuki');
    props(ctx).setProperty('CAL_PLANNED:' + ME, JSON.stringify({ day: '2026-10-21', at: 'x', ok: true }));
    ctx.outcomesQueueNote_(1, 2, 'owner@example.com', ME);
    expect(keysOf(ctx.achCheck_(ME, DAY1, {}))).toEqual(['first-calendar', 'first-kit', 'first-oshi', 'first-style'].sort());
  });

  it('全部取った数えるものの表は読まない', () => {
    const { ctx } = setup();
    const all = {};
    ctx.ACHIEVEMENTS().forEach((a) => { if (a.metric !== 'done') all[a.key] = '2026-10-21T00:00:00.000Z'; });
    props(ctx).setProperty('ACH:' + ME, JSON.stringify(all));
    const read = [];
    const orig = ctx.dbReadAll;
    ctx.dbReadAll = (t) => { read.push(t); return orig(t); };
    ctx.achCheck_(ME, DAY1, {});
    expect(read).not.toContain('pulls');
    expect(read).not.toContain('usage');
    expect(read).toContain('issues');
  });
});

describe('一度取ったら消さない', () => {
  it('完了を取り消しても、使われ方が消えても、取った印は残る', () => {
    const { ctx } = setup();
    const i = ctx.issueCreate('しごと', '', []);
    ctx.dbUpdate('issues', 'number', i.number, { assignee: ME });
    ctx.issueClose(i.number, null);
    ctx.usageRecord([{ kind: 'action', target: 'search-open', count: 1 }]);
    const first = ctx.achCheck_(ME, DAY1, {});
    expect(keysOf(first)).toEqual(['done-1', 'first-search']);
    ctx.issueReopen(i.number);
    ctx.dbDelete('usage', 'target', 'search-open');
    const again = ctx.achCheck_(ME, new Date('2026-10-22T03:00:00Z'), {});
    expect(again.newly).toEqual([]);
    expect(Object.keys(again.have).sort()).toEqual(['done-1', 'first-search']);
    // 取った時刻は最初に取ったときのまま
    expect(again.have['done-1']).toBe(DAY1.toISOString());
    expect(ctx.apiAchievements().unlocked.map((a) => a.key).sort()).toEqual(['done-1', 'first-search']);
  });

  it('2つのタブで同時に届いても、取ったと言うのは1回だけ (鍵の中で読み直して足す)', () => {
    const { ctx } = setup();
    const i = ctx.issueCreate('しごと', '', []);
    ctx.dbUpdate('issues', 'number', i.number, { assignee: ME });
    ctx.issueClose(i.number, null);
    const orig = ctx.dbWithLock_;
    let raced = false;
    ctx.dbWithLock_ = function (ms, fn, busy) {
      if (!raced) {
        raced = true;
        // 鍵を取る直前に、ほかのタブが同じ実績を取り終えた
        props(ctx).setProperty('ACH:' + ME, JSON.stringify({ 'done-1': '2026-10-21T02:00:00.000Z' }));
      }
      return orig(ms, fn, busy);
    };
    const res = ctx.achCheck_(ME, DAY1, {});
    expect(res.newly).toEqual([]);
    expect(res.have['done-1']).toBe('2026-10-21T02:00:00.000Z');
  });

  it('鍵が取れなければ取らない (取ったと言わない。次に数え直したときに取れる)', () => {
    const { ctx } = setup();
    ctx.achDaysTouch_(ME, DAY1);
    const orig = ctx.dbWithLock_;
    ctx.dbWithLock_ = (ms, fn, busy) => busy();
    expect(ctx.achCheck_(ME, DAY1, {}).newly).toEqual([]);
    ctx.dbWithLock_ = orig;
    expect(ctx.achCheck_(ME, DAY1, {}).newly).toEqual(['days-1']);
  });

  it('知らない key と時刻でない値は読まない (人がエディタで書き換えうる)', () => {
    const { ctx } = setup();
    props(ctx).setProperty('ACH:' + ME, JSON.stringify({ 'days-1': '2026-10-21T00:00:00Z', nope: '2026-10-21T00:00:00Z', 'done-1': 3 }));
    expect(Object.keys(ctx.achUnlockedRead_(ME))).toEqual(['days-1']);
    props(ctx).setProperty('ACH:' + ME, '{こわれた');
    expect(ctx.achUnlockedRead_(ME)).toEqual({});
  });
});

describe('入口 (apiAchievements / apiAchievementsCheck)', () => {
  it('アドレスを受けず、開いている本人のぶんだけを返す (ほかの人の実績は見えない)', () => {
    const { ctx, fake } = setup();
    expect(ctx.apiAchievements.length).toBe(0);
    expect(ctx.apiAchievementsCheck.length).toBe(0);
    fake._setUser('b@example.com');
    ctx.apiAchievementsCheck();
    expect(ctx.apiAchievements().unlocked.map((a) => a.key)).toEqual(['days-1']);
    fake._setUser(ME);
    const mine = ctx.apiAchievements();
    expect(mine.unlocked).toEqual([]);
    expect(JSON.stringify(mine)).not.toContain('b@example.com');
  });

  it('まだのものは名前を返さず、数のあるものはいちばん近い1つにだけ手がかり', () => {
    const { ctx } = setup();
    const res = ctx.apiAchievementsCheck();
    const done = res.items.find((a) => a.key === 'days-1');
    expect(done).toMatchObject({ done: true, title: 'はじめの一日', icon: '🌱' });
    expect(done.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const locked = res.items.filter((a) => !a.done);
    for (const a of locked) {
      expect(a.title, a.key).toBeUndefined();
      expect(a.desc, a.key).toBeUndefined();
      expect(a.icon, a.key).toBeUndefined();
    }
    expect(res.items.find((a) => a.key === 'days-3').hint).toBe('あと 2 日で…');
    expect(res.items.find((a) => a.key === 'days-7').hint).toBe('');
    expect(res.items.find((a) => a.key === 'first-kit')).toMatchObject({ hint: '', groupLabel: 'はじめて' });
    expect(res.next.length).toBeLessThanOrEqual(3);
    expect(res.next.every((n) => !n.title)).toBe(true);
    expect(res.groups.find((g) => g.key === 'days')).toMatchObject({ got: 1, total: 8 });
  });

  it('レベルと段、今回取ったぶんで段が上がったか (crossed)', () => {
    const { ctx } = setup();
    const r1 = ctx.apiAchievementsCheck();
    expect(r1).toMatchObject({ level: 2, crossed: false, stage: { key: 'grow1', toNext: 3 } });
    // あと3つで Lv5 (一人前)
    for (let i = 0; i < 3; i++) {
      const n = ctx.issueCreate('しごと' + i, '', []).number;
      ctx.dbUpdate('issues', 'number', n, { assignee: ME });
      ctx.issueClose(n, null);
    }
    ctx.dbAppend('branches', { name: '見直し', createdBy: ME });
    ctx.dbAppend('inquiries', { number: 1, kind: 'bug', body: 'x', by: ME, at: DAY1, state: 'open' });
    const r2 = ctx.apiAchievements();
    expect(r2.newly.map((a) => a.key).sort()).toEqual(['done-1', 'first-branch', 'first-inquiry']);
    expect(r2).toMatchObject({ level: 5, crossed: true, stage: { key: 'grow2', label: '一人前' } });
    expect(ctx.apiOshiGet().growth).toMatchObject({ level: 5, key: 'grow2' });
    expect(ctx.apiAchievements()).toMatchObject({ crossed: false, newly: [] });
  });

  it('止めた人 (ach.on オフ) は数えず、開いた日も数えない', () => {
    const { ctx } = setup();
    ctx.apiPrefSet('ach.on', false);
    const res = ctx.apiAchievementsCheck();
    expect(res).toMatchObject({ on: false, newly: [], level: 1 });
    expect(ctx.achDaysRead_(ME).n).toBe(0);
  });

  it('実績の設定は自分の設定で、既定でオン', () => {
    const { ctx } = setup();
    const items = ctx.PREFS_SCHEMA().filter((p) => /^ach\./.test(p.key));
    expect(items.map((p) => [p.key, p.scope, p.def])).toEqual([['ach.on', 'me', true], ['ach.cheer', 'me', true]]);
    expect(ctx.prefItem_('home.cards.ach')).toMatchObject({ scope: 'me', def: true });
    expect(ctx.apiPrefs().effective.ach).toEqual({ on: true, cheer: true });
  });
});
