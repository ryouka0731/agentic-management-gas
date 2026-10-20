import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';
import { CORE_SOURCES } from './sources.js';

/*
 * 中身の置き場 (ObjectStore)・指紋 (HashGas)・読む層のキャッシュ (LiveCache)・
 * 記録の並び (Commit) の単体テスト。どれも統合テストでは差し替えられていて、
 * 本体の枝がほとんど通っていなかった。
 */

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const signed = (buf) => Array.from(buf).map((b) => (b > 127 ? b - 256 : b));

/** 疑似GASの Blob に無い copyBlob / setName を持つ画像の Blob */
function imageBlob(bytes, mime) {
  const make = (name) => ({
    getName: () => name,
    getBytes: () => signed(bytes),
    getContentType: () => mime,
    copyBlob: () => make(name),
    setName: (n) => make(n),
  });
  return make('img');
}

function withCache(fake) {
  const store = new Map();
  fake.CacheService = {
    getScriptCache: () => ({
      get: (k) => (store.has(k) ? store.get(k) : null),
      getAll: (keys) => Object.fromEntries(keys.filter((k) => store.has(k)).map((k) => [k, store.get(k)])),
      putAll: (obj) => { for (const [k, v] of Object.entries(obj)) store.set(k, v); },
      removeAll: (keys) => keys.forEach((k) => store.delete(k)),
    }),
  };
  return store;
}

function setup() {
  const fake = createFakeGas();
  const store = withCache(fake);
  const ctx = loadGasWith(fake, ...CORE_SOURCES);
  const config = ctx.repoInit('agentic-management');
  return { fake, ctx, config, store };
}

describe('HashGas', () => {
  it('sha256Hex は UTF-8 の SHA-256 を小文字 hex で返す', () => {
    const { ctx } = setup();
    expect(ctx.sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(ctx.sha256Hex('就業規則')).toBe(sha('就業規則'));
  });

  it('sha256HexBytes は符号付き byte の Blob からも同じ指紋を出す', () => {
    const { ctx } = setup();
    // 0x80 以上の byte は GAS では負の数で届く。符号の扱いを誤ると指紋がずれる
    const bytes = Buffer.from([0, 1, 127, 128, 200, 255, 0x89, 0x50, 0x4e, 0x47]);
    expect(ctx.sha256HexBytes(imageBlob(bytes, 'image/png'))).toBe(sha(bytes));
    // 字の指紋と、同じ字を byte にした Blob の指紋は一致する
    const text = 'Hello 世界 😀';
    expect(ctx.sha256HexBytes(imageBlob(Buffer.from(text, 'utf8')))).toBe(ctx.sha256Hex(text));
  });
});

describe('ObjectStore', () => {
  it('字の中身を置いて読み戻し、同じ指紋は二度置かない', () => {
    const { ctx, fake, config } = setup();
    const s = 'a'.repeat(64);
    expect(ctx.objectGet(s)).toBe(null);
    expect(ctx.objectExists(s)).toBe(false);

    ctx.objectPut(s, '<p>一</p>\n');
    ctx.objectPut(s, '<p>二</p>\n');
    expect(ctx.objectGet(s)).toBe('<p>一</p>\n');
    expect(ctx.objectExists(s)).toBe(true);
    expect(ctx.objectExists(s, 'png')).toBe(false);

    const folder = fake.DriveApp.getFolderById(config.objectsId);
    let n = 0;
    for (const it = folder.getFilesByName(s + '.html'); it.hasNext(); it.next()) n++;
    expect(n).toBe(1);
  });

  it('画像は拡張子付きで置き、拡張子を知らなくても探せる', () => {
    const { ctx, fake, config } = setup();
    const bytes = Buffer.from([0x47, 0x49, 0x46, 0x38, 0xff]);
    const s = sha(bytes);
    ctx.objectPutBlob(s, imageBlob(bytes, 'image/gif'), 'gif');
    ctx.objectPutBlob(s, imageBlob(bytes, 'image/gif'), 'gif');

    const folder = fake.DriveApp.getFolderById(config.objectsId);
    let n = 0;
    for (const it = folder.getFilesByName(s + '.gif'); it.hasNext(); it.next()) n++;
    expect(n).toBe(1);
    expect(ctx.objectExists(s, 'gif')).toBe(true);
    expect(ctx.objectFindBlob(s)).not.toBe(null);
  });

  it('objectFindBlob は形の違う指紋と見当たらないものに null を返す (投げない)', () => {
    const { ctx } = setup();
    expect(ctx.objectFindBlob('unavailable')).toBe(null);
    expect(ctx.objectFindBlob('')).toBe(null);
    expect(ctx.objectFindBlob(null)).toBe(null);
    expect(ctx.objectFindBlob('b'.repeat(64))).toBe(null);
  });

  it('不正な拡張子では置かない', () => {
    const { ctx } = setup();
    expect(() => ctx.objectPutBlob('c'.repeat(64), imageBlob(Buffer.from('x')), 'PNG')).toThrow(/拡張子が不正/);
    expect(() => ctx.objectPut('xyz', 'a')).toThrow(/SHAの形式が不正/);
  });
});

describe('LiveCache', () => {
  function registered() {
    const env = setup();
    const id = env.fake._createDoc('就業規則', '', env.config.mainId);
    env.ctx.repoRegisterFile(id, '就業規則.doc');
    let renders = 0;
    env.ctx.renderDoc = () => { renders++; return '<p>版' + renders + '</p>\n'; };
    return { ...env, id, renders: () => renders };
  }

  it('登録していない文書は読まない', () => {
    const { ctx } = setup();
    expect(() => ctx.liveHtml('file-999')).toThrow(/管理対象に登録されていません/);
  });

  it('更新時刻が変わると読み直し、変わらなければキャッシュから返す', () => {
    const { ctx, fake, id, renders } = registered();
    expect(ctx.liveHtml(id)).toBe('<p>版1</p>\n');
    expect(ctx.liveHtml(id)).toBe('<p>版1</p>\n');
    expect(renders()).toBe(1);

    // Docs で編集された (更新時刻が進んだ)
    fake.DriveApp.getFileById(id)._updated = new Date(Date.now() + 60000);
    expect(ctx.liveHtml(id)).toBe('<p>版2</p>\n');
    expect(renders()).toBe(2);
  });

  it('liveCacheInvalidate は今のキャッシュを消し、次は読み直す', () => {
    const { ctx, id, store, renders } = registered();
    ctx.liveHtml(id);
    expect(store.size).toBeGreaterThan(0);
    ctx.liveCacheInvalidate(id);
    expect(store.size).toBe(0);
    expect(ctx.liveHtml(id)).toBe('<p>版2</p>\n');
    expect(renders()).toBe(2);
  });

  it('liveCacheInvalidate はキャッシュが無くても何もしない', () => {
    const { ctx, id, store } = registered();
    store.set('unrelated', 'x');
    ctx.liveCacheInvalidate(id);
    expect([...store.keys()]).toEqual(['unrelated']);
  });

  it('区切りの1つが追い出されていたら、つなぎかけを返さず null にする', () => {
    const { ctx, store } = setup();
    const html = 'x'.repeat(ctx.CACHE_CHUNK_SIZE() * 2 + 5);
    ctx.liveCachePut_('k', html);
    expect(store.get('k:meta')).toBe('3');
    expect(ctx.liveCacheGet_('k')).toBe(html);

    store.delete('k:1');
    expect(ctx.liveCacheGet_('k')).toBe(null);
  });

  it('数の字が壊れた meta は無いものとして扱う', () => {
    const { ctx, store } = setup();
    store.set('k:meta', 'abc');
    expect(ctx.liveCacheGet_('k')).toBe(null);
    expect(ctx.liveCacheGet_('none')).toBe(null);
  });

  it('空の文書も「0個に区切った」として覚え、空字で返す', () => {
    const { ctx } = setup();
    ctx.liveCachePut_('e', '');
    expect(ctx.liveCacheGet_('e')).toBe('');
  });

  it('種別ごとに描き方を選び、知らない種別は断る', () => {
    const { ctx } = setup();
    ctx.renderDoc = (id) => 'doc:' + id;
    ctx.renderSheet = (id) => 'sheet:' + id;
    ctx.renderSlides = (id) => 'slide:' + id;
    expect(ctx.renderByType_('F', 'doc')).toBe('doc:F');
    expect(ctx.renderByType_('F', 'sheet')).toBe('sheet:F');
    expect(ctx.renderByType_('F', 'slide')).toBe('slide:F');
    expect(() => ctx.renderByType_('F', 'pdf')).toThrow(/まだ対応していません: pdf/);
  });
});

describe('Commit: 記録の並び', () => {
  const t = (s) => new Date('2026-01-01T00:00:' + s + 'Z');
  function rows(ctx, list) {
    for (const r of list) {
      ctx.dbAppend('commits', Object.assign({ fileId: 'F', branch: 'main', blobSha: 'b', author: 'a', message: 'm' }, r));
    }
  }

  it('headCommit は同じ文書・同じ版の最新だけを見る', () => {
    const { ctx } = setup();
    rows(ctx, [
      { sha: 's1', parentSha: '', timestamp: t('01') },
      { sha: 's2', parentSha: 's1', timestamp: t('02') },
      { sha: 'x1', parentSha: '', branch: '改訂', timestamp: t('09') },
      { sha: 'y1', parentSha: '', fileId: 'G', timestamp: t('09') },
    ]);
    expect(ctx.headCommit('F', 'main').sha).toBe('s2');
    expect(ctx.headCommit('F', '改訂').sha).toBe('x1');
    expect(ctx.headCommit('F', 'なし')).toBe(null);
  });

  it('commitHistory は親を辿った順で、辿れない行は新しい順で後ろに足す', () => {
    const { ctx } = setup();
    rows(ctx, [
      // 親の無い迷子 (古い順に置く。並べ替えなければ置いた順のままになる)
      { sha: 'o1', parentSha: 'gone', timestamp: t('03') },
      { sha: 'o2', parentSha: 'gone', timestamp: t('04') },
      { sha: 's1', parentSha: '', timestamp: t('01') },
      { sha: 's2', parentSha: 's1', timestamp: t('05') },
      { sha: 'x1', parentSha: 's1', branch: '改訂', timestamp: t('06') },
    ]);
    expect(ctx.commitHistory('F', 'main').map((r) => r.sha)).toEqual(['s2', 's1', 'o2', 'o1']);
    expect(ctx.commitHistory('F', '改訂').map((r) => r.sha)).toEqual(['x1']);
    expect(ctx.commitHistory('Z', 'main')).toEqual([]);
  });

  it('commitHistory は親のつながりが輪になっていても止まる', () => {
    const { ctx } = setup();
    rows(ctx, [
      { sha: 'a', parentSha: 'b', timestamp: t('02') },
      { sha: 'b', parentSha: 'a', timestamp: t('01') },
    ]);
    expect(ctx.commitHistory('F', 'main').map((r) => r.sha)).toEqual(['a', 'b']);
  });

  it('commitHtml は知らない記録に null を返す', () => {
    const { ctx } = setup();
    expect(ctx.commitHtml('none')).toBe(null);
  });

  it('commitOnlySpacing_ は前の中身が読めなければ「空白だけ」と言わない', () => {
    const { ctx } = setup();
    expect(ctx.commitOnlySpacing_(null, '<p>a</p>\n')).toBe(false);
    expect(ctx.commitOnlySpacing_({ blobSha: 'd'.repeat(64) }, '<p>a</p>\n')).toBe(false);
    ctx.objectPut('e'.repeat(64), '<p>a</p>\n');
    expect(ctx.commitOnlySpacing_({ blobSha: 'e'.repeat(64) }, '<p>a</p>\n')).toBe(true);
    expect(ctx.commitOnlySpacing_({ blobSha: 'e'.repeat(64) }, '<p>b</p>\n')).toBe(false);
  });

  it('何を変えたかは1〜500字で求める', () => {
    const { ctx } = setup();
    expect(() => ctx.commitFile('F', 'main', '', null)).toThrow(/何を変えたかを入力してください/);
    expect(() => ctx.commitFile('F', 'main', null, null)).toThrow(/何を変えたかを入力してください/);
    expect(() => ctx.commitFile('F', 'main', 'あ'.repeat(501), null)).toThrow(/何を変えたかを入力してください/);
  });

  it('同じ中身を二度記録しない', () => {
    const { ctx, fake, config } = setup();
    const id = fake._createDoc('細則', '<p>一</p>\n', config.mainId);
    ctx.repoRegisterFile(id, '細則.doc');
    ctx.liveHtml = (fid) => fake._docs.get(fid);
    ctx.commitFile(id, 'main', '初め', null);
    expect(() => ctx.commitFile(id, 'main', 'もう一度', null)).toThrow(/変更がありません/);
    // 500字ちょうどは通る
    fake._docs.set(id, '<p>二</p>\n');
    expect(ctx.commitFile(id, 'main', 'あ'.repeat(500), null).message).toBe('あ'.repeat(500));
  });
});
