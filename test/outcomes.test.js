import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';
import { APP_SOURCES } from './sources.js';

/*
 * 成果の数 (src/core/Outcomes.gs) を、手で数えた値と突き合わせる。
 *
 * 疑似GAS に1か月ぶんの台帳を置き、日ごとの数を全部の日について決め打ちで比べる。数え方
 * (7日以上動きが無かった・7日以内に開き直されなかった・差し戻し無しで反映した…) を変えると落ちる。
 * 期待する数は下の筋書きの各行の注に書いた手計算で、コードから写したものではない。
 */

/** 東京の時刻 */
const T = (s) => new Date(s.replace(' ', 'T') + ':00+09:00');

function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...APP_SOURCES);
  ctx.repoInit('agentic-management');
  return { fake, ctx };
}

/**
 * 1か月 (2026年10月) の台帳を置く。
 *
 * やること:
 *  #1 10-01 作る → 10-02 やりとり → (止まる) → 10-10 やりとり [動いた] → 10-12 完了 [きれい]
 *  #2 10-01 作る → 10-03 完了 → 10-08 開き直し [見張り。10-03 の完了はきれいでない] → 10-09 完了 [きれい]
 *  #3 10-01 作る・期限 10-05 → 10-20 完了 [動いた・きれい]。期限切れは 10-06〜10-19 の14日
 *  #4 10-01 作る → 10-07 やりとり (6日目なので止まっていない) → 10-14 やりとり [ちょうど7日で動いた]
 *  #5 10-01 作る・期限 10-02 → 10-04 置き場へ。期限切れは 10-03 の1日だけ
 *  #6 10-01 作る → 10-25 完了 [動いた] → 10-30 開き直し [10-25 の完了はきれいでない]
 *  #7 履歴の無い古い行 (10-02 に完了)。期限 10-01 だが、10-01 の終わりでは期限は過ぎていない
 * 確認依頼:
 *  1 10-02 出す → 10-03 差し戻し → 10-05 承認 → 10-06 反映 [差し戻しがあったのできれいでない]
 *  2 10-01 改訂版に記録 (出す前。10-12 の前の動きは 10-02 の「出す」) → 10-02 出す → 10-12 記録 [動いた] → 10-13 承認・反映 [きれい]
 *  3 10-02 出す → 10-20 コメント [動いた]
 *  4 10-02 出す (改訂D) → 取り下げ → 10-20 コメント。取り下げた依頼は数えない
 *  5 10-15 同じ改訂D から出し直す → 10-25 記録 [動いた]。記録は取り下げた4には付けない
 */
function placeMonth(ctx) {
  let id = 0;
  const log = (n, action, at, actor = 'a@x') =>
    ctx.dbAppend('change_log', { id: ++id, at: T(at), actor, target: 'issue:' + n, action, field: '', before: '', after: '' });
  const issue = (n, extra = {}) => ctx.dbAppend('issues', Object.assign({
    number: n, title: 'やること' + n, body: '', state: 'open', assignee: '', labels: '',
    createdAt: T('2026-10-01 09:00'), updatedAt: T('2026-10-01 09:00'), closedAt: '', archivedAt: '', dueDate: '',
  }, extra));
  const comment = (n, at, by) => ctx.dbAppend('issue_comments', { id: ++id, issueNumber: n, body: 'x', by, at: T(at) });

  for (let n = 1; n <= 6; n++) log(n, 'create', '2026-10-01 09:00');
  issue(1, { state: 'closed', closedAt: T('2026-10-12 15:00') });
  comment(1, '2026-10-02 10:00', 'A@X');
  comment(1, '2026-10-10 11:00', 'e@x');
  log(1, 'close', '2026-10-12 15:00');

  issue(2, { state: 'closed', closedAt: T('2026-10-09 10:00') });
  log(2, 'close', '2026-10-03 10:00');
  log(2, 'reopen', '2026-10-08 10:00', 'b@x');
  log(2, 'close', '2026-10-09 10:00');

  issue(3, { state: 'closed', dueDate: '2026-10-05', closedAt: T('2026-10-20 12:00') });
  log(3, 'close', '2026-10-20 12:00');

  issue(4);
  comment(4, '2026-10-07 10:00', 'f@x');
  comment(4, '2026-10-14 10:00', 'f@x');

  issue(5, { dueDate: '2026-10-02', archivedAt: T('2026-10-04 10:00') });

  issue(6);
  log(6, 'close', '2026-10-25 10:00');
  log(6, 'reopen', '2026-10-30 10:00');

  issue(7, { state: 'closed', dueDate: '2026-10-01', closedAt: T('2026-10-02 10:00') });

  const pull = (number, branch, extra) => ctx.dbAppend('pulls', Object.assign({
    number, title: '依頼' + number, body: '', sourceBranch: branch, targetBranch: 'main', state: 'open',
    author: 'b@x', createdAt: T('2026-10-02 09:00'), mergedAt: '', reviewers: 'c@x',
  }, extra));
  const review = (pr, state, at) => ctx.dbAppend('reviews', { prNumber: pr, reviewer: 'c@x', state, body: '', at: T(at), id: ++id });
  const commit = (branch, at) => ctx.dbAppend('commits', {
    sha: 's' + (++id), parentSha: '', branch, fileId: 'f', blobSha: 'b', author: 'd@x', message: '直した', timestamp: T(at),
  });

  pull(1, '改訂A', { state: 'merged', mergedAt: T('2026-10-06 10:00') });
  review(1, 'request_changes', '2026-10-03 10:00');
  review(1, 'approve', '2026-10-05 10:00');

  pull(2, '改訂B', { state: 'merged', createdAt: T('2026-10-02 09:30'), mergedAt: T('2026-10-13 15:00') });
  commit('改訂B', '2026-10-01 10:00');
  commit('改訂B', '2026-10-12 09:00');
  review(2, 'approve', '2026-10-13 10:00');

  pull(3, '改訂C', {});
  review(3, 'comment', '2026-10-20 10:00');

  pull(4, '改訂D', { state: 'closed' });
  review(4, 'comment', '2026-10-20 10:30');
  pull(5, '改訂D', { createdAt: T('2026-10-15 09:00') });
  commit('改訂D', '2026-10-25 11:00');

  ctx.dbAppend('inquiries', { number: 1, kind: 'bug', body: 'x', by: 'g@x', at: T('2026-10-20 11:00'), state: 'open' });

  // 混み合いは日ごとの数 (dbBusyNote_)、時間切れは使われ方の場所 error:timeout から数える
  ctx.PropertiesService.getScriptProperties().setProperty('OUTCOME_BUSY:2026-10-10', '4');
  ctx.dbAppend('usage', { day: '2026-10-10', kind: 'action', target: 'error:timeout', count: 2, user: 'a@x' });
  ctx.dbAppend('usage', { day: '2026-10-10', kind: 'action', target: 'error:timeout', count: 1, user: 'b@x' });
  ctx.dbAppend('usage', { day: '2026-10-10', kind: 'action', target: 'docs', count: 9, user: 'b@x' });
}

/** 10月の日ごとの数。書いていない日は0 */
const EXPECTED = {
  moved: { '2026-10-10': 1, '2026-10-12': 1, '2026-10-14': 1, '2026-10-20': 2, '2026-10-25': 2 },
  closedClean: { '2026-10-09': 1, '2026-10-12': 1, '2026-10-20': 1 },
  mergedClean: { '2026-10-13': 1 },
  reopened: { '2026-10-08': 1, '2026-10-30': 1 },
  overdue: Object.assign({ '2026-10-03': 1 },
    Object.fromEntries(Array.from({ length: 14 }, (_, i) => ['2026-10-' + String(6 + i).padStart(2, '0'), 1]))),
  activePeople: {
    '2026-10-01': 2, '2026-10-02': 2, '2026-10-03': 2, '2026-10-05': 1, '2026-10-07': 1, '2026-10-08': 1,
    '2026-10-09': 1, '2026-10-10': 1, '2026-10-12': 2, '2026-10-13': 1, '2026-10-14': 1, '2026-10-15': 1,
    '2026-10-20': 3, '2026-10-25': 2, '2026-10-30': 1,
  },
  busyErrors: { '2026-10-10': 4 },
  timeoutErrors: { '2026-10-10': 3 },
};
const DAYS = Array.from({ length: 31 }, (_, i) => '2026-10-' + String(i + 1).padStart(2, '0'));

describe('成果の数を手で数えた値と突き合わせる', () => {
  const { ctx } = setup();
  placeMonth(ctx);
  const led = ctx.outcomesLedger_();
  const got = Object.fromEntries(DAYS.map((d) => [d, ctx.outcomesTally_(d, led)]));

  it.each(Object.keys(EXPECTED))('%s が全部の日で手計算と同じ', (field) => {
    const want = Object.fromEntries(DAYS.map((d) => [d, EXPECTED[field][d] || 0]));
    const have = Object.fromEntries(DAYS.map((d) => [d, got[d][field]]));
    expect(have).toEqual(want);
  });

  it('台帳を渡さなくても同じ数になる (1日だけ数えるとき)', () => {
    expect(ctx.outcomesTally_('2026-10-20')).toEqual(got['2026-10-20']);
  });

  it('人の名前もアドレスも入れない', () => {
    const text = JSON.stringify(got);
    expect(text).not.toMatch(/@/);
  });
});

describe('楽しさの層を切っている人 (fxOff)', () => {
  it('はっきり false と書いた人だけを数える', () => {
    const { ctx } = setup();
    const props = ctx.PropertiesService.getScriptProperties();
    props.setProperty('MYPREF:x@x', JSON.stringify({ 'fun.combo': false }));
    props.setProperty('MYPREF:y@x', JSON.stringify({ 'fun.combo': true }));
    props.setProperty('MYPREF:z@x', JSON.stringify({ 'home.cards.game': false, 'fun.words': false }));
    props.setProperty('MYPREF:w@x', JSON.stringify({ 'focus.remind': 'end', 'home.cards.turn': false }));
    props.setProperty('MYPREF:v@x', JSON.stringify({ 'oshi.show': false }));
    props.setProperty('MYPREF:u@x', '{壊れた');
    props.setProperty('PREF:fun.combo', 'false');
    expect(ctx.outcomesFxOff_()).toBe(3);
  });
});

describe('1日1回の数え直し (outcomesDaily_)', () => {
  function counted(ctx) {
    return ctx.dbReadAll('outcomes_daily').map((r) => Object.assign({}, r, { day: ctx.usageDayOf_(r.day) }));
  }

  it('きのうから8日を数え、同じ日の行は上書きする (行を増やさない)', () => {
    const { ctx } = setup();
    placeMonth(ctx);
    ctx.outcomesDaily_(T('2026-10-21 00:05'));
    ctx.outcomesDaily_(T('2026-10-21 00:06'));
    const rows = counted(ctx);
    expect(rows.map((r) => r.day).sort()).toEqual(DAYS.slice(12, 20));
    expect(rows.find((r) => r.day === '2026-10-20')).toMatchObject({ moved: 2, closedClean: 1, activePeople: 3 });
  });

  it('7日のうちに開き直されたら、前の日の「きれいに終わった」を数え直して下げる', () => {
    // 10-26 の時点では、10-30 の開き直しはまだ台帳に無い。外しておいて、あとから入れる
    const { ctx: c2 } = setup();
    placeMonth(c2);
    const rows = c2.dbReadAll('change_log');
    const reopen = rows.find((r) => r.target === 'issue:6' && r.action === 'reopen');
    c2.dbDelete('change_log', 'id', reopen.id);
    c2.outcomesDaily_(T('2026-10-26 00:05'));
    expect(counted(c2).find((r) => r.day === '2026-10-25').closedClean).toBe(1);
    c2.dbAppend('change_log', reopen);
    c2.outcomesDaily_(T('2026-10-31 00:05'));
    expect(counted(c2).find((r) => r.day === '2026-10-25').closedClean).toBe(0);
    expect(counted(c2).filter((r) => r.day === '2026-10-25')).toHaveLength(1);
  });

  it('fxOff はきのうの行にだけ入れ、前の日の値は数え直しで消さない', () => {
    const { ctx } = setup();
    const props = ctx.PropertiesService.getScriptProperties();
    props.setProperty('MYPREF:x@x', JSON.stringify({ 'fun.combo': false }));
    ctx.outcomesDaily_(T('2026-10-20 00:05'));
    props.setProperty('MYPREF:y@x', JSON.stringify({ 'focus.start': false }));
    ctx.outcomesDaily_(T('2026-10-21 00:05'));
    const rows = counted(ctx);
    expect(rows.find((r) => r.day === '2026-10-19').fxOff).toBe(1);
    expect(rows.find((r) => r.day === '2026-10-20').fxOff).toBe(2);
    expect(rows.find((r) => r.day === '2026-10-13').fxOff).toBe('');
  });

  it('混み合いの日ごとの数は、残す日数より古いものを消す', () => {
    const { ctx } = setup();
    const props = ctx.PropertiesService.getScriptProperties();
    props.setProperty('OUTCOME_BUSY:2026-10-01', '2');
    props.setProperty('OUTCOME_BUSY:2026-10-07', '1');
    props.setProperty('OUTCOME_BUSY:2026-10-20', '5');
    ctx.outcomesDaily_(T('2026-10-21 00:05'));
    expect(props.getProperty('OUTCOME_BUSY:2026-10-01')).toBe(null);
    expect(props.getProperty('OUTCOME_BUSY:2026-10-07')).toBe('1');
    expect(counted(ctx).find((r) => r.day === '2026-10-20').busyErrors).toBe(5);
  });

  it('数えるのは鍵の外で、鍵を取るのは書くときの1回だけ。取れなければ投げずに諦める', () => {
    const { ctx } = setup();
    placeMonth(ctx);
    let tries = 0;
    let readsInLock = 0;
    const realRead = ctx.dbReadAll;
    ctx.dbReadAll = (t) => { if (ctx.dbLockDepth_ > 0 && t !== 'outcomes_daily') readsInLock++; return realRead(t); };
    ctx.LockService = { getScriptLock: () => ({ tryLock: () => { tries++; return true; }, releaseLock: () => {} }) };
    ctx.outcomesDaily_(T('2026-10-21 00:05'));
    expect(tries).toBe(1);
    expect(readsInLock).toBe(0);

    ctx.LockService = { getScriptLock: () => ({ tryLock: () => false, releaseLock: () => {} }) };
    const before = ctx.PropertiesService.getScriptProperties().getProperty('OUTCOME_BUSY:2026-10-22');
    expect(() => ctx.outcomesDaily_(T('2026-10-22 00:05'))).not.toThrow();
    // 黙って次に回す (onBusy) ものは、人への断りとして数えない
    expect(ctx.PropertiesService.getScriptProperties().getProperty('OUTCOME_BUSY:2026-10-22')).toBe(before);
  });

  it('1日1回の片付けのあとに、片付けとは別の印で1回だけ数える', () => {
    const { ctx } = setup();
    placeMonth(ctx);
    const props = ctx.PropertiesService.getScriptProperties();
    const today = ctx.usageDay(new Date());
    // 片付けが済んでいない日は数えない
    expect(ctx.outcomesDailyOnce_()).toBe(false);
    ctx.processCommandQueue();
    expect(props.getProperty('ARCHIVE_HOUSEKEPT_ON')).toBe(today);
    expect(props.getProperty('OUTCOMES_ON')).toBe(today);
    expect(ctx.dbReadAll('outcomes_daily')).toHaveLength(8);
    expect(ctx.outcomesDailyOnce_()).toBe(false);
  });

  it('数えるところで落ちても、片付けの印は済みのまま (片付けをやり直さない)。次の回に数え直す', () => {
    const { ctx } = setup();
    placeMonth(ctx);
    const props = ctx.PropertiesService.getScriptProperties();
    const today = ctx.usageDay(new Date());
    const real = ctx.outcomesDaily_;
    ctx.outcomesDaily_ = () => { throw new Error('Exceeded maximum execution time'); };
    ctx.processCommandQueue();
    expect(props.getProperty('ARCHIVE_HOUSEKEPT_ON')).toBe(today);
    expect(props.getProperty('OUTCOMES_ON')).toBe(null);
    expect(props.getProperty('OUTCOMES_RUNNING')).toBe(null);
    ctx.outcomesDaily_ = real;
    let archives = 0;
    const realHk = ctx.issueHousekeep;
    ctx.issueHousekeep = function () { archives++; return realHk.apply(this, arguments); };
    ctx.processCommandQueue();
    expect(archives).toBe(0);
    expect(props.getProperty('OUTCOMES_ON')).toBe(today);
    expect(ctx.dbReadAll('outcomes_daily')).toHaveLength(8);
  });
});

describe('「混み合っています」を数える (dbBusyNote_)', () => {
  it('人に断ったときだけ、その日の数に足す', () => {
    const { ctx } = setup();
    ctx.LockService = { getScriptLock: () => ({ tryLock: () => false, releaseLock: () => {} }) };
    const key = 'OUTCOME_BUSY:' + ctx.usageDay(new Date());
    expect(() => ctx.dbWithLock_(10, () => 1)).toThrow(/混み合っています/);
    expect(() => ctx.dbWithLock_(10, () => 1)).toThrow(/混み合っています/);
    expect(ctx.dbWithLock_(10, () => 1, () => 'skip')).toBe('skip');
    expect(ctx.PropertiesService.getScriptProperties().getProperty(key)).toBe('2');
  });
});

describe('週ごとの合計 (outcomesWeeks_)', () => {
  const day = (d, o) => Object.assign({ day: d, moved: 0, closedClean: 0, mergedClean: 0, reopened: 0, overdue: 0,
    activePeople: 0, busyErrors: 0, timeoutErrors: 0, fxOff: '' }, o);

  it('終わった週だけを、月曜から日曜で足す。量の数は週の最後の日の値', () => {
    const { ctx } = setup();
    const rows = [
      day('2026-10-12', { moved: 2, activePeople: 3, overdue: 4, fxOff: 1 }),
      day('2026-10-14', { moved: 1, closedClean: 2, activePeople: 4, overdue: 2, busyErrors: 3 }),
      day('2026-10-18', { mergedClean: 1, activePeople: 1, overdue: 5, fxOff: 2, timeoutErrors: 1 }),
      // 今週 (10-19〜) は出さない
      day('2026-10-19', { moved: 9, activePeople: 9 }),
      // 前の週は人が2人まで
      day('2026-10-06', { moved: 5, activePeople: 2 }),
    ];
    const weeks = ctx.outcomesWeeks_(rows, 2, T('2026-10-21 12:00'));
    expect(JSON.parse(JSON.stringify(weeks))).toEqual([
      { start: '2026-10-12', end: '2026-10-18', days: 3, people: 4, hidden: false, moved: 3, closedClean: 2,
        mergedClean: 1, reopened: 0, busyErrors: 3, timeoutErrors: 1, overdue: 5, fxOff: 2 },
      { start: '2026-10-05', end: '2026-10-11', days: 1, people: null, hidden: true, moved: null, closedClean: null,
        mergedClean: null, reopened: null, busyErrors: null, timeoutErrors: null, overdue: null, fxOff: null },
    ]);
  });
});
