import { describe, it, expect } from 'vitest';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';
import { APP_SOURCES } from './sources.js';

/*
 * 台帳の読み取りのキャッシュ (Db.gs の dbReadAll。docs/dev/ledger-schema.md の「台帳の読み取りはキャッシュに置く」)。
 * 守ること: 2回目からは台帳を読まない・書いたらすぐ新しい中身 (同じ実行の中でも、ほかの実行でも)・
 * Db.gs の外で直に書く所も覚えを捨てる・返すのは写し・Date は Date のまま・100KB を超える表も置ける・
 * キャッシュが壊れていても台帳を読む・鍵を取ったら同じ実行の中の覚えを捨てる。
 *
 * test/harness.js は、テストから呼んだ1回を1回の実行として扱う (同じ実行の中の覚えは呼ぶたびに消える)。
 * 1回の実行の中で何度も読むところは、包まれた関数 (withSelfApprove_ / dbWithLock_) の中から呼ぶ。
 */

const ME = 'tester@example.com';

function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...APP_SOURCES);
  ctx.repoInit('agentic-management');
  return { ctx, fake };
}

/** 1回の実行の中で fn を走らせる (鍵は取らない) */
const oneRun = (ctx, fn) => ctx.withSelfApprove_(fn);
const reads = (fake, table) => fake._sheetReads(table);
const titles = (rows) => rows.map((r) => r.title).sort();

describe('読み取りを覚える', () => {
  it('2回目からは台帳を読まない (ほかの実行でも、CacheService から引く)', () => {
    const { ctx, fake } = setup();
    ctx.issueCreate('ひとつめ', '', []);
    ctx.dbReadAll('issues');
    const before = reads(fake, 'issues');
    expect(titles(ctx.dbReadAll('issues'))).toEqual(['ひとつめ']);
    expect(titles(ctx.dbReadAll('issues'))).toEqual(['ひとつめ']);
    expect(reads(fake, 'issues')).toBe(before);
  });

  it('同じ実行の中では、キャッシュが無くても2度読まない', () => {
    const { ctx, fake } = setup();
    ctx.issueCreate('ひとつめ', '', []);
    ctx.CacheService = undefined;
    // 1回読むぶん (見出しの確かめも含む) を測る
    const before = reads(fake, 'issues');
    ctx.dbReadAll('issues');
    const once = reads(fake, 'issues') - before;
    expect(once).toBeGreaterThan(0);
    oneRun(ctx, () => {
      ctx.dbReadAll('issues');
      ctx.dbFindOne('issues', 'number', 1);
      ctx.dbReadAll('issues');
    });
    expect(reads(fake, 'issues')).toBe(before + 2 * once);
    // 次の実行ではもう一度読む (キャッシュが無いので)
    ctx.dbReadAll('issues');
    expect(reads(fake, 'issues')).toBe(before + 3 * once);
  });

  it('返すのは写し。呼び出し側が行や Date を書き換えても、次に読む中身は変わらない', () => {
    const { ctx } = setup();
    const due = new Date(2026, 9, 30);
    ctx.dbAppend('issues', { number: 1, title: 'もと', state: 'open', dueDate: due });
    oneRun(ctx, () => {
      const a = ctx.dbReadAll('issues');
      a[0].title = '書き換えた';
      a[0].dueDate.setFullYear(1999);
      a.push({ number: 99 });
      const b = ctx.dbReadAll('issues');
      expect(b.map((r) => r.title)).toEqual(['もと']);
      expect(b[0].dueDate.getFullYear()).toBe(2026);
      // 同じ実行の中の覚えから返したものを書き換えても、次は元のまま
      b[0].title = 'もう一度';
      b[0].dueDate.setFullYear(1998);
      expect(ctx.dbReadAll('issues')[0].title).toBe('もと');
      expect(ctx.dbReadAll('issues')[0].dueDate.getFullYear()).toBe(2026);
    });
    const c = ctx.dbReadAll('issues');
    c[0].title = 'こちらも';
    expect(ctx.dbReadAll('issues')[0].title).toBe('もと');
  });

  it('台帳の Date は、キャッシュから読んでも Date で返る (字にしない)', () => {
    const { ctx, fake } = setup();
    const at = new Date(2026, 9, 21, 9, 30);
    ctx.dbAppend('issues', { number: 1, title: 'x', state: 'open', createdAt: at, dueDate: '2026-10-30' });
    ctx.dbReadAll('issues');
    const before = reads(fake, 'issues');
    const [row] = ctx.dbReadAll('issues');
    expect(reads(fake, 'issues')).toBe(before);
    expect(Object.prototype.toString.call(row.createdAt)).toBe('[object Date]');
    expect(row.createdAt.getTime()).toBe(at.getTime());
    expect(Object.prototype.toString.call(row.dueDate)).toBe('[object Date]');
    expect(row.number).toBe(1);
    expect(row.title).toBe('x');
  });
});

describe('書いたら覚えを捨てる', () => {
  /** 読んで覚えさせてから write し、次の実行で新しい中身が返るかを見る */
  function freshAfter(ctx, table, write) {
    ctx.dbReadAll(table);
    ctx.dbReadAll(table);
    write();
    return ctx.dbReadAll(table);
  }

  it('dbAppend / dbUpdate / dbDelete / 番号を振る追加のあとは、新しい中身を返す', () => {
    const { ctx } = setup();
    ctx.dbAppend('tags', { name: 'あ', color: 'red' });
    expect(freshAfter(ctx, 'tags', () => ctx.dbAppend('tags', { name: 'い', color: 'blue' }))
      .map((r) => r.name)).toEqual(expect.arrayContaining(['あ', 'い']));
    expect(freshAfter(ctx, 'tags', () => ctx.dbUpdate('tags', 'name', 'い', { color: 'green' }))
      .find((r) => r.name === 'い').color).toBe('green');
    expect(freshAfter(ctx, 'tags', () => ctx.dbDelete('tags', 'name', 'い'))
      .find((r) => r.name === 'い')).toBeUndefined();
    expect(titles(freshAfter(ctx, 'issues', () => ctx.dbAppendNumbered('issues', 'number', { title: '番号つき', state: 'open' }))))
      .toEqual(['番号つき']);
    expect(freshAfter(ctx, 'change_log', () => ctx.dbAppendNumberedMany('change_log', 'id', [{ actor: ME }, { actor: ME }])).length)
      .toBeGreaterThanOrEqual(2);
  });

  it('使われ方 (usageRecord) は台帳に直に書くが、そのあとは新しい数を返す', () => {
    const { ctx } = setup();
    ctx.usageRecord([{ kind: 'action', target: 'a', count: 2 }]);
    const rows = freshAfter(ctx, 'usage', () => ctx.usageRecord([{ kind: 'action', target: 'a', count: 5 }]));
    expect(rows.filter((r) => r.target === 'a').map((r) => r.count)).toEqual([7]);
    expect(freshAfter(ctx, 'usage', () => ctx.usageRecord([{ kind: 'action', target: 'b', count: 1 }]))
      .map((r) => r.target).sort()).toEqual(['a', 'b']);
  });

  it('やることを消す (issuePurge) と、ぶら下がりの表もやることの表も新しい中身になる', () => {
    const { ctx } = setup();
    const n = ctx.issueCreate('消すもの', '', []).number;
    ctx.issueCommentAdd(n, 'ひとこと');
    ctx.dbReadAll('issues');
    ctx.dbReadAll('issue_comments');
    ctx.dbReadAll('issues');
    ctx.dbReadAll('issue_comments');
    ctx.issuePurge(n);
    expect(ctx.dbReadAll('issues').find((r) => r.number === n)).toBeUndefined();
    expect(ctx.dbReadAll('issue_comments').filter((r) => Number(r.issueNumber) === n)).toEqual([]);
  });

  it('知らせを読んだ印 (noticeMarkRead)・やりとりの番号埋め・成果の数も、直に書いたあとは新しい中身', () => {
    const { ctx, fake } = setup();
    ctx.noticeAdd(ME, 'mention', '題', '本文', '');
    const read = freshAfter(ctx, 'notifications', () => expect(ctx.noticeMarkRead([])).toBe(1));
    expect(read.every((r) => r.readAt)).toBe(true);

    ctx.dbAppend('reviews', { prNumber: 1, reviewer: ME, state: 'comment', body: 'x', at: new Date() });
    const filled = freshAfter(ctx, 'reviews', () => expect(ctx.reviewBackfillIds_()).toBe(1));
    expect(Number(filled[0].id)).toBeGreaterThan(0);

    const day = { day: '2026-10-20', moved: 1, closedClean: 0, mergedClean: 0, reopened: 0, overdue: 0, activePeople: 1,
      busyErrors: 0, timeoutErrors: 0, fxOff: 0 };
    expect(freshAfter(ctx, 'outcomes_daily', () => ctx.outcomesWrite_([day])).length).toBe(1);
    expect(freshAfter(ctx, 'outcomes_daily', () => ctx.outcomesWrite_([Object.assign({}, day, { moved: 4 })]))
      .map((r) => r.moved)).toEqual([4]);
    expect(fake).toBeTruthy();
  });

  it('同じ実行の中で、書いた直後に読んでも新しい中身 (鍵の中でも外でも)', () => {
    const { ctx } = setup();
    ctx.dbAppend('tags', { name: 'もと' });
    oneRun(ctx, () => {
      expect(ctx.dbReadAll('tags').some((r) => r.name === 'そと')).toBe(false);
      ctx.dbAppend('tags', { name: 'そと' });
      expect(ctx.dbReadAll('tags').some((r) => r.name === 'そと')).toBe(true);
    });
    ctx.dbWithLock_(1000, () => {
      expect(ctx.dbReadAll('tags').some((r) => r.name === 'なか')).toBe(false);
      ctx.dbAppend('tags', { name: 'なか' });
      // 鍵の中では版を変えるのは鍵を放すとき。それまでもキャッシュの古い中身を返さない
      expect(ctx.dbReadAll('tags').some((r) => r.name === 'なか')).toBe(true);
      ctx.dbUpdate('tags', 'name', 'なか', { color: 'red' });
      expect(ctx.dbReadAll('tags').find((r) => r.name === 'なか').color).toBe('red');
    });
    expect(ctx.dbReadAll('tags').find((r) => r.name === 'なか').color).toBe('red');
  });

  it('鍵の中で書いた版は、鍵を放す前に変わる (次に鍵を取った実行が新しい中身を読む)', () => {
    const { ctx } = setup();
    const cache = ctx.CacheService.getScriptCache();
    ctx.dbReadAll('tags');
    const v0 = cache.get('DBV:tags');
    let inside = null;
    let released = false;
    const realLock = ctx.LockService;
    ctx.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => { released = true; inside = cache.get('DBV:tags'); } }) };
    ctx.dbAppend('tags', { name: 'x' });
    ctx.dbWithLock_(1000, () => {
      ctx.dbAppend('tags', { name: 'y' });
      ctx.dbAppend('tags', { name: 'z' });
      // 1行ごとには変えない (鍵を放すときにまとめる)
      expect(cache.get('DBV:tags')).not.toBe(null);
    });
    ctx.LockService = realLock;
    expect(released).toBe(true);
    expect(inside).not.toBe(v0);
    expect(inside).toBe(cache.get('DBV:tags'));
  });

  it('鍵を取ったら、同じ実行の中で前に読んだ覚えを捨てる (ほかの実行が書いた中身で決める)', () => {
    const { ctx, fake } = setup();
    ctx.dbAppend('tags', { name: 'もと' });
    oneRun(ctx, () => {
      expect(ctx.dbReadAll('tags').map((r) => r.name)).toContain('もと');
      // ほかの実行が書いた (台帳に行が増え、版が変わった)
      fake.SpreadsheetApp.openById(ctx.repoConfig().dbId).getSheetByName('tags').appendRow(['ほか', '', '', '', '']);
      ctx.CacheService.getScriptCache().put('DBV:tags', 'other-run', 21600);
      // 鍵の外では、同じ実行の中の覚えのまま
      expect(ctx.dbReadAll('tags').map((r) => r.name)).not.toContain('ほか');
      ctx.dbWithLock_(1000, () => {
        expect(ctx.dbReadAll('tags').map((r) => r.name)).toContain('ほか');
      });
    });
  });
});

describe('人がシートを直にいじったとき・キャッシュが使えないとき', () => {
  it('直にいじったぶんは、期限 (300秒) までは古いまま。過ぎれば読み直す。dbInvalidateAll_ ですぐ捨てられる', () => {
    const { ctx, fake } = setup();
    ctx.dbAppend('tags', { name: 'もと' });
    ctx.dbReadAll('tags');
    const sheet = fake.SpreadsheetApp.openById(ctx.repoConfig().dbId).getSheetByName('tags');
    sheet.appendRow(['手で足した', '', '', '', '']);
    expect(ctx.dbReadAll('tags').map((r) => r.name)).not.toContain('手で足した');
    fake._cacheAdvance(ctx.DB_CACHE_SEC() + 1);
    expect(ctx.dbReadAll('tags').map((r) => r.name)).toContain('手で足した');

    sheet.appendRow(['もう1つ', '', '', '', '']);
    expect(ctx.dbReadAll('tags').map((r) => r.name)).not.toContain('もう1つ');
    ctx.dbInvalidateAll_();
    expect(ctx.dbReadAll('tags').map((r) => r.name)).toContain('もう1つ');
  });

  it('版の鍵が追い出されたら、前の版の中身を使わない (新しい版を作って読み直す)', () => {
    const { ctx, fake } = setup();
    const cache = ctx.CacheService.getScriptCache();
    ctx.dbAppend('tags', { name: 'もと' });
    ctx.dbReadAll('tags');
    fake.SpreadsheetApp.openById(ctx.repoConfig().dbId).getSheetByName('tags').appendRow(['あと', '', '', '', '']);
    cache.remove('DBV:tags');
    expect(ctx.dbReadAll('tags').map((r) => r.name)).toContain('あと');
    // 追い出されるたびに決まった版 ('0' など) へ戻ると、前に追い出されたときに置いた中身が当たる
    ctx.dbAppend('tags', { name: 'さらに' });
    cache.remove('DBV:tags');
    expect(ctx.dbReadAll('tags').map((r) => r.name)).toContain('さらに');
  });

  it('キャッシュが使えない・読むと投げる・置くと投げる・中身が壊れているときも、台帳を読んで返す', () => {
    const { ctx, fake } = setup();
    ctx.dbAppend('tags', { name: 'もと' });
    const good = ctx.CacheService;
    const want = ctx.dbReadAll('tags').map((r) => r.name).sort();
    const names = () => ctx.dbReadAll('tags').map((r) => r.name).sort();

    ctx.CacheService = { getScriptCache: () => { throw new Error('使えません'); } };
    expect(names()).toEqual(want);
    ctx.CacheService = { getScriptCache: () => ({ get: () => { throw new Error('読めません'); } }) };
    expect(names()).toEqual(want);
    ctx.CacheService = { getScriptCache: () => ({ get: () => null, put: () => { throw new Error('置けません'); } }) };
    expect(names()).toEqual(want);
    // 書くとき (版を変える) にまとめて置けない → 1つずつ置く
    const store = new Map();
    ctx.CacheService = { getScriptCache: () => ({
      get: (k) => (store.has(k) ? store.get(k) : null),
      put: (k, v) => { store.set(k, String(v)); },
      remove: (k) => { store.delete(k); },
      putAll: () => { throw new Error('まとめて置けません'); },
      getAll: () => ({}),
    }) };
    ctx.dbReadAll('tags');
    ctx.dbAppend('tags', { name: 'あと' });
    expect(names()).toContain('あと');

    ctx.CacheService = good;
    ctx.dbReadAll('tags');
    const cache = good.getScriptCache();
    cache.put('DB:tags:' + cache.get('DBV:tags'), '{こわれた', 300);
    expect(names()).toEqual([...want, 'あと'].sort());
    expect(fake).toBeTruthy();
  });
});

describe('100KB を超える表', () => {
  it('分けて置き (1つの値は 100KB まで)、2回目は台帳を読まない。1つでも追い出されたら台帳を読む', () => {
    const { ctx, fake } = setup();
    // 日本語の本文 (1字3バイト) で 300KB を超える
    const rows = [];
    for (let i = 0; i < 120; i++) rows.push({ id: i + 1, issueNumber: 1, body: 'あ'.repeat(900) + i, by: ME, at: new Date() });
    ctx.dbWithLock_(1000, () => rows.forEach((r) => ctx.dbAppend('issue_comments', r)));
    expect(ctx.dbReadAll('issue_comments').length).toBe(120);
    const cache = ctx.CacheService.getScriptCache();
    const ver = cache.get('DBV:issue_comments');
    const head = cache.get('DB:issue_comments:' + ver);
    expect(head).toMatch(/^#\d+$/);
    expect(Number(head.substring(1))).toBeGreaterThan(1);
    for (const [, v] of cache._store) expect(Buffer.byteLength(v.value, 'utf8')).toBeLessThanOrEqual(100 * 1024);

    const before = reads(fake, 'issue_comments');
    const again = ctx.dbReadAll('issue_comments');
    expect(reads(fake, 'issue_comments')).toBe(before);
    expect(again.map((r) => r.body)).toEqual(rows.map((r) => r.body));

    cache.remove('DB:issue_comments:' + ver + ':1');
    expect(ctx.dbReadAll('issue_comments').length).toBe(120);
    expect(reads(fake, 'issue_comments')).toBeGreaterThan(before);
  });

  it('分けても上限の数を超える表はキャッシュに置かない (読み取りは返す)', () => {
    const { ctx } = setup();
    ctx.DB_CACHE_MAX_CHUNKS = () => 2;
    ctx.dbWithLock_(1000, () => {
      for (let i = 0; i < 120; i++) ctx.dbAppend('issue_comments', { id: i + 1, issueNumber: 1, body: 'あ'.repeat(900), by: ME });
    });
    expect(ctx.dbReadAll('issue_comments').length).toBe(120);
    const cache = ctx.CacheService.getScriptCache();
    expect(cache.get('DB:issue_comments:' + cache.get('DBV:issue_comments'))).toBe(null);
  });
});

describe('管理者がキャッシュを捨てる', () => {
  it('apiCacheClear は管理者だけ。捨てたあとは台帳を読み直す', () => {
    const { ctx, fake } = setup();
    ctx.dbAppend('tags', { name: 'もと' });
    ctx.dbReadAll('tags');
    fake.SpreadsheetApp.openById(ctx.repoConfig().dbId).getSheetByName('tags').appendRow(['手で足した', '', '', '', '']);
    fake._setUser('stranger@example.com');
    expect(() => ctx.apiCacheClear()).toThrow();
    fake._setUser(ME);
    expect(ctx.apiCacheClear()).toEqual({ cleared: true });
    expect(ctx.dbReadAll('tags').map((r) => r.name)).toContain('手で足した');
  });

  it('debugCacheClear は持ち主だけ', () => {
    const { ctx, fake } = setup();
    fake._setUser('stranger@example.com');
    expect(() => ctx.debugCacheClear()).toThrow();
    fake._setUser(ME);
    expect(ctx.debugCacheClear()).toContain('捨てました');
  });
});
