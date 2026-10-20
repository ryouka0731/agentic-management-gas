import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';
import { APP_SOURCES } from './sources.js';

/*
 * 集中のしかた (src/core/Focus.gs と src/api/Focus.gs)。
 * 始めたことを番頭の中の手で確かめる・本人にだけ見せる・数は台帳から数える・連続日数を持たない、を固定する。
 */

const ME = 'tester@example.com';
const OTHER = 'b@example.com';

function setup(opts) {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...APP_SOURCES);
  ctx.repoInit('agentic-management');
  if (!opts || opts.on !== false) ctx.apiPrefSet('focus.start', true);
  return { ctx, fake };
}

function issue(ctx, title) {
  return ctx.issueCreate(title || 'やること', '', []).number;
}

/** 1分前に開いて、いま始めた形 (このあとの手は「始めたあと」になる) */
function startedAgo(ctx, n, opts) {
  const o = opts || {};
  const now = new Date(Date.now() - (o.ago || 60000));
  const opened = new Date(now.getTime() - (o.panel || 10000));
  return ctx.focusStart_(o.who || ME, n, o.minutes || 25, o.step || '', opened.toISOString(), now);
}

describe('始める', () => {
  it('番号は通しで振り、行に本人 (小文字)・長さ・始めた時刻・開いた時刻を残す', () => {
    const { ctx, fake } = setup();
    const n = issue(ctx);
    fake._setUser('Tester@Example.com');
    const a = ctx.apiFocusStart(n, 25, '', new Date(Date.now() - 5000).toISOString());
    const b = ctx.apiFocusStart(n, 45, '', '');
    expect([a.id, b.id]).toEqual([1, 2]);
    const rows = ctx.dbReadAll('focus_sessions');
    expect(rows[1].who).toBe('tester@example.com');
    expect(Number(rows[1].plannedMinutes)).toBe(45);
    expect(a.title).toBe('やること');
    // 開いた時刻は始めた時刻より前 (5秒前)
    expect(Date.parse(a.startedAt) - Date.parse(a.openedAt)).toBeGreaterThanOrEqual(4000);
  });

  it('次を始めると、終えていない前の記録は「終えないまま次を始めた」(left) になる', () => {
    const { ctx } = setup();
    const n = issue(ctx);
    ctx.apiFocusStart(n, 25, '', '');
    ctx.apiFocusStart(n, 25, '', '');
    const rows = ctx.dbReadAll('focus_sessions');
    expect(rows[0].result).toBe('left');
    expect(rows[0].endedAt).toBeTruthy();
    expect(rows[1].endedAt).toBeFalsy();
  });

  it('開いた時刻が先・1時間より前・読めないときは、始めた時刻に倒す', () => {
    const { ctx } = setup();
    const n = issue(ctx);
    const now = new Date();
    ['2099-01-01T00:00:00Z', new Date(now.getTime() - 2 * 3600000).toISOString(), 'きのう'].forEach((opened) => {
      const row = ctx.focusStart_(ME, n, 25, '', opened, now);
      expect(row.openedAt.getTime()).toBe(now.getTime());
    });
  });

  it('長さは1〜180分の整数。完了したもの・無い番号では始められない', () => {
    const { ctx } = setup();
    const n = issue(ctx);
    expect(() => ctx.apiFocusStart(n, 0, '', '')).toThrow('1〜180分');
    expect(() => ctx.apiFocusStart(n, 181, '', '')).toThrow('1〜180分');
    expect(() => ctx.apiFocusStart(n, 2.5, '', '')).toThrow('1〜180分');
    expect(() => ctx.apiFocusStart(999, 25, '', '')).toThrow('#999');
    ctx.issueClose(n, null);
    expect(() => ctx.apiFocusStart(n, 25, '', '')).toThrow('完了しています');
  });

  it('自分の設定でオンにしていなければ断る (既定はオフ)', () => {
    const { ctx } = setup({ on: false });
    const n = issue(ctx);
    expect(() => ctx.apiFocusStart(n, 25, '', '')).toThrow('集中のしかた');
    expect(ctx.dbReadAll('focus_sessions')).toEqual([]);
  });

  it('最初の一手を書いたら、その時点で「始めた」になる', () => {
    const { ctx } = setup();
    const n = issue(ctx);
    const out = ctx.apiFocusStart(n, 25, '  昼から戻ったら第3条を開く  ', '');
    expect(out.provedAt).toBe(out.startedAt);
    expect(out.proofKind).toBe('firstStep');
    expect(out.firstStep).toBe('昼から戻ったら第3条を開く');
  });
});

describe('始めたことを確かめる (番頭の中の手で)', () => {
  it('何もしていなければ確かめない', () => {
    const { ctx } = setup();
    const s = startedAgo(ctx, issue(ctx));
    const got = ctx.apiFocusProve(s.id, 'comment');
    expect(got.fresh).toBe(false);
    expect(got.session.provedAt).toBe('');
  });

  it('そのやることにやりとりを書くと「始めた」になる (時刻はやりとりの時刻)', () => {
    const { ctx } = setup();
    const n = issue(ctx);
    const s = startedAgo(ctx, n);
    const c = ctx.issueCommentAdd(n, 'まず第3条から');
    const got = ctx.apiFocusProve(s.id, 'comment');
    expect(got.fresh).toBe(true);
    expect(got.session.proofKind).toBe('comment');
    expect(got.session.provedAt).toBe(new Date(c.at).toISOString());
    // 二度目は何もしない
    expect(ctx.apiFocusProve(s.id, 'comment').fresh).toBe(false);
  });

  it('ほかの人のやりとり・別のやることのやりとり・始める前のやりとりでは確かめない', () => {
    const { ctx, fake } = setup();
    const n = issue(ctx);
    const other = issue(ctx, '別のもの');
    ctx.issueCommentAdd(n, '始める前に書いた');
    const s = startedAgo(ctx, n, { ago: -1000 }); // 1秒先に始めた形 (前のやりとりは始める前)
    ctx.issueCommentAdd(other, '別のやることへ');
    fake._setUser(OTHER);
    ctx.issueCommentAdd(n, 'ほかの人が書いた');
    fake._setUser(ME);
    expect(ctx.focusEvidence_(ctx.dbFindOne('focus_sessions', 'id', s.id), 'comment', new Date(Date.now() + 5000))).toBe(null);
  });

  it('やることを直すと (変更の履歴に本人の行が残ると)「始めた」になる', () => {
    const { ctx } = setup();
    const n = issue(ctx);
    const s = startedAgo(ctx, n);
    ctx.issueUpdate(n, { title: '直した題名' });
    expect(ctx.apiFocusProve(s.id, 'edit').session.proofKind).toBe('edit');
  });

  it('ボードで作業中へ動かしたと言われたら、いま作業中にあるときだけ確かめる', () => {
    const { ctx } = setup();
    const n = issue(ctx);
    const s = startedAgo(ctx, n);
    ctx.projectMove(n, 'Backlog', 0);
    expect(ctx.apiFocusProve(s.id, 'move').fresh).toBe(false);
    ctx.projectMove(n, 'In Progress', 0);
    // 言われなければ見ない (ボードの移し替えは履歴に残らないので、いまの置き場で確かめる)
    expect(ctx.apiFocusProve(s.id, '').fresh).toBe(false);
    expect(ctx.apiFocusProve(s.id, 'move').session.proofKind).toBe('move');
  });

  it('始める前から作業中にあったカードは、ボードの手として数えない (始めたあとに動かしたときだけ)', () => {
    const { ctx } = setup();
    const n = issue(ctx);
    ctx.projectMove(n, 'In Progress', 0);
    const s = startedAgo(ctx, n);
    expect(ctx.dbFindOne('focus_sessions', 'id', s.id).columnAtStart).toBe('In Progress');
    expect(ctx.apiFocusProve(s.id, 'move').fresh).toBe(false);
    // 一度外して戻しても、始めた時点の置き場は作業中のまま (移し替えの履歴が無いので確かめようがない)
    ctx.projectMove(n, 'Backlog', 0);
    ctx.projectMove(n, 'In Progress', 0);
    expect(ctx.apiFocusProve(s.id, 'move').fresh).toBe(false);
  });

  it('始めた時点で作業中でなかったカードを作業中へ動かすと、ボードの手になる', () => {
    const { ctx } = setup();
    const n = issue(ctx);
    ctx.projectMove(n, 'Backlog', 0);
    const s = startedAgo(ctx, n);
    expect(ctx.dbFindOne('focus_sessions', 'id', s.id).columnAtStart).toBe('Backlog');
    ctx.projectMove(n, 'In Progress', 0);
    expect(ctx.apiFocusProve(s.id, 'move').session.proofKind).toBe('move');
  });

  it('始めた時点で完了の列にあったカードは、ボードの手として数えない', () => {
    const { ctx } = setup();
    const n = issue(ctx);
    ctx.projectMove(n, 'Done', 0);
    const s = startedAgo(ctx, n);
    ctx.projectMove(n, 'In Progress', 0);
    expect(ctx.apiFocusProve(s.id, 'move').fresh).toBe(false);
  });

  it('始めた時点の置き場が空の (列を足す前の) 記録は、ボードの手として数えない。ほかの手は数える', () => {
    const { ctx } = setup();
    const n = issue(ctx);
    ctx.dbAppend('focus_sessions', { id: 70, issueNumber: n, who: ME, plannedMinutes: 25,
      startedAt: new Date(Date.now() - 60000), openedAt: new Date(Date.now() - 70000) });
    ctx.projectMove(n, 'In Progress', 0);
    expect(ctx.apiFocusProve(70, 'move').fresh).toBe(false);
    ctx.issueUpdate(n, { title: '直した題名' });
    expect(ctx.apiFocusProve(70, 'edit').session.proofKind).toBe('edit');
  });

  it('そのやることから作った改訂版に記録すると「始めた」になる。ほかの改訂版では確かめない', () => {
    const { ctx } = setup();
    const n = issue(ctx);
    const s = startedAgo(ctx, n);
    ctx.dbAppend('commits', { sha: 'x1', branch: 'issue-' + n + '0-別', author: ME, timestamp: new Date() });
    expect(ctx.apiFocusProve(s.id, 'record').fresh).toBe(false);
    ctx.dbAppend('commits', { sha: 'x2', branch: 'issue-' + n + '-見直し', author: ME, timestamp: new Date() });
    expect(ctx.apiFocusProve(s.id, 'record').session.proofKind).toBe('record');
  });

  it('終えるときにも台帳を見て確かめる (書いてから終えた人を取りこぼさない)', () => {
    const { ctx } = setup();
    const n = issue(ctx);
    const s = startedAgo(ctx, n);
    ctx.issueCommentAdd(n, '書いた');
    const out = ctx.apiFocusEnd(s.id, 'stopped');
    expect(out.result).toBe('stopped');
    expect(out.proofKind).toBe('comment');
  });
});

describe('本人のぶんだけ', () => {
  it('ほかの人の記録は確かめる・延ばす・終えるのどれも断る', () => {
    const { ctx, fake } = setup();
    const s = startedAgo(ctx, issue(ctx));
    fake._setUser(OTHER);
    expect(() => ctx.apiFocusProve(s.id, 'comment')).toThrow('ほかの人の集中の記録');
    expect(() => ctx.apiFocusExtend(s.id, 10)).toThrow('ほかの人の集中の記録');
    expect(() => ctx.apiFocusEnd(s.id, 'stopped')).toThrow('ほかの人の集中の記録');
    expect(ctx.dbFindOne('focus_sessions', 'id', s.id).endedAt).toBeFalsy();
  });

  it('自分の記録の一覧には、ほかの人のものが入らない', () => {
    const { ctx, fake } = setup();
    const n = issue(ctx);
    startedAgo(ctx, n, { who: OTHER, step: 'ほかの人の一手' });
    const mine = ctx.apiFocusMine();
    expect(mine.active).toBe(null);
    expect(mine.week.started).toBe(0);
    fake._setUser(OTHER);
    expect(ctx.apiFocusMine().week.started).toBe(1);
  });

  it('誰か分からなければ断る', () => {
    const { ctx, fake } = setup();
    const n = issue(ctx);
    fake._setUser('');
    expect(() => ctx.apiFocusStart(n, 25, '', '')).toThrow('誰か分かりません');
    expect(() => ctx.apiFocusMine()).toThrow('誰か分かりません');
  });

  it('アドレスを受ける関数は画面から呼べない (末尾 _)', () => {
    const { ctx } = setup();
    const open = Object.keys(ctx).filter((k) => /^focus/.test(k) && typeof ctx[k] === 'function' && !/_$/.test(k));
    expect(open).toEqual([]);
  });
});

describe('延ばす・終える・続いているもの', () => {
  it('「もう少し」で10分ずつ延ばす。終えたものは延ばせない', () => {
    const { ctx } = setup();
    const s = startedAgo(ctx, issue(ctx));
    expect(ctx.apiFocusExtend(s.id).extendedMinutes).toBe(10);
    expect(ctx.apiFocusExtend(s.id, 10).extendedMinutes).toBe(20);
    ctx.apiFocusEnd(s.id, 'done');
    expect(() => ctx.apiFocusExtend(s.id, 10)).toThrow('終わっています');
  });

  it('終わり方は done / stopped だけ。二度押しは前のまま返す', () => {
    const { ctx } = setup();
    const s = startedAgo(ctx, issue(ctx));
    expect(() => ctx.apiFocusEnd(s.id, 'left')).toThrow('終わり方');
    const a = ctx.apiFocusEnd(s.id, 'done');
    const b = ctx.apiFocusEnd(s.id, 'stopped');
    expect(b.result).toBe('done');
    expect(b.endedAt).toBe(a.endedAt);
  });

  it('続いているものを返す (開き直した画面が輪を描き直せるように)', () => {
    const { ctx } = setup();
    const n = issue(ctx, '規程の見直し');
    const s = startedAgo(ctx, n, { step: '第3条を開く' });
    const mine = ctx.apiFocusMine();
    expect(mine.active.id).toBe(s.id);
    expect(mine.active.title).toBe('規程の見直し');
    ctx.apiFocusEnd(s.id, 'stopped');
    expect(ctx.apiFocusMine().active).toBe(null);
  });

  it('12時間より前に始めたまま置いてあるものは、続いているとみなさない', () => {
    const { ctx } = setup();
    startedAgo(ctx, issue(ctx), { ago: 13 * 3600000 });
    expect(ctx.apiFocusMine().active).toBe(null);
  });
});

describe('ポイント (台帳から数える・参加している人だけ)', () => {
  function joined(ctx) {
    ctx.apiSetGameEnabled(true);
    ctx.apiGameJoin(true);
  }

  it('確かめた始めは1点、開いてから1分のうちに始めたら +1', () => {
    const { ctx } = setup();
    joined(ctx);
    const n = issue(ctx);
    const out = ctx.apiFocusStart(n, 25, '第3条を開く', new Date(Date.now() - 5000).toISOString());
    expect(out.points).toBe(2);
    expect(ctx.gamePointsByPerson_('', '')[ME]).toBe(2);
  });

  it('ゆっくり始めたらボーナスは無い。やることの開始日に始めたら付く', () => {
    const { ctx } = setup();
    joined(ctx);
    const slow = issue(ctx, 'ゆっくり');
    ctx.focusStart_(ME, slow, 25, '一手', new Date(Date.now() - 600000).toISOString(), new Date());
    expect(ctx.gamePointsByPerson_('', '')[ME]).toBe(1);
    const planned = issue(ctx, '今日から');
    ctx.dbUpdate('issues', 'number', planned, { startDate: ctx.motivationDay_(new Date()) });
    ctx.focusStart_(ME, planned, 25, '一手', new Date(Date.now() - 600000).toISOString(), new Date());
    expect(ctx.gamePointsByPerson_('', '')[ME]).toBe(1 + 2);
  });

  it('同じやることには1人1日1回まで (始め直して稼げない)。確かめていない始めは数えない', () => {
    const { ctx } = setup();
    joined(ctx);
    const n = issue(ctx);
    for (let i = 0; i < 4; i++) ctx.apiFocusStart(n, 25, '一手' + i, new Date().toISOString());
    ctx.apiFocusStart(issue(ctx, '書かずに始めた'), 25, '', new Date().toISOString());
    expect(ctx.gamePointsByPerson_('', '')[ME]).toBe(2);
    // 2回目以降の始めの返事は 0 点 (もう数えた)
    expect(ctx.apiFocusStart(n, 25, 'もう一度', new Date().toISOString()).points).toBe(0);
  });

  it('週の上位に参加していない人・ゲームがオフのときは、ポイントにしない', () => {
    const { ctx } = setup();
    const n = issue(ctx);
    ctx.apiSetGameEnabled(true);
    expect(ctx.apiFocusStart(n, 25, '一手', new Date().toISOString()).points).toBe(0);
    expect(ctx.gamePointsByPerson_('', '')[ME]).toBeUndefined();
    ctx.apiGameJoin(true);
    ctx.apiSetGameEnabled(false);
    expect(ctx.apiFocusStart(issue(ctx), 25, '一手', new Date().toISOString()).points).toBe(0);
  });

  it('やることを消すと、集中の記録もポイントも消える', () => {
    const { ctx } = setup();
    joined(ctx);
    const n = issue(ctx);
    ctx.apiFocusStart(n, 25, '一手', new Date().toISOString());
    ctx.issueArchive(n);
    ctx.issuePurge(n);
    expect(ctx.dbReadAll('focus_sessions')).toEqual([]);
    expect(ctx.gamePointsByPerson_('', '')[ME]).toBeUndefined();
  });
});

describe('技の図鑑 (本人だけ・台帳から数える)', () => {
  function badges(ctx) {
    const out = {};
    ctx.apiFocusMine().badges.forEach((b) => { out[b.key] = b; });
    return out;
  }

  it('何もしていなければ全部まだ。まだのものは名前も中身も返さない', () => {
    const { ctx } = setup();
    const all = ctx.apiFocusMine().badges;
    expect(all.map((b) => b.key)).toEqual(['lightning', 'early', 'finish', 'comeback', 'steps', 'starts10']);
    all.forEach((b) => {
      expect(b.done).toBe(false);
      expect(b.label).toBe('');
      expect(b.about).toBe('');
    });
  });

  it('電光石火: 開いてから1分のうちに確かめた。2分かかったら付かない', () => {
    const { ctx } = setup();
    const n = issue(ctx);
    const slow = startedAgo(ctx, n, { panel: 120000 });
    ctx.issueCommentAdd(n, '書いた');
    ctx.apiFocusProve(slow.id, 'comment');
    expect(badges(ctx).lightning.done).toBe(false);
    ctx.apiFocusStart(n, 25, 'すぐ書いた', new Date(Date.now() - 3000).toISOString());
    expect(badges(ctx).lightning.done).toBe(true);
    expect(badges(ctx).lightning.label).toBe('電光石火');
  });

  it('一番乗り: その日の最初の集中を10時より前 (東京) に始めた。2つ目が朝でも数えない', () => {
    const { ctx } = setup();
    const n = issue(ctx);
    const day = '2026-10-14';
    ctx.focusStart_(ME, n, 25, '', '', new Date(day + 'T02:00:00Z')); // 東京 11時
    ctx.dbAppend('focus_sessions', { id: 90, issueNumber: n, who: ME, startedAt: new Date(day + 'T00:30:00Z') }); // 9時半
    expect(badges(ctx).early.done).toBe(true);
    expect(badges(ctx).early.at).toBe(day);

    const second = setup();
    const m = issue(second.ctx);
    second.ctx.focusStart_(ME, m, 25, '', '', new Date(day + 'T01:30:00Z')); // 10時半が最初
    second.ctx.dbAppend('focus_sessions', { id: 91, issueNumber: m, who: ME, startedAt: new Date(day + 'T02:30:00Z') });
    expect(badges(second.ctx).early.done).toBe(false);
  });

  it('やりきった・七転び八起き (延ばしたあと最後まで)。やめたものは数えない', () => {
    const { ctx } = setup();
    const n = issue(ctx);
    const a = startedAgo(ctx, n);
    ctx.apiFocusExtend(a.id);
    ctx.apiFocusEnd(a.id, 'stopped');
    expect(badges(ctx).comeback.done).toBe(false);
    expect(badges(ctx).finish.done).toBe(false);
    const b = startedAgo(ctx, n);
    ctx.apiFocusEnd(b.id, 'done');
    expect(badges(ctx).finish.done).toBe(true);
    expect(badges(ctx).comeback.done).toBe(false);
    const c = startedAgo(ctx, n);
    ctx.apiFocusExtend(c.id);
    ctx.apiFocusEnd(c.id, 'done');
    expect(badges(ctx).comeback.done).toBe(true);
  });

  it('小さな一歩: 最初の一手を10回書いた (9回では付かない)', () => {
    const { ctx } = setup();
    const n = issue(ctx);
    for (let i = 0; i < 9; i++) ctx.apiFocusStart(n, 15, '一手' + i, '');
    expect(badges(ctx).steps.done).toBe(false);
    ctx.apiFocusStart(n, 15, '十回目', '');
    expect(badges(ctx).steps.done).toBe(true);
    expect(badges(ctx).starts10.done).toBe(true);
  });

  it('連続日数は返さない', () => {
    const { ctx } = setup();
    ctx.apiFocusStart(issue(ctx), 15, '一手', '');
    const text = JSON.stringify(ctx.apiFocusMine());
    expect(text).not.toMatch(/streak|連続/);
  });
});

describe('自分の数 (今週・始めるまでの時間)', () => {
  it('今週に始めた・確かめた・やりきった数。先週のものは入らない', () => {
    const { ctx } = setup();
    const n = issue(ctx);
    const a = startedAgo(ctx, n, { step: '一手' });
    ctx.apiFocusEnd(a.id, 'done');
    startedAgo(ctx, n);
    ctx.dbAppend('focus_sessions', { id: 80, issueNumber: n, who: ME, startedAt: new Date(Date.now() - 8 * 86400000),
      provedAt: new Date(Date.now() - 8 * 86400000), result: 'done' });
    expect(ctx.apiFocusMine().week).toEqual({ started: 2, proved: 1, finished: 1 });
  });

  it('始めるまでの時間を、1分・5分・15分・それより長くに分けて数える', () => {
    const { ctx } = setup();
    const n = issue(ctx);
    [30, 200, 600, 2000, 50].forEach((sec, i) => {
      const now = new Date(Date.now() - 3600000 + i * 1000);
      ctx.dbAppend('focus_sessions', { id: 100 + i, issueNumber: n, who: ME, startedAt: now,
        openedAt: new Date(now.getTime() - sec * 1000), provedAt: now });
    });
    startedAgo(ctx, n); // 確かめていないものは数えない
    const mine = ctx.apiFocusMine();
    expect(mine.toStart).toEqual([
      { label: '1分以内', count: 2 }, { label: '5分以内', count: 1 },
      { label: '15分以内', count: 1 }, { label: 'それより長く', count: 1 },
    ]);
    expect(mine.measured).toBe(5);
  });
});

describe('鍵', () => {
  it('始めるのは鍵の中 (前の記録を閉じて番号を振るまで)。鍵が取れなければ何も書かない', () => {
    const { ctx, fake } = setup();
    const n = issue(ctx);
    ctx.apiFocusStart(n, 25, '', '');
    const saved = fake.LockService.getScriptLock;
    fake.LockService.getScriptLock = () => ({ tryLock: () => false, waitLock() { throw new Error('x'); }, releaseLock() {} });
    try {
      expect(() => ctx.apiFocusStart(n, 25, '', '')).toThrow();
    } finally {
      fake.LockService.getScriptLock = saved;
    }
    const rows = ctx.dbReadAll('focus_sessions');
    expect(rows.length).toBe(1);
    expect(rows[0].endedAt).toBeFalsy();
  });
});
