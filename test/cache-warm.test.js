import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';
import { APP_SOURCES } from './sources.js';

/*
 * 裏の定期実行で台帳の読み取りのキャッシュを温める (src/core/CacheWarm.gs。docs/dev/command-queue.md の
 * 「キューのついでに台帳の覚えを温める」と docs/dev/ledger-schema.md)。
 * 守ること: 温めの印 (DBW:<表>) が無い表だけ読む・1回に読むのは上限まで・命令があった回は温めない・
 * 温めで落ちてもキューは止まらない・温めると本体 (DB:<表>:<版>) の期限が延びる・温めた中身は今の版の中身。
 */

function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...APP_SOURCES);
  ctx.repoInit('agentic-management');
  // 1日1回の片付けと成果の数も同じ回で台帳を読むので、温めの読み取りだけを数えるために止める
  ctx.housekeepArchiveDaily_ = () => {};
  ctx.outcomesDailyOnce_ = () => {};
  return { ctx, fake };
}

const props = (ctx) => ctx.PropertiesService.getScriptProperties();
const cache = (ctx) => ctx.CacheService.getScriptCache();

/** 温める表のうち、この回でシートを読んだもの */
function readDuring(ctx, fake, fn) {
  const tables = ctx.CACHE_WARM_TABLES_();
  const before = Object.fromEntries(tables.map((t) => [t, fake._sheetReads(t)]));
  fn();
  return tables.filter((t) => fake._sheetReads(t) > before[t]);
}

function enqueue(ctx, id, cmd) {
  return ctx.commandQueueFolder_().createFile(id + '.cmd.json', JSON.stringify(cmd), 'text/plain');
}

describe('温める表', () => {
  it('台帳にある表だけ。全部の記録・変更の履歴・使われ方は温めない', () => {
    const { ctx } = setup();
    const schema = ctx.DB_SCHEMA();
    const tables = ctx.CACHE_WARM_TABLES_();
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) expect(schema[t]).toBeTruthy();
    expect(new Set(tables).size).toBe(tables.length);
    for (const t of ['commits', 'change_log', 'usage']) expect(tables).not.toContain(t);
  });

  it('印の長さは本体の長さより短い (本体が切れる前に温め直す)', () => {
    const { ctx } = setup();
    expect(ctx.CACHE_WARM_MARK_SEC_()).toBeLessThan(ctx.DB_CACHE_SEC());
    // 差は1分ごとの回の5回ぶん以上 (命令で温めを飛ばした回・トリガーの遅れの余裕)
    expect(ctx.DB_CACHE_SEC() - ctx.CACHE_WARM_MARK_SEC_()).toBeGreaterThanOrEqual(5 * 60);
  });
});

describe('キューのついでに温める', () => {
  it('印が無い表だけを、1回に上限まで読む。一巡したら読まない', () => {
    const { ctx, fake } = setup();
    const tables = ctx.CACHE_WARM_TABLES_();
    const per = ctx.CACHE_WARM_PER_RUN_();
    const seen = [];
    for (let i = 0; i < Math.ceil(tables.length / per); i++) {
      const got = readDuring(ctx, fake, () => ctx.processCommandQueue());
      expect(got.length).toBeLessThanOrEqual(per);
      expect(got.length).toBeGreaterThan(0);
      for (const t of got) expect(seen).not.toContain(t);
      seen.push(...got);
    }
    expect(seen.sort()).toEqual([...tables].sort());
    // 印がそろったら読まない
    expect(readDuring(ctx, fake, () => ctx.processCommandQueue())).toEqual([]);
    // 印が切れたら、また読む
    fake._cacheAdvance(ctx.CACHE_WARM_MARK_SEC_() + 1);
    expect(readDuring(ctx, fake, () => ctx.processCommandQueue()).length).toBe(per);
  });

  it('温めると本体の期限が延びる。最初に読んだときから 30分を過ぎても台帳を読まない', () => {
    const { ctx, fake } = setup();
    ctx.issueCreate('ひとつめ', '', []);
    ctx.dbReadAll('issues');
    const warmAll = () => {
      for (let i = 0; i < 20; i++) ctx.processCommandQueue();
    };
    warmAll();
    fake._cacheAdvance(ctx.CACHE_WARM_MARK_SEC_() + 1);
    warmAll();
    // 最初の読み取りから 1800 秒を超えた
    fake._cacheAdvance(ctx.DB_CACHE_SEC() - ctx.CACHE_WARM_MARK_SEC_());
    const before = fake._sheetReads('issues');
    expect(ctx.dbReadAll('issues').map((r) => r.title)).toEqual(['ひとつめ']);
    expect(fake._sheetReads('issues')).toBe(before);
  });

  it('温めた中身は今の版の中身。書いたあとに温めても、書いたものが見える', () => {
    const { ctx, fake } = setup();
    for (let i = 0; i < 20; i++) ctx.processCommandQueue();
    ctx.issueCreate('あとから', '', []);
    fake._cacheAdvance(ctx.CACHE_WARM_MARK_SEC_() + 1);
    for (let i = 0; i < 20; i++) ctx.processCommandQueue();
    const before = fake._sheetReads('issues');
    expect(ctx.dbReadAll('issues').map((r) => r.title)).toEqual(['あとから']);
    expect(fake._sheetReads('issues')).toBe(before);
  });

  it('命令があった回は温めない (キューの返事を先にする)', () => {
    const { ctx, fake } = setup();
    enqueue(ctx, 'c1', { op: 'issueList', args: {} });
    const got = readDuring(ctx, fake, () => ctx.processCommandQueue());
    // 命令が読んだ表はあるが、温めの印は置いていない
    expect(got.filter((t) => cache(ctx).get('DBW:' + t))).toEqual([]);
    // 次の回 (命令が無い) で温める
    expect(readDuring(ctx, fake, () => ctx.processCommandQueue()).length).toBe(ctx.CACHE_WARM_PER_RUN_());
  });

  it('温めで落ちてもキューは止まらない。落ちた表は印を置いて先へ回し、次の回はほかの表を温める', () => {
    const { ctx, fake } = setup();
    const tables = ctx.CACHE_WARM_TABLES_();
    const orig = ctx.dbReadSheet_;
    ctx.dbReadSheet_ = (table, cols) => {
      if (table === tables[0]) throw new Error('読めない');
      return orig(table, cols);
    };
    expect(() => ctx.processCommandQueue()).not.toThrow();
    expect(cache(ctx).get('DBW:' + tables[0])).toBeTruthy();
    const got = readDuring(ctx, fake, () => ctx.processCommandQueue());
    expect(got.length).toBeGreaterThan(0);
    expect(got).not.toContain(tables[0]);
  });

  it('キャッシュが使えないときは何もしない (落ちない)', () => {
    const { ctx } = setup();
    ctx.CacheService = undefined;
    expect(() => ctx.processCommandQueue()).not.toThrow();
  });

  it('持ち主のスイッチ (CACHE_WARM_OFF) で止められる', () => {
    const { ctx, fake } = setup();
    props(ctx).setProperty('CACHE_WARM_OFF', '1');
    expect(readDuring(ctx, fake, () => ctx.processCommandQueue())).toEqual([]);
    props(ctx).deleteProperty('CACHE_WARM_OFF');
    expect(readDuring(ctx, fake, () => ctx.processCommandQueue()).length).toBeGreaterThan(0);
  });

  it('1回の所要時間を残す (QUEUE_LAST_COST: 全体・温め・温めた数・命令の数)', () => {
    const { ctx } = setup();
    ctx.processCommandQueue();
    const cost = JSON.parse(props(ctx).getProperty('QUEUE_LAST_COST'));
    expect(cost.ms).toBeGreaterThanOrEqual(0);
    expect(cost.warmMs).toBeGreaterThanOrEqual(0);
    expect(cost.warmed).toBe(ctx.CACHE_WARM_PER_RUN_());
    expect(cost.ran).toBe(0);
  });
});
