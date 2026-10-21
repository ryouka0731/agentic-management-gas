import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';
import { APP_SOURCES } from './sources.js';

/*
 * 自分へのご褒美 (src/core/Reward.gs と src/api/Reward.gs)。換金の代わりに、本人が決めた小さなご褒美と
 * 本人のポイントを交換する。既定はオフ・本人にだけ・たまった数は台帳から数える・残りを超えない・
 * 最後の交換は5分のあいだ取り消せる、を固定する。
 */

const ME = 'tester@example.com';
const OTHER = 'b@example.com';

function setup(opts) {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...APP_SOURCES);
  ctx.repoInit('agentic-management');
  fake._setUser(ME);
  if (!opts || opts.on !== false) ctx.apiPrefSet('luck.reward', true);
  // 開いた時刻から数え始める (それより前に作ったやることは数えない)
  if (!opts || (opts.on !== false && opts.start !== false)) ctx.apiRewardGet();
  return { ctx, fake };
}

/** 本人が担当で、いま閉じたやること */
function closeMine(ctx, who, title) {
  const n = ctx.apiIssueCreate(title || '済ませた', '', []).number;
  ctx.apiIssueUpdate(n, { assignee: who || ME });
  ctx.issueClose(n, null);
  return n;
}

/** 担当なしで作って、本人が閉じたやること (閉じた人の取りぶんになる) */
function closeLoose(ctx) {
  const n = ctx.apiIssueCreate('担当なし', '', []).number;
  ctx.apiIssueClose(n);
  return n;
}

describe('既定はオフ', () => {
  it('オフのあいだはどの入口も断る', () => {
    const { ctx } = setup({ on: false });
    expect(ctx.apiPrefs().effective.luck).toEqual({ on: false, reward: false });
    expect(() => ctx.apiRewardGet()).toThrow('自分の設定でオン');
    expect(() => ctx.apiRewardItemSave({ title: 'コーヒー', cost: 3 })).toThrow('自分の設定でオン');
    expect(() => ctx.apiRewardSpend(1)).toThrow('自分の設定でオン');
    expect(() => ctx.apiRewardUndo(1)).toThrow('自分の設定でオン');
    expect(() => ctx.apiRewardItemDelete(1)).toThrow('自分の設定でオン');
  });

  it('当たりとご褒美は自分の設定 (scope me) で、既定はオフ', () => {
    const { ctx } = setup({ on: false });
    const items = ctx.PREFS_SCHEMA().filter((p) => p.key.indexOf('luck.') === 0);
    expect(items.map((p) => [p.key, p.scope, p.type, p.def])).toEqual([
      ['luck.on', 'me', 'bool', false], ['luck.reward', 'me', 'bool', false]]);
    ctx.apiPrefSet('luck.on', true);
    expect(ctx.apiPrefs().effective.luck).toEqual({ on: true, reward: false });
  });
});

describe('ご褒美の一覧', () => {
  it('足す・直す・外す。名前とポイント (1〜50 の整数) を確かめる', () => {
    const { ctx } = setup();
    let st = ctx.apiRewardItemSave({ title: '  好きなコーヒー ', cost: 5 });
    expect(st.items).toEqual([{ id: 1, title: '好きなコーヒー', cost: 5 }]);
    st = ctx.apiRewardItemSave({ title: '15分の散歩', cost: 3 });
    st = ctx.apiRewardItemSave({ id: 1, title: 'いいコーヒー', cost: 8 });
    expect(st.items.map((i) => [i.id, i.title, i.cost])).toEqual([[1, 'いいコーヒー', 8], [2, '15分の散歩', 3]]);
    st = ctx.apiRewardItemDelete(1);
    expect(st.items.map((i) => i.id)).toEqual([2]);
    expect(() => ctx.apiRewardItemDelete(1)).toThrow('見つかりません');
    expect(() => ctx.apiRewardItemSave({ title: '', cost: 3 })).toThrow('名前');
    expect(() => ctx.apiRewardItemSave({ title: 'x', cost: 0 })).toThrow('1〜50');
    expect(() => ctx.apiRewardItemSave({ title: 'x', cost: 51 })).toThrow('1〜50');
    expect(() => ctx.apiRewardItemSave({ title: 'x', cost: 2.5 })).toThrow('1〜50');
    expect(() => ctx.apiRewardItemSave({ title: 'あ'.repeat(41), cost: 2 })).toThrow('40 字');
    expect(() => ctx.apiRewardItemSave({ id: 99, title: 'x', cost: 2 })).toThrow('見つかりません');
  });

  it('並べられるのは20個まで', () => {
    const { ctx } = setup();
    for (let i = 0; i < 20; i++) ctx.apiRewardItemSave({ title: 'ご褒美' + i, cost: 1 });
    expect(() => ctx.apiRewardItemSave({ title: 'もう1つ', cost: 1 })).toThrow('20 個まで');
  });
});

describe('使えるポイントの数え方', () => {
  it('ポイントに参加していなければ、始めた日から済ませたやること1件を1と数える (保存しない)', () => {
    const { ctx } = setup();
    let st = ctx.apiRewardGet();
    expect(st.rule).toBe('done');
    expect(st.earned).toBe(0);
    closeMine(ctx);
    closeMine(ctx);
    // ほかの人のやることは数えない
    closeMine(ctx, OTHER);
    st = ctx.apiRewardGet();
    expect([st.earned, st.spent, st.available]).toEqual([2, 0, 2]);
    // 台帳から数えるので、開き直せば減る
    const n = closeMine(ctx);
    expect(ctx.apiRewardGet().earned).toBe(3);
    ctx.issueReopen(n);
    expect(ctx.apiRewardGet().earned).toBe(2);
  });

  it('数え始める前に作ったやることは、あとで閉じても数えない (閉じ直して稼げない)', () => {
    const { ctx } = setup({ start: false });
    const old = ctx.apiIssueCreate('前からあったもの', '', []).number;
    ctx.apiIssueUpdate(old, { assignee: ME });
    // 作った時刻と数え始めが同じミリ秒になると「前から」と言えない (重い全体の走りで時々落ちていた)。1分前に作ったことにする
    ctx.dbUpdate('issues', 'number', old, { createdAt: new Date(Date.now() - 60000) });
    ctx.apiRewardGet();
    ctx.issueClose(old, null);
    closeMine(ctx);
    expect(ctx.apiRewardGet().earned).toBe(1);
  });

  it('担当なしで閉じた人の取りぶんは、1日5件まで', () => {
    const { ctx } = setup();
    for (let i = 0; i < 7; i++) closeLoose(ctx);
    // 担当のあるものは絞らない
    closeMine(ctx); closeMine(ctx);
    expect(ctx.apiRewardGet().earned).toBe(7);
  });

  it('ポイントとレベルがオンで週の上位に参加していれば、ポイント (台帳から数える) で数える', () => {
    const { ctx } = setup({ start: false });
    ctx.apiSetGameEnabled(true);
    ctx.apiGameJoin(true);
    ctx.apiRewardGet();
    closeMine(ctx);
    const st = ctx.apiRewardGet();
    expect(st.rule).toBe('game');
    expect(st.earned).toBe(ctx.gamePointsByPerson_(ctx.motivationDay_(new Date(st.since)), '')[ME]);
    // 数え始める前に付いていたポイントは入らない
    expect(ctx.rewardRead_(ME).base).toBe(0);
    expect(st.earned).toBeGreaterThan(0);
  });

  it('数え方が変わったら (参加する・やめる)、いまから数え直し、前の交換はまとめて残す', () => {
    const { ctx } = setup();
    closeMine(ctx); closeMine(ctx);
    const a = ctx.apiRewardItemSave({ title: 'コーヒー', cost: 2 }).items[0];
    ctx.apiRewardSpend(a.id);
    expect(ctx.apiRewardGet().ruleChanged).toBe(false);
    ctx.apiSetGameEnabled(true);
    ctx.apiGameJoin(true);
    let st = ctx.apiRewardGet();
    expect(st.rule).toBe('game');
    expect([st.earned, st.spent, st.available]).toEqual([0, 0, 0]);
    expect(st.spends).toEqual([]);
    expect(st.archived).toMatchObject({ count: 1, total: 2 });
    expect(st.ruleChanged).toBe(true);
    // ご褒美の一覧はそのまま
    expect(st.items.map((i) => i.title)).toEqual(['コーヒー']);
    // やめても数え直す (まとめは足していく)
    closeMine(ctx);
    ctx.apiGameJoin(false);
    st = ctx.apiRewardGet();
    expect(st.rule).toBe('done');
    expect(st.earned).toBe(0);
    expect(st.ruleChanged).toBe(true);
  });
});

describe('交換する', () => {
  it('残りを超えては交換できない。交換したぶんだけ残りが減り、記録は新しい順', () => {
    const { ctx } = setup();
    closeMine(ctx); closeMine(ctx); closeMine(ctx);
    const a = ctx.apiRewardItemSave({ title: 'コーヒー', cost: 2 }).items[0];
    ctx.apiRewardItemSave({ title: '散歩', cost: 1 });
    const b = ctx.apiRewardGet().items[1];
    let st = ctx.apiRewardSpend(a.id);
    expect(st.spentNow).toEqual({ id: 3, title: 'コーヒー', cost: 2 });
    expect([st.earned, st.spent, st.available]).toEqual([3, 2, 1]);
    expect(() => ctx.apiRewardSpend(a.id)).toThrow('ポイントが足りない');
    st = ctx.apiRewardSpend(b.id);
    expect(st.available).toBe(0);
    expect(st.spends.map((s) => s.title)).toEqual(['散歩', 'コーヒー']);
    expect(() => ctx.apiRewardSpend(b.id)).toThrow('ポイントが足りない');
    expect(() => ctx.apiRewardSpend(999)).toThrow('見つかりません');
  });

  it('ご褒美を外しても、交換した記録と交換したぶんは残る', () => {
    const { ctx } = setup();
    closeMine(ctx); closeMine(ctx);
    const a = ctx.apiRewardItemSave({ title: 'コーヒー', cost: 2 }).items[0];
    ctx.apiRewardSpend(a.id);
    const st = ctx.apiRewardItemDelete(a.id);
    expect(st.spends.map((s) => s.title)).toEqual(['コーヒー']);
    expect(st.available).toBe(0);
  });

  it('長い名前で何十回交換しても、1人ぶんは 9KB に収まり、使い続けられる', () => {
    const { ctx, fake } = setup();
    for (let i = 0; i < 45; i++) closeMine(ctx);
    const title = 'とても長いご褒美の名前'.repeat(4).slice(0, 40);
    expect(title.length).toBe(40);
    for (let i = 0; i < 20; i++) ctx.apiRewardItemSave({ title: title.slice(0, 38) + String(i).padStart(2, '0'), cost: 1 });
    const items = ctx.apiRewardGet().items;
    for (let i = 0; i < 40; i++) ctx.apiRewardSpend(items[i % 20].id);
    const raw = fake.PropertiesService.getScriptProperties().getProperty('REWARD:' + ME);
    expect(Buffer.byteLength(raw, 'utf8')).toBeLessThan(9 * 1024);
    const st = ctx.apiRewardGet();
    expect([st.spent, st.available]).toEqual([40, 5]);
    expect(st.spends.length).toBeLessThanOrEqual(30);
    expect(() => ctx.apiRewardSpend(items[0].id)).not.toThrow();
  });

  it('鍵の中で読み直した交換のぶんで比べる (ほぼ同時の2つ目は断る)', () => {
    const { ctx } = setup();
    closeMine(ctx);
    const a = ctx.apiRewardItemSave({ title: 'x', cost: 1 }).items[0];
    const real = ctx.dbWithLock_;
    let raced = false;
    // 鍵の外で数え終えたあと、鍵を取る直前に別の画面から1つ交換された形
    ctx.dbWithLock_ = (ms, fn) => {
      if (!raced) {
        raced = true;
        ctx.dbWithLock_ = real;
        ctx.rewardMutate_(ME, (r) => { r.spends.push({ id: r.nextId++, title: 'x', cost: 1, at: new Date().toISOString() }); });
        ctx.dbWithLock_ = (m2, f2) => real(m2, f2);
      }
      return real(ms, fn);
    };
    expect(() => ctx.apiRewardSpend(a.id)).toThrow('ポイントが足りない');
    ctx.dbWithLock_ = real;
    expect(ctx.apiRewardGet().spends.length).toBe(1);
  });

  it('古い記録は合計にまとめる (残りは変わらない)', () => {
    const { ctx } = setup();
    for (let i = 0; i < 3; i++) closeMine(ctx);
    const a = ctx.apiRewardItemSave({ title: 'x', cost: 1 }).items[0];
    const keep = ctx.REWARD_KEEP_SPENDS;
    ctx.REWARD_KEEP_SPENDS = () => 1;
    ctx.apiRewardSpend(a.id);
    ctx.apiRewardSpend(a.id);
    ctx.REWARD_KEEP_SPENDS = keep;
    const st = ctx.apiRewardGet();
    expect(st.spends.length).toBe(1);
    expect([st.spent, st.available]).toEqual([2, 1]);
  });
});

describe('取り消す', () => {
  it('最後の交換だけ、5分のあいだ取り消せる', () => {
    const { ctx } = setup();
    closeMine(ctx); closeMine(ctx);
    const a = ctx.apiRewardItemSave({ title: 'x', cost: 1 }).items[0];
    const first = ctx.apiRewardSpend(a.id).spentNow;
    const second = ctx.apiRewardSpend(a.id);
    expect(second.undoId).toBe(second.spentNow.id);
    expect(second.undoUntil).not.toBe('');
    expect(() => ctx.apiRewardUndo(first.id)).toThrow('最後の交換だけ');
    const st = ctx.apiRewardUndo(second.spentNow.id);
    expect([st.spent, st.available]).toEqual([1, 1]);
    expect(st.spends.map((s) => s.id)).toEqual([first.id]);
  });

  it('5分を過ぎたら取り消せない (時刻はサーバの時計で見る)', () => {
    const { ctx } = setup();
    closeMine(ctx);
    const a = ctx.apiRewardItemSave({ title: 'x', cost: 1 }).items[0];
    const s = ctx.rewardSpend_(ME, a.id, new Date()).spend;
    const later = new Date(Date.parse(s.at) + 5 * 60 * 1000);
    expect(ctx.rewardState_(ME, later).undoId).toBe(0);
    expect(() => ctx.rewardUndo_(ME, s.id, later)).toThrow('5分');
    expect(() => ctx.rewardUndo_(ME, s.id, new Date(Date.parse(s.at) + 4 * 60 * 1000))).not.toThrow();
  });

  it('取り消した番号は次の交換に回さない', () => {
    const { ctx } = setup();
    closeMine(ctx); closeMine(ctx);
    const a = ctx.apiRewardItemSave({ title: 'x', cost: 1 }).items[0];
    const s = ctx.apiRewardSpend(a.id).spentNow;
    ctx.apiRewardUndo(s.id);
    expect(ctx.apiRewardSpend(a.id).spentNow.id).toBeGreaterThan(s.id);
  });
});

describe('本人にだけ', () => {
  it('ほかの人のご褒美も記録も見えない。入口はアドレスを受けない', () => {
    const { ctx, fake } = setup();
    closeMine(ctx);
    const a = ctx.apiRewardItemSave({ title: '秘密のケーキ', cost: 1 }).items[0];
    ctx.apiRewardSpend(a.id);
    fake._setUser(OTHER);
    ctx.apiPrefSet('luck.reward', true);
    const st = ctx.apiRewardGet();
    expect(st.items).toEqual([]);
    expect(st.spends).toEqual([]);
    expect(JSON.stringify(st)).not.toContain('秘密のケーキ');
    expect(() => ctx.apiRewardSpend(a.id)).toThrow('見つかりません');
    expect(() => ctx.apiRewardItemDelete(a.id)).toThrow('見つかりません');
    ['apiRewardGet', 'apiRewardItemSave', 'apiRewardItemDelete', 'apiRewardSpend', 'apiRewardUndo'].forEach((name) => {
      expect(String(ctx[name]).split('{')[0]).not.toMatch(/email|who|user/i);
    });
  });

  it('台帳には置かない (スクリプトプロパティに1人1つ)', () => {
    const { ctx, fake } = setup();
    ctx.apiRewardItemSave({ title: 'コーヒー', cost: 1 });
    expect(Object.keys(ctx.DB_SCHEMA())).not.toContain('reward_spends');
    expect(fake.PropertiesService.getScriptProperties().getProperty('REWARD:' + ME)).toContain('コーヒー');
  });

});
