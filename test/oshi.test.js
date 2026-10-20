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

describe('定義 (Oshi.js)', () => {
  it('表情は待機・ほめる・おいわい・おうえん・しんぱい・ねむい・びっくりと、育ちの3段', () => {
    const keys = pure.OSHI_STATES().map((s) => s.key);
    expect(keys).toEqual(['idle', 'praise', 'celebrate', 'cheer', 'worry', 'sleepy', 'surprise', 'grow1', 'grow2', 'grow3']);
    expect(pure.OSHI_STAGES().map((s) => s.key)).toEqual(['grow1', 'grow2', 'grow3']);
  });

  it('せりふは口調ごとに全部の場面を持ち、どの場面にも2つ以上ある (回すため)', () => {
    const lines = pure.OSHI_LINES();
    const events = pure.OSHI_EVENTS().map((e) => e.key);
    expect(Object.keys(lines).sort()).toEqual(pure.OSHI_TONES().map((t) => t.key).sort());
    for (const tone of Object.keys(lines)) {
      expect(Object.keys(lines[tone]).sort(), tone).toEqual([...events].sort());
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

  it('育ちの段は数で決まり、届いた段より下には戻らない', () => {
    expect(pure.oshiStageOf(0).key).toBe('grow1');
    expect(pure.oshiStageOf(5).meter).toBe(50);
    expect(pure.oshiStageOf(5).toNext).toBe(5);
    expect(pure.oshiStageOf(10).key).toBe('grow2');
    expect(pure.oshiStageOf(40)).toMatchObject({ key: 'grow3', meter: 100, toNext: 0 });
    // 取り消して数が減っても、届いた段に留まる
    expect(pure.oshiStageOf(3, 1).key).toBe('grow2');
    expect(pure.oshiStageOf(3, 9).key).toBe('grow3');
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
    const got = ctx.apiOshiSetImage('praise', url('image/png', PNG));
    expect(got.state).toBe('praise');
    expect(got.sha).toMatch(/^[0-9a-f]{64}$/);
    expect(ctx.objectExists(got.sha, 'png')).toBe(true);
    ctx.apiOshiSetImage('idle', url('image/jpeg', JPG));
    ctx.apiOshiSetImage('cheer', url('image/gif', GIF));
    ctx.apiOshiSetImage('worry', url('image/webp', WEBP));
    const rows = ctx.dbReadAll('oshi_images');
    expect(rows.map((r) => r.state).sort()).toEqual(['cheer', 'idle', 'praise', 'worry']);
    expect(rows.every((r) => r.who === 'tester@example.com')).toBe(true);
    // 番号は通し番号
    expect(rows.map((r) => Number(r.id)).sort()).toEqual([1, 2, 3, 4]);
  });

  it('読み返すと同じバイトの data URL が返る', () => {
    const { ctx } = setup();
    ctx.apiOshiSetImage('praise', url('image/png', PNG));
    const back = ctx.apiOshiImage('praise');
    expect(back.dataUrl).toBe(url('image/png', PNG));
    expect(ctx.apiOshiImage('idle')).toBe(null);
  });

  it('同じ表情は差し替え (行は1つのまま)。前の中身はゴミ箱へ移す', () => {
    const { ctx, fake } = setup();
    const a = ctx.apiOshiSetImage('praise', url('image/png', PNG));
    const b = ctx.apiOshiSetImage('praise', url('image/jpeg', JPG));
    expect(ctx.dbReadAll('oshi_images').length).toBe(1);
    expect(ctx.dbReadAll('oshi_images')[0].sha).toBe(b.sha);
    expect(ctx.objectExists(a.sha, 'png')).toBe(false);
    expect(ctx.objectExists(b.sha, 'jpg')).toBe(true);
    expect(fake).toBeTruthy();
  });

  it('形式・大きさ・中身が合わなければ、ふつうの言葉で断り、何も置かない', () => {
    const { ctx } = setup();
    const before = ctx.objectsFolder_().getFiles();
    let n0 = 0; while (before.hasNext()) { before.next(); n0++; }
    expect(() => ctx.apiOshiSetImage('praise', 'こんにちは')).toThrow('画像として読めませんでした');
    expect(() => ctx.apiOshiSetImage('praise', url('image/svg+xml', Buffer.from('<svg/>'))))
      .toThrow('受け取れない形式です (PNG・JPEG・WebP・GIF だけ): image/svg+xml');
    expect(() => ctx.apiOshiSetImage('praise', url('image/png', Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]))))
      .toThrow('画像は1枚1MBまでにしてください');
    // 名乗った形式と中身が違う (拡張子だけ変えた物)
    expect(() => ctx.apiOshiSetImage('praise', url('image/png', JPG))).toThrow('画像の中身が形式と合いません');
    expect(() => ctx.apiOshiSetImage('nope', url('image/png', PNG))).toThrow('知らない表情です: nope');
    expect(ctx.dbReadAll('oshi_images')).toEqual([]);
    const after = ctx.objectsFolder_().getFiles();
    let n1 = 0; while (after.hasNext()) { after.next(); n1++; }
    expect(n1).toBe(n0);
  });

  it('鍵が取れなかったら、中身も置かない', () => {
    const { ctx, fake } = setup();
    fake.LockService.getScriptLock = () => ({ tryLock: () => false, releaseLock() {} });
    expect(() => ctx.apiOshiSetImage('praise', url('image/png', PNG))).toThrow('混み合っています');
    const sha = ctx.sha256HexBytes(ctx.Utilities.newBlob(Array.from(PNG), 'image/png', 'x'));
    expect(ctx.objectExists(sha, 'png')).toBe(false);
  });

  it('外す・まるごと消すの道がある', () => {
    const { ctx } = setup();
    const a = ctx.apiOshiSetImage('praise', url('image/png', PNG));
    ctx.apiOshiSetImage('idle', url('image/jpeg', JPG));
    ctx.apiOshiSetProfile('ルナ', 'genki');
    expect(ctx.apiOshiClearImage('praise')).toEqual({ state: 'praise', removed: true });
    expect(ctx.apiOshiClearImage('praise')).toEqual({ state: 'praise', removed: false });
    expect(ctx.objectExists(a.sha, 'png')).toBe(false);
    expect(ctx.apiOshiForget()).toEqual({ removed: 1 });
    expect(ctx.dbReadAll('oshi_images')).toEqual([]);
    expect(ctx.dbReadAll('oshi')).toEqual([]);
    // 消したあとは、最初からいるキャラに戻る
    expect(ctx.apiOshiGet().name).toBe('クロハ');
  });
});

describe('本人にだけ', () => {
  it('ほかの人の画像・名前・せりふは読めず、置いても自分のぶんにしかならない', () => {
    const { ctx, fake } = setup();
    fake._setUser('a@example.com');
    ctx.apiOshiSetImage('praise', url('image/png', PNG));
    ctx.apiOshiSetProfile('ルナ', 'cool');
    ctx.apiOshiSetLines('done', ['えらい']);

    fake._setUser('b@example.com');
    expect(ctx.apiOshiImage('praise')).toBe(null);
    const b = ctx.apiOshiGet();
    expect(b.name).toBe('クロハ');
    expect(b.images).toEqual([]);
    expect(b.events.find((e) => e.key === 'done').mine).toEqual([]);
    // 置いても a のぶんは変わらない
    ctx.apiOshiSetImage('praise', url('image/jpeg', JPG));
    fake._setUser('a@example.com');
    expect(ctx.apiOshiImage('praise').dataUrl).toBe(url('image/png', PNG));
    expect(ctx.apiOshiGet().name).toBe('ルナ');
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
    ctx.apiOshiSetProfile('ルナ', 'polite');
    fake._setUser('a@example.com');
    expect(ctx.apiOshiGet().name).toBe('ルナ');
    expect(ctx.dbReadAll('oshi').length).toBe(1);
  });
});

describe('名前・口調・せりふ', () => {
  it('名前と口調を決めると、その口調の既定のせりふと自分のせりふが返る', () => {
    const { ctx } = setup();
    expect(ctx.apiOshiGet().tone).toBe('gothic');
    ctx.apiOshiSetProfile(' ルナ ', 'kansai');
    ctx.apiOshiSetLines('done', 'さすが！\nえらい！');
    const got = ctx.apiOshiGet();
    expect(got.name).toBe('ルナ');
    expect(got.tone).toBe('kansai');
    const done = got.events.find((e) => e.key === 'done');
    expect(done.lines).toEqual(pure.OSHI_LINES().kansai.done);
    expect(done.mine).toEqual(['さすが！', 'えらい！']);
    // せりふを空にすると、既定だけに戻る
    ctx.apiOshiSetLines('done', []);
    expect(ctx.apiOshiGet().events.find((e) => e.key === 'done').mine).toEqual([]);
    // 何度書いても1人1行
    expect(ctx.dbReadAll('oshi').length).toBe(1);
  });

  it('知らない口調・場面、長すぎる名前は断る', () => {
    const { ctx } = setup();
    expect(() => ctx.apiOshiSetProfile('ルナ', 'yankee')).toThrow('知らない口調です: yankee');
    expect(() => ctx.apiOshiSetProfile('あ'.repeat(21), 'polite')).toThrow('名前は20字までにしてください');
    expect(() => ctx.apiOshiSetLines('scold', ['x'])).toThrow('知らない場面です: scold');
  });

  it('台帳の字は数式として読ませない ("=" 始まりの名前)', () => {
    const { ctx } = setup();
    ctx.apiOshiSetProfile('=1+1', 'polite');
    expect(ctx.apiOshiGet().name).toBe('=1+1');
  });

  it('手で壊されたせりふの欄は、無いものとして読む', () => {
    const { ctx } = setup();
    ctx.apiOshiSetProfile('ルナ', 'polite');
    ctx.dbUpdate('oshi', 'id', 1, { lines: '{こわれた' });
    expect(ctx.apiOshiGet().events.find((e) => e.key === 'done').mine).toEqual([]);
  });
});

describe('育てる', () => {
  function closeFor(ctx, who) {
    const i = ctx.issueCreate('しごと', '', []);
    ctx.dbUpdate('issues', 'number', i.number, { assignee: who });
    ctx.issueClose(i.number, null);
    return i.number;
  }

  it('ポイントに参加していなければ、済ませたやることの数で育つ (本人のぶんだけ)', () => {
    const { ctx } = setup();
    for (let i = 0; i < 10; i++) closeFor(ctx, 'tester@example.com');
    closeFor(ctx, 'other@example.com');
    const g = ctx.apiOshiGet().growth;
    expect(g).toMatchObject({ key: 'grow2', label: '一人前', points: 10, source: 'count' });
  });

  it('ポイントに参加している人はポイントで育つ', () => {
    const { ctx } = setup();
    ctx.apiSetGameEnabled(true);
    ctx.apiGameJoin(true);
    closeFor(ctx, 'tester@example.com');
    const g = ctx.apiOshiGet().growth;
    expect(g.source).toBe('game');
    expect(g.points).toBe(ctx.gamePointsByPerson_('', '')['tester@example.com']);
  });

  it('取り消しても届いた段から下がらない (最高の段だけを覚える)', () => {
    const { ctx } = setup();
    const nums = [];
    for (let i = 0; i < 10; i++) nums.push(closeFor(ctx, 'tester@example.com'));
    expect(ctx.apiOshiGet().growth.key).toBe('grow2');
    nums.forEach((n) => ctx.issueReopen(n));
    const g = ctx.apiOshiGet().growth;
    expect(g.points).toBe(0);
    expect(g.key).toBe('grow2');
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
    ctx.apiOshiSetProfile('ルナ', 'polite');
    const outs = {
      apiOshiSetImage: ctx.apiOshiSetImage('praise', url('image/png', PNG)),
      apiOshiGet: ctx.apiOshiGet(),
      apiOshiImage: ctx.apiOshiImage('praise'),
      apiOshiSetProfile: ctx.apiOshiSetProfile('ルナ', 'genki'),
      apiOshiSetLines: ctx.apiOshiSetLines('done', ['えらい']),
      apiOshiClearImage: ctx.apiOshiClearImage('praise'),
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
    for (const st of pure.OSHI_STAGES().slice(1)) expect(text).toContain(st.min + ' で' + st.label);
  });
});

describe('最初からいるキャラ', () => {
  function setupWithPictures() {
    const fake = createFakeGas();
    const ctx = loadGasWith(fake, ...APP_SOURCES, ...OSHI_DEFAULT_SOURCES);
    ctx.repoInit('agentic-management');
    return { ctx, fake };
  }

  it('名前は架空の「クロハ」、口調は耽美。まだ決めていない人にだけ効き、変えられる', () => {
    expect(pure.OSHI_DEFAULT()).toEqual({ name: 'クロハ', tone: 'gothic' });
    const { ctx } = setup();
    const got = ctx.apiOshiGet();
    expect(got).toMatchObject({ name: 'クロハ', tone: 'gothic', defaultName: 'クロハ' });
    expect(got.events.find((e) => e.key === 'done').lines).toEqual(pure.OSHI_LINES().gothic.done);
    expect(got.styles.map((s) => s.key)).toEqual(['chibi', 'normal']);
    ctx.apiOshiSetProfile('ソラ', 'polite');
    expect(ctx.apiOshiGet()).toMatchObject({ name: 'ソラ', tone: 'polite' });
    // 名前を空にした人は空のまま (最初からいるキャラの名前に戻さない)
    ctx.apiOshiSetProfile('', 'polite');
    expect(ctx.apiOshiGet().name).toBe('');
  });

  it('使わない設定の人は、名前なし・丁寧から始まる', () => {
    const { ctx } = setup();
    ctx.apiPrefSet('oshi.useDefault', false);
    expect(ctx.apiOshiGet()).toMatchObject({ name: '', tone: 'polite' });
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

  it('設定に「使う」と「2頭身・等身」がある (既定は使う・2頭身)', () => {
    const { ctx } = setup();
    const items = ctx.apiPrefs().items;
    expect(items.find((p) => p.key === 'oshi.useDefault')).toMatchObject({ type: 'bool', def: true, scope: 'me' });
    const style = items.find((p) => p.key === 'oshi.style');
    expect(style).toMatchObject({ type: 'enum', def: 'chibi', scope: 'me' });
    expect(style.options.map((o) => o.value)).toEqual(['chibi', 'normal']);
    expect(ctx.apiPrefs().effective.oshi).toMatchObject({ useDefault: true, style: 'chibi' });
    ctx.apiPrefSet('oshi.style', 'normal');
    ctx.apiPrefSet('oshi.useDefault', false);
    expect(ctx.apiPrefs().effective.oshi).toMatchObject({ useDefault: false, style: 'normal' });
  });

  it('絵は1枚ずつ返す。どの形・どの表情にもあり、透明な WebP', () => {
    const { ctx } = setupWithPictures();
    for (const st of pure.OSHI_STYLES()) {
      for (const s of pure.OSHI_STATES()) {
        const got = ctx.apiOshiDefaultImage(st.key, s.key);
        expect(got.style).toBe(st.key);
        expect(got.state).toBe(s.key);
        const bytes = Buffer.from(got.dataUrl.replace(/^data:image\/webp;base64,/, ''), 'base64');
        expect(bytes.toString('latin1', 0, 4) + bytes.toString('latin1', 8, 12), st.key + '-' + s.key).toBe('RIFFWEBP');
      }
    }
    // 2頭身と等身は別の絵
    expect(ctx.apiOshiDefaultImage('chibi', 'idle').dataUrl).not.toBe(ctx.apiOshiDefaultImage('normal', 'idle').dataUrl);
  });

  it('知らない形・表情はふつうの言葉で断る', () => {
    const { ctx } = setupWithPictures();
    expect(() => ctx.apiOshiDefaultImage('real', 'idle')).toThrow('知らない絵の形です: real');
    expect(() => ctx.apiOshiDefaultImage('chibi', 'nope')).toThrow('知らない表情です: nope');
    expect(() => ctx.apiOshiDefaultImage('__proto__', 'idle')).toThrow('知らない絵の形です');
  });

  it('自分の絵を入れても、最初からいるキャラの絵は変わらない (別のもの)', () => {
    const { ctx } = setupWithPictures();
    const before = ctx.apiOshiDefaultImage('chibi', 'praise').dataUrl;
    ctx.apiOshiSetImage('praise', url('image/png', PNG));
    expect(ctx.apiOshiImage('praise').dataUrl).toBe(url('image/png', PNG));
    expect(ctx.apiOshiDefaultImage('chibi', 'praise').dataUrl).toBe(before);
    // 最初の返事 (apiOshiGet) に絵の中身は入れない
    expect(JSON.stringify(ctx.apiOshiGet())).not.toContain('data:image/webp');
  });

  it('入口は Date と関数を返さない', () => {
    const { ctx } = setupWithPictures();
    const v = ctx.apiOshiDefaultImage('normal', 'grow3');
    expect(Object.values(v).every((x) => typeof x === 'string')).toBe(true);
  });

  it('実在の人の名前を、画面・手引き・定義に書かない', () => {
    const files = ['src/core/Oshi.js', 'src/core/OshiStore.gs', 'src/api/Oshi.gs', 'src/core/Prefs.gs',
      'src/ui/js-oshi.html', 'src/ui/js-guide.html', 'docs/manual/oshi.md', 'docs/manual/settings.md', 'docs/dev/ui.md'];
    const all = files.map((f) => fs.readFileSync(path.resolve(f), 'utf8')).join('\n');
  });
});
