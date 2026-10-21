import { describe, it, expect } from 'vitest';
import { loadGas, loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';
import { APP_SOURCES } from './sources.js';

/*
 * 推しの機嫌 (自分の設定 oshi.mood。既定はオフ)。決め方は Oshi.js の OSHI_MOOD_RULES / oshiMoodOf、数えるのは OshiMood.gs。
 * 守ること: 変わるのは表情とせりふだけ・本人のぶんだけ数える・オフなら台帳を読まない・済ませたらすぐ直る。
 * 境目の数は OSHI_MOOD_RULES() から読む (テストに数を写すと、変えたときにテストだけ古いまま通る)。
 */

const pure = loadGas('src/core/Oshi.js');
const R = pure.OSHI_MOOD_RULES();

const ME = 'tester@example.com';
const OTHER = 'b@example.com';
const DAY = 86400000;

/** 疑似の CacheService (期限は見ない) */
function fakeCache(ctx) {
  const store = new Map();
  ctx.CacheService = { getScriptCache: () => ({
    get: (k) => (store.has(k) ? store.get(k) : null),
    put: (k, v) => { store.set(k, String(v)); },
    remove: (k) => { store.delete(k); },
  }) };
  return store;
}

function countReads(ctx) {
  const real = ctx.dbReadAll;
  const seen = [];
  ctx.dbReadAll = (t) => { seen.push(t); return real(t); };
  return seen;
}

function setup(opts) {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...APP_SOURCES);
  ctx.repoInit('agentic-management');
  if (!opts || opts.mood !== false) ctx.apiPrefSet('oshi.mood', true);
  const cache = opts && opts.noCache ? null : fakeCache(ctx);
  return { ctx, fake, cache };
}

/** 東京の0時の Date (台帳の期限の形) */
const tokyoMidnight = (day) => new Date(Date.parse(day + 'T00:00:00Z') - 9 * 3600000);

/** やることを作り、欄を直す。動いた日は既定で now (動きなしに数えない) */
function issue(ctx, patch, now) {
  const n = ctx.issueCreate('やること', '', []).number;
  ctx.dbUpdate('issues', 'number', n, Object.assign({ assignee: ME, updatedAt: now || new Date() }, patch));
  return n;
}

describe('決め方 (OSHI_MOOD_RULES / oshiMoodOf)', () => {
  const base = { open: 1, overdue: 0, stale: 0, lastDoneDays: null };
  const of = (p) => pure.oshiMoodOf(Object.assign({}, base, p));

  it('段は良い順に ごきげん・ふつう・しょんぼり・むっ。しょんぼりはしんぱいの絵、むっはむっの絵', () => {
    expect(pure.OSHI_MOODS().map((m) => m.key)).toEqual(['happy', 'normal', 'sulky', 'pouty']);
    expect(pure.OSHI_MOODS().map((m) => m.label)).toEqual(['ごきげん', 'ふつう', 'しょんぼり', 'むっ']);
    expect(pure.oshiMoodLevelOf('sulky')).toMatchObject({ event: 'mood_sulky', state: 'worry' });
    expect(pure.oshiMoodLevelOf('pouty')).toMatchObject({ event: 'mood_pouty', state: 'pout' });
  });

  it('期限を過ぎた件数: sulky 件でしょんぼり、pouty 件でむっ (その1つ手前は1つ上の段)', () => {
    expect(of({ overdue: R.overdue.sulky - 1 }).level).toBe('normal');
    expect(of({ overdue: R.overdue.sulky })).toEqual({ level: 'sulky', reasons: [{ kind: 'overdue', count: R.overdue.sulky }] });
    expect(of({ overdue: R.overdue.pouty - 1 }).level).toBe('sulky');
    expect(of({ overdue: R.overdue.pouty }).level).toBe('pouty');
  });

  it('動きの無い件数と、最後に済ませてからの日数も同じ形', () => {
    expect(of({ stale: R.stale.sulky - 1 }).level).toBe('normal');
    expect(of({ stale: R.stale.sulky }).level).toBe('sulky');
    expect(of({ stale: R.stale.pouty }).level).toBe('pouty');
    expect(of({ lastDoneDays: R.idle.sulky - 1 }).level).toBe('normal');
    expect(of({ lastDoneDays: R.idle.sulky })).toEqual({ level: 'sulky', reasons: [{ kind: 'idle', count: R.idle.sulky }] });
    expect(of({ lastDoneDays: R.idle.pouty }).level).toBe('pouty');
  });

  it('いちばん悪いわけに合わせ、わけは届いたものだけを数で返す', () => {
    const got = of({ overdue: R.overdue.sulky, stale: R.stale.pouty, lastDoneDays: 0 });
    expect(got.level).toBe('pouty');
    expect(got.reasons).toEqual([{ kind: 'overdue', count: R.overdue.sulky }, { kind: 'stale', count: R.stale.pouty }]);
  });

  it('一度も済ませていなければ日数は見ない。開いているやることが無ければ「ふつう」より下にしない', () => {
    expect(of({ lastDoneDays: null }).level).toBe('normal');
    expect(pure.oshiMoodOf({ open: 0, overdue: 9, stale: 9, lastDoneDays: 99 })).toEqual({ level: 'normal', reasons: [] });
    expect(pure.oshiMoodOf({ open: 0, overdue: 0, stale: 0, lastDoneDays: R.happyDays }).level).toBe('happy');
  });

  it('最近済ませていて、わけが無ければごきげん', () => {
    expect(of({ lastDoneDays: 0 }).level).toBe('happy');
    expect(of({ lastDoneDays: R.happyDays }).level).toBe('happy');
    expect(of({ lastDoneDays: R.happyDays + 1 }).level).toBe('normal');
  });

  it('わけの字は数だけ (題名・名前を入れない)', () => {
    expect(pure.oshiMoodReasonText('overdue', 2)).toBe('期限を過ぎたやること 2件');
    expect(pure.oshiMoodReasonText('stale', 3)).toBe('しばらく動いていないやること 3件');
    expect(pure.oshiMoodReasonText('idle', 9)).toBe('最後に済ませてから 9日');
  });

  it('機嫌のせりふは口調ごとにあり、叱らない・責めない', () => {
    for (const tone of pure.OSHI_TONES()) {
      for (const k of ['mood_sulky', 'mood_pouty', 'mood_recover']) {
        const list = pure.OSHI_LINES()[tone.key][k];
        expect(list.length, tone.key + k).toBeGreaterThanOrEqual(2);
        for (const l of list) {
          expect(l.length, l).toBeLessThanOrEqual(pure.OSHI_TEXT_LIMITS().lineMax);
          for (const bad of ['怒', 'なぜ', 'どうして', 'ダメ', 'だめ', 'サボ', '最低', 'ひどい', 'がっかり', 'のせい']) {
            expect(l.includes(bad), tone.key + ': ' + l).toBe(false);
          }
        }
      }
    }
    expect(pure.oshiEventOf('mood_pouty').state).toBe('pout');
    expect(pure.oshiEventOf('mood_recover').state).toBe('celebrate');
  });
});

describe('数える (OshiMood.gs)', () => {
  const NOW = new Date('2026-10-14T03:00:00Z'); // 東京 10/14 12:00

  it('期限は東京の暦日で切れる (今日が期限ならまだ。0時を過ぎたら過ぎた)', () => {
    const { ctx } = setup({ noCache: true });
    issue(ctx, { dueDate: tokyoMidnight('2026-10-13') }, NOW);
    expect(ctx.oshiMoodSignals_(ME, new Date('2026-10-13T14:59:00Z')).overdue).toBe(0); // 東京 10/13 23:59
    expect(ctx.oshiMoodSignals_(ME, new Date('2026-10-13T15:00:00Z')).overdue).toBe(1); // 東京 10/14 0:00
  });

  it('台帳の値は Date でも字でも読む。読めない字は数えない', () => {
    const { ctx } = setup({ noCache: true });
    issue(ctx, { dueDate: tokyoMidnight('2026-10-10') }, NOW);
    issue(ctx, { dueDate: '2026-10-11' }, NOW);
    issue(ctx, { dueDate: '2026-10-14' }, NOW);
    issue(ctx, { dueDate: 'あした' }, NOW);
    const n = issue(ctx, {}, NOW);
    ctx.dbUpdate('issues', 'number', n, { state: 'closed', closedAt: new Date('2026-10-11T16:00:00Z') }); // 東京 10/12
    const s = ctx.oshiMoodSignals_(ME, NOW);
    expect(s).toEqual({ open: 4, overdue: 2, stale: 0, lastDoneDays: 2 });
  });

  it('動きなしは、チームの設定の最初の段 (stale.steps) より長くそのままのもの', () => {
    const { ctx } = setup({ noCache: true });
    const first = ctx.staleSteps_()[0];
    for (let k = 0; k < R.stale.sulky; k++) issue(ctx, {}, new Date(NOW.getTime() - first * DAY));
    issue(ctx, {}, new Date(NOW.getTime() - (first - 1) * DAY));
    const s = ctx.oshiMoodSignals_(ME, NOW);
    expect(s.stale).toBe(R.stale.sulky);
    expect(ctx.oshiMoodOf(s).level).toBe('sulky');
  });

  it('本人のぶんだけ数える (ほかの人の担当・ほかの人が作った担当なし・捨てたものは数えない)', () => {
    const { ctx, fake } = setup({ noCache: true });
    const late = tokyoMidnight('2026-10-01');
    issue(ctx, { dueDate: late }, NOW);
    issue(ctx, { dueDate: late, assignee: OTHER }, NOW);
    issue(ctx, { dueDate: late, assignee: OTHER + ', ' + ME.toUpperCase() }, NOW); // 2人の担当 (大文字でも本人)
    issue(ctx, { dueDate: late, archivedAt: new Date() }, NOW);
    issue(ctx, { dueDate: late, assignee: '' }, NOW); // 本人が作った担当なし
    fake._setUser(OTHER);
    issue(ctx, { dueDate: late, assignee: '' }, NOW); // ほかの人が作った担当なし
    fake._setUser(ME);
    expect(ctx.oshiMoodSignals_(ME, NOW)).toMatchObject({ open: 3, overdue: 3 });
    expect(ctx.oshiMoodSignals_(OTHER, NOW)).toMatchObject({ open: 3, overdue: 3 });
  });

  it('オフなら null で、台帳を読まない (推しを止めた人も)', () => {
    const { ctx } = setup({ mood: false });
    const reads = countReads(ctx);
    expect(ctx.oshiMood_(ME, NOW)).toBe(null);
    expect(reads.filter((t) => t === 'issues' || t === 'change_log')).toEqual([]);
    ctx.apiPrefSet('oshi.mood', true);
    ctx.apiPrefSet('oshi.on', false);
    reads.length = 0;
    expect(ctx.oshiMood_(ME, NOW)).toBe(null);
    expect(ctx.apiOshiMood()).toBe(null);
    expect(reads.filter((t) => t === 'issues' || t === 'change_log')).toEqual([]);
  });

  it('オンでも、表は1回ずつ読む (やることごとに引かない)', () => {
    const { ctx } = setup({ noCache: true });
    for (let k = 0; k < 4; k++) issue(ctx, { assignee: k % 2 ? ME : '' }, NOW);
    const reads = countReads(ctx);
    const real = ctx.dbFindOne;
    let finds = 0;
    ctx.dbFindOne = (...a) => { finds++; return real(...a); };
    ctx.oshiMood_(ME, NOW);
    expect(reads.filter((t) => t === 'issues').length).toBe(1);
    expect(reads.filter((t) => t === 'change_log').length).toBeLessThanOrEqual(1);
    expect(finds).toBe(0);
  });

  it('覚えたぶんを返す。済ませたら (完了・取り消し・直す) すぐ数え直し、直ったらお祝いのせりふ', () => {
    const { ctx } = setup();
    const now = new Date();
    const past = new Date(now.getTime() - 3 * DAY);
    const n = issue(ctx, { dueDate: ctx.plainDay(past) });
    const first = ctx.apiOshiGet().mood;
    expect(first).toMatchObject({ level: 'sulky', label: 'しょんぼり', event: 'mood_sulky', state: 'worry', recovered: false });
    expect(first.reasons).toEqual([{ kind: 'overdue', count: 1, text: '期限を過ぎたやること 1件' }]);
    expect(pure.OSHI_LINES().buddy.mood_sulky).toContain(first.line);

    // 覚えているあいだは読まない
    const reads = countReads(ctx);
    expect(ctx.apiOshiMood().level).toBe('sulky');
    expect(reads.filter((t) => t === 'issues')).toEqual([]);

    // 済ませたら、覚えを消して数え直す
    ctx.apiIssueClose(n);
    const after = ctx.apiOshiMood();
    expect(after).toMatchObject({ level: 'happy', event: 'mood_recover', state: 'celebrate', recovered: true, reasons: [] });
    expect(pure.OSHI_LINES().buddy.mood_recover).toContain(after.line);

    // 取り消すと、また数える (直ったあとはお祝いを繰り返さない)
    ctx.apiIssueReopen(n);
    expect(ctx.apiOshiMood()).toMatchObject({ level: 'sulky', recovered: false });
    // 期限を延ばしても (わけが無くなったら) すぐ直る。取り消したので済ませた日は無く、ふつう
    ctx.issueUpdate(n, { dueDate: ctx.plainDay(new Date(now.getTime() + 3 * DAY)) });
    expect(ctx.apiOshiMood()).toMatchObject({ level: 'normal', event: 'mood_recover', recovered: true });
  });

  it('自分のキャラを使っていれば、そのキャラの口調と自分のせりふ', () => {
    const { ctx } = setup({ noCache: true });
    const c = ctx.apiOshiCharCreate('ソラ', 'kansai').charId;
    ctx.apiPrefSet('oshi.char', 'mine:' + c);
    ctx.apiOshiSetLines(c, 'mood_pouty', ['ソラのむっ']);
    const past = ctx.plainDay(new Date(Date.now() - 3 * DAY));
    for (let k = 0; k < R.overdue.pouty; k++) issue(ctx, { dueDate: past });
    const m = ctx.apiOshiMood();
    expect(m).toMatchObject({ level: 'pouty', state: 'pout' });
    expect(['ソラのむっ'].concat(pure.OSHI_LINES().kansai.mood_pouty)).toContain(m.line);
    expect(ctx.apiOshiGet().mood.level).toBe('pouty');
  });

  it('何も取り上げない (Lv・実績・クリアは機嫌で変わらない)', () => {
    const { ctx } = setup({ noCache: true });
    const before = ctx.apiOshiGet();
    const past = ctx.plainDay(new Date(Date.now() - 3 * DAY));
    for (let k = 0; k < R.overdue.pouty; k++) issue(ctx, { dueDate: past });
    const after = ctx.apiOshiGet();
    expect(after.mood.level).toBe('pouty');
    expect(after.growth).toEqual(before.growth);
    expect(after.cleared).toBe(before.cleared);
    expect(after.reveal).toEqual(before.reveal);
  });

  it('設定は自分の設定で既定オフ、推しの節にある', () => {
    const { ctx } = setup({ mood: false });
    const item = ctx.apiPrefs().items.find((p) => p.key === 'oshi.mood');
    expect(item).toMatchObject({ scope: 'me', type: 'bool', def: false, section: '推し', value: false });
    expect(ctx.apiPrefs().effective.oshi.mood).toBe(false);
    expect(ctx.apiOshiGet().mood).toBe(null);
    ctx.apiPrefSet('oshi.mood', true);
    expect(ctx.apiPrefs().effective.oshi.mood).toBe(true);
  });
});
