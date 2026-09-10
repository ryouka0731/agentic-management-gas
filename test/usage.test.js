import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';

const SOURCES = [
  'src/core/Hash.js',
  'src/core/HashGas.gs',
  'src/core/Db.gs',
  'src/core/Repo.gs',
  'src/core/Usage.gs',
];

function setup() {
  const fake = createFakeGas();
  // 日付の文字列は実機と同じ形にする
  fake.Utilities.formatDate = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  };

  const ctx = loadGasWith(fake, ...SOURCES);
  ctx.repoInit('agentic-management');
  return { ctx, fake };
}

describe('記録する', () => {
  it('日と場所と回数だけを残す', () => {
    const { ctx } = setup();
    ctx.usageRecord([{ kind: 'action', target: 'issue-create-btn', count: 3 }]);

    const rows = ctx.dbReadAll('usage');
    expect(rows).toHaveLength(1);
    expect(rows[0].target).toBe('issue-create-btn');
    expect(Number(rows[0].count)).toBe(3);

    // 押した人はサーバ側で決める。画面から受け取ると名乗りを詐称できる
    expect(rows[0].user).toBe('tester@example.com');
  });

  it('同じ日の同じ場所は足し込む', () => {
    const { ctx } = setup();
    ctx.usageRecord([{ kind: 'action', target: 'a', count: 2 }]);
    ctx.usageRecord([{ kind: 'action', target: 'a', count: 5 }]);

    const rows = ctx.dbReadAll('usage');
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].count)).toBe(7);
  });

  it('種類が違えば別に数える', () => {
    const { ctx } = setup();
    ctx.usageRecord([
      { kind: 'action', target: 'a', count: 1 },
      { kind: 'view', target: 'a', count: 1 },
    ]);

    expect(ctx.dbReadAll('usage')).toHaveLength(2);
  });

  it('知らない種類は数えない', () => {
    const { ctx } = setup();
    ctx.usageRecord([{ kind: 'whoami', target: 'a', count: 1 }]);

    expect(ctx.dbReadAll('usage')).toEqual([]);
  });

  it('名前として使えないものは数えない', () => {
    const { ctx } = setup();
    ctx.usageRecord([
      { kind: 'action', target: 'あぶない<script>', count: 1 },
      { kind: 'action', target: '', count: 1 },
      { kind: 'action', target: 'a'.repeat(80), count: 1 },
    ]);

    expect(ctx.dbReadAll('usage')).toEqual([]);
  });

  it('おかしい回数は数えない', () => {
    const { ctx } = setup();
    ctx.usageRecord([
      { kind: 'action', target: 'a', count: 0 },
      { kind: 'action', target: 'b', count: -5 },
      { kind: 'action', target: 'c', count: 99999 },
    ]);

    expect(ctx.dbReadAll('usage')).toEqual([]);
  });

  it('一度に受け取る数に上限がある', () => {
    const { ctx } = setup();
    const many = [];
    for (let i = 0; i < 100; i++) {
      many.push({ kind: 'action', target: 'k' + i, count: 1 });
    }

    // 際限なく受け取ると行が増え続ける
    expect(ctx.usageRecord(many)).toBe(ctx.USAGE_MAX_KEYS());
  });

  it('空でも落ちない', () => {
    const { ctx } = setup();
    expect(ctx.usageRecord([])).toBe(0);
    expect(ctx.usageRecord(null)).toBe(0);
  });
});

describe('まとめる', () => {
  /** 日を指定して1行入れる */
  function put(ctx, day, kind, target, count, user) {
    ctx.dbAppend('usage', {
      day, kind, target, count, user: user || 'tester@example.com',
    });
  }

  it('多い順に並べる', () => {
    const { ctx } = setup();
    put(ctx, '2026-09-10', 'action', 'a', 3);
    put(ctx, '2026-09-10', 'action', 'b', 9);

    const res = ctx.usageSummary(30, new Date(2026, 8, 10));
    expect(res.byTarget.map((t) => t.target)).toEqual(['b', 'a']);
    expect(res.total).toBe(12);
  });

  it('日をまたいでも同じ場所は足す', () => {
    const { ctx } = setup();
    put(ctx, '2026-09-09', 'action', 'a', 2);
    put(ctx, '2026-09-10', 'action', 'a', 4);

    const res = ctx.usageSummary(30, new Date(2026, 8, 10));
    expect(res.byTarget[0].count).toBe(6);
  });

  it('日ごとの合計も出す', () => {
    const { ctx } = setup();
    put(ctx, '2026-09-09', 'action', 'a', 2);
    put(ctx, '2026-09-10', 'action', 'b', 4);

    const res = ctx.usageSummary(30, new Date(2026, 8, 10));
    expect(res.byDay).toEqual([
      { day: '2026-09-09', count: 2 },
      { day: '2026-09-10', count: 4 },
    ]);
  });

  it('期間の外は数えない', () => {
    const { ctx } = setup();
    put(ctx, '2026-08-01', 'action', 'ふるい', 5);
    put(ctx, '2026-09-10', 'action', 'あたらしい', 1);

    const res = ctx.usageSummary(7, new Date(2026, 8, 10));
    expect(res.byTarget.map((t) => t.target)).toEqual(['あたらしい']);
    expect(res.from).toBe('2026-09-04');
  });

  it('何も無ければ空を返す', () => {
    const { ctx } = setup();
    const res = ctx.usageSummary(30, new Date(2026, 8, 10));

    expect(res.total).toBe(0);
    expect(res.byTarget).toEqual([]);
  });

  it('期間は行きすぎない値に丸める', () => {
    const { ctx } = setup();

    // 指定が無ければ30日。長すぎる指定は1年で止める
    expect(ctx.usageSummary(0, new Date(2026, 8, 10)).from).toBe('2026-08-12');
    expect(ctx.usageSummary(9999, new Date(2026, 8, 10)).from).toBe('2025-09-11');
  });
});

describe('人ごとに見る', () => {
  function put(ctx, day, kind, target, count, user) {
    ctx.dbAppend('usage', { day, kind, target, count, user });
  }

  it('よく使っている人を多い順に並べる', () => {
    const { ctx } = setup();
    put(ctx, '2026-09-10', 'action', 'a', 3, 'aoki@example.com');
    put(ctx, '2026-09-10', 'action', 'b', 9, 'ito@example.com');

    const res = ctx.usageSummary(30, new Date(2026, 8, 10));
    expect(res.byUser.map((u) => u.who))
      .toEqual(['ito@example.com', 'aoki@example.com']);
    expect(res.byUser[0].count).toBe(9);
  });

  it('人を指定するとその人のぶんだけになる', () => {
    const { ctx } = setup();
    put(ctx, '2026-09-10', 'action', 'a', 3, 'aoki@example.com');
    put(ctx, '2026-09-10', 'action', 'b', 9, 'ito@example.com');

    const res = ctx.usageSummary(30, new Date(2026, 8, 10), 'aoki@example.com');
    expect(res.total).toBe(3);
    expect(res.byTarget.map((t) => t.target)).toEqual(['a']);
  });

  it('絞り込んでも人ごとの並びは全員ぶん出す', () => {
    const { ctx } = setup();
    put(ctx, '2026-09-10', 'action', 'a', 3, 'aoki@example.com');
    put(ctx, '2026-09-10', 'action', 'b', 9, 'ito@example.com');

    // 誰が使っているかは、一人を見ているときにも知りたい
    const res = ctx.usageSummary(30, new Date(2026, 8, 10), 'aoki@example.com');
    expect(res.byUser).toHaveLength(2);
  });

  it('同じ人の同じ場所は足し込む', () => {
    const { ctx } = setup();
    ctx.usageRecord([{ kind: 'action', target: 'a', count: 2 }]);
    ctx.usageRecord([{ kind: 'action', target: 'a', count: 3 }]);

    expect(ctx.dbReadAll('usage')).toHaveLength(1);
    expect(Number(ctx.dbReadAll('usage')[0].count)).toBe(5);
  });

  it('人が違えば別の行になる', () => {
    const { ctx, fake } = setup();
    ctx.usageRecord([{ kind: 'action', target: 'a', count: 1 }]);

    fake._setUser('hoka@example.com');
    ctx.usageRecord([{ kind: 'action', target: 'a', count: 1 }]);

    expect(ctx.dbReadAll('usage')).toHaveLength(2);
  });

  it('誰の期間かも返す', () => {
    const { ctx } = setup();
    expect(ctx.usageSummary(30, new Date(2026, 8, 10), 'x@example.com').who)
      .toBe('x@example.com');
  });
});
