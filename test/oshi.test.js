import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { loadGas, loadGasWith } from './harness.js';
import { createFakeGas } from './fakegas.js';
import { APP_SOURCES, OSHI_DEFAULT_SOURCES } from './sources.js';

/*
 * 推し (自分だけのキャラクター)。定義は src/core/Oshi.js、置き場は OshiStore.gs、入口は src/api/Oshi.gs。
 * 守ること: 本人にだけ見せる・置く前に全部を確かめる・叱らない・連続日数を持たない・育ちは戻らない。
 */

const pure = loadGas('src/core/Oshi.js');

function setup() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...APP_SOURCES);
  ctx.repoInit('agentic-management');
  return { ctx, fake };
}

/** 本物の形をした小さな画像 (先頭のバイトだけ本物。中身は検査しない) */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]);
const GIF = Buffer.from('GIF89a----', 'latin1');
const WEBP = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.from([1, 0, 0, 0]), Buffer.from('WEBPVP8 ', 'latin1')]);
const url = (mime, buf) => 'data:' + mime + ';base64,' + buf.toString('base64');
/** 自分のキャラを1人作って番号を返す */
const make = (ctx, name, tone) => ctx.apiOshiCharCreate(name || '', tone || 'polite').charId;
/** 推しの画像の中身が objects/ にあるか (推しの画像は文書の履歴の画像と別の名前で置く) */
const oshiHas = (ctx, sha, ext) => ctx.objectsFolder_().getFilesByName('oshi-' + sha + '.' + ext).hasNext();

describe('定義 (Oshi.js)', () => {
  it('表情は待機・ほめる・おいわい・おうえん・しんぱい・ねむい・びっくりと、育ちの3段', () => {
    const keys = pure.OSHI_STATES().map((s) => s.key);
    expect(keys).toEqual(['idle', 'praise', 'celebrate', 'cheer', 'worry', 'sleepy', 'surprise', 'grow1', 'grow2', 'grow3', 'work', 'pout']);
    expect(pure.OSHI_STAGES().map((s) => s.key)).toEqual(['grow1', 'grow2', 'grow3']);
    // 作業中は作業部屋でだけ、むっは機嫌でだけ出す (でたらめに選ぶ表情に入れない)
    expect(pure.OSHI_STATES().filter((s) => s.scene).map((s) => s.key)).toEqual(['work', 'pout']);
    // むっは絵が無くてもよく、無ければしんぱいの絵
    expect(pure.oshiStateOf('pout')).toMatchObject({ optional: true, fallback: 'worry' });
  });

  it('せりふは口調ごとに全部の場面を持ち、どの場面にも2つ以上ある (回すため)', () => {
    const lines = pure.OSHI_LINES();
    // 考え中 (spinner) は無くてもよい (既定の言葉に倒れる。test/oshi-spinner.test.js)。口調を足す枝が書き忘れても落とさない
    const events = pure.OSHI_EVENTS().filter((e) => !e.spinner).map((e) => e.key);
    expect(Object.keys(lines).sort()).toEqual(pure.OSHI_TONES().map((t) => t.key).sort());
    for (const tone of Object.keys(lines)) {
      expect(Object.keys(lines[tone]).filter((k) => k !== 'spinner').sort(), tone).toEqual([...events].sort());
      for (const e of events) expect(lines[tone][e].length, tone + '.' + e).toBeGreaterThanOrEqual(2);
    }
  });

  it('場面の表情はどれも在る表情', () => {
    const states = new Set(pure.OSHI_STATES().map((s) => s.key));
    for (const e of pure.OSHI_EVENTS()) expect(states.has(e.state), e.key).toBe(true);
  });

  it('キャラクターは叱らない (責める・急かす言葉を持たない)', () => {
    const all = JSON.stringify(pure.OSHI_LINES());
    for (const bad of ['ダメ', 'だめ', 'なぜ', 'まだ終わって', '遅い！', 'サボ', '怒', '連続', '毎日']) {
      expect(all.includes(bad), bad).toBe(false);
    }
  });

  it('Git の言葉を人に見せない (せりふ・頼み文)', () => {
    const all = JSON.stringify(pure.OSHI_LINES()) + pure.OSHI_PROMPT_BASE() +
      pure.OSHI_STATES().map((s) => pure.oshiPrompt(s.key)).join('');
    for (const bad of ['マージ', 'コミット', 'ブランチ', 'プルリク', 'PR', 'Issue']) {
      expect(all.includes(bad), bad).toBe(false);
    }
  });

  it('頼み文は表情ごとにあり、同じキャラクター・正方形・背景・上半身・文字なし・健全を必ず頼む', () => {
    for (const s of pure.OSHI_STATES()) {
      const p = pure.oshiPrompt(s.key);
      expect(p).toContain('「' + s.label + '」');
      for (const must of ['同じキャラクター', '1:1', 'PNG', '透明', '無地', '上半身', '文字', '健全']) {
        expect(p, s.key + ': ' + must).toContain(must);
      }
    }
    expect(pure.oshiPrompt('nope')).toBe('');
    expect(pure.OSHI_PROMPT_BASE()).toContain('参考画像');
  });

  it('育ちの段はレベル (Lv) で決まる (見習い Lv1〜4・一人前 Lv5〜14・名人 Lv15〜)', () => {
    expect(pure.oshiStageOf(1)).toMatchObject({ key: 'grow1', label: '見習い', meter: 0, toNext: 4, level: 1 });
    expect(pure.oshiStageOf(0).level).toBe(1);
    expect(pure.oshiStageOf(3)).toMatchObject({ key: 'grow1', meter: 50, toNext: 2 });
    expect(pure.oshiStageOf(4).key).toBe('grow1');
    expect(pure.oshiStageOf(5)).toMatchObject({ key: 'grow2', label: '一人前', meter: 0, toNext: 10 });
    expect(pure.oshiStageOf(14).key).toBe('grow2');
    expect(pure.oshiStageOf(15)).toMatchObject({ key: 'grow3', label: '名人', meter: 100, toNext: 0 });
    expect(pure.oshiStageOf(99).key).toBe('grow3');
  });

  it('あいさつの場面は時刻で決まる', () => {
    expect(pure.oshiGreetingOf(7)).toBe('morning');
    expect(pure.oshiGreetingOf(13)).toBe('day');
    expect(pure.oshiGreetingOf(23)).toBe('night');
    expect(pure.oshiGreetingOf(2)).toBe('night');
  });

  it('自分のせりふは空行と重なりを落とし、上限を超えたら黙って切らずに断る', () => {
    expect(pure.oshiCleanLines([' すごい ', '', 'すごい', 'えらい'])).toEqual(['すごい', 'えらい']);
    expect(pure.oshiCleanLines('a\n\nb')).toEqual(['a', 'b']);
    expect(() => pure.oshiCleanLines(['あ'.repeat(61)])).toThrow('60字まで');
    expect(() => pure.oshiCleanLines(Array.from({ length: 11 }, (_, i) => 'x' + i))).toThrow('10個まで');
  });
});

describe('画像を置く', () => {
  it('PNG・JPEG・WebP・GIF を置け、中身は objects/ に、台帳には誰のどの表情かだけが残る', () => {
    const { ctx } = setup();
    const c = make(ctx);
    const got = ctx.apiOshiSetImage(c, 'praise', url('image/png', PNG));
    expect(got.state).toBe('praise');
    expect(got.sha).toMatch(/^[0-9a-f]{64}$/);
    expect(oshiHas(ctx, got.sha, 'png')).toBe(true);
    ctx.apiOshiSetImage(c, 'idle', url('image/jpeg', JPG));
    ctx.apiOshiSetImage(c, 'cheer', url('image/gif', GIF));
    ctx.apiOshiSetImage(c, 'worry', url('image/webp', WEBP));
    const rows = ctx.dbReadAll('oshi_images');
    expect(rows.map((r) => r.state).sort()).toEqual(['cheer', 'idle', 'praise', 'worry']);
    expect(rows.every((r) => r.who === 'tester@example.com')).toBe(true);
    // 番号は通し番号
    expect(rows.map((r) => Number(r.id)).sort()).toEqual([1, 2, 3, 4]);
  });

  it('読み返すと同じバイトの data URL が返る', () => {
    const { ctx } = setup();
    const c = make(ctx);
    ctx.apiOshiSetImage(c, 'praise', url('image/png', PNG));
    const back = ctx.apiOshiImage(c, 'praise');
    expect(back.dataUrl).toBe(url('image/png', PNG));
    expect(ctx.apiOshiImage(c, 'idle')).toBe(null);
  });

  it('同じ表情は差し替え (行は1つのまま)。前の中身はゴミ箱へ移す', () => {
    const { ctx, fake } = setup();
    const c = make(ctx);
    const a = ctx.apiOshiSetImage(c, 'praise', url('image/png', PNG));
    const b = ctx.apiOshiSetImage(c, 'praise', url('image/jpeg', JPG));
    expect(ctx.dbReadAll('oshi_images').length).toBe(1);
    expect(ctx.dbReadAll('oshi_images')[0].sha).toBe(b.sha);
    expect(oshiHas(ctx, a.sha, 'png')).toBe(false);
    expect(oshiHas(ctx, b.sha, 'jpg')).toBe(true);
    expect(fake).toBeTruthy();
  });

  it('形式・大きさ・中身が合わなければ、ふつうの言葉で断り、何も置かない', () => {
    const { ctx } = setup();
    const c = make(ctx);
    const before = ctx.objectsFolder_().getFiles();
    let n0 = 0; while (before.hasNext()) { before.next(); n0++; }
    expect(() => ctx.apiOshiSetImage(c, 'praise', 'こんにちは')).toThrow('画像として読めませんでした');
    expect(() => ctx.apiOshiSetImage(c, 'praise', url('image/svg+xml', Buffer.from('<svg/>'))))
      .toThrow('受け取れない形式です (PNG・JPEG・WebP・GIF だけ): image/svg+xml');
    expect(() => ctx.apiOshiSetImage(c, 'praise', url('image/png', Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]))))
      .toThrow('画像は1枚1MBまでにしてください');
    // 名乗った形式と中身が違う (拡張子だけ変えた物)
    expect(() => ctx.apiOshiSetImage(c, 'praise', url('image/png', JPG))).toThrow('画像の中身が形式と合いません');
    expect(() => ctx.apiOshiSetImage(c, 'nope', url('image/png', PNG))).toThrow('知らない表情です: nope');
    expect(ctx.dbReadAll('oshi_images')).toEqual([]);
    const after = ctx.objectsFolder_().getFiles();
    let n1 = 0; while (after.hasNext()) { after.next(); n1++; }
    expect(n1).toBe(n0);
  });

  it('鍵が取れなかったら、中身も置かない', () => {
    const { ctx, fake } = setup();
    const c = make(ctx);
    fake.LockService.getScriptLock = () => ({ tryLock: () => false, releaseLock() {} });
    expect(() => ctx.apiOshiSetImage(c, 'praise', url('image/png', PNG))).toThrow('混み合っています');
    const sha = ctx.sha256HexBytes(ctx.Utilities.newBlob(Array.from(PNG), 'image/png', 'x'));
    expect(oshiHas(ctx, sha, 'png')).toBe(false);
  });

  it('外す・まるごと消すの道がある', () => {
    const { ctx } = setup();
    const c = make(ctx);
    const a = ctx.apiOshiSetImage(c, 'praise', url('image/png', PNG));
    ctx.apiOshiSetImage(c, 'idle', url('image/jpeg', JPG));
    ctx.apiOshiSetProfile(c, 'ルナ', 'genki');
    expect(ctx.apiOshiClearImage(c, 'praise')).toEqual({ charId: c, state: 'praise', removed: true });
    expect(ctx.apiOshiClearImage(c, 'praise')).toEqual({ charId: c, state: 'praise', removed: false });
    expect(oshiHas(ctx, a.sha, 'png')).toBe(false);
    expect(ctx.apiOshiForget()).toEqual({ removed: 1 });
    expect(ctx.dbReadAll('oshi_images')).toEqual([]);
    expect(ctx.dbReadAll('oshi')).toEqual([]);
    // 消したあとは、最初からいるキャラに戻る
    expect(ctx.apiOshiGet()).toMatchObject({ name: 'タク', kind: 'builtin', mine: [] });
    // 画面がでたらめに選ばない表情を知れるように、場面でだけ出す印を渡す
    const states = ctx.apiOshiGet().states;
    expect(states.filter((x) => x.scene).map((x) => x.key)).toEqual(['work', 'pout']);
    expect(states.filter((x) => x.scene === false).length).toBe(states.length - 2);
    expect(states.find((x) => x.key === 'pout')).toMatchObject({ optional: true, fallback: 'worry' });
    expect(states.find((x) => x.key === 'idle')).toMatchObject({ optional: false, fallback: '' });
  });
});

describe('本人にだけ', () => {
  it('ほかの人の画像・名前・せりふは読めず、置いても自分のぶんにしかならない', () => {
    const { ctx, fake } = setup();
    fake._setUser('a@example.com');
    const a = make(ctx, 'ルナ', 'cool');
    ctx.apiOshiSetImage(a, 'praise', url('image/png', PNG));
    ctx.apiOshiSetLines(a, 'done', ['えらい']);
    ctx.apiPrefSet('oshi.char', 'mine:' + a);

    fake._setUser('b@example.com');
    // a の番号を名指ししても、b には無いキャラ
    expect(() => ctx.apiOshiImage(a, 'praise')).not.toThrow();
    expect(ctx.apiOshiImage(a, 'praise')).toBe(null);
    expect(() => ctx.apiOshiSetImage(a, 'praise', url('image/jpeg', JPG))).toThrow('そのキャラは見つかりません');
    expect(() => ctx.apiOshiSetProfile(a, 'のっとり', 'polite')).toThrow('そのキャラは見つかりません');
    expect(() => ctx.apiOshiCharDelete(a)).toThrow('そのキャラは見つかりません');
    expect(() => ctx.apiPrefSet('oshi.char', 'mine:' + a)).toThrow('そのキャラは選べません');
    const b = ctx.apiOshiGet();
    expect(b).toMatchObject({ name: 'タク', kind: 'builtin', mine: [], images: [] });
    expect(b.events.find((e) => e.key === 'done').mine).toEqual([]);
    // b が自分のキャラを作っても、a のぶんは変わらない (番号は人ごと)
    const bc = make(ctx, 'ソラ');
    expect(bc).toBe(1);
    ctx.apiOshiSetImage(bc, 'praise', url('image/jpeg', JPG));
    fake._setUser('a@example.com');
    expect(ctx.apiOshiImage(a, 'praise').dataUrl).toBe(url('image/png', PNG));
    expect(ctx.apiOshiGet()).toMatchObject({ name: 'ルナ', kind: 'mine', charId: a });
    expect(ctx.apiOshiGet().mine.map((m) => m.name)).toEqual(['ルナ']);
  });

  it('入口はアドレスを受けない (開いている本人だけ)', () => {
    const src = fs.readFileSync(path.resolve('src/api/Oshi.gs'), 'utf8');
    for (const m of src.matchAll(/^function (api\w+)\(([^)]*)\)/gm)) {
      expect(m[2], m[1]).not.toMatch(/email|who|user/i);
    }
  });

  it('大文字のアドレスで書かれた行も本人のものとして読む', () => {
    const { ctx, fake } = setup();
    fake._setUser('A@Example.com');
    const c = make(ctx, 'ルナ', 'polite');
    fake._setUser('a@example.com');
    ctx.apiOshiSetProfile(c, 'ルナ2', 'polite');
    expect(ctx.apiOshiGet().mine.map((m) => m.name)).toEqual(['ルナ2']);
    expect(ctx.dbReadAll('oshi').length).toBe(1);
  });
});

describe('名前・口調・せりふ', () => {
  it('名前と口調を決めると、その口調の既定のせりふと自分のせりふが返る', () => {
    const { ctx } = setup();
    expect(ctx.apiOshiGet().tone).toBe('buddy');
    const c = make(ctx);
    ctx.apiPrefSet('oshi.char', 'mine:' + c);
    ctx.apiOshiSetProfile(c, ' ルナ ', 'kansai');
    ctx.apiOshiSetLines(c, 'done', 'さすが！\nえらい！');
    const got = ctx.apiOshiGet();
    expect(got.name).toBe('ルナ');
    expect(got.tone).toBe('kansai');
    const done = got.events.find((e) => e.key === 'done');
    expect(done.lines).toEqual(pure.OSHI_LINES().kansai.done);
    expect(done.mine).toEqual(['さすが！', 'えらい！']);
    // せりふを空にすると、既定だけに戻る
    ctx.apiOshiSetLines(c, 'done', []);
    expect(ctx.apiOshiGet().events.find((e) => e.key === 'done').mine).toEqual([]);
    // 何度書いても1人1行
    expect(ctx.dbReadAll('oshi').length).toBe(1);
  });

  it('知らない口調・場面、長すぎる名前は断る', () => {
    const { ctx } = setup();
    const c = make(ctx);
    expect(() => ctx.apiOshiSetProfile(c, 'ルナ', 'yankee')).toThrow('知らない口調です: yankee');
    expect(() => ctx.apiOshiSetProfile(c, 'あ'.repeat(21), 'polite')).toThrow('名前は20字までにしてください');
    expect(() => ctx.apiOshiSetLines(c, 'scold', ['x'])).toThrow('知らない場面です: scold');
    expect(() => ctx.apiOshiCharCreate('あ'.repeat(21), 'polite')).toThrow('名前は20字までにしてください');
    expect(() => ctx.apiOshiCharCreate('ルナ', 'yankee')).toThrow('知らない口調です: yankee');
    for (const bad of ['0', -1, 1.5, 'x', '__proto__', null]) expect(() => ctx.apiOshiSetProfile(bad, 'a', 'polite'), String(bad)).toThrow('知らないキャラです');
  });

  it('台帳の字は数式として読ませない ("=" 始まりの名前)', () => {
    const { ctx } = setup();
    make(ctx, '=1+1', 'polite');
    expect(ctx.apiOshiGet().mine[0].name).toBe('=1+1');
  });

  it('手で壊されたせりふの欄は、無いものとして読む', () => {
    const { ctx } = setup();
    make(ctx, 'ルナ', 'polite');
    ctx.dbUpdate('oshi', 'id', 1, { lines: '{こわれた' });
    expect(ctx.apiOshiGet().mine[0].events.find((e) => e.key === 'done').mine).toEqual([]);
  });
});

describe('育てる (Lv = 1 + 取った実績の数)', () => {
  function closeFor(ctx, who) {
    const i = ctx.issueCreate('しごと', '', []);
    ctx.dbUpdate('issues', 'number', i.number, { assignee: who });
    ctx.issueClose(i.number, null);
    return i.number;
  }
  const now = new Date('2026-10-21T03:00:00Z');

  it('実績を取るとレベルが上がり、段が決まる (本人のぶんだけ)', () => {
    const { ctx } = setup();
    expect(ctx.apiOshiGet().growth).toMatchObject({ key: 'grow1', level: 1, unlocked: 0 });
    // 開いた1日目 (はじめの一日) と、はじめて片づけた
    ctx.achCheck_('tester@example.com', now, { countDay: true });
    closeFor(ctx, 'tester@example.com');
    closeFor(ctx, 'other@example.com');
    ctx.achCheck_('tester@example.com', now, {});
    const g = ctx.apiOshiGet().growth;
    expect(g).toMatchObject({ key: 'grow1', level: 3, unlocked: 2, toNext: 2 });
  });

  it('ポイントは推しの育ちに効かない (前はポイントで育っていた)', () => {
    const { ctx } = setup();
    ctx.apiSetGameEnabled(true);
    ctx.apiGameJoin(true);
    for (let i = 0; i < 12; i++) closeFor(ctx, 'tester@example.com');
    // まだ数え直していないので、実績は無い
    expect(ctx.apiOshiGet().growth).toMatchObject({ level: 1, key: 'grow1' });
  });

  it('取り消しても下がらない (取った実績は消えない)', () => {
    const { ctx } = setup();
    const nums = [];
    for (let i = 0; i < 10; i++) nums.push(closeFor(ctx, 'tester@example.com'));
    ctx.achCheck_('tester@example.com', now, { countDay: true });
    const before = ctx.apiOshiGet().growth;
    expect(before.level).toBe(4); // 1 + はじめの一日・はじめて片づけた・10件片づけた
    nums.forEach((n) => ctx.issueReopen(n));
    ctx.achCheck_('tester@example.com', now, {});
    expect(ctx.apiOshiGet().growth.level).toBe(4);
  });
});

describe('画面に渡せる形か', () => {
  function dates(v, p) {
    if (v === null || v === undefined) return [];
    if (Object.prototype.toString.call(v) === '[object Date]') return [p];
    if (typeof v === 'function') return [p + ' (関数)'];
    if (typeof v === 'object') return Object.keys(v).flatMap((k) => dates(v[k], p + '.' + k));
    return [];
  }
  it('どの入口も Date と関数を返さない', () => {
    const { ctx } = setup();
    const created = ctx.apiOshiCharCreate('ルナ', 'polite');
    const c = created.charId;
    const two = make(ctx, 'ソラ');
    ctx.apiPrefSet('oshi.char', 'mine:' + c);
    const outs = {
      apiOshiCharCreate: created,
      apiOshiSetImage: ctx.apiOshiSetImage(c, 'praise', url('image/png', PNG)),
      apiOshiGet: ctx.apiOshiGet(),
      apiOshiImage: ctx.apiOshiImage(c, 'praise'),
      apiOshiSetProfile: ctx.apiOshiSetProfile(c, 'ルナ', 'genki'),
      apiOshiSetLines: ctx.apiOshiSetLines(c, 'done', ['えらい']),
      apiOshiClearImage: ctx.apiOshiClearImage(c, 'praise'),
      apiOshiCharDelete: ctx.apiOshiCharDelete(two),
      apiOshiForget: ctx.apiOshiForget(),
    };
    for (const [name, v] of Object.entries(outs)) expect(dates(v, name)).toEqual([]);
    expect(typeof outs.apiOshiGet.images).toBe('object');
  });
});

describe('手引き (docs/manual/oshi.md)', () => {
  const text = fs.readFileSync(path.resolve('docs/manual/oshi.md'), 'utf8');

  it('頼み文を写さない (唯一の定義は Oshi.js。写すと片方だけ直って食い違う)', () => {
    for (const s of pure.OSHI_STATES()) expect(text.includes(s.pose), s.key).toBe(false);
    for (const r of pure.OSHI_PROMPT_RULES().slice(1)) expect(text.includes(r.slice(2)), r).toBe(false);
    for (const line of pure.OSHI_PROMPT_BASE().split('\n').slice(0, 3)) expect(text.includes(line), line).toBe(false);
  });

  it('表情・口調の名前と、上限の数は定義と同じ', () => {
    for (const s of pure.OSHI_STATES()) expect(text, s.label).toContain(s.label.replace(/^育ち\d /, ''));
    for (const t of pure.OSHI_TONES()) expect(text, t.label).toContain(t.label);
    const lim = pure.OSHI_IMAGE_LIMITS();
    expect(text).toContain(Math.round(lim.maxBytes / 1024 / 1024) + 'MB');
    expect(text).toContain(lim.maxPx + 'px');
    expect(text).toContain(pure.OSHI_TEXT_LIMITS().linesPerEvent + '個まで');
    expect(text).toContain(pure.OSHI_TEXT_LIMITS().lineMax + '字まで');
    expect(text).toContain(pure.OSHI_LUCKY_ONE_IN() + ' 回に 1 回');
    for (const st of pure.OSHI_STAGES().slice(1)) expect(text).toContain('Lv' + st.min + ' で' + st.label);
  });
});


function setupWithPictures() {
  const fake = createFakeGas();
  const ctx = loadGasWith(fake, ...APP_SOURCES, ...OSHI_DEFAULT_SOURCES);
  ctx.repoInit('agentic-management');
  return { ctx, fake };
}

describe('最初からいるキャラ', () => {
  it('表は1つ (OSHI_BUILTINS): タク (明るい相棒) とイツキ (耽美)。先頭 (タク) が既定', () => {
    expect(pure.OSHI_BUILTINS()).toEqual([
      { key: 'taku', name: 'タク', tone: 'buddy' },
      { key: 'itsuki', name: 'イツキ', tone: 'gothic' },
    ]);
    for (const c of pure.OSHI_BUILTINS()) expect(pure.oshiToneKnown(c.tone), c.key).toBe(true);
    expect(pure.oshiBuiltinOf('taku').name).toBe('タク');
    expect(pure.oshiBuiltinOf('nobody')).toBe(null);
    const { ctx } = setup();
    expect(ctx.PREFS_SCHEMA().find((p) => p.key === 'oshi.char').def).toBe('builtin:taku');
    expect(ctx.PREFS_SCHEMA().find((p) => p.key === 'oshi.fallback').def).toBe('builtin:taku');
  });

  it('使うキャラの名指しは builtin:<key> か mine:<番号> だけを読む', () => {
    expect(pure.oshiCharParse('builtin:taku')).toEqual({ kind: 'builtin', key: 'taku', id: 0 });
    expect(pure.oshiCharParse('mine:3')).toEqual({ kind: 'mine', key: '', id: 3 });
    for (const bad of ['builtin:nobody', 'builtin:', 'mine:0', 'mine:-1', 'mine:1.5', 'mine:x', 'taku', '', null, 'builtin:__proto__']) {
      expect(pure.oshiCharParse(bad), String(bad)).toBe(null);
    }
  });

  it('何も決めていない人はタク。名前と口調は決まっていて、口調のせりふだけを言う', () => {
    const { ctx } = setup();
    const got = ctx.apiOshiGet();
    expect(got).toMatchObject({ char: 'builtin:taku', kind: 'builtin', builtinKey: 'taku', name: 'タク', tone: 'buddy',
      charId: 0, images: [], mine: [], mineMax: 5 });
    expect(got.builtins.map((c) => c.key)).toEqual(['taku', 'itsuki']);
    expect(got.events.find((e) => e.key === 'done').lines).toEqual(pure.OSHI_LINES().buddy.done);
    expect(got.events.every((e) => e.mine.length === 0)).toBe(true);
    expect(got.styles.map((s) => s.key)).toEqual(['chibi', 'normal']);
  });

  it('設定でイツキを選ぶと、イツキの名前と耽美のせりふになる', () => {
    const { ctx } = setup();
    ctx.apiPrefSet('oshi.char', 'builtin:itsuki');
    const got = ctx.apiOshiGet();
    expect(got).toMatchObject({ char: 'builtin:itsuki', kind: 'builtin', builtinKey: 'itsuki', name: 'イツキ', tone: 'gothic' });
    expect(got.events.find((e) => e.key === 'night').lines).toEqual(pure.OSHI_LINES().gothic.night);
    expect(ctx.apiPrefs().effective.oshi).toMatchObject({ on: true, char: 'builtin:itsuki', fallback: 'builtin:taku', style: 'chibi' });
  });

  it('耽美の口調は全部の場面に3つ以上あり、「なのだ」で話す (一人称は俺。敬語を使わない)', () => {
    const g = pure.OSHI_LINES().gothic;
    expect(pure.OSHI_TONES().find((t) => t.key === 'gothic').label).toBe('耽美 (祈りの口調)');
    for (const e of pure.OSHI_EVENTS()) {
      expect(g[e.key].length, e.key).toBeGreaterThanOrEqual(3);
      expect(g[e.key].some((l) => l.includes('なのだ')), e.key).toBe(true);
      for (const l of g[e.key]) {
        expect(l, e.key).toContain('のだ');
        expect(l, e.key).not.toMatch(/です|ます|ございます|私|僕/);
      }
    }
  });

  it('明るい相棒の口調は全部の場面に3〜4つあり、です・ますで明るく話す (一人称は僕。耽美の語尾を混ぜない)', () => {
    const b = pure.OSHI_LINES().buddy;
    expect(pure.OSHI_TONES().find((t) => t.key === 'buddy').label).toBe('明るい相棒');
    for (const e of pure.OSHI_EVENTS()) {
      expect(b[e.key].length, e.key).toBeGreaterThanOrEqual(3);
      // 考え中 (spinner) は吹き出しで回さず、Claude Code の考え中の字に並べるので多くてよい
      if (!e.spinner) expect(b[e.key].length, e.key).toBeLessThanOrEqual(4);
      expect(b[e.key].some((l) => /です|ます|しょう/.test(l)), e.key).toBe(true);
      for (const l of b[e.key]) {
        expect(l, e.key).not.toMatch(/のだ|俺|でございます/);
        expect(l.length, l).toBeLessThanOrEqual(pure.OSHI_TEXT_LIMITS().lineMax);
      }
    }
    const all = JSON.stringify(b);
    expect(all).toContain('僕');
    expect(all).toContain('道具');
    expect(all).toContain('余白');
  });

  it('設定に「使うキャラ」「絵が無い表情」「2頭身・等身」がある', () => {
    const { ctx } = setup();
    const items = ctx.apiPrefs().items;
    expect(items.find((p) => p.key === 'oshi.char')).toMatchObject({ type: 'char', def: 'builtin:taku', scope: 'me' });
    expect(items.find((p) => p.key === 'oshi.char').options.map((o) => o.value)).toEqual(['builtin:taku', 'builtin:itsuki']);
    const fb = items.find((p) => p.key === 'oshi.fallback');
    expect(fb).toMatchObject({ type: 'enum', def: 'builtin:taku', scope: 'me' });
    expect(fb.options.map((o) => o.value)).toEqual(['builtin:taku', 'builtin:itsuki', 'none']);
    const style = items.find((p) => p.key === 'oshi.style');
    expect(style).toMatchObject({ type: 'enum', def: 'chibi', scope: 'me' });
    expect(style.options.map((o) => o.value)).toEqual(['chibi', 'normal']);
    expect(items.find((p) => p.key === 'oshi.useDefault')).toBe(undefined);
  });

  it('絵は1枚ずつ返す。どのキャラ・どの形・どの表情にもあり、透明な WebP', () => {
    const { ctx } = setupWithPictures();
    const seen = new Set();
    for (const c of pure.OSHI_BUILTINS()) {
      for (const st of pure.OSHI_STYLES()) {
        for (const s of pure.OSHI_STATES()) {
          const got = ctx.apiOshiDefaultImage(c.key, st.key, s.key);
          // 絵が無くてもよい表情 (むっ) は、まだ絵が無い (画面が fallback の表情に代える)
          if (s.optional) {
            expect(got, c.key + st.key + s.key).toBe(null);
            continue;
          }
          expect(got).toMatchObject({ char: c.key, style: st.key, state: s.key });
          const bytes = Buffer.from(got.dataUrl.replace(/^data:image\/webp;base64,/, ''), 'base64');
          expect(bytes.toString('latin1', 0, 4) + bytes.toString('latin1', 8, 12), c.key + st.key + s.key).toBe('RIFFWEBP');
          seen.add(got.dataUrl);
        }
      }
    }
    // 取り違えていない (キャラ・形・表情ごとに別の絵)
    expect(seen.size).toBe(pure.OSHI_BUILTINS().length * pure.OSHI_STYLES().length *
      pure.OSHI_STATES().filter((s) => !s.optional).length);
  });

  it('知らないキャラ・形・表情はふつうの言葉で断る', () => {
    const { ctx } = setupWithPictures();
    expect(() => ctx.apiOshiDefaultImage('nobody', 'chibi', 'idle')).toThrow('知らないキャラです: nobody');
    expect(() => ctx.apiOshiDefaultImage('__proto__', 'chibi', 'idle')).toThrow('知らないキャラです');
    expect(() => ctx.apiOshiDefaultImage('taku', 'real', 'idle')).toThrow('知らない絵の形です: real');
    expect(() => ctx.apiOshiDefaultImage('taku', 'chibi', 'nope')).toThrow('知らない表情です: nope');
    expect(() => ctx.apiOshiDefaultImage('taku', '__proto__', 'idle')).toThrow('知らない絵の形です');
  });

  it('自分のキャラに絵を入れても、最初からいるキャラの絵は変わらない。最初の返事に絵の中身は入れない', () => {
    const { ctx } = setupWithPictures();
    const before = ctx.apiOshiDefaultImage('itsuki', 'chibi', 'praise').dataUrl;
    const c = make(ctx);
    ctx.apiOshiSetImage(c, 'praise', url('image/png', PNG));
    expect(ctx.apiOshiImage(c, 'praise').dataUrl).toBe(url('image/png', PNG));
    expect(ctx.apiOshiDefaultImage('itsuki', 'chibi', 'praise').dataUrl).toBe(before);
    expect(JSON.stringify(ctx.apiOshiGet())).not.toContain('data:image/webp');
    const v = ctx.apiOshiDefaultImage('taku', 'normal', 'grow3');
    expect(Object.values(v).every((x) => typeof x === 'string')).toBe(true);
  });
});

describe('自分のキャラを何人も', () => {
  it('5人まで作れ、6人目はふつうの言葉で断る (台帳にも足さない)', () => {
    const { ctx } = setup();
    const ids = [1, 2, 3, 4, 5].map((i) => make(ctx, 'キャラ' + i));
    expect(ids).toEqual([1, 2, 3, 4, 5]);
    expect(() => ctx.apiOshiCharCreate('6人目', 'polite')).toThrow('自分のキャラは5人までです');
    expect(ctx.dbReadAll('oshi').length).toBe(5);
    expect(ctx.apiOshiGet().mine.map((m) => m.name)).toEqual(['キャラ1', 'キャラ2', 'キャラ3', 'キャラ4', 'キャラ5']);
  });

  it('絵・名前・せりふはキャラごと。1人を消しても、ほかのキャラはそのまま', () => {
    const { ctx } = setup();
    const a = make(ctx, 'ルナ', 'genki');
    const b = make(ctx, 'ソラ', 'cool');
    const pa = ctx.apiOshiSetImage(a, 'praise', url('image/png', PNG));
    ctx.apiOshiSetImage(b, 'praise', url('image/jpeg', JPG));
    ctx.apiOshiSetImage(b, 'idle', url('image/gif', GIF));
    ctx.apiOshiSetLines(b, 'done', ['ソラのせりふ']);
    expect(ctx.apiOshiImage(a, 'praise').dataUrl).toBe(url('image/png', PNG));
    expect(ctx.apiOshiImage(b, 'praise').dataUrl).toBe(url('image/jpeg', JPG));
    expect(ctx.apiOshiImage(a, 'idle')).toBe(null);
    const got = ctx.apiOshiGet().mine;
    expect(got.find((m) => m.charId === a).events.find((e) => e.key === 'done').mine).toEqual([]);
    expect(got.find((m) => m.charId === b).events.find((e) => e.key === 'done')).toMatchObject({
      mine: ['ソラのせりふ'], lines: pure.OSHI_LINES().cool.done });

    expect(ctx.apiOshiCharDelete(a)).toEqual({ charId: a, removed: 1 });
    expect(oshiHas(ctx, pa.sha, 'png')).toBe(false);
    const left = ctx.apiOshiGet().mine;
    expect(left.map((m) => m.charId)).toEqual([b]);
    expect(left[0].images.map((i) => i.state).sort()).toEqual(['idle', 'praise']);
    expect(ctx.apiOshiImage(b, 'praise').dataUrl).toBe(url('image/jpeg', JPG));
    expect(() => ctx.apiOshiSetImage(a, 'praise', url('image/png', PNG))).toThrow('そのキャラは見つかりません');
  });

  it('同じ絵を2人に入れて1人を消しても、もう1人の絵の中身は残す', () => {
    const { ctx } = setup();
    const a = make(ctx);
    const b = make(ctx);
    const got = ctx.apiOshiSetImage(a, 'praise', url('image/png', PNG));
    ctx.apiOshiSetImage(b, 'praise', url('image/png', PNG));
    ctx.apiOshiCharDelete(a);
    expect(oshiHas(ctx, got.sha, 'png')).toBe(true);
    expect(ctx.apiOshiImage(b, 'praise').dataUrl).toBe(url('image/png', PNG));
  });

  it('消した番号は次のキャラに回さない (選んでいたキャラが別のキャラにすり替わらない)', () => {
    const { ctx } = setup();
    make(ctx, 'ルナ');
    const b = make(ctx, 'ソラ');
    ctx.apiOshiCharDelete(b);
    expect(make(ctx, 'ミナ')).toBe(3);
    // 全部消しても戻さない
    ctx.apiOshiForget();
    expect(make(ctx, 'ハル')).toBe(4);
  });

  it('作るのは鍵の中。鍵が取れなければ作らない', () => {
    const { ctx, fake } = setup();
    fake.LockService.getScriptLock = () => ({ tryLock: () => false, releaseLock() {} });
    expect(() => ctx.apiOshiCharCreate('ルナ', 'polite')).toThrow('混み合っています');
    expect(ctx.dbReadAll('oshi')).toEqual([]);
  });
});

describe('使うキャラを選ぶ (oshi.char) と、絵が無い表情 (oshi.fallback)', () => {
  it('自分のキャラは、持っているものだけ選べる。無いもの・知らないものはふつうの言葉で断る', () => {
    const { ctx } = setup();
    expect(() => ctx.apiPrefSet('oshi.char', 'mine:1')).toThrow('そのキャラは選べません');
    expect(() => ctx.apiPrefSet('oshi.char', 'builtin:nobody')).toThrow('そのキャラは選べません');
    expect(() => ctx.apiPrefSet('oshi.char', 7)).toThrow('そのキャラは選べません');
    const c = make(ctx, 'ルナ', 'kansai');
    ctx.apiPrefSet('oshi.char', 'mine:' + c);
    expect(ctx.apiPrefs().effective.oshi.char).toBe('mine:' + c);
    expect(ctx.apiOshiGet()).toMatchObject({ char: 'mine:' + c, kind: 'mine', charId: c, builtinKey: '', name: 'ルナ',
      tone: 'kansai', fallback: 'taku' });
  });

  it('自分のキャラの絵が無い表情に出すのは oshi.fallback の最初からいるキャラ。「出さない」なら空', () => {
    const { ctx } = setup();
    const c = make(ctx, 'ルナ');
    ctx.apiPrefSet('oshi.char', 'mine:' + c);
    ctx.apiPrefSet('oshi.fallback', 'builtin:itsuki');
    expect(ctx.apiOshiGet().fallback).toBe('itsuki');
    ctx.apiPrefSet('oshi.fallback', 'none');
    expect(ctx.apiOshiGet().fallback).toBe('');
    expect(() => ctx.apiPrefSet('oshi.fallback', 'builtin:nobody')).toThrow('入れられない値です');
  });

  it('選んでいたキャラを消すと、選び方を既定に戻す (覚えた値も消す)', () => {
    const { ctx, fake } = setup();
    const c = make(ctx, 'ルナ');
    ctx.apiPrefSet('oshi.char', 'mine:' + c);
    ctx.apiOshiCharDelete(c);
    // 表示の道は無いキャラを既定に倒すだけなので、覚えた値そのものが消えたかを見る
    const raw = fake.PropertiesService.getScriptProperties().getProperty('MYPREF:tester@example.com');
    expect(raw === null || !('oshi.char' in JSON.parse(raw))).toBe(true);
    const p = ctx.apiPrefs().items.find((x) => x.key === 'oshi.char');
    expect(p).toMatchObject({ value: 'builtin:taku', custom: false });
    expect(ctx.apiOshiGet()).toMatchObject({ kind: 'builtin', name: 'タク' });
  });

  it('設定に残った無いキャラ (台帳を手で消した) は、画面を止めずに既定のキャラで出す', () => {
    const { ctx, fake } = setup();
    const c = make(ctx, 'ルナ');
    ctx.apiPrefSet('oshi.char', 'mine:' + c);
    // 台帳の行を手で消した
    ctx.dbDelete('oshi', 'id', 1);
    expect(() => ctx.apiPrefs()).not.toThrow();
    expect(ctx.apiPrefs().effective.oshi.char).toBe('builtin:taku');
    expect(ctx.apiOshiGet()).toMatchObject({ kind: 'builtin', name: 'タク' });
    // スクリプトプロパティを手で書き換えた (読めない値)
    fake.PropertiesService.getScriptProperties().setProperty('MYPREF:tester@example.com', JSON.stringify({ 'oshi.char': 'mine:abc' }));
    expect(ctx.apiOshiGet()).toMatchObject({ kind: 'builtin', name: 'タク' });
  });

  it('既定 (タク) を選び直したら、決めた値を残さない', () => {
    const { ctx } = setup();
    ctx.apiPrefSet('oshi.char', 'builtin:itsuki');
    ctx.apiPrefSet('oshi.char', 'builtin:taku');
    expect(ctx.apiPrefs().items.find((x) => x.key === 'oshi.char').custom).toBe(false);
  });
});

describe('charId の列を足す前の行', () => {
  it('charId が空の名前と絵の行は、その人の1人目として読み、書き直すと 1 が入る', () => {
    const { ctx } = setup();
    // 列を足す前に書かれた行 (charId なし)
    ctx.dbAppendNumbered('oshi', 'id', { who: 'tester@example.com', name: 'むかし', tone: 'genki', lines: '{"done":["前のせりふ"]}', updatedAt: new Date() });
    const sha = 'a'.repeat(64);
    ctx.dbAppendNumbered('oshi_images', 'id', { who: 'tester@example.com', state: 'praise', sha, mime: 'image/png', updatedAt: new Date() });
    expect(ctx.dbReadAll('oshi')[0].charId).toBe('');
    const got = ctx.apiOshiGet();
    expect(got.mine).toHaveLength(1);
    expect(got.mine[0]).toMatchObject({ charId: 1, name: 'むかし', tone: 'genki' });
    expect(got.mine[0].images.map((i) => i.state)).toEqual(['praise']);
    expect(got.mine[0].events.find((e) => e.key === 'done').mine).toEqual(['前のせりふ']);
    // 選べる・直せる。直しても行は1つのまま
    ctx.apiPrefSet('oshi.char', 'mine:1');
    ctx.apiOshiSetProfile(1, 'むかし2', 'genki');
    expect(ctx.dbReadAll('oshi')).toHaveLength(1);
    expect(Number(ctx.dbReadAll('oshi')[0].charId)).toBe(1);
    // 次に作るのは2人目
    expect(make(ctx, 'あたらしい')).toBe(2);
  });

  it('名前を決めずに絵だけ入れていた人も、1人目のキャラがいる', () => {
    const { ctx } = setup();
    ctx.dbAppendNumbered('oshi_images', 'id', { who: 'tester@example.com', state: 'idle', sha: 'b'.repeat(64), mime: 'image/png', updatedAt: new Date() });
    expect(ctx.apiOshiGet().mine).toEqual([expect.objectContaining({ charId: 1, name: '', tone: 'polite' })]);
    ctx.apiOshiSetProfile(1, 'ルナ', 'polite');
    expect(ctx.apiOshiGet().mine[0].name).toBe('ルナ');
  });
});

describe('文書の履歴の画像と取り違えない', () => {
  /** 文書の履歴が同じバイトの画像を objects/ に置いた (DocRenderer と同じ置き方) */
  const commitImage = (ctx) => {
    const blob = ctx.Utilities.newBlob(Array.from(PNG), 'image/png', 'x');
    const sha = ctx.sha256HexBytes(blob);
    ctx.objectPutBlob(sha, blob, 'png');
    return sha;
  };

  it('同じバイトの推しの画像を差し替え・外し・キャラごと消し・全部消しても、履歴の画像は残る', () => {
    const { ctx } = setup();
    const sha = commitImage(ctx);
    const c = make(ctx);
    expect(ctx.apiOshiSetImage(c, 'praise', url('image/png', PNG)).sha).toBe(sha);
    ctx.apiOshiSetImage(c, 'praise', url('image/jpeg', JPG));
    expect(ctx.objectExists(sha, 'png')).toBe(true);
    ctx.apiOshiSetImage(c, 'praise', url('image/png', PNG));
    ctx.apiOshiClearImage(c, 'praise');
    expect(ctx.objectExists(sha, 'png')).toBe(true);
    ctx.apiOshiSetImage(c, 'idle', url('image/png', PNG));
    ctx.apiOshiCharDelete(c);
    expect(ctx.objectExists(sha, 'png')).toBe(true);
    const d = make(ctx);
    ctx.apiOshiSetImage(d, 'idle', url('image/png', PNG));
    ctx.apiOshiForget();
    expect(ctx.objectExists(sha, 'png')).toBe(true);
  });

  it('この形にする前の行 (中身が <sha>.<ext>) は読めて、外しても消しても中身をゴミ箱へ移さない', () => {
    const { ctx } = setup();
    const sha = commitImage(ctx);
    // 前の形で書かれた推しの行 (中身は履歴の画像と同じ名前)
    ctx.dbAppendNumbered('oshi_images', 'id', { who: 'tester@example.com', state: 'praise', sha, mime: 'image/png', updatedAt: new Date(), charId: 1 });
    ctx.dbAppendNumbered('oshi_images', 'id', { who: 'tester@example.com', state: 'idle', sha, mime: 'image/png', updatedAt: new Date(), charId: 1 });
    expect(ctx.apiOshiImage(1, 'praise').dataUrl).toBe(url('image/png', PNG));
    ctx.apiOshiSetImage(1, 'praise', url('image/jpeg', JPG));
    ctx.apiOshiClearImage(1, 'praise');
    ctx.apiOshiCharDelete(1);
    expect(ctx.objectExists(sha, 'png')).toBe(true);
  });
});

describe('鍵の中で Drive を触らない', () => {
  it('置く・差し替える・外す・消す・全部消すのどれも、鍵を持っているあいだはファイルを触らない', () => {
    const { ctx, fake } = setup();
    const c = make(ctx);
    const inLock = [];
    const realFolder = ctx.objectsFolder_;
    const realGet = fake.DriveApp.getFolderById;
    ctx.objectsFolder_ = () => { if (ctx.dbLockDepth_ > 0) inLock.push('objectsFolder_'); return realFolder(); };
    fake.DriveApp.getFolderById = (id) => { if (ctx.dbLockDepth_ > 0) inLock.push('getFolderById'); return realGet.call(fake.DriveApp, id); };
    try {
      const a = ctx.apiOshiSetImage(c, 'praise', url('image/png', PNG));
      ctx.apiOshiSetImage(c, 'praise', url('image/jpeg', JPG));
      ctx.apiOshiSetImage(c, 'idle', url('image/gif', GIF));
      ctx.apiOshiClearImage(c, 'idle');
      const d = make(ctx);
      ctx.apiOshiSetImage(d, 'idle', url('image/webp', WEBP));
      ctx.apiOshiCharDelete(c);
      ctx.apiOshiForget();
      // ゴミ箱へ移すことはしている (鍵の外で)
      expect(oshiHas(ctx, a.sha, 'png')).toBe(false);
    } finally {
      ctx.objectsFolder_ = realFolder;
      fake.DriveApp.getFolderById = realGet;
    }
    expect(inLock).toEqual([]);
  });
});

describe('壊れた画像と番号', () => {
  it('形は base64 でも読めない中身なら、ふつうの言葉で断る', () => {
    const { ctx } = setup();
    const c = make(ctx);
    const realDecode = ctx.Utilities.base64Decode;
    ctx.Utilities.base64Decode = () => { throw new Error('Invalid argument: base64'); };
    try {
      expect(() => ctx.apiOshiSetImage(c, 'praise', 'data:image/png;base64,iVBO=w==')).toThrow('画像として読めませんでした');
    } finally {
      ctx.Utilities.base64Decode = realDecode;
    }
  });

  it('前の形の1人目 (番号を覚えていない) を消しても、次のキャラに 1 を回さない', () => {
    const { ctx } = setup();
    ctx.dbAppendNumbered('oshi', 'id', { who: 'tester@example.com', name: 'むかし', tone: 'genki', lines: '{}', updatedAt: new Date() });
    ctx.apiOshiCharDelete(1);
    expect(make(ctx, 'あたらしい')).toBe(2);
  });
});

describe('推しは既定でオン、選ぶのは自分の設定', () => {
  it('何も決めていない人は推しがオンで、使うキャラも絵が無い表情もタク', () => {
    const { ctx } = setup();
    expect(ctx.apiPrefs().effective.oshi).toMatchObject({ on: true, char: 'builtin:taku', fallback: 'builtin:taku' });
  });

  it('推しの設定はどれも自分の設定で、チームの設定には出ず、管理者が書いても本人のぶんにしか効かない', () => {
    const { ctx, fake } = setup();
    const keys = ['oshi.on', 'oshi.home', 'oshi.char', 'oshi.fallback', 'oshi.style'];
    for (const k of keys) expect(ctx.PREFS_SCHEMA().find((p) => p.key === k).scope, k).toBe('me');
    // 持ち主 (= 管理者) が選んでも、書くのは自分の覚え (MYPREF:) だけ
    ctx.apiPrefSet('oshi.char', 'builtin:itsuki');
    const props = fake.PropertiesService.getScriptProperties();
    for (const k of keys) expect(props.getProperty('PREF:' + k), k).toBe(null);
    // チームの値を手で書いても読まない
    props.setProperty('PREF:oshi.char', JSON.stringify('builtin:itsuki'));
    fake._setUser('b@example.com');
    expect(ctx.apiPrefs().effective.oshi.char).toBe('builtin:taku');
    expect(ctx.apiOshiGet().name).toBe('タク');
  });

  it('選んでもらったときのせりふ (chosen) は、どの口調にもあり、表情は出すときにでたらめに選ぶ', () => {
    const ev = pure.OSHI_EVENTS().find((e) => e.key === 'chosen');
    expect(ev).toMatchObject({ label: '選んでもらった', randomState: true });
    expect(ev.praise).toBeFalsy();
    for (const t of pure.OSHI_TONES()) {
      const l = pure.OSHI_LINES()[t.key].chosen;
      expect(l.length, t.key).toBeGreaterThanOrEqual(3);
      expect(l.length, t.key).toBeLessThanOrEqual(4);
    }
    const { ctx } = setup();
    expect(ctx.apiOshiGet().events.find((e) => e.key === 'chosen')).toMatchObject({ randomState: true,
      lines: pure.OSHI_LINES().buddy.chosen });
  });
});
